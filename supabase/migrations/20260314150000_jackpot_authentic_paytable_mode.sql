-- Add AUTHENTIC_PAYTABLE jackpot delivery mode with pre-registered per-spin payout plans.

alter table public.casino_runtime
  add column if not exists jackpot_delivery_mode text not null default 'TARGET_FIRST';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'casino_runtime_jackpot_delivery_mode_check'
      and conrelid = 'public.casino_runtime'::regclass
  ) then
    alter table public.casino_runtime
      add constraint casino_runtime_jackpot_delivery_mode_check
      check (jackpot_delivery_mode = any (array['TARGET_FIRST'::text, 'AUTHENTIC_PAYTABLE'::text]));
  end if;
end;
$$;

update public.casino_runtime
set jackpot_delivery_mode = 'TARGET_FIRST'
where jackpot_delivery_mode is null
  or jackpot_delivery_mode not in ('TARGET_FIRST', 'AUTHENTIC_PAYTABLE');

create table if not exists public.jackpot_payout_plan_steps (
  id bigserial primary key,
  queue_id bigint not null references public.jackpot_payout_queue(id) on delete cascade,
  campaign_id uuid not null,
  device_id text not null references public.devices(device_id) on delete cascade,
  step_index integer not null,
  expected_amount numeric not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (queue_id, step_index)
);

create index if not exists idx_jackpot_plan_steps_queue_unconsumed
  on public.jackpot_payout_plan_steps (queue_id, consumed_at, step_index);

create or replace function public.register_authentic_jackpot_plan(
  p_device_id text,
  p_queue_id bigint,
  p_campaign_id uuid,
  p_expected_amounts numeric[],
  p_tolerance numeric default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.jackpot_payout_queue;
  v_expected_count integer := coalesce(array_length(p_expected_amounts, 1), 0);
  v_i integer := 0;
  v_sum numeric := 0;
  v_amount numeric := 0;
  v_target numeric := 0;
  v_tolerance numeric := least(greatest(coalesce(p_tolerance, 500), 0), 5000);
  v_residual numeric := 0;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  if p_queue_id is null then
    raise exception 'p_queue_id is required';
  end if;

  if p_campaign_id is null then
    raise exception 'p_campaign_id is required';
  end if;

  select * into v_row
  from public.jackpot_payout_queue
  where id = p_queue_id
    and device_id = p_device_id
    and campaign_id = p_campaign_id
    and completed_at is null
  for update;

  if not found then
    raise exception 'Active jackpot queue row not found for device/campaign';
  end if;

  if v_expected_count <= 0 then
    raise exception 'At least one expected payout step is required';
  end if;

  if v_expected_count <> greatest(coalesce(v_row.payouts_left, 0), 0) then
    raise exception 'Expected payout step count (%) must match payouts_left (%)', v_expected_count, v_row.payouts_left;
  end if;

  for v_i in 1..v_expected_count loop
    v_amount := greatest(coalesce(p_expected_amounts[v_i], 0), 0);
    v_sum := v_sum + v_amount;
  end loop;

  v_sum := round(v_sum, 4);
  v_target := round(greatest(coalesce(v_row.remaining_amount, 0), 0), 4);

  if v_sum > v_target + 0.0001 then
    raise exception 'Plan sum (%) cannot exceed queue target (%)', v_sum, v_target;
  end if;

  if v_sum < greatest(v_target - v_tolerance, 0) - 0.0001 then
    raise exception 'Plan sum (%) must be within tolerance of queue target (% - %)', v_sum, v_target, v_tolerance;
  end if;

  delete from public.jackpot_payout_plan_steps
  where queue_id = v_row.id;

  for v_i in 1..v_expected_count loop
    insert into public.jackpot_payout_plan_steps (
      queue_id,
      campaign_id,
      device_id,
      step_index,
      expected_amount,
      created_at
    ) values (
      v_row.id,
      v_row.campaign_id,
      v_row.device_id,
      v_i,
      round(greatest(coalesce(p_expected_amounts[v_i], 0), 0), 4),
      now()
    );
  end loop;

  v_residual := round(greatest(v_target - v_sum, 0), 4);

  update public.jackpot_payout_queue
  set
    target_amount = v_sum,
    remaining_amount = v_sum,
    updated_at = now()
  where id = v_row.id;

  if v_residual > 0 and v_row.jackpot_pot_id is not null then
    update public.jackpot_pots
    set
      amount_total = greatest(amount_total - v_residual, 0),
      amount_remaining = greatest(amount_remaining - v_residual, 0)
    where id = v_row.jackpot_pot_id;

    insert into public.jackpot_pots (
      amount_total,
      amount_remaining,
      status,
      goal_mode,
      goal_snapshot,
      created_at
    )
    values (
      v_residual,
      v_residual,
      'queued',
      'amount',
      jsonb_build_object(
        'reason', 'authentic_plan_residual',
        'sourceQueueId', v_row.id,
        'sourceCampaign', v_row.campaign_id,
        'sourceDeviceId', v_row.device_id,
        'createdAt', now()
      ),
      now()
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'queue_id', v_row.id,
    'campaign_id', v_row.campaign_id,
    'steps', v_expected_count,
    'target_amount', v_target,
    'planned_amount', v_sum,
    'residual_requeued', v_residual
  );
end;
$$;

create or replace function public.process_device_jackpot_payout(
  p_device_id text,
  p_event_ts timestamptz default now()
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.jackpot_payout_queue;
  v_runtime public.casino_runtime;
  v_plan_step public.jackpot_payout_plan_steps;
  v_variance numeric := 0;
  v_base_chunk numeric := 0;
  v_jitter numeric := 0;
  v_payout numeric := 0;
  v_next_spins_until_start integer := 0;
  v_device_is_free_game boolean := false;
  v_curve text := 'center';
  v_delivery_mode text := 'TARGET_FIRST';
  v_total_steps integer := 10;
  v_steps_left integer := 1;
  v_current_step integer := 1;
  v_weight_current numeric := 1;
  v_weight_remaining_sum numeric := 1;
  v_weight_step integer := 1;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return 0;
  end if;

  perform public.finalize_device_jackpot_payouts(p_device_id, coalesce(p_event_ts, now()));

  select * into v_row
  from public.jackpot_payout_queue
  where device_id = p_device_id
    and completed_at is null
  order by created_at asc, id asc
  limit 1
  for update skip locked;

  if not found then
    return 0;
  end if;

  if coalesce(v_row.spins_until_start, 0) > 0 then
    v_next_spins_until_start := greatest(coalesce(v_row.spins_until_start, 0) - 1, 0);

    update public.jackpot_payout_queue
    set
      spins_until_start = v_next_spins_until_start,
      updated_at = now()
    where id = v_row.id;

    if v_next_spins_until_start > 0 then
      return 0;
    end if;
  end if;

  select coalesce(d.is_free_game, false)
    into v_device_is_free_game
  from public.devices d
  where d.device_id = p_device_id;

  if not coalesce(v_device_is_free_game, false) then
    return 0;
  end if;

  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  v_delivery_mode := coalesce(v_runtime.jackpot_delivery_mode, 'TARGET_FIRST');

  if v_delivery_mode = 'AUTHENTIC_PAYTABLE' then
    select * into v_plan_step
    from public.jackpot_payout_plan_steps
    where queue_id = v_row.id
      and consumed_at is null
    order by step_index asc, id asc
    limit 1
    for update skip locked;

    if found then
      v_payout := round(greatest(least(coalesce(v_plan_step.expected_amount, 0), coalesce(v_row.remaining_amount, 0)), 0), 4);

      update public.jackpot_payout_plan_steps
      set consumed_at = coalesce(p_event_ts, now())
      where id = v_plan_step.id;
    end if;
  end if;

  if v_payout <= 0 then
    v_variance := least(greatest(coalesce(v_runtime.jackpot_win_variance, 0), 0), 500);
    v_curve := lower(coalesce(v_runtime.jackpot_payout_curve, 'center'));
    if v_curve not in ('flat', 'front', 'center', 'back') then
      v_curve := 'center';
    end if;

    v_steps_left := greatest(coalesce(v_row.payouts_left, 1), 1);

    if v_steps_left <= 1 or coalesce(v_row.remaining_amount, 0) <= 0 then
      v_payout := greatest(coalesce(v_row.remaining_amount, 0), 0);
    else
      v_current_step := greatest(1, least(v_total_steps - v_steps_left + 1, v_total_steps));
      v_weight_current := public.jackpot_curve_weight(v_current_step, v_total_steps, v_curve);
      v_weight_remaining_sum := 0;

      for v_weight_step in v_current_step..v_total_steps loop
        v_weight_remaining_sum := v_weight_remaining_sum
          + public.jackpot_curve_weight(v_weight_step, v_total_steps, v_curve);
      end loop;

      v_base_chunk := v_row.remaining_amount * v_weight_current / greatest(v_weight_remaining_sum, 0.0001);
      v_jitter := (random() * 2 - 1) * least(v_variance, greatest(v_base_chunk * 0.6, 0));
      v_payout := round(v_base_chunk + v_jitter, 4);
      v_payout := greatest(0, least(v_row.remaining_amount, v_payout));

      if v_payout <= 0 then
        v_payout := least(v_row.remaining_amount, round(v_base_chunk, 4));
      end if;
    end if;
  end if;

  if v_payout <= 0 and coalesce(v_row.remaining_amount, 0) > 0 then
    v_payout := least(v_row.remaining_amount, 0.0001);
  end if;

  if v_payout <= 0 then
    return 0;
  end if;

  update public.jackpot_payout_queue
  set
    remaining_amount = greatest(remaining_amount - v_payout, 0),
    payouts_left = greatest(payouts_left - 1, 0),
    updated_at = now(),
    payout_ready_at = case
      when remaining_amount - v_payout <= 0.0001 or payouts_left - 1 <= 0 then coalesce(p_event_ts, now())
      else payout_ready_at
    end
  where id = v_row.id;

  if v_row.jackpot_pot_id is not null then
    update public.jackpot_pots
    set
      amount_remaining = greatest(amount_remaining - v_payout, 0)
    where id = v_row.jackpot_pot_id;
  end if;

  return greatest(v_payout, 0);
end;
$$;

create or replace view public.casino_runtime_live as
select
  r.id,
  r.active_mode,
  r.base_profile_id,
  r.happy_profile_id,
  r.manual_happy_enabled,
  r.auto_happy_enabled,
  r.prize_pool_balance,
  r.happy_hour_prize_balance,
  r.prize_pool_goal,
  r.jackpot_pool_balance,
  r.jackpot_pool_goal,
  r.jackpot_contrib_pct,
  r.jackpot_min_winners,
  r.jackpot_max_winners,
  r.jackpot_delay_min_spins,
  r.jackpot_delay_max_spins,
  r.jackpot_chunk_min,
  r.jackpot_chunk_max,
  r.jackpot_win_variance,
  r.jackpot_pending_payout,
  r.last_jackpot_triggered_at,
  r.active_happy_pot_id,
  r.active_jackpot_pot_id,
  r.pool_goal_mode,
  r.pool_goal_spins,
  r.pool_goal_time_seconds,
  r.happy_pool_spin_counter,
  r.jackpot_pool_spin_counter,
  r.happy_pool_goal_anchor_at,
  r.jackpot_pool_goal_anchor_at,
  r.max_win_enabled,
  r.max_win_multiplier,
  coalesce((select count(*) from public.happy_hour_pots hp_1 where hp_1.status = 'queued'), 0::bigint) as happy_pots_queued_count,
  coalesce((select sum(hp_1.amount_remaining) from public.happy_hour_pots hp_1 where hp_1.status = 'queued'), 0::numeric) as happy_pots_queued_amount,
  coalesce((select count(*) from public.jackpot_pots jp where jp.status = 'queued'), 0::bigint) as jackpot_pots_queued_count,
  coalesce((select sum(jp.amount_remaining) from public.jackpot_pots jp where jp.status = 'queued'), 0::numeric) as jackpot_pots_queued_amount,
  r.hopper_alert_threshold,
  r.updated_at,
  bp.name as base_profile_name,
  hp.name as happy_profile_name,
  bp.house_pct as base_house_pct,
  bp.pool_pct as base_pool_pct,
  bp.player_pct as base_player_pct,
  hp.house_pct as happy_house_pct,
  hp.pool_pct as happy_pool_pct,
  hp.player_pct as happy_player_pct,
  hp.prize_pct as happy_prize_pct,
  case
    when r.active_mode = 'HAPPY' then hp.player_pct + hp.prize_pct
    else bp.player_pct
  end as active_target_rtp_pct,
  r.jackpot_payout_curve,
  r.jackpot_delivery_mode
from public.casino_runtime r
left join public.rtp_profiles bp on bp.id = r.base_profile_id
left join public.rtp_profiles hp on hp.id = r.happy_profile_id;

grant execute on function public.register_authentic_jackpot_plan(text, bigint, uuid, numeric[], numeric) to anon;
grant execute on function public.register_authentic_jackpot_plan(text, bigint, uuid, numeric[], numeric) to authenticated;
grant execute on function public.register_authentic_jackpot_plan(text, bigint, uuid, numeric[], numeric) to service_role;

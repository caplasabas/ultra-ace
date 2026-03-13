-- Jackpot free-spin payout curve controls + DEV-only test trigger.

alter table public.casino_runtime
  add column if not exists jackpot_payout_curve text not null default 'center';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'casino_runtime_jackpot_payout_curve_check'
      and conrelid = 'public.casino_runtime'::regclass
  ) then
    alter table public.casino_runtime
      add constraint casino_runtime_jackpot_payout_curve_check
      check (jackpot_payout_curve = any (array['flat'::text, 'front'::text, 'center'::text, 'back'::text]));
  end if;
end;
$$;

update public.casino_runtime
set jackpot_payout_curve = 'center'
where jackpot_payout_curve is null
  or lower(jackpot_payout_curve) not in ('flat', 'front', 'center', 'back');

create or replace function public.jackpot_curve_weight(
  p_step_index integer,
  p_total_steps integer,
  p_curve text default 'center'
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_step integer := greatest(coalesce(p_step_index, 1), 1);
  v_total integer := greatest(coalesce(p_total_steps, 1), 1);
  v_curve text := lower(coalesce(p_curve, 'center'));
  v_center numeric := (v_total + 1)::numeric / 2.0;
  v_weight numeric := 1;
begin
  v_step := least(v_step, v_total);

  if v_curve = 'front' then
    v_weight := (v_total - v_step + 1)::numeric;
  elsif v_curve = 'back' then
    v_weight := v_step::numeric;
  elsif v_curve = 'center' then
    v_weight := greatest(
      1,
      ((v_total + 1)::numeric / 2.0) - abs(v_step::numeric - v_center) + 0.5
    );
  else
    v_weight := 1;
  end if;

  return greatest(v_weight, 0.1);
end;
$$;

create or replace function public.trigger_jackpot_payout_if_ready(
  p_event_ts timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_runtime public.casino_runtime;
  v_pot public.jackpot_pots;
  v_pool numeric := 0;
  v_min_winners integer := 1;
  v_max_winners integer := 1;
  v_requested integer := 1;
  v_count integer := 0;
  v_share numeric := 0;
  v_remaining numeric := 0;
  v_overflow numeric := 0;
  v_assigned_total numeric := 0;
  v_actual_winners integer := 0;
  v_campaign_id uuid := gen_random_uuid();
  v_device_ids text[] := '{}';
  v_target_device_ids text[] := '{}';
  v_device_id text;
  v_delay integer := 0;
  v_winner_index integer := 0;
  v_planned numeric := 0;
  v_device_cap numeric := null;
  v_allocate numeric := 0;
begin
  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if not found then
    return jsonb_build_object('triggered', false, 'reason', 'runtime_missing');
  end if;

  if coalesce(v_runtime.jackpot_pending_payout, false) then
    return jsonb_build_object('triggered', false, 'reason', 'pending_campaign');
  end if;

  select * into v_pot
  from public.jackpot_pots
  where status = 'queued'
  order by created_at asc, id asc
  limit 1
  for update skip locked;

  if not found then
    return jsonb_build_object('triggered', false, 'reason', 'no_queued_pot');
  end if;

  v_pool := greatest(coalesce(v_pot.amount_remaining, 0), 0);
  if v_pool <= 0 then
    update public.jackpot_pots
    set
      status = 'completed',
      amount_remaining = 0,
      completed_at = now()
    where id = v_pot.id;

    return jsonb_build_object('triggered', false, 'reason', 'empty_queued_pot');
  end if;

  select array_agg(t.device_id), count(*)
    into v_device_ids, v_count
  from (
    select d.device_id
    from public.devices d
    where d.device_status = 'playing'
    order by random()
  ) t;

  if coalesce(v_count, 0) <= 0 then
    return jsonb_build_object('triggered', false, 'reason', 'no_eligible_devices');
  end if;

  v_min_winners := greatest(coalesce(v_runtime.jackpot_min_winners, 1), 1);
  v_max_winners := greatest(coalesce(v_runtime.jackpot_max_winners, v_min_winners), v_min_winners);
  v_requested := floor(random() * (v_max_winners - v_min_winners + 1))::integer + v_min_winners;
  v_requested := least(v_requested, v_count);

  if v_requested <= 0 then
    return jsonb_build_object('triggered', false, 'reason', 'winner_count_zero');
  end if;

  select coalesce(array_agg(t.device_id), '{}'::text[])
    into v_target_device_ids
  from (
    select device_id
    from unnest(v_device_ids) as d(device_id)
    limit v_requested
  ) t;

  if coalesce(array_length(v_target_device_ids, 1), 0) <= 0 then
    return jsonb_build_object('triggered', false, 'reason', 'winner_selection_failed');
  end if;

  v_share := round(v_pool / greatest(v_requested, 1), 4);
  v_remaining := v_pool;

  v_winner_index := 0;
  foreach v_device_id in array v_target_device_ids loop
    v_winner_index := v_winner_index + 1;
    v_planned := case
      when v_winner_index < v_requested then v_share
      else greatest(v_remaining, 0)
    end;

    if coalesce(v_runtime.max_win_enabled, true) then
      select public.compute_max_win_cap(d.last_bet_amount)
        into v_device_cap
      from public.devices d
      where d.device_id = v_device_id;

      v_allocate := least(v_planned, greatest(coalesce(v_device_cap, 0), 0));
    else
      v_allocate := v_planned;
    end if;

    if coalesce(v_allocate, 0) <= 0 then
      continue;
    end if;

    v_delay := floor(
      random() * (greatest(coalesce(v_runtime.jackpot_delay_max_spins, 3), coalesce(v_runtime.jackpot_delay_min_spins, 2))
      - greatest(coalesce(v_runtime.jackpot_delay_min_spins, 2), 0) + 1)
    )::integer + greatest(coalesce(v_runtime.jackpot_delay_min_spins, 2), 0);

    insert into public.jackpot_payout_queue (
      campaign_id,
      jackpot_pot_id,
      device_id,
      target_amount,
      remaining_amount,
      spins_until_start,
      payouts_left,
      created_at,
      updated_at
    )
    values (
      v_campaign_id,
      v_pot.id,
      v_device_id,
      v_allocate,
      v_allocate,
      v_delay,
      10,
      coalesce(p_event_ts, now()),
      now()
    );

    v_actual_winners := v_actual_winners + 1;
    v_assigned_total := v_assigned_total + v_allocate;
    v_remaining := greatest(v_remaining - v_allocate, 0);
  end loop;

  if v_actual_winners <= 0 or v_assigned_total <= 0 then
    return jsonb_build_object('triggered', false, 'reason', 'no_eligible_devices_for_cap');
  end if;

  v_overflow := greatest(v_remaining, 0);
  if v_overflow > 0.0001 then
    update public.jackpot_pots
    set
      amount_total = greatest(amount_total - v_overflow, 0),
      amount_remaining = greatest(amount_remaining - v_overflow, 0)
    where id = v_pot.id;

    insert into public.jackpot_pots (
      amount_total,
      amount_remaining,
      status,
      goal_mode,
      goal_snapshot,
      created_at
    )
    values (
      v_overflow,
      v_overflow,
      'queued',
      'amount',
      jsonb_build_object(
        'reason', 'trigger_cap_overflow',
        'sourcePotId', v_pot.id,
        'sourceCampaign', v_campaign_id,
        'createdAt', coalesce(p_event_ts, now())
      ),
      coalesce(p_event_ts, now())
    );
  end if;

  update public.jackpot_pots
  set
    status = 'processing',
    campaign_id = v_campaign_id,
    activated_at = coalesce(activated_at, coalesce(p_event_ts, now()))
  where id = v_pot.id;

  update public.casino_runtime
  set
    jackpot_pending_payout = true,
    active_jackpot_pot_id = v_pot.id,
    last_jackpot_triggered_at = coalesce(p_event_ts, now()),
    updated_at = now()
  where id = true;

  return jsonb_build_object(
    'triggered', true,
    'campaign_id', v_campaign_id,
    'pot_id', v_pot.id,
    'winners', v_actual_winners,
    'amount', v_assigned_total,
    'overflow_requeued', v_overflow
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
  v_variance numeric := 0;
  v_base_chunk numeric := 0;
  v_jitter numeric := 0;
  v_payout numeric := 0;
  v_next_spins_until_start integer := 0;
  v_cap_total numeric := null;
  v_cap_remaining numeric := null;
  v_paid_so_far numeric := 0;
  v_overflow numeric := 0;
  v_unallocated numeric := 0;
  v_device_is_free_game boolean := false;
  v_is_dev_test boolean := false;
  v_curve text := 'center';
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

  -- Next event from device acts as payout confirmation for previous ready rows.
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

  -- Jackpot queue pays through jackpot free spins only.
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

  v_variance := greatest(coalesce(v_runtime.jackpot_win_variance, 0), 0);
  v_curve := lower(coalesce(v_runtime.jackpot_payout_curve, 'center'));
  if v_curve not in ('flat', 'front', 'center', 'back') then
    v_curve := 'center';
  end if;

  if v_row.jackpot_pot_id is not null then
    select coalesce(jp.goal_snapshot ->> 'source', '') = 'dev_test'
      into v_is_dev_test
    from public.jackpot_pots jp
    where jp.id = v_row.jackpot_pot_id;
  end if;

  if coalesce(v_runtime.max_win_enabled, true) and not coalesce(v_is_dev_test, false) then
    select public.compute_max_win_cap(d.last_bet_amount)
      into v_cap_total
    from public.devices d
    where d.device_id = p_device_id;

    select coalesce(sum(q.target_amount - q.remaining_amount), 0)
      into v_paid_so_far
    from public.jackpot_payout_queue q
    where q.campaign_id = v_row.campaign_id
      and q.device_id = p_device_id;

    if v_cap_total is null then
      -- No bet context yet: do not force payout to zero.
      v_cap_remaining := null;
    else
      v_cap_remaining := greatest(v_cap_total - coalesce(v_paid_so_far, 0), 0);
    end if;
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

  if v_cap_remaining is not null then
    v_payout := least(v_payout, v_cap_remaining);
  end if;

  if v_payout <= 0
    and not (v_cap_remaining is not null and v_cap_remaining < v_row.remaining_amount) then
    return 0;
  end if;

  if v_cap_remaining is not null and v_cap_remaining < v_row.remaining_amount then
    v_overflow := greatest(v_row.remaining_amount - v_payout, 0);

    update public.jackpot_payout_queue
    set
      remaining_amount = 0,
      payouts_left = 0,
      updated_at = now(),
      payout_ready_at = case
        when v_payout > 0 then coalesce(p_event_ts, now())
        else payout_ready_at
      end,
      completed_at = case
        when v_payout > 0 then completed_at
        else coalesce(p_event_ts, now())
      end
    where id = v_row.id;

    if v_overflow > 0 then
      v_unallocated := public.redistribute_jackpot_overflow(
        p_campaign_id := v_row.campaign_id,
        p_jackpot_pot_id := v_row.jackpot_pot_id,
        p_amount := v_overflow,
        p_exclude_device := p_device_id,
        p_event_ts := coalesce(p_event_ts, now())
      );

      if v_unallocated > 0 and v_row.jackpot_pot_id is not null then
        update public.jackpot_pots
        set amount_remaining = greatest(amount_remaining - v_unallocated, 0)
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
          v_unallocated,
          v_unallocated,
          'queued',
          'amount',
          jsonb_build_object('reason', 'max_win_overflow_no_device', 'sourceCampaign', v_row.campaign_id),
          coalesce(p_event_ts, now())
        );
      end if;
    end if;
  else
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
  end if;

  if v_row.jackpot_pot_id is not null then
    update public.jackpot_pots
    set
      amount_remaining = greatest(amount_remaining - v_payout, 0)
    where id = v_row.jackpot_pot_id;
  end if;

  return greatest(v_payout, 0);
end;
$$;

create or replace function public.enqueue_dev_jackpot_test(
  p_amount numeric,
  p_device_ids text[],
  p_winners integer default 1,
  p_delay_min integer default 0,
  p_delay_max integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_runtime public.casino_runtime;
  v_amount numeric := round(greatest(coalesce(p_amount, 0), 0), 4);
  v_delay_min integer := greatest(coalesce(p_delay_min, 0), 0);
  v_delay_max integer := greatest(coalesce(p_delay_max, 0), 0);
  v_requested integer := greatest(coalesce(p_winners, 1), 1);
  v_device_count integer := 0;
  v_campaign_id uuid := gen_random_uuid();
  v_pot_id bigint;
  v_share numeric := 0;
  v_remaining numeric := 0;
  v_winner_index integer := 0;
  v_delay integer := 0;
  v_device_id text;
  v_selected_device_ids text[] := '{}';
  v_target_device_ids text[] := '{}';
  v_invalid_ids text[] := '{}';
begin
  if v_amount <= 0 then
    raise exception 'p_amount must be greater than 0';
  end if;

  if coalesce(array_length(p_device_ids, 1), 0) <= 0 then
    raise exception 'Select at least one DEV device';
  end if;

  select coalesce(array_agg(distinct trim(req.device_id)), '{}'::text[])
    into v_invalid_ids
  from unnest(p_device_ids) as req(device_id)
  where trim(coalesce(req.device_id, '')) <> ''
    and trim(req.device_id) not like 'dev-%';

  if coalesce(array_length(v_invalid_ids, 1), 0) > 0 then
    raise exception 'Only DEV device IDs are allowed (prefix dev-): %', array_to_string(v_invalid_ids, ', ');
  end if;

  select coalesce(array_agg(t.device_id), '{}'::text[]), count(*)
    into v_selected_device_ids, v_device_count
  from (
    select distinct d.device_id
    from unnest(p_device_ids) as req(device_id)
    join public.devices d
      on d.device_id = trim(req.device_id)
    where trim(coalesce(req.device_id, '')) <> ''
      and d.device_id like 'dev-%'
    order by d.device_id
  ) t;

  if coalesce(v_device_count, 0) <= 0 then
    raise exception 'No eligible DEV devices found';
  end if;

  if exists (
    select 1
    from public.jackpot_payout_queue q
    where q.completed_at is null
      and q.device_id = any(v_selected_device_ids)
  ) then
    raise exception 'One or more selected DEV devices already has active jackpot queue';
  end if;

  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if not found then
    raise exception 'casino_runtime row is missing';
  end if;

  if coalesce(v_runtime.jackpot_pending_payout, false) then
    raise exception 'A jackpot campaign is already pending; finish it first';
  end if;

  v_delay_max := greatest(v_delay_max, v_delay_min);
  v_requested := least(v_requested, v_device_count);

  select coalesce(array_agg(t.device_id), '{}'::text[])
    into v_target_device_ids
  from (
    select device_id
    from unnest(v_selected_device_ids) as d(device_id)
    order by random()
    limit v_requested
  ) t;

  if coalesce(array_length(v_target_device_ids, 1), 0) <= 0 then
    raise exception 'Failed to select DEV winner devices';
  end if;

  insert into public.jackpot_pots (
    amount_total,
    amount_remaining,
    status,
    goal_mode,
    goal_snapshot,
    campaign_id,
    created_at,
    activated_at
  )
  values (
    v_amount,
    v_amount,
    'processing',
    'amount',
    jsonb_build_object(
      'source', 'dev_test',
      'requestedDeviceIds', p_device_ids,
      'winnerDeviceIds', v_target_device_ids,
      'winnerCount', v_requested,
      'delayMinSpins', v_delay_min,
      'delayMaxSpins', v_delay_max,
      'createdAt', now()
    ),
    v_campaign_id,
    now(),
    now()
  )
  returning id into v_pot_id;

  v_share := round(v_amount / greatest(v_requested, 1), 4);
  v_remaining := v_amount;

  v_winner_index := 0;
  foreach v_device_id in array v_target_device_ids loop
    v_winner_index := v_winner_index + 1;
    v_delay := floor(random() * (v_delay_max - v_delay_min + 1))::integer + v_delay_min;

    insert into public.jackpot_payout_queue (
      campaign_id,
      jackpot_pot_id,
      device_id,
      target_amount,
      remaining_amount,
      spins_until_start,
      payouts_left,
      created_at,
      updated_at
    )
    values (
      v_campaign_id,
      v_pot_id,
      v_device_id,
      case when v_winner_index < v_requested then v_share else greatest(v_remaining, 0) end,
      case when v_winner_index < v_requested then v_share else greatest(v_remaining, 0) end,
      v_delay,
      10,
      now(),
      now()
    );

    if v_winner_index < v_requested then
      v_remaining := greatest(v_remaining - v_share, 0);
    else
      v_remaining := 0;
    end if;
  end loop;

  update public.casino_runtime
  set
    jackpot_pending_payout = true,
    active_jackpot_pot_id = v_pot_id,
    last_jackpot_triggered_at = now(),
    updated_at = now()
  where id = true;

  return jsonb_build_object(
    'ok', true,
    'campaign_id', v_campaign_id,
    'pot_id', v_pot_id,
    'amount', v_amount,
    'winner_count', v_requested,
    'winner_device_ids', v_target_device_ids
  );
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
  r.jackpot_payout_curve
from public.casino_runtime r
left join public.rtp_profiles bp on bp.id = r.base_profile_id
left join public.rtp_profiles hp on hp.id = r.happy_profile_id;

grant execute on function public.enqueue_dev_jackpot_test(numeric, text[], integer, integer, integer) to anon;
grant execute on function public.enqueue_dev_jackpot_test(numeric, text[], integer, integer, integer) to authenticated;
grant execute on function public.enqueue_dev_jackpot_test(numeric, text[], integer, integer, integer) to service_role;

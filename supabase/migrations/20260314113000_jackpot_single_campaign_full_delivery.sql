-- Ensure one jackpot campaign delivers its assigned amount in a single 10-spin jackpot cycle.
-- Removes jackpot max-win capping/overflow splitting from queue assignment and payout processing.

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
  v_campaign_id uuid := gen_random_uuid();
  v_device_ids text[] := '{}';
  v_device_id text;
  v_delay integer := 0;
  v_winner_index integer := 0;
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
    limit greatest(coalesce(v_runtime.jackpot_max_winners, 1), 1)
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

  v_share := round(v_pool / v_requested, 4);
  v_remaining := v_pool;

  v_winner_index := 0;
  foreach v_device_id in array v_device_ids loop
    exit when v_winner_index >= v_requested;
    v_winner_index := v_winner_index + 1;

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
      case when v_winner_index < v_requested then v_share else greatest(v_remaining, 0) end,
      case when v_winner_index < v_requested then v_share else greatest(v_remaining, 0) end,
      v_delay,
      10,
      coalesce(p_event_ts, now()),
      now()
    );

    if v_winner_index < v_requested then
      v_remaining := greatest(v_remaining - v_share, 0);
    else
      v_remaining := 0;
    end if;
  end loop;

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
    'winners', v_requested,
    'amount', v_pool
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
  v_device_is_free_game boolean := false;
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

  v_variance := greatest(coalesce(v_runtime.jackpot_win_variance, 0), 0);
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

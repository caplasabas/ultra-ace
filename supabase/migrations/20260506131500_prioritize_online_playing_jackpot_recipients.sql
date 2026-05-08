CREATE OR REPLACE FUNCTION public.redistribute_jackpot_overflow(
  p_campaign_id uuid,
  p_jackpot_pot_id bigint,
  p_amount numeric,
  p_exclude_device text DEFAULT NULL::text,
  p_event_ts timestamp with time zone DEFAULT now()
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_remaining numeric := greatest(coalesce(p_amount, 0), 0);
  v_runtime public.casino_runtime;
  v_device_id text;
  v_room numeric := 0;
  v_allocate numeric := 0;
  v_tried text[] := '{}';
  v_paid_so_far numeric := 0;
  v_device_cap numeric := null;
begin
  if v_remaining <= 0 then
    return 0;
  end if;

  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  loop
    exit when v_remaining <= 0;

    select d.device_id
      into v_device_id
    from public.devices d
    where public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, coalesce(p_event_ts, now()))
      and public.resolve_device_presence_status(d.device_status, d.last_seen_at, coalesce(p_event_ts, now())) <> 'offline'
      and (p_exclude_device is null or d.device_id <> p_exclude_device)
      and not (d.device_id = any(v_tried))
    order by
      case
        when coalesce(nullif(trim(d.deployment_mode), ''), 'online') = 'online'
          and public.resolve_device_presence_status(d.device_status, d.last_seen_at, coalesce(p_event_ts, now())) = 'playing'
          then 0
        when coalesce(nullif(trim(d.deployment_mode), ''), 'online') = 'online'
          and public.resolve_device_presence_status(d.device_status, d.last_seen_at, coalesce(p_event_ts, now())) <> 'offline'
          then 1
        else 2
      end,
      random()
    limit 1;

    if v_device_id is null then
      exit;
    end if;

    v_tried := array_append(v_tried, v_device_id);

    if coalesce(v_runtime.max_win_enabled, true) then
      select coalesce(sum(q.target_amount - q.remaining_amount), 0)
        into v_paid_so_far
      from public.jackpot_payout_queue q
      where q.campaign_id = p_campaign_id
        and q.device_id = v_device_id;

      select public.compute_max_win_cap(d.last_bet_amount)
        into v_device_cap
      from public.devices d
      where d.device_id = v_device_id;

      if v_device_cap is null then
        v_room := 0;
      else
        v_room := greatest(v_device_cap - v_paid_so_far, 0);
      end if;
    else
      v_room := v_remaining;
    end if;

    if coalesce(v_room, 0) <= 0 then
      continue;
    end if;

    v_allocate := least(v_remaining, v_room);

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
      p_campaign_id,
      p_jackpot_pot_id,
      v_device_id,
      v_allocate,
      v_allocate,
      0,
      1,
      coalesce(p_event_ts, now()),
      now()
    );

    v_remaining := greatest(v_remaining - v_allocate, 0);
  end loop;

  return v_remaining;
end;
$$;

ALTER FUNCTION public.redistribute_jackpot_overflow(uuid, bigint, numeric, text, timestamp with time zone) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.finalize_device_jackpot_payouts(
  p_device_id text,
  p_event_ts timestamp with time zone DEFAULT now()
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_updated bigint := 0;
  v_next_active_pot_id bigint := null;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return;
  end if;

  update public.jackpot_payout_queue
  set
    completed_at = coalesce(p_event_ts, now()),
    payouts_left = 0,
    updated_at = now()
  where device_id = p_device_id
    and completed_at is null
    and (
      coalesce(remaining_amount, 0) <= 0.0001
      or coalesce(payouts_left, 0) <= 0
    );

  get diagnostics v_updated = row_count;

  if v_updated <= 0 then
    return;
  end if;

  update public.jackpot_pots jp
  set
    status = 'completed',
    amount_remaining = 0,
    completed_at = coalesce(p_event_ts, now())
  where jp.status = 'processing'
    and not exists (
      select 1
      from public.jackpot_payout_queue q
      where q.jackpot_pot_id = jp.id
        and q.completed_at is null
    );

  select jp.id
    into v_next_active_pot_id
  from public.jackpot_pots jp
  where jp.status = 'processing'
    and exists (
      select 1
      from public.jackpot_payout_queue q
      where q.jackpot_pot_id = jp.id
        and q.completed_at is null
    )
  order by jp.activated_at asc nulls last, jp.id asc
  limit 1;

  update public.casino_runtime
  set
    jackpot_pending_payout = v_next_active_pot_id is not null,
    active_jackpot_pot_id = v_next_active_pot_id,
    updated_at = now()
  where id = true;

  perform public.trigger_jackpot_payout_if_ready(coalesce(p_event_ts, now()));
end;
$$;

ALTER FUNCTION public.finalize_device_jackpot_payouts(text, timestamp with time zone) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.trigger_jackpot_payout_if_ready(
  p_event_ts timestamp with time zone DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_runtime public.casino_runtime;
  v_pot public.jackpot_pots;
  v_pool numeric := 0;
  v_min_winners integer := 1;
  v_max_winners integer := 1;
  v_requested integer := 1;
  v_count integer := 0;
  v_primary_count integer := 0;
  v_online_count integer := 0;
  v_active_open_count integer := 0;
  v_share numeric := 0;
  v_remaining numeric := 0;
  v_overflow numeric := 0;
  v_assigned_total numeric := 0;
  v_actual_winners integer := 0;
  v_campaign_id uuid := gen_random_uuid();
  v_device_ids text[] := '{}'::text[];
  v_target_device_ids text[] := '{}'::text[];
  v_overflow_candidate_ids text[] := '{}'::text[];
  v_awarded_device_ids text[] := '{}'::text[];
  v_device_id text;
  v_delay integer := 0;
  v_delay_min integer := 0;
  v_delay_max integer := 0;
  v_winner_index integer := 0;
  v_planned numeric := 0;
  v_device_cap numeric := null;
  v_allocate numeric := 0;
  v_allow_variance_over_cap boolean := false;
  v_variance_over_cap_limit numeric := 200;
  v_absorb_queue_id bigint := null;
begin
  select *
    into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if not found then
    return jsonb_build_object('triggered', false, 'reason', 'runtime_missing');
  end if;

  v_allow_variance_over_cap :=
    lower(coalesce(v_runtime.jackpot_delivery_mode, 'TARGET_FIRST')) = 'authentic_paytable';

  select count(*)
    into v_active_open_count
  from public.jackpot_payout_queue q
  where q.completed_at is null;

  select *
    into v_pot
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

  select
    count(*) filter (
      where coalesce(nullif(trim(d.deployment_mode), ''), 'online') = 'online'
        and public.resolve_device_presence_status(d.device_status, d.last_seen_at, coalesce(p_event_ts, now())) = 'playing'
    ),
    count(*) filter (
      where coalesce(nullif(trim(d.deployment_mode), ''), 'online') = 'online'
        and public.resolve_device_presence_status(d.device_status, d.last_seen_at, coalesce(p_event_ts, now())) <> 'offline'
    )
    into v_primary_count, v_online_count
  from public.devices d
  where public.should_count_device_activity(
      d.deployment_mode,
      d.device_status,
      d.last_seen_at,
      coalesce(p_event_ts, now())
    )
    and public.resolve_device_presence_status(d.device_status, d.last_seen_at, coalesce(p_event_ts, now())) <> 'offline'
    and not exists (
      select 1
      from public.jackpot_payout_queue q
      where q.device_id = d.device_id
        and q.completed_at is null
    );

  select coalesce(array_agg(t.device_id), '{}'::text[]), count(*)
    into v_device_ids, v_count
  from (
    select d.device_id
    from public.devices d
    where public.should_count_device_activity(
        d.deployment_mode,
        d.device_status,
        d.last_seen_at,
        coalesce(p_event_ts, now())
      )
      and public.resolve_device_presence_status(d.device_status, d.last_seen_at, coalesce(p_event_ts, now())) <> 'offline'
      and (
        coalesce(v_active_open_count, 0) <= 0
        or (
          coalesce(nullif(trim(d.deployment_mode), ''), 'online') = 'online'
          and public.resolve_device_presence_status(d.device_status, d.last_seen_at, coalesce(p_event_ts, now())) = 'playing'
        )
      )
      and not exists (
        select 1
        from public.jackpot_payout_queue q
        where q.device_id = d.device_id
          and q.completed_at is null
      )
    order by
      case
        when coalesce(nullif(trim(d.deployment_mode), ''), 'online') = 'online'
          and public.resolve_device_presence_status(d.device_status, d.last_seen_at, coalesce(p_event_ts, now())) = 'playing'
          then 0
        when coalesce(nullif(trim(d.deployment_mode), ''), 'online') = 'online'
          and public.resolve_device_presence_status(d.device_status, d.last_seen_at, coalesce(p_event_ts, now())) <> 'offline'
          then 1
        else 2
      end,
      random()
  ) t;

  if coalesce(v_count, 0) <= 0 then
    return jsonb_build_object('triggered', false, 'reason', 'no_eligible_devices');
  end if;

  if coalesce(v_active_open_count, 0) > 0 and coalesce(v_primary_count, 0) <= 0 then
    return jsonb_build_object('triggered', false, 'reason', 'no_playing_online_capacity');
  end if;

  v_delay_min := greatest(coalesce(v_runtime.jackpot_delay_min_spins, 2), 0);
  v_delay_max := greatest(coalesce(v_runtime.jackpot_delay_max_spins, v_delay_min), v_delay_min);

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
      select coalesce(public.compute_max_win_cap(d.last_bet_amount), 3000)
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
      v_pot.id,
      v_device_id,
      v_allocate,
      v_allocate,
      v_delay,
      10,
      coalesce(p_event_ts, now()),
      now()
    );

    v_remaining := greatest(v_remaining - v_allocate, 0);
    v_assigned_total := v_assigned_total + v_allocate;
    v_awarded_device_ids := array_append(v_awarded_device_ids, v_device_id);
    v_actual_winners := v_actual_winners + 1;
  end loop;

  if v_remaining > 0.0001 then
    select coalesce(array_agg(t.device_id), '{}'::text[])
      into v_overflow_candidate_ids
    from (
      select d.device_id
      from unnest(v_device_ids) as d(device_id)
      where not (d.device_id = any(v_awarded_device_ids))
      order by random()
    ) t;

    foreach v_device_id in array v_overflow_candidate_ids loop
      exit when v_remaining <= 0.0001;

      if coalesce(v_runtime.max_win_enabled, true) then
        select coalesce(public.compute_max_win_cap(d.last_bet_amount), 3000)
          into v_device_cap
        from public.devices d
        where d.device_id = v_device_id;

        v_allocate := least(v_remaining, greatest(coalesce(v_device_cap, 0), 0));
      else
        v_allocate := v_remaining;
      end if;

      if coalesce(v_allocate, 0) <= 0 then
        continue;
      end if;

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
        v_pot.id,
        v_device_id,
        v_allocate,
        v_allocate,
        v_delay,
        10,
        coalesce(p_event_ts, now()),
        now()
      );

      v_awarded_device_ids := array_append(v_awarded_device_ids, v_device_id);
      v_actual_winners := v_actual_winners + 1;
      v_assigned_total := v_assigned_total + v_allocate;
      v_remaining := greatest(v_remaining - v_allocate, 0);
    end loop;
  end if;

  if v_remaining > 0.0001
    and v_allow_variance_over_cap
    and v_remaining <= v_variance_over_cap_limit
    and v_actual_winners > 0 then
    select q.id
      into v_absorb_queue_id
    from public.jackpot_payout_queue q
    where q.campaign_id = v_campaign_id
      and q.jackpot_pot_id = v_pot.id
      and q.completed_at is null
    order by q.target_amount desc, q.created_at asc, q.id asc
    limit 1
    for update skip locked;

    if found then
      update public.jackpot_payout_queue
      set
        target_amount = target_amount + v_remaining,
        remaining_amount = remaining_amount + v_remaining,
        updated_at = now()
      where id = v_absorb_queue_id;

      v_assigned_total := v_assigned_total + v_remaining;
      v_remaining := 0;
    end if;
  end if;

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

    update public.casino_runtime
    set
      prize_pool_balance = greatest(coalesce(prize_pool_balance, 0) + v_overflow, 0),
      updated_at = now()
    where id = true;
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
    'winner_device_ids', v_awarded_device_ids,
    'amount', v_assigned_total,
    'overflow_requeued', 0,
    'overflow_to_happy_pool', v_overflow,
    'recipient_pool',
    case
      when coalesce(v_primary_count, 0) >= v_actual_winners then 'playing_online'
      when coalesce(v_online_count, 0) >= v_actual_winners then 'online'
      else 'eligible_fallback'
    end
  );
end;
$$;

ALTER FUNCTION public.trigger_jackpot_payout_if_ready(timestamp with time zone) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.process_pool_goal_queues(
  p_event_ts timestamp with time zone DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_runtime public.casino_runtime;
  v_now timestamptz := coalesce(p_event_ts, now());
  v_happy_reached boolean := false;
  v_jackpot_reached boolean := false;
  v_spin_target bigint := 1000;
  v_time_target integer := 1800;
  v_mode text := 'amount';
  v_jackpot_pot_amount numeric := 0;
  v_jackpot_overflow_to_happy numeric := 0;
begin
  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'runtime_missing');
  end if;

  v_mode := lower(coalesce(v_runtime.pool_goal_mode, 'amount'));
  if v_mode not in ('amount', 'spins', 'time') then
    v_mode := 'amount';
  end if;

  v_spin_target := greatest(coalesce(v_runtime.pool_goal_spins, 1000), 1);
  v_time_target := greatest(coalesce(v_runtime.pool_goal_time_seconds, 1800), 1);

  if v_mode = 'amount' then
    v_happy_reached := v_runtime.prize_pool_balance >= greatest(coalesce(v_runtime.prize_pool_goal, 0), 0)
      and v_runtime.prize_pool_balance > 0;
    v_jackpot_reached := v_runtime.jackpot_pool_balance >= greatest(coalesce(v_runtime.jackpot_pool_goal, 0), 0)
      and v_runtime.jackpot_pool_balance > 0;
  elsif v_mode = 'spins' then
    v_happy_reached := v_runtime.happy_pool_spin_counter >= v_spin_target and v_runtime.prize_pool_balance > 0;
    v_jackpot_reached := v_runtime.jackpot_pool_spin_counter >= v_spin_target and v_runtime.jackpot_pool_balance > 0;
  else
    v_happy_reached := extract(epoch from (v_now - coalesce(v_runtime.happy_pool_goal_anchor_at, v_now))) >= v_time_target
      and v_runtime.prize_pool_balance > 0;
    v_jackpot_reached := extract(epoch from (v_now - coalesce(v_runtime.jackpot_pool_goal_anchor_at, v_now))) >= v_time_target
      and v_runtime.jackpot_pool_balance > 0;
  end if;

  if v_happy_reached then
    insert into public.happy_hour_pots (
      amount_total,
      amount_remaining,
      status,
      goal_mode,
      goal_snapshot,
      created_at
    )
    values (
      greatest(v_runtime.prize_pool_balance, 0),
      greatest(v_runtime.prize_pool_balance, 0),
      'queued',
      v_mode,
      jsonb_build_object(
        'goalAmount', v_runtime.prize_pool_goal,
        'goalSpins', v_spin_target,
        'goalTimeSeconds', v_time_target,
        'triggeredAt', v_now
      ),
      v_now
    );

    update public.casino_runtime
    set
      prize_pool_balance = 0,
      happy_pool_spin_counter = 0,
      happy_pool_goal_anchor_at = v_now,
      updated_at = now()
    where id = true;
  end if;

  if v_jackpot_reached then
    v_jackpot_pot_amount := case
      when v_mode = 'amount' then least(
        greatest(coalesce(v_runtime.jackpot_pool_balance, 0), 0),
        greatest(coalesce(v_runtime.jackpot_pool_goal, 0), 0)
      )
      else greatest(coalesce(v_runtime.jackpot_pool_balance, 0), 0)
    end;

    v_jackpot_overflow_to_happy := case
      when v_mode = 'amount' then greatest(coalesce(v_runtime.jackpot_pool_balance, 0) - v_jackpot_pot_amount, 0)
      else 0
    end;

    insert into public.jackpot_pots (
      amount_total,
      amount_remaining,
      status,
      goal_mode,
      goal_snapshot,
      created_at
    )
    values (
      v_jackpot_pot_amount,
      v_jackpot_pot_amount,
      'queued',
      v_mode,
      jsonb_build_object(
        'goalAmount', v_runtime.jackpot_pool_goal,
        'goalSpins', v_spin_target,
        'goalTimeSeconds', v_time_target,
        'triggeredAt', v_now,
        'overflowToHappyPool', v_jackpot_overflow_to_happy
      ),
      v_now
    );

    update public.casino_runtime
    set
      jackpot_pool_balance = 0,
      prize_pool_balance = greatest(coalesce(prize_pool_balance, 0) + v_jackpot_overflow_to_happy, 0),
      jackpot_pool_spin_counter = 0,
      jackpot_pool_goal_anchor_at = v_now,
      updated_at = now()
    where id = true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'happyReached', v_happy_reached,
    'jackpotReached', v_jackpot_reached,
    'jackpotOverflowToHappyPool', v_jackpot_overflow_to_happy
  );
end;
$$;

ALTER FUNCTION public.process_pool_goal_queues(timestamp with time zone) OWNER TO postgres;

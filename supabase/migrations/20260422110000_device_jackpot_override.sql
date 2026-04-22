CREATE OR REPLACE FUNCTION public.finalize_device_jackpot_payouts(
  p_device_id text,
  p_event_ts timestamp with time zone DEFAULT now()
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_runtime public.casino_runtime;
  v_updated bigint := 0;
  v_active_open_rows bigint := 0;
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

  select *
    into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if not found then
    return;
  end if;

  if v_runtime.active_jackpot_pot_id is null then
    return;
  end if;

  select count(*)
    into v_active_open_rows
  from public.jackpot_payout_queue
  where jackpot_pot_id = v_runtime.active_jackpot_pot_id
    and completed_at is null;

  if v_active_open_rows > 0 then
    return;
  end if;

  update public.jackpot_pots
  set
    status = 'completed',
    amount_remaining = 0,
    completed_at = coalesce(p_event_ts, now())
  where id = v_runtime.active_jackpot_pot_id;

  update public.casino_runtime
  set
    jackpot_pending_payout = false,
    active_jackpot_pot_id = null,
    updated_at = now()
  where id = true;

  perform public.trigger_jackpot_payout_if_ready(coalesce(p_event_ts, now()));
end;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_device_jackpot_override(
  p_device_id text,
  p_amount numeric,
  p_step_count integer DEFAULT 10
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_device public.devices;
  v_amount numeric := round(greatest(coalesce(p_amount, 0), 0), 4);
  v_step_count integer := greatest(coalesce(p_step_count, 10), 1);
  v_campaign_id uuid := gen_random_uuid();
  v_pot_id bigint;
  v_queue_id bigint;
  v_step_amount numeric := 0;
  v_current_step_amount numeric := 0;
  v_remaining numeric := 0;
  v_now timestamp with time zone := now();
  v_i integer := 0;
begin
  if trim(coalesce(p_device_id, '')) = '' then
    raise exception 'p_device_id is required';
  end if;

  if v_amount <= 0 then
    raise exception 'p_amount must be greater than 0';
  end if;

  if v_step_count < 1 or v_step_count > 50 then
    raise exception 'p_step_count must be between 1 and 50';
  end if;

  select *
    into v_device
  from public.devices
  where device_id = trim(p_device_id)
  for update;

  if not found then
    raise exception 'Device not found: %', p_device_id;
  end if;

  if coalesce(v_device.is_free_game, false)
     or coalesce(v_device.pending_free_spins, 0) > 0
     or coalesce(v_device.show_free_spin_intro, false) then
    raise exception 'Device % is currently in a free-spin flow; wait until it finishes before overriding jackpot', p_device_id;
  end if;

  if exists (
    select 1
    from public.jackpot_payout_queue q
    where q.device_id = v_device.device_id
      and q.completed_at is null
  ) then
    raise exception 'Device % already has an active jackpot queue', v_device.device_id;
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
      'source', 'dashboard_device_override',
      'deviceId', v_device.device_id,
      'deviceName', coalesce(v_device.name, ''),
      'stepCount', v_step_count,
      'createdAt', v_now
    ),
    v_campaign_id,
    v_now,
    v_now
  )
  returning id into v_pot_id;

  insert into public.jackpot_payout_queue (
    campaign_id,
    jackpot_pot_id,
    device_id,
    target_amount,
    remaining_amount,
    spins_until_start,
    payouts_left,
    created_at,
    updated_at,
    payout_ready_at
  )
  values (
    v_campaign_id,
    v_pot_id,
    v_device.device_id,
    v_amount,
    v_amount,
    0,
    v_step_count,
    v_now,
    v_now,
    v_now
  )
  returning id into v_queue_id;

  v_step_amount := round(v_amount / v_step_count, 4);
  v_remaining := v_amount;

  for v_i in 1..v_step_count loop
    v_current_step_amount := case
      when v_i < v_step_count then v_step_amount
      else round(greatest(v_remaining, 0), 4)
    end;

    insert into public.jackpot_payout_plan_steps (
      queue_id,
      campaign_id,
      device_id,
      step_index,
      expected_amount,
      created_at
    )
    values (
      v_queue_id,
      v_campaign_id,
      v_device.device_id,
      v_i,
      v_current_step_amount,
      v_now
    );

    v_remaining := round(greatest(v_remaining - v_current_step_amount, 0), 4);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'device_id', v_device.device_id,
    'queue_id', v_queue_id,
    'campaign_id', v_campaign_id,
    'pot_id', v_pot_id,
    'amount', v_amount,
    'step_count', v_step_count
  );
end;
$$;

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

  if coalesce(v_runtime.jackpot_pending_payout, false) then
    return jsonb_build_object('triggered', false, 'reason', 'pending_campaign');
  end if;

  v_allow_variance_over_cap :=
    lower(coalesce(v_runtime.jackpot_delivery_mode, 'TARGET_FIRST')) = 'authentic_paytable';

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

  select coalesce(array_agg(t.device_id), '{}'::text[]), count(*)
    into v_device_ids, v_count
  from (
    select d.device_id
    from public.devices d
    where d.device_status = 'playing'
      and public.should_count_device_activity(
        d.deployment_mode,
        d.device_status,
        d.last_seen_at,
        coalesce(p_event_ts, now())
      )
      and not exists (
        select 1
        from public.jackpot_payout_queue q
        where q.device_id = d.device_id
          and q.completed_at is null
      )
    order by random()
  ) t;

  if coalesce(v_count, 0) <= 0 then
    return jsonb_build_object('triggered', false, 'reason', 'no_eligible_devices');
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
    'winner_device_ids', v_awarded_device_ids,
    'amount', v_assigned_total,
    'overflow_requeued', v_overflow
  );
end;
$$;

GRANT ALL ON FUNCTION public.finalize_device_jackpot_payouts(text, timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.finalize_device_jackpot_payouts(text, timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.finalize_device_jackpot_payouts(text, timestamp with time zone) TO service_role;

GRANT ALL ON FUNCTION public.enqueue_device_jackpot_override(text, numeric, integer) TO anon;
GRANT ALL ON FUNCTION public.enqueue_device_jackpot_override(text, numeric, integer) TO authenticated;
GRANT ALL ON FUNCTION public.enqueue_device_jackpot_override(text, numeric, integer) TO service_role;

GRANT ALL ON FUNCTION public.trigger_jackpot_payout_if_ready(timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.trigger_jackpot_payout_if_ready(timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.trigger_jackpot_payout_if_ready(timestamp with time zone) TO service_role;

-- Allow small AUTHENTIC_PAYTABLE variance bonus to bypass max-win assignment cap (up to 200)
-- so tiny add-ons are included in the active jackpot target instead of becoming leftover mini-queues.

-- Redistribute capped jackpot overflow immediately to additional winners in the same campaign.
-- Keep DEV test default behavior aligned with real max-win capping, with optional override.

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
  v_overflow_candidate_ids text[] := '{}';
  v_awarded_device_ids text[] := '{}';
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

  v_allow_variance_over_cap :=
    lower(coalesce(v_runtime.jackpot_delivery_mode, 'TARGET_FIRST')) = 'authentic_paytable';

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

  select coalesce(array_agg(t.device_id), '{}'::text[]), count(*)
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

    v_awarded_device_ids := array_append(v_awarded_device_ids, v_device_id);
    v_actual_winners := v_actual_winners + 1;
    v_assigned_total := v_assigned_total + v_allocate;
    v_remaining := greatest(v_remaining - v_allocate, 0);
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

create or replace function public.enqueue_dev_jackpot_test(
  p_amount numeric,
  p_device_ids text[],
  p_winners integer,
  p_delay_min integer,
  p_delay_max integer,
  p_ignore_max_win boolean
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
  v_ignore_max_win boolean := coalesce(p_ignore_max_win, false);
  v_device_count integer := 0;
  v_campaign_id uuid := gen_random_uuid();
  v_pot_id bigint;
  v_share numeric := 0;
  v_remaining numeric := 0;
  v_overflow numeric := 0;
  v_assigned_total numeric := 0;
  v_actual_winners integer := 0;
  v_winner_index integer := 0;
  v_delay integer := 0;
  v_device_id text;
  v_selected_device_ids text[] := '{}';
  v_target_device_ids text[] := '{}';
  v_overflow_candidate_ids text[] := '{}';
  v_awarded_device_ids text[] := '{}';
  v_invalid_ids text[] := '{}';
  v_planned numeric := 0;
  v_device_cap numeric := null;
  v_allocate numeric := 0;
  v_allow_variance_over_cap boolean := false;
  v_variance_over_cap_limit numeric := 200;
  v_absorb_queue_id bigint := null;
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
    select dd.device_id
    from (
      select distinct d.device_id
      from unnest(p_device_ids) as req(device_id)
      join public.devices d
        on d.device_id = trim(req.device_id)
      where trim(coalesce(req.device_id, '') ) <> ''
        and d.device_id like 'dev-%'
    ) dd
    order by random()
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

  v_allow_variance_over_cap :=
    lower(coalesce(v_runtime.jackpot_delivery_mode, 'TARGET_FIRST')) = 'authentic_paytable';

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
      'ignoreMaxWin', v_ignore_max_win,
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
    v_planned := case
      when v_winner_index < v_requested then v_share
      else greatest(v_remaining, 0)
    end;

    if not v_ignore_max_win and coalesce(v_runtime.max_win_enabled, true) then
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
      v_pot_id,
      v_device_id,
      v_allocate,
      v_allocate,
      v_delay,
      10,
      now(),
      now()
    );

    v_awarded_device_ids := array_append(v_awarded_device_ids, v_device_id);
    v_actual_winners := v_actual_winners + 1;
    v_assigned_total := v_assigned_total + v_allocate;
    v_remaining := greatest(v_remaining - v_allocate, 0);
  end loop;

  if v_remaining > 0.0001 then
    select coalesce(array_agg(t.device_id), '{}'::text[])
      into v_overflow_candidate_ids
    from (
      select d.device_id
      from unnest(v_selected_device_ids) as d(device_id)
      where not (d.device_id = any(v_awarded_device_ids))
      order by random()
    ) t;

    foreach v_device_id in array v_overflow_candidate_ids loop
      exit when v_remaining <= 0.0001;

      if not v_ignore_max_win and coalesce(v_runtime.max_win_enabled, true) then
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
        v_pot_id,
        v_device_id,
        v_allocate,
        v_allocate,
        v_delay,
        10,
        now(),
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
      and q.jackpot_pot_id = v_pot_id
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
    raise exception 'No eligible DEV devices after max-win cap filtering';
  end if;

  v_overflow := greatest(v_remaining, 0);
  if v_overflow > 0.0001 then
    update public.jackpot_pots
    set
      amount_total = greatest(amount_total - v_overflow, 0),
      amount_remaining = greatest(amount_remaining - v_overflow, 0)
    where id = v_pot_id;

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
        'reason', 'dev_test_cap_overflow',
        'sourcePotId', v_pot_id,
        'sourceCampaign', v_campaign_id,
        'ignoreMaxWin', v_ignore_max_win,
        'createdAt', now()
      ),
      now()
    );
  end if;

  update public.casino_runtime
  set
    jackpot_pending_payout = true,
    active_jackpot_pot_id = v_pot_id,
    last_jackpot_triggered_at = now(),
    updated_at = now()
  where id = true;

  update public.jackpot_pots
  set goal_snapshot = coalesce(goal_snapshot, '{}'::jsonb) || jsonb_build_object(
    'assignedWinnerDeviceIds', v_awarded_device_ids,
    'assignedAmount', v_assigned_total,
    'overflowRequeued', v_overflow
  )
  where id = v_pot_id;

  return jsonb_build_object(
    'ok', true,
    'campaign_id', v_campaign_id,
    'pot_id', v_pot_id,
    'amount', v_amount,
    'assigned_amount', v_assigned_total,
    'overflow_requeued', v_overflow,
    'winner_count', v_actual_winners,
    'winner_device_ids', v_awarded_device_ids,
    'ignore_max_win', v_ignore_max_win
  );
end;
$$;

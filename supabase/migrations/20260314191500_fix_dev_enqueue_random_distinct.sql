-- Fix DEV jackpot RPC distinct-random winner selection query for Postgres (42P10).

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
begin
  return public.enqueue_dev_jackpot_test(
    p_amount := p_amount,
    p_device_ids := p_device_ids,
    p_winners := p_winners,
    p_delay_min := p_delay_min,
    p_delay_max := p_delay_max,
    p_ignore_max_win := false
  );
end;
$$;

grant execute on function public.enqueue_dev_jackpot_test(numeric, text[], integer, integer, integer, boolean) to anon;
grant execute on function public.enqueue_dev_jackpot_test(numeric, text[], integer, integer, integer, boolean) to authenticated;
grant execute on function public.enqueue_dev_jackpot_test(numeric, text[], integer, integer, integer, boolean) to service_role;

grant execute on function public.enqueue_dev_jackpot_test(numeric, text[], integer, integer, integer) to anon;
grant execute on function public.enqueue_dev_jackpot_test(numeric, text[], integer, integer, integer) to authenticated;
grant execute on function public.enqueue_dev_jackpot_test(numeric, text[], integer, integer, integer) to service_role;

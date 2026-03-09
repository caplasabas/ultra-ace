-- Queue-based pot model for happy hour and jackpot pools.
-- Adds shared pool-goal mode controls: amount, spins, time.

alter table public.casino_runtime
  add column if not exists active_happy_pot_id bigint,
  add column if not exists active_jackpot_pot_id bigint,
  add column if not exists pool_goal_mode text not null default 'amount',
  add column if not exists pool_goal_spins bigint not null default 1000,
  add column if not exists pool_goal_time_seconds integer not null default 1800,
  add column if not exists happy_pool_spin_counter bigint not null default 0,
  add column if not exists jackpot_pool_spin_counter bigint not null default 0,
  add column if not exists happy_pool_goal_anchor_at timestamptz not null default now(),
  add column if not exists jackpot_pool_goal_anchor_at timestamptz not null default now();

create table if not exists public.happy_hour_pots (
  id bigserial primary key,
  amount_total numeric not null default 0,
  amount_remaining numeric not null default 0,
  status text not null default 'queued' check (status in ('queued', 'active', 'completed')),
  goal_mode text not null default 'amount',
  goal_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_happy_hour_pots_status_created
  on public.happy_hour_pots (status, created_at);

create table if not exists public.jackpot_pots (
  id bigserial primary key,
  amount_total numeric not null default 0,
  amount_remaining numeric not null default 0,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed')),
  goal_mode text not null default 'amount',
  goal_snapshot jsonb not null default '{}'::jsonb,
  campaign_id uuid,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_jackpot_pots_status_created
  on public.jackpot_pots (status, created_at);

alter table public.jackpot_payout_queue
  add column if not exists jackpot_pot_id bigint;

create index if not exists idx_jackpot_payout_queue_pot
  on public.jackpot_payout_queue (jackpot_pot_id, completed_at);

create or replace function public.process_pool_goal_queues(
  p_event_ts timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_runtime public.casino_runtime;
  v_now timestamptz := coalesce(p_event_ts, now());
  v_happy_reached boolean := false;
  v_jackpot_reached boolean := false;
  v_spin_target bigint := 1000;
  v_time_target integer := 1800;
  v_mode text := 'amount';
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
    insert into public.jackpot_pots (
      amount_total,
      amount_remaining,
      status,
      goal_mode,
      goal_snapshot,
      created_at
    )
    values (
      greatest(v_runtime.jackpot_pool_balance, 0),
      greatest(v_runtime.jackpot_pool_balance, 0),
      'queued',
      v_mode,
      jsonb_build_object(
        'goalAmount', v_runtime.jackpot_pool_goal,
        'goalSpins', v_spin_target,
        'goalTimeSeconds', v_time_target,
        'triggeredAt', v_now
      ),
      v_now
    );

    update public.casino_runtime
    set
      jackpot_pool_balance = 0,
      jackpot_pool_spin_counter = 0,
      jackpot_pool_goal_anchor_at = v_now,
      updated_at = now()
    where id = true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'happyReached', v_happy_reached,
    'jackpotReached', v_jackpot_reached
  );
end;
$$;

create or replace function public.recompute_casino_mode()
returns public.casino_runtime
language plpgsql
security definer
set search_path = public
as $$
declare
  v_runtime public.casino_runtime;
  v_next_happy_pot public.happy_hour_pots;
begin
  insert into public.casino_runtime (id, base_profile_id, happy_profile_id)
  values (true, 'base_slow', 'happy_slow')
  on conflict (id) do nothing;

  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  v_runtime.prize_pool_balance := greatest(coalesce(v_runtime.prize_pool_balance, 0), 0);
  v_runtime.happy_hour_prize_balance := greatest(coalesce(v_runtime.happy_hour_prize_balance, 0), 0);

  if v_runtime.active_mode = 'HAPPY' and v_runtime.happy_hour_prize_balance <= 0 then
    if v_runtime.active_happy_pot_id is not null then
      update public.happy_hour_pots
      set
        status = 'completed',
        amount_remaining = 0,
        completed_at = now()
      where id = v_runtime.active_happy_pot_id;
    end if;

    v_runtime.happy_hour_prize_balance := 0;
    v_runtime.active_happy_pot_id := null;
  end if;

  if v_runtime.happy_hour_prize_balance <= 0 then
    if v_runtime.manual_happy_enabled or v_runtime.auto_happy_enabled then
      select * into v_next_happy_pot
      from public.happy_hour_pots
      where status = 'queued'
      order by created_at asc, id asc
      limit 1
      for update skip locked;

      if found then
        update public.happy_hour_pots
        set
          status = 'active',
          activated_at = coalesce(activated_at, now())
        where id = v_next_happy_pot.id;

        v_runtime.happy_hour_prize_balance := greatest(v_next_happy_pot.amount_remaining, 0);
        v_runtime.active_happy_pot_id := v_next_happy_pot.id;
      end if;
    end if;
  end if;

  update public.casino_runtime
  set
    active_mode = case
      when v_runtime.manual_happy_enabled and v_runtime.happy_hour_prize_balance > 0 then 'HAPPY'
      when v_runtime.auto_happy_enabled and v_runtime.happy_hour_prize_balance > 0 then 'HAPPY'
      else 'BASE'
    end,
    manual_happy_enabled = case
      when v_runtime.happy_hour_prize_balance <= 0 and not exists (
        select 1 from public.happy_hour_pots p where p.status = 'queued'
      ) then false
      else v_runtime.manual_happy_enabled
    end,
    prize_pool_balance = v_runtime.prize_pool_balance,
    happy_hour_prize_balance = v_runtime.happy_hour_prize_balance,
    active_happy_pot_id = v_runtime.active_happy_pot_id,
    updated_at = now()
  where id = true
  returning * into v_runtime;

  return v_runtime;
end;
$$;

create or replace function public.set_happy_hour_enabled(p_enabled boolean)
returns public.casino_runtime
language plpgsql
security definer
set search_path = public
as $$
declare
  v_runtime public.casino_runtime;
  v_has_queued boolean := false;
begin
  insert into public.casino_runtime (id, base_profile_id, happy_profile_id)
  values (true, 'base_slow', 'happy_slow')
  on conflict (id) do nothing;

  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  select exists(
    select 1 from public.happy_hour_pots where status = 'queued'
  ) into v_has_queued;

  if p_enabled and v_runtime.prize_pool_balance <= 0 and v_runtime.happy_hour_prize_balance <= 0 and not v_has_queued then
    raise exception 'Cannot enable happy hour: no prize pot available';
  end if;

  update public.casino_runtime
  set
    manual_happy_enabled = coalesce(p_enabled, false),
    updated_at = now()
  where id = true;

  return public.recompute_casino_mode();
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
  v_campaign_id uuid := (
    (
      substr(md5(random()::text || clock_timestamp()::text), 1, 8) || '-' ||
      substr(md5(random()::text || clock_timestamp()::text), 1, 4) || '-' ||
      substr(md5(random()::text || clock_timestamp()::text), 1, 4) || '-' ||
      substr(md5(random()::text || clock_timestamp()::text), 1, 4) || '-' ||
      substr(md5(random()::text || clock_timestamp()::text), 1, 12)
    )::uuid
  );
  v_device_ids text[] := '{}';
  v_device_id text;
  v_delay integer := 0;
  v_chunk_count integer := 1;
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

    v_chunk_count := floor(
      random() * (greatest(coalesce(v_runtime.jackpot_chunk_max, 3), coalesce(v_runtime.jackpot_chunk_min, 2))
      - greatest(coalesce(v_runtime.jackpot_chunk_min, 2), 1) + 1)
    )::integer + greatest(coalesce(v_runtime.jackpot_chunk_min, 2), 1);

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
      greatest(v_chunk_count, 1),
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
  v_open_rows bigint := 0;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return 0;
  end if;

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
    update public.jackpot_payout_queue
    set
      spins_until_start = greatest(spins_until_start - 1, 0),
      updated_at = now()
    where id = v_row.id;

    return 0;
  end if;

  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  v_variance := greatest(coalesce(v_runtime.jackpot_win_variance, 0), 0);

  if coalesce(v_row.payouts_left, 1) <= 1 or coalesce(v_row.remaining_amount, 0) <= 0 then
    v_payout := greatest(coalesce(v_row.remaining_amount, 0), 0);
  else
    v_base_chunk := v_row.remaining_amount / greatest(v_row.payouts_left, 1);
    v_jitter := (random() * 2 - 1) * v_variance;
    v_payout := greatest(0, least(v_row.remaining_amount, round(v_base_chunk + v_jitter, 4)));

    if v_payout <= 0 then
      v_payout := least(v_row.remaining_amount, round(v_base_chunk, 4));
    end if;
  end if;

  if v_payout <= 0 then
    return 0;
  end if;

  update public.jackpot_payout_queue
  set
    remaining_amount = greatest(remaining_amount - v_payout, 0),
    payouts_left = greatest(payouts_left - 1, 0),
    updated_at = now(),
    completed_at = case
      when remaining_amount - v_payout <= 0.0001 or payouts_left - 1 <= 0 then coalesce(p_event_ts, now())
      else completed_at
    end
  where id = v_row.id;

  if v_row.jackpot_pot_id is not null then
    update public.jackpot_pots
    set
      amount_remaining = greatest(amount_remaining - v_payout, 0)
    where id = v_row.jackpot_pot_id;
  end if;

  select count(*)
    into v_open_rows
  from public.jackpot_payout_queue
  where completed_at is null;

  if v_open_rows = 0 then
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
  end if;

  return v_payout;
end;
$$;

create or replace function public.apply_metric_event(
  p_device_id text,
  p_event_type text,
  p_amount numeric,
  p_event_ts timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb,
  p_write_ledger boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := coalesce((p_event_ts at time zone 'utc')::date, (now() at time zone 'utc')::date);
  v_event text := lower(trim(coalesce(p_event_type, '')));
  v_amt numeric := greatest(coalesce(p_amount, 0), 0);
  v_balance_delta numeric := 0;
  v_coins_in numeric := 0;
  v_hopper_in numeric := 0;
  v_hopper_out numeric := 0;
  v_bet numeric := 0;
  v_win numeric := 0;
  v_withdraw numeric := 0;
  v_spins bigint := 0;
  v_house_take numeric := 0;
  v_pool_contrib numeric := 0;
  v_pool_paid numeric := 0;
  v_jackpot_contrib numeric := 0;
  v_jackpot_paid numeric := 0;
  v_spin_win_hint numeric := 0;
  v_last_bet_amount numeric := null;
  v_last_bet_at timestamptz := null;
  v_runtime public.casino_runtime;
  v_profile_id text;
  v_profile_house_pct numeric := 0;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_after_win numeric := 0;
  v_after_house numeric := 0;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  if v_amt = 0 then
    return;
  end if;

  insert into public.casino_runtime (id, base_profile_id, happy_profile_id)
  values (true, 'base_slow', 'happy_slow')
  on conflict (id) do nothing;

  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if v_event = 'coins_in' then
    v_coins_in := v_amt;
    v_balance_delta := v_amt;
  elsif v_event = 'hopper_in' then
    v_hopper_in := v_amt;
  elsif v_event = 'withdrawal' then
    v_hopper_out := v_amt;
    v_withdraw := v_amt;
    v_balance_delta := -v_amt;
  elsif v_event = 'bet' then
    v_bet := v_amt;
    v_balance_delta := -v_amt;
    v_last_bet_amount := v_bet;
    v_last_bet_at := coalesce(p_event_ts, now());

    v_profile_id := case
      when v_runtime.active_mode = 'HAPPY' then v_runtime.happy_profile_id
      else v_runtime.base_profile_id
    end;

    select coalesce(house_pct, 0)
      into v_profile_house_pct
    from public.rtp_profiles
    where id = v_profile_id;

    if coalesce(v_metadata->>'totalWin', '') ~ '^-?\\d+(\\.\\d+)?$' then
      v_spin_win_hint := greatest((v_metadata->>'totalWin')::numeric, 0);
    else
      v_spin_win_hint := 0;
    end if;

    -- Priority split: HOUSE -> JACKPOT -> HAPPY accumulation.
    v_after_win := greatest(v_bet - v_spin_win_hint, 0);
    v_house_take := least(greatest(v_bet * v_profile_house_pct / 100.0, 0), v_after_win);
    v_after_house := greatest(v_after_win - v_house_take, 0);

    v_jackpot_contrib := least(
      greatest(v_bet * greatest(coalesce(v_runtime.jackpot_contrib_pct, 10), 0) / 100.0, 0),
      v_after_house
    );

    v_pool_contrib := greatest(v_after_house - v_jackpot_contrib, 0);

    update public.casino_runtime
    set
      prize_pool_balance = greatest(0, prize_pool_balance + v_pool_contrib),
      jackpot_pool_balance = greatest(0, jackpot_pool_balance + v_jackpot_contrib),
      updated_at = now()
    where id = true
    returning * into v_runtime;

    perform public.process_pool_goal_queues(coalesce(p_event_ts, now()));
    perform public.trigger_jackpot_payout_if_ready(coalesce(p_event_ts, now()));
  elsif v_event = 'win' then
    v_win := v_amt;
    v_balance_delta := v_amt;

    if v_runtime.active_mode = 'HAPPY' then
      v_pool_paid := v_win;

      update public.casino_runtime
      set
        happy_hour_prize_balance = greatest(0, happy_hour_prize_balance - v_pool_paid),
        updated_at = now()
      where id = true
      returning * into v_runtime;

      if v_runtime.active_happy_pot_id is not null then
        update public.happy_hour_pots
        set amount_remaining = greatest(amount_remaining - v_pool_paid, 0)
        where id = v_runtime.active_happy_pot_id;
      end if;
    end if;
  elsif v_event = 'spin' then
    v_spins := greatest(floor(v_amt), 0);

    update public.casino_runtime
    set
      happy_pool_spin_counter = happy_pool_spin_counter + v_spins,
      jackpot_pool_spin_counter = jackpot_pool_spin_counter + v_spins,
      updated_at = now()
    where id = true;

    perform public.process_pool_goal_queues(coalesce(p_event_ts, now()));
    perform public.trigger_jackpot_payout_if_ready(coalesce(p_event_ts, now()));

    v_jackpot_paid := public.process_device_jackpot_payout(p_device_id, coalesce(p_event_ts, now()));
    if v_jackpot_paid > 0 then
      v_win := v_win + v_jackpot_paid;
      v_balance_delta := v_balance_delta + v_jackpot_paid;
      v_metadata := v_metadata || jsonb_build_object(
        'jackpotPayout', v_jackpot_paid,
        'jackpotCampaignPayout', true
      );
    end if;
  else
    raise exception 'unsupported metric event type: %', p_event_type;
  end if;

  if v_event <> 'bet' then
    perform public.recompute_casino_mode();
  end if;

  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  update public.devices
  set
    balance = greatest(0, balance + v_balance_delta),
    coins_in_total = coins_in_total + v_coins_in,
    hopper_balance = greatest(0, hopper_balance + v_hopper_in - v_hopper_out),
    hopper_in_total = hopper_in_total + v_hopper_in,
    hopper_out_total = hopper_out_total + v_hopper_out,
    bet_total = bet_total + v_bet,
    win_total = win_total + v_win,
    house_take_total = house_take_total + v_house_take,
    jackpot_contrib_total = jackpot_contrib_total + v_jackpot_contrib,
    jackpot_win_total = jackpot_win_total + v_jackpot_paid,
    last_bet_amount = coalesce(v_last_bet_amount, last_bet_amount),
    last_bet_at = coalesce(v_last_bet_at, last_bet_at),
    withdraw_total = withdraw_total + v_withdraw,
    spins_total = spins_total + v_spins,
    prize_pool_contrib_total = prize_pool_contrib_total + v_pool_contrib,
    prize_pool_paid_total = prize_pool_paid_total + v_pool_paid,
    updated_at = now()
  where device_id = p_device_id;

  insert into public.device_daily_stats (
    stat_date,
    device_id,
    coins_in_amount,
    hopper_in_amount,
    hopper_out_amount,
    bet_amount,
    win_amount,
    house_take_amount,
    jackpot_contrib_amount,
    jackpot_win_amount,
    withdrawal_amount,
    balance_change,
    event_count,
    spins_count,
    prize_pool_contrib_amount,
    prize_pool_paid_amount,
    updated_at
  )
  values (
    v_date,
    p_device_id,
    v_coins_in,
    v_hopper_in,
    v_hopper_out,
    v_bet,
    v_win,
    v_house_take,
    v_jackpot_contrib,
    v_jackpot_paid,
    v_withdraw,
    v_balance_delta,
    1,
    v_spins,
    v_pool_contrib,
    v_pool_paid,
    now()
  )
  on conflict (stat_date, device_id) do update
  set
    coins_in_amount = device_daily_stats.coins_in_amount + excluded.coins_in_amount,
    hopper_in_amount = device_daily_stats.hopper_in_amount + excluded.hopper_in_amount,
    hopper_out_amount = device_daily_stats.hopper_out_amount + excluded.hopper_out_amount,
    bet_amount = device_daily_stats.bet_amount + excluded.bet_amount,
    win_amount = device_daily_stats.win_amount + excluded.win_amount,
    house_take_amount = device_daily_stats.house_take_amount + excluded.house_take_amount,
    jackpot_contrib_amount = device_daily_stats.jackpot_contrib_amount + excluded.jackpot_contrib_amount,
    jackpot_win_amount = device_daily_stats.jackpot_win_amount + excluded.jackpot_win_amount,
    withdrawal_amount = device_daily_stats.withdrawal_amount + excluded.withdrawal_amount,
    balance_change = device_daily_stats.balance_change + excluded.balance_change,
    event_count = device_daily_stats.event_count + 1,
    spins_count = device_daily_stats.spins_count + excluded.spins_count,
    prize_pool_contrib_amount = device_daily_stats.prize_pool_contrib_amount + excluded.prize_pool_contrib_amount,
    prize_pool_paid_amount = device_daily_stats.prize_pool_paid_amount + excluded.prize_pool_paid_amount,
    updated_at = now();

  if p_write_ledger then
    insert into public.device_metric_events (event_ts, device_id, event_type, amount, metadata)
    values (coalesce(p_event_ts, now()), p_device_id, v_event, v_amt, v_metadata);
  end if;
end;
$$;

create or replace function public.apply_metric_events(
  p_events jsonb,
  p_write_ledger boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a json array';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_events)
  loop
    perform public.apply_metric_event(
      p_device_id := v_item->>'device_id',
      p_event_type := v_item->>'event_type',
      p_amount := coalesce((v_item->>'amount')::numeric, 0),
      p_event_ts := coalesce((v_item->>'event_ts')::timestamptz, now()),
      p_metadata := coalesce(v_item->'metadata', '{}'::jsonb),
      p_write_ledger := p_write_ledger
    );
  end loop;
end;
$$;

drop view if exists public.devices_dashboard_live;
create view public.devices_dashboard_live as
select
  d.*,
  coalesce(j.has_active, false) as jackpot_selected,
  coalesce(j.target_amount, 0) as jackpot_target_amount,
  coalesce(j.remaining_amount, 0) as jackpot_remaining_amount,
  coalesce(j.spins_until_start, 0) as jackpot_spins_until_start
from public.devices d
left join (
  select
    q.device_id,
    true as has_active,
    sum(q.target_amount) as target_amount,
    sum(q.remaining_amount) as remaining_amount,
    min(q.spins_until_start) as spins_until_start
  from public.jackpot_payout_queue q
  where q.completed_at is null
  group by q.device_id
) j on j.device_id = d.device_id;

drop view if exists public.casino_runtime_live;
create view public.casino_runtime_live as
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
  coalesce((select count(*) from public.happy_hour_pots hp where hp.status = 'queued'), 0)::bigint as happy_pots_queued_count,
  coalesce((select sum(hp.amount_remaining) from public.happy_hour_pots hp where hp.status = 'queued'), 0) as happy_pots_queued_amount,
  coalesce((select count(*) from public.jackpot_pots jp where jp.status = 'queued'), 0)::bigint as jackpot_pots_queued_count,
  coalesce((select sum(jp.amount_remaining) from public.jackpot_pots jp where jp.status = 'queued'), 0) as jackpot_pots_queued_amount,
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
  end as active_target_rtp_pct
from public.casino_runtime r
left join public.rtp_profiles bp on bp.id = r.base_profile_id
left join public.rtp_profiles hp on hp.id = r.happy_profile_id;

select public.recompute_casino_mode();

-- Max win cap based on last bet amount + jackpot overflow redistribution.

alter table public.casino_runtime
  add column if not exists max_win_enabled boolean not null default true,
  add column if not exists max_win_multiplier numeric not null default 3000;

create or replace function public.redistribute_jackpot_overflow(
  p_campaign_id uuid,
  p_jackpot_pot_id bigint,
  p_amount numeric,
  p_exclude_device text default null,
  p_event_ts timestamptz default now()
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining numeric := greatest(coalesce(p_amount, 0), 0);
  v_runtime public.casino_runtime;
  v_device_id text;
  v_room numeric := 0;
  v_allocate numeric := 0;
  v_tried text[] := '{}';
  v_paid_so_far numeric := 0;
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
    where d.device_status = 'playing'
      and (p_exclude_device is null or d.device_id <> p_exclude_device)
      and not (d.device_id = any(v_tried))
    order by random()
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

      select greatest(coalesce(d.last_bet_amount, 0) * greatest(coalesce(v_runtime.max_win_multiplier, 0), 0) - v_paid_so_far, 0)
        into v_room
      from public.devices d
      where d.device_id = v_device_id;
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
  v_cap_total numeric := null;
  v_cap_remaining numeric := null;
  v_paid_so_far numeric := 0;
  v_overflow numeric := 0;
  v_unallocated numeric := 0;
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

  if coalesce(v_runtime.max_win_enabled, true) then
    select coalesce(d.last_bet_amount, 0) * greatest(coalesce(v_runtime.max_win_multiplier, 0), 0)
      into v_cap_total
    from public.devices d
    where d.device_id = p_device_id;

    select coalesce(sum(q.target_amount - q.remaining_amount), 0)
      into v_paid_so_far
    from public.jackpot_payout_queue q
    where q.campaign_id = v_row.campaign_id
      and q.device_id = p_device_id;

    v_cap_remaining := greatest(coalesce(v_cap_total, 0) - coalesce(v_paid_so_far, 0), 0);
  end if;

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

  if v_cap_remaining is not null then
    v_payout := least(v_payout, v_cap_remaining);
  end if;

  -- If device is capped, move leftover to additional winners.
  if v_cap_remaining is not null and v_cap_remaining < v_row.remaining_amount then
    v_overflow := greatest(v_row.remaining_amount - v_payout, 0);

    update public.jackpot_payout_queue
    set
      remaining_amount = 0,
      payouts_left = 0,
      updated_at = now(),
      completed_at = coalesce(p_event_ts, now())
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
      completed_at = case
        when remaining_amount - v_payout <= 0.0001 or payouts_left - 1 <= 0 then coalesce(p_event_ts, now())
        else completed_at
      end
    where id = v_row.id;
  end if;

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

  return greatest(v_payout, 0);
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
  v_max_win_cap numeric := null;
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

  if coalesce(v_runtime.max_win_enabled, true) then
    select coalesce(d.last_bet_amount, 0) * greatest(coalesce(v_runtime.max_win_multiplier, 0), 0)
      into v_max_win_cap
    from public.devices d
    where d.device_id = p_device_id;
  end if;

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

    if v_max_win_cap is not null then
      v_win := least(v_win, v_max_win_cap);
    end if;

    v_balance_delta := v_win;

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

    if v_max_win_cap is not null then
      v_jackpot_paid := least(v_jackpot_paid, v_max_win_cap);
    end if;

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
  r.max_win_enabled,
  r.max_win_multiplier,
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

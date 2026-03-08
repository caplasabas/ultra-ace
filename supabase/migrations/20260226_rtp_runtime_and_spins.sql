-- RTP profiles, runtime mode control, prize pool accounting, and spin metrics.

-- 1) Extend devices + daily stats for spins and prize-pool movement.
alter table public.devices
  add column if not exists spins_total bigint not null default 0,
  add column if not exists prize_pool_contrib_total numeric not null default 0,
  add column if not exists prize_pool_paid_total numeric not null default 0;

alter table public.device_daily_stats
  add column if not exists spins_count bigint not null default 0,
  add column if not exists prize_pool_contrib_amount numeric not null default 0,
  add column if not exists prize_pool_paid_amount numeric not null default 0;

-- 2) Extend metric event type enum/check to include spin events.
alter table public.device_metric_events
  drop constraint if exists device_metric_events_event_type_check;

alter table public.device_metric_events
  add constraint device_metric_events_event_type_check
  check (event_type in ('coins_in', 'hopper_in', 'withdrawal', 'bet', 'win', 'spin'));

-- 3) RTP profile catalog.
create table if not exists public.rtp_profiles (
  id text primary key,
  name text not null,
  mode text not null check (mode in ('BASE', 'HAPPY')),
  house_pct numeric not null default 0,
  pool_pct numeric not null default 0,
  player_pct numeric not null default 0,
  prize_pct numeric not null default 0,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rtp_profiles_mode on public.rtp_profiles(mode, enabled, sort_order);

insert into public.rtp_profiles (id, name, mode, house_pct, pool_pct, player_pct, prize_pct, sort_order)
values
  ('base_slow', 'Base Slow', 'BASE', 20, 10, 70, 0, 10),
  ('base_fast', 'Base Fast', 'BASE', 20, 40, 40, 0, 20),
  ('happy_slow', 'Happy Slow', 'HAPPY', 20, 10, 70, 50, 30),
  ('happy_fast', 'Happy Fast', 'HAPPY', 20, 40, 40, 100, 40)
on conflict (id) do nothing;

-- 4) Runtime singleton for active profile + prize pool state.
create table if not exists public.casino_runtime (
  id boolean primary key default true,
  active_mode text not null default 'BASE' check (active_mode in ('BASE', 'HAPPY')),
  base_profile_id text not null references public.rtp_profiles(id),
  happy_profile_id text not null references public.rtp_profiles(id),
  manual_happy_enabled boolean not null default false,
  auto_happy_enabled boolean not null default true,
  prize_pool_balance numeric not null default 0,
  prize_pool_goal numeric not null default 10000,
  updated_at timestamptz not null default now()
);

insert into public.casino_runtime (
  id,
  active_mode,
  base_profile_id,
  happy_profile_id,
  manual_happy_enabled,
  auto_happy_enabled,
  prize_pool_balance,
  prize_pool_goal
)
values (true, 'BASE', 'base_slow', 'happy_slow', false, true, 0, 10000)
on conflict (id) do nothing;

-- 5) Normalize runtime mode based on pool state / trigger flags.
create or replace function public.recompute_casino_mode()
returns public.casino_runtime
language plpgsql
security definer
set search_path = public
as $$
declare
  v_runtime public.casino_runtime;
  v_next_mode text := 'BASE';
begin
  insert into public.casino_runtime (id, base_profile_id, happy_profile_id)
  values (true, 'base_slow', 'happy_slow')
  on conflict (id) do nothing;

  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if v_runtime.prize_pool_balance <= 0 then
    v_runtime.prize_pool_balance := 0;
    v_runtime.manual_happy_enabled := false;
    v_next_mode := 'BASE';
  elsif v_runtime.manual_happy_enabled then
    v_next_mode := 'HAPPY';
  elsif v_runtime.auto_happy_enabled and v_runtime.prize_pool_balance >= v_runtime.prize_pool_goal then
    v_next_mode := 'HAPPY';
  else
    v_next_mode := 'BASE';
  end if;

  update public.casino_runtime
  set
    active_mode = v_next_mode,
    manual_happy_enabled = v_runtime.manual_happy_enabled,
    prize_pool_balance = v_runtime.prize_pool_balance,
    updated_at = now()
  where id = true
  returning * into v_runtime;

  return v_runtime;
end;
$$;

-- 6) Manual happy-hour trigger helper.
create or replace function public.set_happy_hour_enabled(p_enabled boolean)
returns public.casino_runtime
language plpgsql
security definer
set search_path = public
as $$
declare
  v_runtime public.casino_runtime;
begin
  insert into public.casino_runtime (id, base_profile_id, happy_profile_id)
  values (true, 'base_slow', 'happy_slow')
  on conflict (id) do nothing;

  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if p_enabled and v_runtime.prize_pool_balance <= 0 then
    raise exception 'Cannot enable happy hour: prize_pool_balance is 0';
  end if;

  update public.casino_runtime
  set
    manual_happy_enabled = coalesce(p_enabled, false),
    updated_at = now()
  where id = true;

  return public.recompute_casino_mode();
end;
$$;

-- 7) Replace metric apply function to include spins + pool accounting.
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
  v_pool_contrib numeric := 0;
  v_pool_paid numeric := 0;
  v_runtime public.casino_runtime;
  v_profile_id text;
  v_profile_pool_pct numeric := 0;
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

    v_profile_id := case when v_runtime.active_mode = 'HAPPY' then v_runtime.happy_profile_id else v_runtime.base_profile_id end;

    select coalesce(pool_pct, 0)
      into v_profile_pool_pct
    from public.rtp_profiles
    where id = v_profile_id;

    v_pool_contrib := greatest(v_bet * v_profile_pool_pct / 100.0, 0);

    update public.casino_runtime
    set prize_pool_balance = greatest(0, prize_pool_balance + v_pool_contrib),
        updated_at = now()
    where id = true
    returning * into v_runtime;
  elsif v_event = 'win' then
    v_win := v_amt;
    v_balance_delta := v_amt;

    if v_runtime.active_mode = 'HAPPY' then
      v_pool_paid := v_win;

      update public.casino_runtime
      set prize_pool_balance = greatest(0, prize_pool_balance - v_pool_paid),
          updated_at = now()
      where id = true
      returning * into v_runtime;
    end if;
  elsif v_event = 'spin' then
    v_spins := greatest(floor(v_amt), 0);
  else
    raise exception 'unsupported metric event type: %', p_event_type;
  end if;

  -- Re-evaluate mode after pool changes.
  perform public.recompute_casino_mode();

  -- Ensure device row exists.
  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  -- Update cumulative counters and live balances.
  update public.devices
  set
    balance = greatest(0, balance + v_balance_delta),
    coins_in_total = coins_in_total + v_coins_in,
    hopper_balance = greatest(0, hopper_balance + v_hopper_in - v_hopper_out),
    hopper_in_total = hopper_in_total + v_hopper_in,
    hopper_out_total = hopper_out_total + v_hopper_out,
    bet_total = bet_total + v_bet,
    win_total = win_total + v_win,
    withdraw_total = withdraw_total + v_withdraw,
    spins_total = spins_total + v_spins,
    prize_pool_contrib_total = prize_pool_contrib_total + v_pool_contrib,
    prize_pool_paid_total = prize_pool_paid_total + v_pool_paid,
    updated_at = now()
  where device_id = p_device_id;

  -- Upsert daily rollup.
  insert into public.device_daily_stats (
    stat_date,
    device_id,
    coins_in_amount,
    hopper_in_amount,
    hopper_out_amount,
    bet_amount,
    win_amount,
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
    withdrawal_amount = device_daily_stats.withdrawal_amount + excluded.withdrawal_amount,
    balance_change = device_daily_stats.balance_change + excluded.balance_change,
    event_count = device_daily_stats.event_count + 1,
    spins_count = device_daily_stats.spins_count + excluded.spins_count,
    prize_pool_contrib_amount = device_daily_stats.prize_pool_contrib_amount + excluded.prize_pool_contrib_amount,
    prize_pool_paid_amount = device_daily_stats.prize_pool_paid_amount + excluded.prize_pool_paid_amount,
    updated_at = now();

  if p_write_ledger then
    insert into public.device_metric_events (event_ts, device_id, event_type, amount, metadata)
    values (coalesce(p_event_ts, now()), p_device_id, v_event, v_amt, coalesce(p_metadata, '{}'::jsonb));
  end if;
end;
$$;

-- 8) Global views include spin + RTP + runtime data.
drop view if exists public.global_stats_live;
create or replace view public.global_stats_live as
select
  coalesce(sum(d.balance), 0) as total_balance,
  coalesce(sum(d.coins_in_total), 0) as total_coins_in,
  coalesce(sum(d.hopper_balance), 0) as total_hopper,
  coalesce(sum(d.bet_total), 0) as total_bet_amount,
  coalesce(sum(d.win_total), 0) as total_win_amount,
  coalesce(sum(d.withdraw_total), 0) as total_withdraw_amount,
  coalesce(sum(d.spins_total), 0)::bigint as total_spins,
  case
    when coalesce(sum(d.bet_total), 0) > 0 then round((coalesce(sum(d.win_total), 0) / nullif(sum(d.bet_total), 0)) * 100.0, 4)
    else 0
  end as global_rtp_percent,
  count(*)::bigint as device_count,
  now() as generated_at
from public.devices d;

drop view if exists public.casino_runtime_live;
create or replace view public.casino_runtime_live as
select
  r.id,
  r.active_mode,
  r.base_profile_id,
  r.happy_profile_id,
  r.manual_happy_enabled,
  r.auto_happy_enabled,
  r.prize_pool_balance,
  r.prize_pool_goal,
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

-- 9) Keep modes consistent on startup.
select public.recompute_casino_mode();

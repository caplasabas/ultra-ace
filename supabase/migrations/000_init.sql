


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."apply_device_ledger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  current_balance bigint;
begin
  select balance into current_balance
  from devices
  where device_id = new.device_id
  for update;

  if current_balance + new.balance_delta < 0 then
    raise exception 'Insufficient balance';
  end if;

  update devices
  set balance = balance + new.balance_delta,
      updated_at = now()
  where device_id = new.device_id;

  return new;
end;
$$;


ALTER FUNCTION "public"."apply_device_ledger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_metric_event"("p_device_id" "text", "p_event_type" "text", "p_amount" numeric, "p_event_ts" timestamp with time zone DEFAULT "now"(), "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_write_ledger" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  v_effective_spin_win_hint numeric := 0;
  v_requested_win numeric := 0;
  v_last_bet_amount numeric := null;
  v_last_bet_at timestamptz := null;
  v_runtime public.casino_runtime;
  v_profile_id text;
  v_profile_house_pct numeric := 0;
  v_profile_jackpot_pct numeric := 0;
  v_house_pct numeric := 0;
  v_jackpot_pct numeric := 0;
  v_happy_pct numeric := 0;
  v_house_target numeric := 0;
  v_jackpot_target numeric := 0;
  v_after_win numeric := 0;
  v_after_house numeric := 0;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_max_win_cap numeric := null;
  v_normal_win_cap numeric := null;
  v_over_cap_amount numeric := 0;
  v_spin_key text := nullif(trim(coalesce(p_metadata->>'spinKey', '')), '');
  v_guard_funding_source text := 'runtime_pool';
  v_guarded_from_bet boolean := false;
  v_dedup_inserted_count integer := 0;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  if v_amt = 0 then
    return;
  end if;

  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  if v_spin_key is not null and v_event in ('bet', 'win', 'spin') then
    insert into public.device_spin_event_dedup (
      device_id,
      spin_key,
      event_type,
      event_ts,
      amount,
      metadata
    )
    values (
      p_device_id,
      v_spin_key,
      v_event,
      coalesce(p_event_ts, now()),
      v_amt,
      v_metadata
    )
    on conflict (device_id, spin_key, event_type) do nothing;

    get diagnostics v_dedup_inserted_count = row_count;

    if v_dedup_inserted_count = 0 then
      return;
    end if;
  end if;

  insert into public.casino_runtime (id, base_profile_id, happy_profile_id)
  values (true, 'base_slow', 'happy_slow')
  on conflict (id) do nothing;

  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if coalesce(v_runtime.max_win_enabled, true) then
    select public.compute_max_win_cap(d.last_bet_amount)
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

    select
      coalesce(house_pct, 0),
      coalesce(pool_pct, 0)
      into v_profile_house_pct, v_profile_jackpot_pct
    from public.rtp_profiles
    where id = v_profile_id;

    if v_metadata ? 'totalWin' then
      begin
        v_spin_win_hint := greatest(coalesce((v_metadata->>'totalWin')::numeric, 0), 0);
      exception when others then
        v_spin_win_hint := 0;
      end;
    end if;

    v_house_pct := greatest(v_profile_house_pct, 0);
    v_jackpot_pct := greatest(v_profile_jackpot_pct, 0);
    v_jackpot_pct := least(v_jackpot_pct, greatest(100 - v_house_pct, 0));
    v_happy_pct := greatest(100 - v_house_pct - v_jackpot_pct, 0);

    v_house_target := v_bet * v_house_pct / 100.0;
    v_jackpot_target := v_bet * v_jackpot_pct / 100.0;

    if v_runtime.active_mode = 'HAPPY' then
      v_normal_win_cap := greatest(coalesce(v_runtime.happy_hour_prize_balance, 0), 0);
      v_guard_funding_source := 'happy_prize_pool';
    else
      v_normal_win_cap := greatest(coalesce(v_runtime.prize_pool_balance, 0), 0)
        + greatest(v_bet - v_house_target, 0);
      v_guard_funding_source := 'base_spin_budget';
    end if;

    if v_max_win_cap is not null then
      v_normal_win_cap := least(v_normal_win_cap, v_max_win_cap);
    end if;

    v_normal_win_cap := greatest(coalesce(v_normal_win_cap, 0), 0);
    v_effective_spin_win_hint := least(v_spin_win_hint, v_normal_win_cap);
    v_after_win := v_bet - v_effective_spin_win_hint;

    -- House is strict. Jackpot flexes with the remaining amount after win and house.
    v_house_take := greatest(v_house_target, 0);
    v_after_house := v_after_win - v_house_take;
    v_jackpot_contrib := greatest(least(v_jackpot_target, v_after_house), 0);
    v_pool_contrib := v_after_house - v_jackpot_contrib;
    v_metadata := v_metadata || jsonb_build_object(
      'requestedTotalWin', v_spin_win_hint,
      'effectiveTotalWinHint', v_effective_spin_win_hint,
      'normalWinFundingCap', v_normal_win_cap,
      'winFundingSource', v_guard_funding_source,
      'overCapWinHint', v_spin_win_hint > v_effective_spin_win_hint + 0.0001
    );

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
    v_requested_win := v_amt;
    v_win := v_requested_win;

    if p_write_ledger and v_spin_key is not null then
      begin
        select
          greatest(coalesce((e.metadata->>'normalWinFundingCap')::numeric, 0), 0),
          coalesce(e.metadata->>'winFundingSource', 'bet_guard')
          into v_normal_win_cap, v_guard_funding_source
        from public.device_metric_events e
        where e.device_id = p_device_id
          and e.event_type = 'bet'
          and coalesce(e.metadata->>'spinKey', '') = v_spin_key
        order by e.event_ts desc, e.id desc
        limit 1;

        v_guarded_from_bet := v_normal_win_cap is not null;
      exception when others then
        v_normal_win_cap := null;
        v_guarded_from_bet := false;
      end;
    end if;

    if v_normal_win_cap is null then
      if v_runtime.active_mode = 'HAPPY' then
        v_normal_win_cap := greatest(coalesce(v_runtime.happy_hour_prize_balance, 0), 0);
        v_guard_funding_source := 'happy_prize_pool';
      else
        v_normal_win_cap := greatest(coalesce(v_runtime.prize_pool_balance, 0), 0);
        v_guard_funding_source := 'base_prize_pool';
      end if;
    end if;

    if v_max_win_cap is not null then
      v_normal_win_cap := least(greatest(coalesce(v_normal_win_cap, 0), 0), v_max_win_cap);
    end if;

    v_normal_win_cap := greatest(coalesce(v_normal_win_cap, 0), 0);
    v_win := least(v_requested_win, v_normal_win_cap);
    v_over_cap_amount := greatest(v_requested_win - v_win, 0);

    if v_over_cap_amount > 0.0001 then
      insert into public.over_cap_win_events (
        device_id,
        spin_key,
        event_ts,
        runtime_mode,
        funding_source,
        requested_amount,
        accepted_amount,
        funding_cap_amount,
        over_amount,
        metadata
      )
      values (
        p_device_id,
        v_spin_key,
        coalesce(p_event_ts, now()),
        v_runtime.active_mode,
        v_guard_funding_source,
        v_requested_win,
        v_win,
        v_normal_win_cap,
        v_over_cap_amount,
        v_metadata
      );
    end if;

    v_metadata := v_metadata || jsonb_build_object(
      'requestedWin', v_requested_win,
      'acceptedWin', v_win,
      'normalWinFundingCap', v_normal_win_cap,
      'winFundingSource', v_guard_funding_source,
      'overCapWinAdjusted', v_over_cap_amount > 0.0001
    );

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
    elsif not v_guarded_from_bet then
      v_pool_paid := v_win;

      update public.casino_runtime
      set
        prize_pool_balance = greatest(0, prize_pool_balance - v_pool_paid),
        updated_at = now()
      where id = true
      returning * into v_runtime;
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
    avg_bet_amount = greatest(1, round((bet_total + v_bet) / nullif(spins_total + v_spins, 0))),
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


ALTER FUNCTION "public"."apply_metric_event"("p_device_id" "text", "p_event_type" "text", "p_amount" numeric, "p_event_ts" timestamp with time zone, "p_metadata" "jsonb", "p_write_ledger" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_metric_events"("p_events" "jsonb", "p_write_ledger" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."apply_metric_events"("p_events" "jsonb", "p_write_ledger" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_enable_global_games_for_new_device"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if to_regclass('public.games') is null or to_regclass('public.cabinet_games') is null then
    return new;
  end if;

  insert into public.cabinet_games (device_id, game_id, installed)
  select
    new.device_id,
    g.id,
    true
  from public.games g
  where coalesce(g.enabled, false) = true
  on conflict (device_id, game_id) do update
  set installed = excluded.installed;

  return new;
end;
$$;


ALTER FUNCTION "public"."auto_enable_global_games_for_new_device"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_max_win_cap"("p_last_bet" numeric) RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  v_bet numeric := greatest(coalesce(p_last_bet, 0), 0);
  v_mult numeric := 0;
begin
  if v_bet <= 0 then
    return null;
  end if;

  if v_bet < 20 then
    v_mult := 3000;
  elsif v_bet < 100 then
    v_mult := 2500;
  elsif v_bet < 200 then
    v_mult := 2000;
  elsif v_bet < 300 then
    v_mult := 1500;
  elsif v_bet < 500 then
    v_mult := 1000;
  else
    v_mult := 700;
  end if;

  return v_bet * v_mult;
end;
$$;


ALTER FUNCTION "public"."compute_max_win_cap"("p_last_bet" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_arcade_life"("p_device_id" "text", "p_game_id" "text", "p_player" "text", "p_amount" numeric, "p_reason" "text" DEFAULT 'start'::"text", "p_event_ts" timestamp with time zone DEFAULT "now"(), "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS TABLE("ok" boolean, "balance" numeric, "charged_amount" numeric, "reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_amount numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  v_balance numeric := 0;
  v_rows integer := 0;
  v_date date := coalesce((p_event_ts at time zone 'utc')::date, (now() at time zone 'utc')::date);
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'source', 'arcade_life',
    'game_id', coalesce(p_game_id, ''),
    'player', coalesce(p_player, ''),
    'reason', coalesce(p_reason, 'start'),
    'amount', v_amount
  );
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return query select false, 0::numeric, 0::numeric, 'missing_device_id'::text;
    return;
  end if;

  if v_amount <= 0 then
    select d.balance into v_balance
    from public.devices d
    where d.device_id = p_device_id;

    return query select false, coalesce(v_balance, 0)::numeric, 0::numeric, 'invalid_amount'::text;
    return;
  end if;

  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'devices'
      and c.column_name = 'bet_total'
  ) then
    execute
      'update public.devices
       set balance = balance - $1,
           bet_total = coalesce(bet_total, 0) + $1,
           updated_at = now()
       where device_id = $2
         and balance >= $1
       returning balance'
    into v_balance
    using v_amount, p_device_id;
    get diagnostics v_rows = row_count;
  else
    update public.devices
    set balance = balance - v_amount,
        updated_at = now()
    where device_id = p_device_id
      and balance >= v_amount
    returning devices.balance into v_balance;
    get diagnostics v_rows = row_count;
  end if;

  if coalesce(v_rows, 0) = 0 then
    select d.balance into v_balance
    from public.devices d
    where d.device_id = p_device_id;

    return query select false, coalesce(v_balance, 0)::numeric, 0::numeric, 'insufficient_balance'::text;
    return;
  end if;

  if to_regclass('public.device_daily_stats') is not null then
    insert into public.device_daily_stats (
      stat_date,
      device_id,
      bet_amount,
      balance_change,
      event_count,
      updated_at
    )
    values (
      v_date,
      p_device_id,
      v_amount,
      -v_amount,
      1,
      now()
    )
    on conflict (stat_date, device_id) do update
    set
      bet_amount = public.device_daily_stats.bet_amount + excluded.bet_amount,
      balance_change = public.device_daily_stats.balance_change + excluded.balance_change,
      event_count = public.device_daily_stats.event_count + 1,
      updated_at = now();
  end if;

  if to_regclass('public.device_metric_events') is not null then
    insert into public.device_metric_events (event_ts, device_id, event_type, amount, metadata)
    values (coalesce(p_event_ts, now()), p_device_id, 'bet', v_amount, v_meta);
  end if;

  return query select true, v_balance, v_amount, 'charged'::text;
end;
$_$;


ALTER FUNCTION "public"."consume_arcade_life"("p_device_id" "text", "p_game_id" "text", "p_player" "text", "p_amount" numeric, "p_reason" "text", "p_event_ts" timestamp with time zone, "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."demo_reset_runtime_metrics"("p_keep_device_ids" "text"[] DEFAULT ARRAY[]::"text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_device_count integer := 0;
  v_command_count integer := 0;
  v_cabinet_game_count integer := 0;
begin
  select count(*)::int
  into v_device_count
  from public.devices d
  where trim(coalesce(d.device_id, '')) <> '';

  truncate table public.device_metric_events restart identity;
  truncate table public.device_daily_stats;

  if to_regclass('public.jackpot_payout_plan_steps') is not null then
    execute 'truncate table public.jackpot_payout_plan_steps restart identity cascade';
  end if;

  if to_regclass('public.jackpot_payout_queue') is not null then
    execute 'truncate table public.jackpot_payout_queue restart identity cascade';
  end if;

  if to_regclass('public.happy_hour_pots') is not null then
    execute 'truncate table public.happy_hour_pots restart identity cascade';
  end if;

  if to_regclass('public.jackpot_pots') is not null then
    execute 'truncate table public.jackpot_pots restart identity cascade';
  end if;

  if to_regclass('public.device_game_sessions') is not null then
    execute 'truncate table public.device_game_sessions restart identity cascade';
  end if;

  if to_regclass('public.device_admin_ledger_entries') is not null then
    execute 'truncate table public.device_admin_ledger_entries restart identity cascade';
  end if;

  if to_regclass('public.device_admin_commands') is not null then
    execute 'truncate table public.device_admin_commands restart identity cascade';
  end if;

  if to_regclass('public.ledger_entries') is not null then
    execute 'truncate table public.ledger_entries restart identity cascade';
  end if;

  if to_regclass('public.ledger_events') is not null then
    execute 'truncate table public.ledger_events restart identity cascade';
  end if;

  if to_regclass('public.over_cap_win_events') is not null then
    execute 'truncate table public.over_cap_win_events restart identity cascade';
  end if;

  if to_regclass('public.device_spin_event_dedup') is not null then
    execute 'truncate table public.device_spin_event_dedup restart identity cascade';
  end if;

  if to_regclass('public.cabinet_games') is not null then
    truncate table public.cabinet_games;

    insert into public.cabinet_games (
      device_id,
      game_id,
      installed,
      installed_version
    )
    select
      d.device_id,
      g.id,
      case
        when g.type = 'casino' and g.enabled = false then false
        else true
      end as installed,
      null as installed_version
    from public.devices d
    cross join public.games g
    where trim(coalesce(d.device_id, '')) <> '';

    get diagnostics v_cabinet_game_count = row_count;
  end if;

  update public.devices
  set
    balance = 0,
    coins_in_total = 0,
    hopper_balance = 0,
    hopper_in_total = 0,
    hopper_out_total = 0,
    bet_total = 0,
    win_total = 0,
    withdraw_total = 0,
    spins_total = 0,
    prize_pool_contrib_total = 0,
    prize_pool_paid_total = 0,
    current_game_id = null,
    current_game_name = null,
    device_status = 'idle',
    active_session_id = null,
    session_started_at = null,
    session_last_heartbeat = null,
    session_ended_at = null,
    runtime_mode = null,
    is_free_game = false,
    free_spins_left = 0,
    pending_free_spins = 0,
    show_free_spin_intro = false,
    current_spin_id = 0,
    session_metadata = '{}'::jsonb,
    house_take_total = 0,
    last_bet_amount = 0,
    last_bet_at = null,
    jackpot_contrib_total = 0,
    jackpot_win_total = 0,
    updated_at = now()
  where true;

  update public.casino_runtime
  set
    active_mode = 'BASE',
    manual_happy_enabled = false,
    auto_happy_enabled = true,
    prize_pool_balance = 0,
    happy_hour_prize_balance = 0,
    jackpot_pool_balance = 0,
    jackpot_pending_payout = false,
    last_jackpot_triggered_at = null,
    active_happy_pot_id = null,
    active_jackpot_pot_id = null,
    happy_pool_spin_counter = 0,
    jackpot_pool_spin_counter = 0,
    happy_pool_goal_anchor_at = now(),
    jackpot_pool_goal_anchor_at = now(),
    updated_at = now()
  where id = true;

  perform public.recompute_casino_mode();

  if to_regclass('public.device_admin_commands') is not null then
    insert into public.device_admin_commands (
      device_id,
      command,
      status,
      reason,
      requested_by,
      requested_at,
      created_at,
      updated_at
    )
    select
      d.device_id,
      'reset',
      'queued',
      'demo_reset_runtime_metrics',
      'dashboard',
      now(),
      now(),
      now()
    from public.devices d
    where trim(coalesce(d.device_id, '')) <> '';

    get diagnostics v_command_count = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'devices_reset', v_device_count,
    'devices_preserved', v_device_count,
    'cabinet_games_seeded', v_cabinet_game_count,
    'reset_commands_queued', v_command_count
  );
end;
$$;


ALTER FUNCTION "public"."demo_reset_runtime_metrics"("p_keep_device_ids" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."disable_game_from_cabinets"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if old.enabled = true and new.enabled = false and new.type = 'casino' then
    update public.cabinet_games
    set installed = false
    where game_id = new.id;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."disable_game_from_cabinets"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."end_device_game_session"("p_device_id" "text", "p_session_id" bigint DEFAULT NULL::bigint, "p_reason" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  update public.device_game_sessions
  set
    status = 'ended',
    ended_at = now(),
    updated_at = now()
  where device_id = p_device_id
    and (p_session_id is null or id = p_session_id)
    and status = 'active';

  update public.devices
  set
    device_status = 'idle',
    active_session_id = null,
    session_last_heartbeat = now(),
    session_ended_at = now(),
    is_free_game = false,
    free_spins_left = 0,
    pending_free_spins = 0,
    show_free_spin_intro = false,
    current_spin_id = 0,
    session_metadata = jsonb_build_object(
      'endReason', coalesce(p_reason, 'unknown'),
      'endedAt', now()
    ),
    updated_at = now()
  where device_id = p_device_id;
end;
$$;


ALTER FUNCTION "public"."end_device_game_session"("p_device_id" "text", "p_session_id" bigint, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_bulk_device_admin_command"("p_command" "text", "p_device_ids" "text"[] DEFAULT NULL::"text"[], "p_reason" "text" DEFAULT NULL::"text", "p_requested_by" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_command text := lower(trim(coalesce(p_command, '')));
  v_device_ids text[];
  v_device_id text;
  v_result jsonb;
  v_target_count integer := 0;
  v_queued_count integer := 0;
  v_deduped_count integer := 0;
begin
  if v_command not in ('restart', 'shutdown', 'reset') then
    raise exception 'Unsupported command: %', v_command;
  end if;

  select coalesce(array_agg(d.device_id order by d.device_id), array[]::text[])
  into v_device_ids
  from (
    select distinct trim(device_id) as device_id
    from public.devices
    where trim(coalesce(device_id, '')) <> ''
      and (
        coalesce(array_length(p_device_ids, 1), 0) = 0
        or device_id = any(p_device_ids)
      )
  ) d;

  v_target_count := coalesce(array_length(v_device_ids, 1), 0);

  if v_target_count = 0 then
    raise exception 'No target devices found';
  end if;

  foreach v_device_id in array v_device_ids
  loop
    v_result := public.enqueue_device_admin_command(
      p_device_id := v_device_id,
      p_command := v_command,
      p_reason := p_reason,
      p_requested_by := p_requested_by
    );

    if coalesce((v_result->>'deduped')::boolean, false) then
      v_deduped_count := v_deduped_count + 1;
    else
      v_queued_count := v_queued_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'command', v_command,
    'target_count', v_target_count,
    'queued_count', v_queued_count,
    'deduped_count', v_deduped_count
  );
end;
$$;


ALTER FUNCTION "public"."enqueue_bulk_device_admin_command"("p_command" "text", "p_device_ids" "text"[], "p_reason" "text", "p_requested_by" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_dev_jackpot_test"("p_amount" numeric, "p_device_ids" "text"[], "p_winners" integer DEFAULT 1, "p_delay_min" integer DEFAULT 0, "p_delay_max" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."enqueue_dev_jackpot_test"("p_amount" numeric, "p_device_ids" "text"[], "p_winners" integer, "p_delay_min" integer, "p_delay_max" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_dev_jackpot_test"("p_amount" numeric, "p_device_ids" "text"[], "p_winners" integer, "p_delay_min" integer, "p_delay_max" integer, "p_ignore_max_win" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."enqueue_dev_jackpot_test"("p_amount" numeric, "p_device_ids" "text"[], "p_winners" integer, "p_delay_min" integer, "p_delay_max" integer, "p_ignore_max_win" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_device_admin_command"("p_device_id" "text", "p_command" "text", "p_reason" "text" DEFAULT NULL::"text", "p_requested_by" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_device_id text := trim(coalesce(p_device_id, ''));
  v_command text := lower(trim(coalesce(p_command, '')));
  v_row public.device_admin_commands;
begin
  if v_device_id = '' then
    raise exception 'p_device_id is required';
  end if;

  if v_command not in ('restart', 'shutdown', 'reset') then
    raise exception 'Unsupported command: %', v_command;
  end if;

  select * into v_row
  from public.device_admin_commands c
  where c.device_id = v_device_id
    and c.command = v_command
    and c.status in ('queued', 'processing')
  order by c.id desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'deduped', true,
      'id', v_row.id,
      'device_id', v_row.device_id,
      'command', v_row.command,
      'status', v_row.status
    );
  end if;

  insert into public.device_admin_commands (
    device_id,
    command,
    status,
    reason,
    requested_by,
    requested_at,
    created_at,
    updated_at
  )
  values (
    v_device_id,
    v_command,
    'queued',
    nullif(trim(coalesce(p_reason, '')), ''),
    nullif(trim(coalesce(p_requested_by, '')), ''),
    now(),
    now(),
    now()
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'deduped', false,
    'id', v_row.id,
    'device_id', v_row.device_id,
    'command', v_row.command,
    'status', v_row.status
  );
end;
$$;


ALTER FUNCTION "public"."enqueue_device_admin_command"("p_device_id" "text", "p_command" "text", "p_reason" "text", "p_requested_by" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_device_jackpot_payouts"("p_device_id" "text", "p_event_ts" timestamp with time zone DEFAULT "now"()) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_runtime public.casino_runtime;
  v_open_rows bigint := 0;
  v_updated bigint := 0;
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
    and payout_ready_at is not null
    and coalesce(remaining_amount, 0) <= 0.0001;

  get diagnostics v_updated = row_count;

  if v_updated <= 0 then
    return;
  end if;

  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if not found then
    return;
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
end;
$$;


ALTER FUNCTION "public"."finalize_device_jackpot_payouts"("p_device_id" "text", "p_event_ts" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."jackpot_curve_weight"("p_step_index" integer, "p_total_steps" integer, "p_curve" "text" DEFAULT 'center'::"text") RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
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


ALTER FUNCTION "public"."jackpot_curve_weight"("p_step_index" integer, "p_total_steps" integer, "p_curve" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."post_bulk_device_admin_ledger_entry"("p_target" "text", "p_entry_kind" "text", "p_amount" numeric, "p_account_name" "text", "p_device_ids" "text"[] DEFAULT NULL::"text"[], "p_notes" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_target text := lower(trim(coalesce(p_target, '')));
  v_kind text := lower(trim(coalesce(p_entry_kind, '')));
  v_requested numeric := greatest(coalesce(p_amount, 0), 0);
  v_device_ids text[];
  v_device_id text;
  v_result jsonb;
  v_events jsonb;
  v_target_count integer := 0;
  v_processed_count integer := 0;
  v_total_applied numeric := 0;
begin
  if v_target not in ('accounting_balance', 'hopper_balance') then
    raise exception 'unsupported target: %', p_target;
  end if;

  if v_kind not in ('debit', 'credit') then
    raise exception 'unsupported entry kind: %', p_entry_kind;
  end if;

  if v_requested <= 0 then
    raise exception 'amount must be > 0';
  end if;

  if coalesce(trim(p_account_name), '') = '' then
    raise exception 'account_name is required';
  end if;

  select coalesce(array_agg(d.device_id order by d.device_id), array[]::text[])
  into v_device_ids
  from (
    select distinct trim(device_id) as device_id
    from public.devices
    where trim(coalesce(device_id, '')) <> ''
      and (
        coalesce(array_length(p_device_ids, 1), 0) = 0
        or device_id = any(p_device_ids)
      )
  ) d;

  v_target_count := coalesce(array_length(v_device_ids, 1), 0);

  if v_target_count = 0 then
    raise exception 'No target devices found';
  end if;

  if v_target = 'accounting_balance' and v_kind = 'credit' then
    select jsonb_agg(
      jsonb_build_object(
        'device_id', item.device_id,
        'event_type', 'coins_in',
        'amount', v_requested,
        'event_ts', now(),
        'metadata', coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
          'source', 'dashboard_global_controls',
          'target', v_target,
          'entry_kind', v_kind,
          'account_name', trim(p_account_name),
          'notes', nullif(trim(coalesce(p_notes, '')), '')
        )
      )
    )
    into v_events
    from unnest(v_device_ids) as item(device_id);

    perform public.apply_metric_events(v_events, true);

    v_processed_count := v_target_count;
    v_total_applied := v_requested * v_target_count;
  else
    foreach v_device_id in array v_device_ids
    loop
      v_result := public.post_device_admin_ledger_entry(
        p_device_id := v_device_id,
        p_target := v_target,
        p_entry_kind := v_kind,
        p_amount := v_requested,
        p_account_name := p_account_name,
        p_notes := p_notes,
        p_metadata := p_metadata
      );

      v_processed_count := v_processed_count + 1;
      v_total_applied := v_total_applied + coalesce((v_result->>'amount')::numeric, 0);
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'target', v_target,
    'entry_kind', v_kind,
    'target_count', v_target_count,
    'processed_count', v_processed_count,
    'amount_per_device', v_requested,
    'total_applied', v_total_applied
  );
end;
$$;


ALTER FUNCTION "public"."post_bulk_device_admin_ledger_entry"("p_target" "text", "p_entry_kind" "text", "p_amount" numeric, "p_account_name" "text", "p_device_ids" "text"[], "p_notes" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."post_device_admin_ledger_entry"("p_device_id" "text", "p_target" "text", "p_entry_kind" "text", "p_amount" numeric, "p_account_name" "text", "p_notes" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_device public.devices;
  v_before numeric := 0;
  v_after numeric := 0;
  v_applied numeric := 0;
  v_target text := lower(trim(coalesce(p_target, '')));
  v_kind text := lower(trim(coalesce(p_entry_kind, '')));
  v_requested numeric := greatest(coalesce(p_amount, 0), 0);
begin
  if coalesce(trim(p_device_id), '') = '' then
    raise exception 'p_device_id is required';
  end if;

  if v_target not in ('accounting_balance', 'hopper_balance') then
    raise exception 'unsupported target: %', p_target;
  end if;

  if v_kind not in ('debit', 'credit') then
    raise exception 'unsupported entry kind: %', p_entry_kind;
  end if;

  if v_requested <= 0 then
    raise exception 'amount must be > 0';
  end if;

  if coalesce(trim(p_account_name), '') = '' then
    raise exception 'account_name is required';
  end if;

  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  select *
  into v_device
  from public.devices
  where device_id = p_device_id
  for update;

  if v_target = 'accounting_balance' then
    v_before := greatest(coalesce(v_device.balance, 0), 0);
  else
    v_before := greatest(coalesce(v_device.hopper_balance, 0), 0);
  end if;

  if v_kind = 'credit' then
    v_applied := v_requested;
    v_after := v_before + v_applied;
  else
    v_applied := least(v_requested, v_before);
    v_after := greatest(0, v_before - v_applied);
  end if;

  if v_target = 'accounting_balance' then
    update public.devices
    set
      balance = v_after,
      updated_at = now()
    where device_id = p_device_id;
  else
    update public.devices
    set
      hopper_balance = v_after,
      updated_at = now()
    where device_id = p_device_id;
  end if;

  insert into public.device_admin_ledger_entries (
    device_id,
    target,
    entry_kind,
    amount,
    account_name,
    notes,
    balance_before,
    balance_after,
    metadata
  )
  values (
    p_device_id,
    v_target,
    v_kind,
    v_applied,
    trim(p_account_name),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_before,
    v_after,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('requested_amount', v_requested)
  );

  return jsonb_build_object(
    'ok', true,
    'device_id', p_device_id,
    'target', v_target,
    'entry_kind', v_kind,
    'amount', v_applied,
    'before', v_before,
    'after', v_after
  );
end;
$$;


ALTER FUNCTION "public"."post_device_admin_ledger_entry"("p_device_id" "text", "p_target" "text", "p_entry_kind" "text", "p_amount" numeric, "p_account_name" "text", "p_notes" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_install_if_disabled"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  game_row public.games;
begin
  if new.installed = true then
    select *
    into game_row
    from public.games
    where id = new.game_id;

    if found and game_row.enabled = false and game_row.type = 'casino' then
      raise exception 'Cannot install disabled game';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_install_if_disabled"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_device_jackpot_payout"("p_device_id" "text", "p_event_ts" timestamp with time zone DEFAULT "now"()) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
      payouts_left = case
        when remaining_amount - v_payout <= 0.0001 then 0
        else greatest(payouts_left - 1, 0)
      end,
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


ALTER FUNCTION "public"."process_device_jackpot_payout"("p_device_id" "text", "p_event_ts" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_pool_goal_queues"("p_event_ts" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."process_pool_goal_queues"("p_event_ts" timestamp with time zone) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."casino_runtime" (
    "id" boolean DEFAULT true NOT NULL,
    "active_mode" "text" DEFAULT 'BASE'::"text" NOT NULL,
    "base_profile_id" "text" NOT NULL,
    "happy_profile_id" "text" NOT NULL,
    "manual_happy_enabled" boolean DEFAULT false NOT NULL,
    "auto_happy_enabled" boolean DEFAULT true NOT NULL,
    "prize_pool_balance" numeric DEFAULT 0 NOT NULL,
    "prize_pool_goal" numeric DEFAULT 10000 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hopper_alert_threshold" numeric DEFAULT 500 NOT NULL,
    "happy_hour_prize_balance" numeric DEFAULT 0 NOT NULL,
    "jackpot_pool_balance" numeric DEFAULT 0 NOT NULL,
    "jackpot_pool_goal" numeric DEFAULT 10000 NOT NULL,
    "jackpot_contrib_pct" numeric DEFAULT 20 NOT NULL,
    "jackpot_min_winners" integer DEFAULT 1 NOT NULL,
    "jackpot_max_winners" integer DEFAULT 5 NOT NULL,
    "jackpot_delay_min_spins" integer DEFAULT 2 NOT NULL,
    "jackpot_delay_max_spins" integer DEFAULT 3 NOT NULL,
    "jackpot_chunk_min" integer DEFAULT 2 NOT NULL,
    "jackpot_chunk_max" integer DEFAULT 3 NOT NULL,
    "jackpot_win_variance" numeric DEFAULT 90 NOT NULL,
    "jackpot_pending_payout" boolean DEFAULT false NOT NULL,
    "last_jackpot_triggered_at" timestamp with time zone,
    "active_happy_pot_id" bigint,
    "active_jackpot_pot_id" bigint,
    "pool_goal_mode" "text" DEFAULT 'amount'::"text" NOT NULL,
    "pool_goal_spins" bigint DEFAULT 1000 NOT NULL,
    "pool_goal_time_seconds" integer DEFAULT 1800 NOT NULL,
    "happy_pool_spin_counter" bigint DEFAULT 0 NOT NULL,
    "jackpot_pool_spin_counter" bigint DEFAULT 0 NOT NULL,
    "happy_pool_goal_anchor_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "jackpot_pool_goal_anchor_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "max_win_enabled" boolean DEFAULT true NOT NULL,
    "max_win_multiplier" numeric DEFAULT 3000 NOT NULL,
    "jackpot_payout_curve" "text" DEFAULT 'center'::"text" NOT NULL,
    "jackpot_delivery_mode" "text" DEFAULT 'TARGET_FIRST'::"text" NOT NULL,
    CONSTRAINT "casino_runtime_active_mode_check" CHECK (("active_mode" = ANY (ARRAY['BASE'::"text", 'HAPPY'::"text"]))),
    CONSTRAINT "casino_runtime_jackpot_delivery_mode_check" CHECK (("jackpot_delivery_mode" = ANY (ARRAY['TARGET_FIRST'::"text", 'AUTHENTIC_PAYTABLE'::"text"]))),
    CONSTRAINT "casino_runtime_jackpot_payout_curve_check" CHECK (("jackpot_payout_curve" = ANY (ARRAY['flat'::"text", 'front'::"text", 'center'::"text", 'back'::"text"])))
);


ALTER TABLE "public"."casino_runtime" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_casino_mode"() RETURNS "public"."casino_runtime"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."recompute_casino_mode"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."redistribute_jackpot_overflow"("p_campaign_id" "uuid", "p_jackpot_pot_id" bigint, "p_amount" numeric, "p_exclude_device" "text" DEFAULT NULL::"text", "p_event_ts" timestamp with time zone DEFAULT "now"()) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."redistribute_jackpot_overflow"("p_campaign_id" "uuid", "p_jackpot_pot_id" bigint, "p_amount" numeric, "p_exclude_device" "text", "p_event_ts" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_authentic_jackpot_plan"("p_device_id" "text", "p_queue_id" bigint, "p_campaign_id" "uuid", "p_expected_amounts" numeric[], "p_tolerance" numeric DEFAULT 500) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.jackpot_payout_queue;
  v_expected_count integer := coalesce(array_length(p_expected_amounts, 1), 0);
  v_i integer := 0;
  v_sum numeric := 0;
  v_amount numeric := 0;
  v_target numeric := 0;
  v_tolerance numeric := least(greatest(coalesce(p_tolerance, 500), 0), 5000);
  v_positive_variance_cap numeric := 200;
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

  if v_sum > v_target + v_positive_variance_cap + 0.0001 then
    raise exception 'Plan sum (%) cannot exceed queue target plus variance cap (%)', v_sum, (v_target + v_positive_variance_cap);
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
    'over_target_bonus', round(greatest(v_sum - v_target, 0), 4),
    'residual_requeued', v_residual
  );
end;
$$;


ALTER FUNCTION "public"."register_authentic_jackpot_plan"("p_device_id" "text", "p_queue_id" bigint, "p_campaign_id" "uuid", "p_expected_amounts" numeric[], "p_tolerance" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_happy_hour_enabled"("p_enabled" boolean) RETURNS "public"."casino_runtime"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."set_happy_hour_enabled"("p_enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_device_game_session"("p_device_id" "text", "p_game_id" "text", "p_game_name" "text" DEFAULT NULL::"text", "p_runtime_mode" "text" DEFAULT NULL::"text", "p_state" "jsonb" DEFAULT '{}'::"jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_session_id bigint;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  if p_game_id is null or trim(p_game_id) = '' then
    raise exception 'p_game_id is required';
  end if;

  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  update public.device_game_sessions
  set
    status = 'ended',
    ended_at = now(),
    updated_at = now()
  where device_id = p_device_id and status = 'active';

  insert into public.device_game_sessions (
    device_id,
    game_id,
    game_name,
    status,
    started_at,
    last_heartbeat,
    last_state,
    updated_at
  )
  values (
    p_device_id,
    p_game_id,
    p_game_name,
    'active',
    now(),
    now(),
    coalesce(p_state, '{}'::jsonb),
    now()
  )
  returning id into v_session_id;

  update public.devices
  set
    current_game_id = p_game_id,
    current_game_name = p_game_name,
    device_status = 'playing',
    active_session_id = v_session_id,
    session_started_at = now(),
    session_last_heartbeat = now(),
    session_ended_at = null,
    runtime_mode = coalesce(p_runtime_mode, runtime_mode),
    session_metadata = coalesce(p_state, '{}'::jsonb),
    updated_at = now()
  where device_id = p_device_id;

  return v_session_id;
end;
$$;


ALTER FUNCTION "public"."start_device_game_session"("p_device_id" "text", "p_game_id" "text", "p_game_name" "text", "p_runtime_mode" "text", "p_state" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_jackpot_payout_if_ready"("p_event_ts" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."trigger_jackpot_payout_if_ready"("p_event_ts" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_device_game_state"("p_device_id" "text", "p_session_id" bigint DEFAULT NULL::bigint, "p_state" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_runtime_mode text;
  v_is_free_game boolean;
  v_free_spins_left integer;
  v_pending_free_spins integer;
  v_show_intro boolean;
  v_current_spin_id bigint;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  v_runtime_mode := nullif(trim(coalesce(p_state->>'runtimeMode', '')), '');
  v_is_free_game := case when p_state ? 'isFreeGame' then coalesce((p_state->>'isFreeGame')::boolean, false) else null end;
  v_free_spins_left := case when p_state ? 'freeSpinsLeft' then greatest(0, coalesce((p_state->>'freeSpinsLeft')::integer, 0)) else null end;
  v_pending_free_spins := case when p_state ? 'pendingFreeSpins' then greatest(0, coalesce((p_state->>'pendingFreeSpins')::integer, 0)) else null end;
  v_show_intro := case when p_state ? 'showFreeSpinIntro' then coalesce((p_state->>'showFreeSpinIntro')::boolean, false) else null end;
  v_current_spin_id := case when p_state ? 'spinId' then greatest(0, coalesce((p_state->>'spinId')::bigint, 0)) else null end;

  update public.devices
  set
    device_status = 'playing',
    active_session_id = coalesce(p_session_id, active_session_id),
    session_last_heartbeat = now(),
    runtime_mode = coalesce(v_runtime_mode, runtime_mode),
    is_free_game = coalesce(v_is_free_game, is_free_game),
    free_spins_left = coalesce(v_free_spins_left, free_spins_left),
    pending_free_spins = coalesce(v_pending_free_spins, pending_free_spins),
    show_free_spin_intro = coalesce(v_show_intro, show_free_spin_intro),
    current_spin_id = coalesce(v_current_spin_id, current_spin_id),
    session_metadata = coalesce(p_state, '{}'::jsonb),
    updated_at = now()
  where device_id = p_device_id;

  if p_session_id is not null then
    update public.device_game_sessions
    set
      last_heartbeat = now(),
      last_state = coalesce(p_state, '{}'::jsonb),
      updated_at = now()
    where id = p_session_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."update_device_game_state"("p_device_id" "text", "p_session_id" bigint, "p_state" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cabinet_games" (
    "device_id" "text" NOT NULL,
    "game_id" "text" NOT NULL,
    "installed" boolean DEFAULT false,
    "installed_version" integer
);


ALTER TABLE "public"."cabinet_games" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."games" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "price" integer DEFAULT 0 NOT NULL,
    "rom_path" "text",
    "package_url" "text",
    "box_art_url" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "emulator_core" "text",
    "join_mode" "text" DEFAULT 'simultaneous'::"text" NOT NULL,
    CONSTRAINT "games_join_mode_check" CHECK (("join_mode" = ANY (ARRAY['simultaneous'::"text", 'alternating'::"text", 'single_only'::"text"]))),
    CONSTRAINT "games_type_check" CHECK (("type" = ANY (ARRAY['arcade'::"text", 'casino'::"text"])))
);


ALTER TABLE "public"."games" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."cabinet_visible_games" AS
 SELECT "cg"."device_id",
    "g"."id",
    "g"."name",
    "g"."type",
    "g"."price",
    "g"."box_art_url",
    "g"."emulator_core",
    "g"."rom_path",
    "g"."version"
   FROM ("public"."cabinet_games" "cg"
     JOIN "public"."games" "g" ON (("g"."id" = "cg"."game_id")))
  WHERE (("cg"."installed" = true) AND ("g"."enabled" = true));


ALTER VIEW "public"."cabinet_visible_games" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."happy_hour_pots" (
    "id" bigint NOT NULL,
    "amount_total" numeric DEFAULT 0 NOT NULL,
    "amount_remaining" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "goal_mode" "text" DEFAULT 'amount'::"text" NOT NULL,
    "goal_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activated_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    CONSTRAINT "happy_hour_pots_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'active'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."happy_hour_pots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."jackpot_pots" (
    "id" bigint NOT NULL,
    "amount_total" numeric DEFAULT 0 NOT NULL,
    "amount_remaining" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "goal_mode" "text" DEFAULT 'amount'::"text" NOT NULL,
    "goal_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "campaign_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activated_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    CONSTRAINT "jackpot_pots_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'processing'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."jackpot_pots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rtp_profiles" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "mode" "text" NOT NULL,
    "house_pct" numeric DEFAULT 0 NOT NULL,
    "pool_pct" numeric DEFAULT 0 NOT NULL,
    "player_pct" numeric DEFAULT 0 NOT NULL,
    "prize_pct" numeric DEFAULT 0 NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rtp_profiles_mode_check" CHECK (("mode" = ANY (ARRAY['BASE'::"text", 'HAPPY'::"text"])))
);


ALTER TABLE "public"."rtp_profiles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."casino_runtime_live" AS
 SELECT "r"."id",
    "r"."active_mode",
    "r"."base_profile_id",
    "r"."happy_profile_id",
    "r"."manual_happy_enabled",
    "r"."auto_happy_enabled",
    "r"."prize_pool_balance",
    "r"."happy_hour_prize_balance",
    "r"."prize_pool_goal",
    "r"."jackpot_pool_balance",
    "r"."jackpot_pool_goal",
    "r"."jackpot_contrib_pct",
    "r"."jackpot_min_winners",
    "r"."jackpot_max_winners",
    "r"."jackpot_delay_min_spins",
    "r"."jackpot_delay_max_spins",
    "r"."jackpot_chunk_min",
    "r"."jackpot_chunk_max",
    "r"."jackpot_win_variance",
    "r"."jackpot_pending_payout",
    "r"."last_jackpot_triggered_at",
    "r"."active_happy_pot_id",
    "r"."active_jackpot_pot_id",
    "r"."pool_goal_mode",
    "r"."pool_goal_spins",
    "r"."pool_goal_time_seconds",
    "r"."happy_pool_spin_counter",
    "r"."jackpot_pool_spin_counter",
    "r"."happy_pool_goal_anchor_at",
    "r"."jackpot_pool_goal_anchor_at",
    "r"."max_win_enabled",
    "r"."max_win_multiplier",
    COALESCE(( SELECT "count"(*) AS "count"
           FROM "public"."happy_hour_pots" "hp_1"
          WHERE ("hp_1"."status" = 'queued'::"text")), (0)::bigint) AS "happy_pots_queued_count",
    COALESCE(( SELECT "sum"("hp_1"."amount_remaining") AS "sum"
           FROM "public"."happy_hour_pots" "hp_1"
          WHERE ("hp_1"."status" = 'queued'::"text")), (0)::numeric) AS "happy_pots_queued_amount",
    COALESCE(( SELECT "count"(*) AS "count"
           FROM "public"."jackpot_pots" "jp"
          WHERE ("jp"."status" = 'queued'::"text")), (0)::bigint) AS "jackpot_pots_queued_count",
    COALESCE(( SELECT "sum"("jp"."amount_remaining") AS "sum"
           FROM "public"."jackpot_pots" "jp"
          WHERE ("jp"."status" = 'queued'::"text")), (0)::numeric) AS "jackpot_pots_queued_amount",
    "r"."hopper_alert_threshold",
    "r"."updated_at",
    "bp"."name" AS "base_profile_name",
    "hp"."name" AS "happy_profile_name",
    "bp"."house_pct" AS "base_house_pct",
    "bp"."pool_pct" AS "base_pool_pct",
    "bp"."player_pct" AS "base_player_pct",
    "hp"."house_pct" AS "happy_house_pct",
    "hp"."pool_pct" AS "happy_pool_pct",
    "hp"."player_pct" AS "happy_player_pct",
    "hp"."prize_pct" AS "happy_prize_pct",
        CASE
            WHEN ("r"."active_mode" = 'HAPPY'::"text") THEN ("hp"."player_pct" + "hp"."prize_pct")
            ELSE "bp"."player_pct"
        END AS "active_target_rtp_pct",
    "r"."jackpot_payout_curve",
    "r"."jackpot_delivery_mode"
   FROM (("public"."casino_runtime" "r"
     LEFT JOIN "public"."rtp_profiles" "bp" ON (("bp"."id" = "r"."base_profile_id")))
     LEFT JOIN "public"."rtp_profiles" "hp" ON (("hp"."id" = "r"."happy_profile_id")));


ALTER VIEW "public"."casino_runtime_live" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."device_admin_commands" (
    "id" bigint NOT NULL,
    "device_id" "text" NOT NULL,
    "command" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "reason" "text",
    "requested_by" "text",
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "error" "text",
    "result" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "device_admin_commands_command_check" CHECK (("command" = ANY (ARRAY['restart'::"text", 'shutdown'::"text", 'reset'::"text"]))),
    CONSTRAINT "device_admin_commands_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."device_admin_commands" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."device_admin_commands_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."device_admin_commands_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."device_admin_commands_id_seq" OWNED BY "public"."device_admin_commands"."id";



CREATE TABLE IF NOT EXISTS "public"."device_admin_ledger_entries" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "device_id" "text" NOT NULL,
    "target" "text" NOT NULL,
    "entry_kind" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "account_name" "text" NOT NULL,
    "notes" "text",
    "balance_before" numeric NOT NULL,
    "balance_after" numeric NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "device_admin_ledger_entries_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "device_admin_ledger_entries_entry_kind_check" CHECK (("entry_kind" = ANY (ARRAY['debit'::"text", 'credit'::"text"]))),
    CONSTRAINT "device_admin_ledger_entries_target_check" CHECK (("target" = ANY (ARRAY['accounting_balance'::"text", 'hopper_balance'::"text"])))
);


ALTER TABLE "public"."device_admin_ledger_entries" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."device_admin_ledger_entries_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."device_admin_ledger_entries_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."device_admin_ledger_entries_id_seq" OWNED BY "public"."device_admin_ledger_entries"."id";



CREATE TABLE IF NOT EXISTS "public"."device_daily_stats" (
    "stat_date" "date" NOT NULL,
    "device_id" "text" NOT NULL,
    "coins_in_amount" numeric DEFAULT 0 NOT NULL,
    "hopper_in_amount" numeric DEFAULT 0 NOT NULL,
    "hopper_out_amount" numeric DEFAULT 0 NOT NULL,
    "bet_amount" numeric DEFAULT 0 NOT NULL,
    "win_amount" numeric DEFAULT 0 NOT NULL,
    "withdrawal_amount" numeric DEFAULT 0 NOT NULL,
    "balance_change" numeric DEFAULT 0 NOT NULL,
    "event_count" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "spins_count" bigint DEFAULT 0 NOT NULL,
    "prize_pool_contrib_amount" numeric DEFAULT 0 NOT NULL,
    "prize_pool_paid_amount" numeric DEFAULT 0 NOT NULL,
    "house_take_amount" numeric DEFAULT 0 NOT NULL,
    "jackpot_contrib_amount" numeric DEFAULT 0 NOT NULL,
    "jackpot_win_amount" numeric DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."device_daily_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."device_game_sessions" (
    "id" bigint NOT NULL,
    "device_id" "text" NOT NULL,
    "game_id" "text" NOT NULL,
    "game_name" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "last_heartbeat" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "device_game_sessions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'ended'::"text"])))
);


ALTER TABLE "public"."device_game_sessions" OWNER TO "postgres";


ALTER TABLE "public"."device_game_sessions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."device_game_sessions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."device_ledger" (
    "id" bigint NOT NULL,
    "device_id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "balance_delta" numeric(14,2) NOT NULL,
    "source" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "device_ledger_type_check" CHECK (("type" = ANY (ARRAY['deposit'::"text", 'withdrawal'::"text", 'play'::"text", 'bet'::"text", 'win'::"text"])))
);


ALTER TABLE "public"."device_ledger" OWNER TO "postgres";


ALTER TABLE "public"."device_ledger" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."device_ledger_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."device_metric_events" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "device_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "metadata" "jsonb",
    CONSTRAINT "device_metric_events_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "device_metric_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['coins_in'::"text", 'hopper_in'::"text", 'withdrawal'::"text", 'bet'::"text", 'win'::"text", 'spin'::"text"])))
);


ALTER TABLE "public"."device_metric_events" OWNER TO "postgres";


ALTER TABLE "public"."device_metric_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."device_metric_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."device_spin_event_dedup" (
    "id" bigint NOT NULL,
    "device_id" "text" NOT NULL,
    "spin_key" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "event_ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "amount" numeric NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "device_spin_event_dedup_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "device_spin_event_dedup_event_type_check" CHECK (("event_type" = ANY (ARRAY['bet'::"text", 'win'::"text", 'spin'::"text"])))
);


ALTER TABLE "public"."device_spin_event_dedup" OWNER TO "postgres";


ALTER TABLE "public"."device_spin_event_dedup" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."device_spin_event_dedup_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "device_id" "text" NOT NULL,
    "name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "balance" numeric(14,2) DEFAULT 0.00 NOT NULL,
    "coins_in_total" numeric DEFAULT 0 NOT NULL,
    "hopper_balance" numeric DEFAULT 0 NOT NULL,
    "hopper_in_total" numeric DEFAULT 0 NOT NULL,
    "hopper_out_total" numeric DEFAULT 0 NOT NULL,
    "bet_total" numeric DEFAULT 0 NOT NULL,
    "win_total" numeric DEFAULT 0 NOT NULL,
    "withdraw_total" numeric DEFAULT 0 NOT NULL,
    "spins_total" bigint DEFAULT 0 NOT NULL,
    "prize_pool_contrib_total" numeric DEFAULT 0 NOT NULL,
    "prize_pool_paid_total" numeric DEFAULT 0 NOT NULL,
    "current_game_id" "text",
    "current_game_name" "text",
    "device_status" "text" DEFAULT 'idle'::"text" NOT NULL,
    "active_session_id" bigint,
    "session_started_at" timestamp with time zone,
    "session_last_heartbeat" timestamp with time zone,
    "session_ended_at" timestamp with time zone,
    "runtime_mode" "text",
    "is_free_game" boolean DEFAULT false NOT NULL,
    "free_spins_left" integer DEFAULT 0 NOT NULL,
    "pending_free_spins" integer DEFAULT 0 NOT NULL,
    "show_free_spin_intro" boolean DEFAULT false NOT NULL,
    "current_spin_id" bigint DEFAULT 0 NOT NULL,
    "session_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "house_take_total" numeric DEFAULT 0 NOT NULL,
    "last_bet_amount" numeric DEFAULT 0 NOT NULL,
    "last_bet_at" timestamp with time zone,
    "jackpot_contrib_total" numeric DEFAULT 0 NOT NULL,
    "jackpot_win_total" numeric DEFAULT 0 NOT NULL,
    "arcade_shell_version" "text",
    "current_ip" "text",
    CONSTRAINT "devices_device_status_check" CHECK (("device_status" = ANY (ARRAY['idle'::"text", 'playing'::"text", 'offline'::"text"])))
);


ALTER TABLE "public"."devices" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."device_stats_live" AS
 SELECT "device_id",
    "balance",
    "hopper_balance",
    "coins_in_total",
    "hopper_in_total",
    "hopper_out_total",
    "bet_total",
    "win_total",
    "withdraw_total",
    "updated_at",
    "name",
    "spins_total",
    "prize_pool_contrib_total",
    "prize_pool_paid_total",
    "current_game_id",
    "current_game_name",
    "device_status",
    "active_session_id",
    "session_started_at",
    "session_last_heartbeat",
    "session_ended_at",
    "runtime_mode",
    "is_free_game",
    "free_spins_left",
    "pending_free_spins",
    "show_free_spin_intro",
    "current_spin_id",
    "session_metadata",
    "arcade_shell_version",
    "current_ip",
    "avg_bet_amount"
   FROM "public"."devices" "d";


ALTER VIEW "public"."device_stats_live" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."jackpot_payout_queue" (
    "id" bigint NOT NULL,
    "campaign_id" "uuid" DEFAULT ((((((((("substr"("md5"((("random"())::"text" || ("clock_timestamp"())::"text")), 1, 8) || '-'::"text") || "substr"("md5"((("random"())::"text" || ("clock_timestamp"())::"text")), 1, 4)) || '-'::"text") || "substr"("md5"((("random"())::"text" || ("clock_timestamp"())::"text")), 1, 4)) || '-'::"text") || "substr"("md5"((("random"())::"text" || ("clock_timestamp"())::"text")), 1, 4)) || '-'::"text") || "substr"("md5"((("random"())::"text" || ("clock_timestamp"())::"text")), 1, 12)))::"uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "target_amount" numeric DEFAULT 0 NOT NULL,
    "remaining_amount" numeric DEFAULT 0 NOT NULL,
    "spins_until_start" integer DEFAULT 0 NOT NULL,
    "payouts_left" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "jackpot_pot_id" bigint,
    "payout_ready_at" timestamp with time zone
);


ALTER TABLE "public"."jackpot_payout_queue" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."devices_dashboard_live" AS
 SELECT "d"."id",
    "d"."device_id",
    "d"."name",
    "d"."created_at",
    "d"."updated_at",
    "d"."balance",
    "d"."coins_in_total",
    "d"."hopper_balance",
    "d"."hopper_in_total",
    "d"."hopper_out_total",
    "d"."bet_total",
    "d"."win_total",
    "d"."withdraw_total",
    "d"."spins_total",
    "d"."prize_pool_contrib_total",
    "d"."prize_pool_paid_total",
    "d"."current_game_id",
    "d"."current_game_name",
    "d"."device_status",
    "d"."active_session_id",
    "d"."session_started_at",
    "d"."session_last_heartbeat",
    "d"."session_ended_at",
    "d"."runtime_mode",
    "d"."is_free_game",
    "d"."free_spins_left",
    "d"."pending_free_spins",
    "d"."show_free_spin_intro",
    "d"."current_spin_id",
    "d"."session_metadata",
    "d"."house_take_total",
    "d"."last_bet_amount",
    "d"."last_bet_at",
    "d"."jackpot_contrib_total",
    "d"."jackpot_win_total",
    "d"."arcade_shell_version",
    "d"."current_ip",
    COALESCE("j"."has_active", false) AS "jackpot_selected",
    COALESCE("j"."target_amount", (0)::numeric) AS "jackpot_target_amount",
    COALESCE("j"."remaining_amount", (0)::numeric) AS "jackpot_remaining_amount",
    COALESCE("j"."spins_until_start", 0) AS "jackpot_spins_until_start"
   FROM ("public"."devices" "d"
     LEFT JOIN ( SELECT "q"."device_id",
            true AS "has_active",
            "sum"("q"."target_amount") AS "target_amount",
            "sum"("q"."remaining_amount") AS "remaining_amount",
            "min"("q"."spins_until_start") AS "spins_until_start"
           FROM "public"."jackpot_payout_queue" "q"
          WHERE ("q"."completed_at" IS NULL)
          GROUP BY "q"."device_id") "j" ON (("j"."device_id" = "d"."device_id")));


ALTER VIEW "public"."devices_dashboard_live" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."global_daily_stats" AS
 SELECT "stat_date",
    COALESCE("sum"("coins_in_amount"), (0)::numeric) AS "total_coins_in",
    COALESCE("sum"("hopper_in_amount"), (0)::numeric) AS "total_hopper_in",
    COALESCE("sum"("hopper_out_amount"), (0)::numeric) AS "total_hopper_out",
    COALESCE("sum"("bet_amount"), (0)::numeric) AS "total_bet_amount",
    COALESCE("sum"("win_amount"), (0)::numeric) AS "total_win_amount",
    COALESCE("sum"("withdrawal_amount"), (0)::numeric) AS "total_withdraw_amount",
    COALESCE("sum"("balance_change"), (0)::numeric) AS "total_balance_change",
    (COALESCE("sum"("event_count"), (0)::numeric))::bigint AS "event_count"
   FROM "public"."device_daily_stats" "s"
  GROUP BY "stat_date"
  ORDER BY "stat_date" DESC;


ALTER VIEW "public"."global_daily_stats" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."global_stats_live" AS
 WITH "totals" AS (
         SELECT COALESCE("sum"("d"."balance"), (0)::numeric) AS "total_balance",
            COALESCE("sum"("d"."coins_in_total"), (0)::numeric) AS "total_coins_in",
            COALESCE("sum"("d"."hopper_balance"), (0)::numeric) AS "total_hopper",
            COALESCE("sum"("d"."bet_total"), (0)::numeric) AS "total_bet_amount",
            COALESCE("sum"("d"."win_total"), (0)::numeric) AS "total_win_amount",
            COALESCE("sum"("d"."withdraw_total"), (0)::numeric) AS "total_withdraw_amount",
             (COALESCE("sum"("d"."spins_total"), (0)::numeric))::bigint AS "total_spins",
             GREATEST(1, COALESCE("round"("sum"("d"."bet_total") / NULLIF("sum"("d"."spins_total"), 0)), 0)) AS "global_avg_bet",
             COALESCE("sum"("d"."house_take_total"), (0)::numeric) AS "total_house_take",
            COALESCE("sum"("d"."jackpot_contrib_total"), (0)::numeric) AS "total_jackpot_contrib",
            COALESCE("sum"("d"."jackpot_win_total"), (0)::numeric) AS "total_jackpot_win",
            "count"(*) AS "device_count"
           FROM "public"."devices" "d"
        ), "runtime" AS (
         SELECT COALESCE("r"."prize_pool_balance", (0)::numeric) AS "prize_pool_balance",
            COALESCE("r"."happy_hour_prize_balance", (0)::numeric) AS "happy_hour_prize_balance",
            COALESCE("r"."jackpot_pool_balance", (0)::numeric) AS "jackpot_pool_balance"
           FROM "public"."casino_runtime" "r"
          WHERE ("r"."id" = true)
         LIMIT 1
        ), "liabilities" AS (
         SELECT COALESCE(( SELECT "sum"("hp"."amount_remaining") AS "sum"
                   FROM "public"."happy_hour_pots" "hp"
                  WHERE ("hp"."status" = 'queued'::"text")), (0)::numeric) AS "happy_queued_amount",
            COALESCE(( SELECT "sum"("jp"."amount_remaining") AS "sum"
                   FROM "public"."jackpot_pots" "jp"
                  WHERE ("jp"."status" = 'queued'::"text")), (0)::numeric) AS "jackpot_queued_amount",
            COALESCE(( SELECT "sum"("jp"."amount_remaining") AS "sum"
                   FROM "public"."jackpot_pots" "jp"
                  WHERE ("jp"."status" = 'processing'::"text")), (0)::numeric) AS "jackpot_processing_amount"
        )
 SELECT "t"."total_balance",
    "t"."total_coins_in",
    "t"."total_hopper",
    "t"."total_bet_amount",
    "t"."total_win_amount",
    "t"."total_withdraw_amount",
    "t"."total_spins",
        CASE
            WHEN ("t"."total_bet_amount" > (0)::numeric) THEN "round"((("t"."total_win_amount" / NULLIF("t"."total_bet_amount", (0)::numeric)) * 100.0), 4)
            ELSE (0)::numeric
        END AS "global_rtp_percent",
    "t"."device_count",
    "now"() AS "generated_at",
    "t"."total_house_take",
        CASE
            WHEN ("t"."total_bet_amount" > (0)::numeric) THEN "round"((("t"."total_house_take" / NULLIF("t"."total_bet_amount", (0)::numeric)) * 100.0), 4)
            ELSE (0)::numeric
        END AS "global_house_edge_percent",
    "t"."total_jackpot_contrib",
    "t"."total_jackpot_win",
    (((((((("t"."total_coins_in" - "t"."total_withdraw_amount") - "t"."total_balance") - COALESCE("rt"."prize_pool_balance", (0)::numeric)) - COALESCE("rt"."happy_hour_prize_balance", (0)::numeric)) - COALESCE("rt"."jackpot_pool_balance", (0)::numeric)) - COALESCE("lb"."happy_queued_amount", (0)::numeric)) - COALESCE("lb"."jackpot_queued_amount", (0)::numeric)) - COALESCE("lb"."jackpot_processing_amount", (0)::numeric)) AS "total_house_net",
        CASE
            WHEN ("t"."total_coins_in" > (0)::numeric) THEN "round"((((((((((("t"."total_coins_in" - "t"."total_withdraw_amount") - "t"."total_balance") - COALESCE("rt"."prize_pool_balance", (0)::numeric)) - COALESCE("rt"."happy_hour_prize_balance", (0)::numeric)) - COALESCE("rt"."jackpot_pool_balance", (0)::numeric)) - COALESCE("lb"."happy_queued_amount", (0)::numeric)) - COALESCE("lb"."jackpot_queued_amount", (0)::numeric)) - COALESCE("lb"."jackpot_processing_amount", (0)::numeric)) / NULLIF("t"."total_coins_in", (0)::numeric)) * 100.0), 4)
            ELSE (0)::numeric
        END AS "global_house_net_percent"
   FROM (("totals" "t"
     LEFT JOIN "runtime" "rt" ON (true))
     LEFT JOIN "liabilities" "lb" ON (true));


ALTER VIEW "public"."global_stats_live" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."happy_hour_pots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."happy_hour_pots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."happy_hour_pots_id_seq" OWNED BY "public"."happy_hour_pots"."id";



CREATE TABLE IF NOT EXISTS "public"."jackpot_payout_plan_steps" (
    "id" bigint NOT NULL,
    "queue_id" bigint NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "step_index" integer NOT NULL,
    "expected_amount" numeric DEFAULT 0 NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."jackpot_payout_plan_steps" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."jackpot_payout_plan_steps_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."jackpot_payout_plan_steps_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."jackpot_payout_plan_steps_id_seq" OWNED BY "public"."jackpot_payout_plan_steps"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."jackpot_payout_queue_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."jackpot_payout_queue_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."jackpot_payout_queue_id_seq" OWNED BY "public"."jackpot_payout_queue"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."jackpot_pots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."jackpot_pots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."jackpot_pots_id_seq" OWNED BY "public"."jackpot_pots"."id";



CREATE TABLE IF NOT EXISTS "public"."live_config" (
    "id" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "gold_chance_initial" double precision,
    "gold_chance_refill" double precision,
    "red_wild_chance" double precision,
    "reel_weights" "jsonb",
    "reel_weights_free" "jsonb",
    "happy_hour" boolean DEFAULT false
);


ALTER TABLE "public"."live_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."over_cap_win_events" (
    "id" bigint NOT NULL,
    "device_id" "text" NOT NULL,
    "spin_key" "text",
    "event_ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "runtime_mode" "text" NOT NULL,
    "funding_source" "text" NOT NULL,
    "requested_amount" numeric NOT NULL,
    "accepted_amount" numeric NOT NULL,
    "funding_cap_amount" numeric NOT NULL,
    "over_amount" numeric NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "over_cap_win_events_accepted_amount_check" CHECK (("accepted_amount" >= (0)::numeric)),
    CONSTRAINT "over_cap_win_events_funding_cap_amount_check" CHECK (("funding_cap_amount" >= (0)::numeric)),
    CONSTRAINT "over_cap_win_events_over_amount_check" CHECK (("over_amount" >= (0)::numeric)),
    CONSTRAINT "over_cap_win_events_requested_amount_check" CHECK (("requested_amount" >= (0)::numeric)),
    CONSTRAINT "over_cap_win_events_runtime_mode_check" CHECK (("runtime_mode" = ANY (ARRAY['BASE'::"text", 'HAPPY'::"text"])))
);


ALTER TABLE "public"."over_cap_win_events" OWNER TO "postgres";


ALTER TABLE "public"."over_cap_win_events" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."over_cap_win_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE OR REPLACE VIEW "public"."over_cap_win_events_live" AS
 SELECT "e"."id",
    "e"."device_id",
    "d"."name" AS "device_name",
    "e"."spin_key",
    "e"."event_ts",
    "e"."runtime_mode",
    "e"."funding_source",
    "e"."requested_amount",
    "e"."accepted_amount",
    "e"."funding_cap_amount",
    "e"."over_amount",
    "e"."metadata",
    "e"."created_at"
   FROM ("public"."over_cap_win_events" "e"
     LEFT JOIN "public"."devices" "d" ON (("d"."device_id" = "e"."device_id")));


ALTER VIEW "public"."over_cap_win_events_live" OWNER TO "postgres";


ALTER TABLE ONLY "public"."device_admin_commands" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."device_admin_commands_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."device_admin_ledger_entries" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."device_admin_ledger_entries_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."happy_hour_pots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."happy_hour_pots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."jackpot_payout_plan_steps" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."jackpot_payout_plan_steps_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."jackpot_payout_queue" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."jackpot_payout_queue_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."jackpot_pots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."jackpot_pots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."cabinet_games"
    ADD CONSTRAINT "cabinet_games_pkey" PRIMARY KEY ("device_id", "game_id");



ALTER TABLE ONLY "public"."casino_runtime"
    ADD CONSTRAINT "casino_runtime_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."device_admin_commands"
    ADD CONSTRAINT "device_admin_commands_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."device_admin_ledger_entries"
    ADD CONSTRAINT "device_admin_ledger_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."device_daily_stats"
    ADD CONSTRAINT "device_daily_stats_pkey" PRIMARY KEY ("stat_date", "device_id");



ALTER TABLE ONLY "public"."device_game_sessions"
    ADD CONSTRAINT "device_game_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."device_ledger"
    ADD CONSTRAINT "device_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."device_metric_events"
    ADD CONSTRAINT "device_metric_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."device_spin_event_dedup"
    ADD CONSTRAINT "device_spin_event_dedup_device_id_spin_key_event_type_key" UNIQUE ("device_id", "spin_key", "event_type");



ALTER TABLE ONLY "public"."device_spin_event_dedup"
    ADD CONSTRAINT "device_spin_event_dedup_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_device_id_key" UNIQUE ("device_id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."happy_hour_pots"
    ADD CONSTRAINT "happy_hour_pots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."jackpot_payout_plan_steps"
    ADD CONSTRAINT "jackpot_payout_plan_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."jackpot_payout_plan_steps"
    ADD CONSTRAINT "jackpot_payout_plan_steps_queue_id_step_index_key" UNIQUE ("queue_id", "step_index");



ALTER TABLE ONLY "public"."jackpot_payout_queue"
    ADD CONSTRAINT "jackpot_payout_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."jackpot_pots"
    ADD CONSTRAINT "jackpot_pots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_config"
    ADD CONSTRAINT "live_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."over_cap_win_events"
    ADD CONSTRAINT "over_cap_win_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rtp_profiles"
    ADD CONSTRAINT "rtp_profiles_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_device_admin_commands_device_status" ON "public"."device_admin_commands" USING "btree" ("device_id", "status", "requested_at" DESC);



CREATE INDEX "idx_device_admin_commands_status_requested" ON "public"."device_admin_commands" USING "btree" ("status", "requested_at");



CREATE INDEX "idx_device_admin_ledger_entries_device_time" ON "public"."device_admin_ledger_entries" USING "btree" ("device_id", "created_at" DESC);



CREATE INDEX "idx_device_daily_stats_device_id" ON "public"."device_daily_stats" USING "btree" ("device_id", "stat_date" DESC);



CREATE INDEX "idx_device_game_sessions_device_started" ON "public"."device_game_sessions" USING "btree" ("device_id", "started_at" DESC);



CREATE INDEX "idx_device_game_sessions_status" ON "public"."device_game_sessions" USING "btree" ("status", "last_heartbeat" DESC);



CREATE INDEX "idx_device_ledger_created_at" ON "public"."device_ledger" USING "btree" ("created_at");



CREATE INDEX "idx_device_ledger_device_id" ON "public"."device_ledger" USING "btree" ("device_id");



CREATE INDEX "idx_device_metric_events_device_time" ON "public"."device_metric_events" USING "btree" ("device_id", "event_ts" DESC);



CREATE INDEX "idx_device_metric_events_type_time" ON "public"."device_metric_events" USING "btree" ("event_type", "event_ts" DESC);



CREATE INDEX "idx_device_spin_event_dedup_device_time" ON "public"."device_spin_event_dedup" USING "btree" ("device_id", "event_ts" DESC, "id" DESC);



CREATE INDEX "idx_happy_hour_pots_status_created" ON "public"."happy_hour_pots" USING "btree" ("status", "created_at");



CREATE INDEX "idx_jackpot_payout_queue_campaign" ON "public"."jackpot_payout_queue" USING "btree" ("campaign_id", "completed_at");



CREATE INDEX "idx_jackpot_payout_queue_device_active" ON "public"."jackpot_payout_queue" USING "btree" ("device_id", "completed_at", "created_at");



CREATE INDEX "idx_jackpot_payout_queue_pot" ON "public"."jackpot_payout_queue" USING "btree" ("jackpot_pot_id", "completed_at");



CREATE INDEX "idx_jackpot_plan_steps_queue_unconsumed" ON "public"."jackpot_payout_plan_steps" USING "btree" ("queue_id", "consumed_at", "step_index");



CREATE INDEX "idx_jackpot_pots_status_created" ON "public"."jackpot_pots" USING "btree" ("status", "created_at");



CREATE INDEX "idx_over_cap_win_events_device_time" ON "public"."over_cap_win_events" USING "btree" ("device_id", "event_ts" DESC);



CREATE INDEX "idx_over_cap_win_events_event_time" ON "public"."over_cap_win_events" USING "btree" ("event_ts" DESC, "id" DESC);



CREATE INDEX "idx_rtp_profiles_mode" ON "public"."rtp_profiles" USING "btree" ("mode", "enabled", "sort_order");



CREATE OR REPLACE TRIGGER "device_admin_commands_set_updated_at" BEFORE UPDATE ON "public"."device_admin_commands" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "devices_set_updated_at" BEFORE UPDATE ON "public"."devices" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_apply_device_ledger" AFTER INSERT ON "public"."device_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."apply_device_ledger"();



CREATE OR REPLACE TRIGGER "trg_auto_enable_global_games_for_new_device" AFTER INSERT ON "public"."devices" FOR EACH ROW EXECUTE FUNCTION "public"."auto_enable_global_games_for_new_device"();



CREATE OR REPLACE TRIGGER "trg_disable_game_from_cabinets" AFTER UPDATE OF "enabled" ON "public"."games" FOR EACH ROW EXECUTE FUNCTION "public"."disable_game_from_cabinets"();



CREATE OR REPLACE TRIGGER "trg_prevent_install_disabled" BEFORE INSERT OR UPDATE ON "public"."cabinet_games" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_install_if_disabled"();



ALTER TABLE ONLY "public"."cabinet_games"
    ADD CONSTRAINT "cabinet_games_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cabinet_games"
    ADD CONSTRAINT "cabinet_games_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."casino_runtime"
    ADD CONSTRAINT "casino_runtime_base_profile_id_fkey" FOREIGN KEY ("base_profile_id") REFERENCES "public"."rtp_profiles"("id");



ALTER TABLE ONLY "public"."casino_runtime"
    ADD CONSTRAINT "casino_runtime_happy_profile_id_fkey" FOREIGN KEY ("happy_profile_id") REFERENCES "public"."rtp_profiles"("id");



ALTER TABLE ONLY "public"."device_admin_ledger_entries"
    ADD CONSTRAINT "device_admin_ledger_entries_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."device_daily_stats"
    ADD CONSTRAINT "device_daily_stats_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."device_game_sessions"
    ADD CONSTRAINT "device_game_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."device_ledger"
    ADD CONSTRAINT "device_ledger_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."device_metric_events"
    ADD CONSTRAINT "device_metric_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."device_spin_event_dedup"
    ADD CONSTRAINT "device_spin_event_dedup_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."jackpot_payout_plan_steps"
    ADD CONSTRAINT "jackpot_payout_plan_steps_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."jackpot_payout_plan_steps"
    ADD CONSTRAINT "jackpot_payout_plan_steps_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "public"."jackpot_payout_queue"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."jackpot_payout_queue"
    ADD CONSTRAINT "jackpot_payout_queue_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."over_cap_win_events"
    ADD CONSTRAINT "over_cap_win_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE CASCADE;



CREATE POLICY "allow read games" ON "public"."games" FOR SELECT USING (true);



CREATE POLICY "allow select devices" ON "public"."devices" FOR SELECT USING (true);



CREATE POLICY "anon read devices" ON "public"."devices" FOR SELECT TO "anon" USING (true);



ALTER TABLE "public"."cabinet_games" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dashboard can read devices" ON "public"."devices" FOR SELECT TO "anon" USING (true);



CREATE POLICY "dev allow all anon" ON "public"."cabinet_games" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "dev allow all anon" ON "public"."games" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "dev allow anon cabinet_games" ON "public"."cabinet_games" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "dev allow select cabinet" ON "public"."cabinet_games" FOR SELECT USING (true);



CREATE POLICY "dev allow select games" ON "public"."games" FOR SELECT USING (true);



CREATE POLICY "device can insert itself" ON "public"."devices" FOR INSERT TO "anon" WITH CHECK ((("device_id" = (("current_setting"('request.jwt.claims'::"text", true))::"jsonb" ->> 'device_id'::"text")) OR ("device_id" IS NOT NULL)));



CREATE POLICY "device can insert ledger" ON "public"."device_ledger" FOR INSERT WITH CHECK (true);



CREATE POLICY "device can read itself" ON "public"."devices" FOR SELECT USING (true);



CREATE POLICY "device can update its own name" ON "public"."devices" FOR UPDATE TO "anon" USING (("device_id" = "device_id")) WITH CHECK (("device_id" = "device_id"));



ALTER TABLE "public"."device_admin_commands" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "device_admin_commands_insert" ON "public"."device_admin_commands" FOR INSERT WITH CHECK (true);



CREATE POLICY "device_admin_commands_select" ON "public"."device_admin_commands" FOR SELECT USING (true);



CREATE POLICY "device_admin_commands_update" ON "public"."device_admin_commands" FOR UPDATE USING (true) WITH CHECK (true);



ALTER TABLE "public"."device_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."devices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devices are readable" ON "public"."devices" FOR SELECT TO "anon" USING (true);



CREATE POLICY "devices_select" ON "public"."devices" FOR SELECT USING (true);



CREATE POLICY "devices_update" ON "public"."devices" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "devices_upsert" ON "public"."devices" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."games" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insert device" ON "public"."devices" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."live_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read config" ON "public"."live_config" FOR SELECT USING (true);



CREATE POLICY "read devices" ON "public"."devices" FOR SELECT USING (true);



CREATE POLICY "update config" ON "public"."live_config" FOR UPDATE USING (true);



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_device_ledger"() TO "anon";
GRANT ALL ON FUNCTION "public"."apply_device_ledger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_device_ledger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_metric_event"("p_device_id" "text", "p_event_type" "text", "p_amount" numeric, "p_event_ts" timestamp with time zone, "p_metadata" "jsonb", "p_write_ledger" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."apply_metric_event"("p_device_id" "text", "p_event_type" "text", "p_amount" numeric, "p_event_ts" timestamp with time zone, "p_metadata" "jsonb", "p_write_ledger" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_metric_event"("p_device_id" "text", "p_event_type" "text", "p_amount" numeric, "p_event_ts" timestamp with time zone, "p_metadata" "jsonb", "p_write_ledger" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_metric_events"("p_events" "jsonb", "p_write_ledger" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."apply_metric_events"("p_events" "jsonb", "p_write_ledger" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_metric_events"("p_events" "jsonb", "p_write_ledger" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_enable_global_games_for_new_device"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_enable_global_games_for_new_device"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_enable_global_games_for_new_device"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_max_win_cap"("p_last_bet" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_max_win_cap"("p_last_bet" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_max_win_cap"("p_last_bet" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."consume_arcade_life"("p_device_id" "text", "p_game_id" "text", "p_player" "text", "p_amount" numeric, "p_reason" "text", "p_event_ts" timestamp with time zone, "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."consume_arcade_life"("p_device_id" "text", "p_game_id" "text", "p_player" "text", "p_amount" numeric, "p_reason" "text", "p_event_ts" timestamp with time zone, "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."consume_arcade_life"("p_device_id" "text", "p_game_id" "text", "p_player" "text", "p_amount" numeric, "p_reason" "text", "p_event_ts" timestamp with time zone, "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."demo_reset_runtime_metrics"("p_keep_device_ids" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."demo_reset_runtime_metrics"("p_keep_device_ids" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."demo_reset_runtime_metrics"("p_keep_device_ids" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."disable_game_from_cabinets"() TO "anon";
GRANT ALL ON FUNCTION "public"."disable_game_from_cabinets"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."disable_game_from_cabinets"() TO "service_role";



GRANT ALL ON FUNCTION "public"."end_device_game_session"("p_device_id" "text", "p_session_id" bigint, "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."end_device_game_session"("p_device_id" "text", "p_session_id" bigint, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."end_device_game_session"("p_device_id" "text", "p_session_id" bigint, "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_bulk_device_admin_command"("p_command" "text", "p_device_ids" "text"[], "p_reason" "text", "p_requested_by" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_bulk_device_admin_command"("p_command" "text", "p_device_ids" "text"[], "p_reason" "text", "p_requested_by" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_bulk_device_admin_command"("p_command" "text", "p_device_ids" "text"[], "p_reason" "text", "p_requested_by" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_dev_jackpot_test"("p_amount" numeric, "p_device_ids" "text"[], "p_winners" integer, "p_delay_min" integer, "p_delay_max" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_dev_jackpot_test"("p_amount" numeric, "p_device_ids" "text"[], "p_winners" integer, "p_delay_min" integer, "p_delay_max" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_dev_jackpot_test"("p_amount" numeric, "p_device_ids" "text"[], "p_winners" integer, "p_delay_min" integer, "p_delay_max" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_dev_jackpot_test"("p_amount" numeric, "p_device_ids" "text"[], "p_winners" integer, "p_delay_min" integer, "p_delay_max" integer, "p_ignore_max_win" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_dev_jackpot_test"("p_amount" numeric, "p_device_ids" "text"[], "p_winners" integer, "p_delay_min" integer, "p_delay_max" integer, "p_ignore_max_win" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_dev_jackpot_test"("p_amount" numeric, "p_device_ids" "text"[], "p_winners" integer, "p_delay_min" integer, "p_delay_max" integer, "p_ignore_max_win" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_device_admin_command"("p_device_id" "text", "p_command" "text", "p_reason" "text", "p_requested_by" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_device_admin_command"("p_device_id" "text", "p_command" "text", "p_reason" "text", "p_requested_by" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_device_admin_command"("p_device_id" "text", "p_command" "text", "p_reason" "text", "p_requested_by" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."finalize_device_jackpot_payouts"("p_device_id" "text", "p_event_ts" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."finalize_device_jackpot_payouts"("p_device_id" "text", "p_event_ts" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_device_jackpot_payouts"("p_device_id" "text", "p_event_ts" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."jackpot_curve_weight"("p_step_index" integer, "p_total_steps" integer, "p_curve" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."jackpot_curve_weight"("p_step_index" integer, "p_total_steps" integer, "p_curve" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."jackpot_curve_weight"("p_step_index" integer, "p_total_steps" integer, "p_curve" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."post_bulk_device_admin_ledger_entry"("p_target" "text", "p_entry_kind" "text", "p_amount" numeric, "p_account_name" "text", "p_device_ids" "text"[], "p_notes" "text", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."post_bulk_device_admin_ledger_entry"("p_target" "text", "p_entry_kind" "text", "p_amount" numeric, "p_account_name" "text", "p_device_ids" "text"[], "p_notes" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."post_bulk_device_admin_ledger_entry"("p_target" "text", "p_entry_kind" "text", "p_amount" numeric, "p_account_name" "text", "p_device_ids" "text"[], "p_notes" "text", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."post_device_admin_ledger_entry"("p_device_id" "text", "p_target" "text", "p_entry_kind" "text", "p_amount" numeric, "p_account_name" "text", "p_notes" "text", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."post_device_admin_ledger_entry"("p_device_id" "text", "p_target" "text", "p_entry_kind" "text", "p_amount" numeric, "p_account_name" "text", "p_notes" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."post_device_admin_ledger_entry"("p_device_id" "text", "p_target" "text", "p_entry_kind" "text", "p_amount" numeric, "p_account_name" "text", "p_notes" "text", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_install_if_disabled"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_install_if_disabled"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_install_if_disabled"() TO "service_role";



GRANT ALL ON FUNCTION "public"."process_device_jackpot_payout"("p_device_id" "text", "p_event_ts" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."process_device_jackpot_payout"("p_device_id" "text", "p_event_ts" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_device_jackpot_payout"("p_device_id" "text", "p_event_ts" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."process_pool_goal_queues"("p_event_ts" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."process_pool_goal_queues"("p_event_ts" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_pool_goal_queues"("p_event_ts" timestamp with time zone) TO "service_role";



GRANT ALL ON TABLE "public"."casino_runtime" TO "anon";
GRANT ALL ON TABLE "public"."casino_runtime" TO "authenticated";
GRANT ALL ON TABLE "public"."casino_runtime" TO "service_role";



GRANT ALL ON FUNCTION "public"."recompute_casino_mode"() TO "anon";
GRANT ALL ON FUNCTION "public"."recompute_casino_mode"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."recompute_casino_mode"() TO "service_role";



GRANT ALL ON FUNCTION "public"."redistribute_jackpot_overflow"("p_campaign_id" "uuid", "p_jackpot_pot_id" bigint, "p_amount" numeric, "p_exclude_device" "text", "p_event_ts" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."redistribute_jackpot_overflow"("p_campaign_id" "uuid", "p_jackpot_pot_id" bigint, "p_amount" numeric, "p_exclude_device" "text", "p_event_ts" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."redistribute_jackpot_overflow"("p_campaign_id" "uuid", "p_jackpot_pot_id" bigint, "p_amount" numeric, "p_exclude_device" "text", "p_event_ts" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."register_authentic_jackpot_plan"("p_device_id" "text", "p_queue_id" bigint, "p_campaign_id" "uuid", "p_expected_amounts" numeric[], "p_tolerance" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."register_authentic_jackpot_plan"("p_device_id" "text", "p_queue_id" bigint, "p_campaign_id" "uuid", "p_expected_amounts" numeric[], "p_tolerance" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_authentic_jackpot_plan"("p_device_id" "text", "p_queue_id" bigint, "p_campaign_id" "uuid", "p_expected_amounts" numeric[], "p_tolerance" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_happy_hour_enabled"("p_enabled" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."set_happy_hour_enabled"("p_enabled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_happy_hour_enabled"("p_enabled" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."start_device_game_session"("p_device_id" "text", "p_game_id" "text", "p_game_name" "text", "p_runtime_mode" "text", "p_state" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."start_device_game_session"("p_device_id" "text", "p_game_id" "text", "p_game_name" "text", "p_runtime_mode" "text", "p_state" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_device_game_session"("p_device_id" "text", "p_game_id" "text", "p_game_name" "text", "p_runtime_mode" "text", "p_state" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_jackpot_payout_if_ready"("p_event_ts" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_jackpot_payout_if_ready"("p_event_ts" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_jackpot_payout_if_ready"("p_event_ts" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_device_game_state"("p_device_id" "text", "p_session_id" bigint, "p_state" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_device_game_state"("p_device_id" "text", "p_session_id" bigint, "p_state" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_device_game_state"("p_device_id" "text", "p_session_id" bigint, "p_state" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."cabinet_games" TO "anon";
GRANT ALL ON TABLE "public"."cabinet_games" TO "authenticated";
GRANT ALL ON TABLE "public"."cabinet_games" TO "service_role";



GRANT ALL ON TABLE "public"."games" TO "anon";
GRANT ALL ON TABLE "public"."games" TO "authenticated";
GRANT ALL ON TABLE "public"."games" TO "service_role";



GRANT ALL ON TABLE "public"."cabinet_visible_games" TO "anon";
GRANT ALL ON TABLE "public"."cabinet_visible_games" TO "authenticated";
GRANT ALL ON TABLE "public"."cabinet_visible_games" TO "service_role";



GRANT ALL ON TABLE "public"."happy_hour_pots" TO "anon";
GRANT ALL ON TABLE "public"."happy_hour_pots" TO "authenticated";
GRANT ALL ON TABLE "public"."happy_hour_pots" TO "service_role";



GRANT ALL ON TABLE "public"."jackpot_pots" TO "anon";
GRANT ALL ON TABLE "public"."jackpot_pots" TO "authenticated";
GRANT ALL ON TABLE "public"."jackpot_pots" TO "service_role";



GRANT ALL ON TABLE "public"."rtp_profiles" TO "anon";
GRANT ALL ON TABLE "public"."rtp_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."rtp_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."casino_runtime_live" TO "anon";
GRANT ALL ON TABLE "public"."casino_runtime_live" TO "authenticated";
GRANT ALL ON TABLE "public"."casino_runtime_live" TO "service_role";



GRANT ALL ON TABLE "public"."device_admin_commands" TO "anon";
GRANT ALL ON TABLE "public"."device_admin_commands" TO "authenticated";
GRANT ALL ON TABLE "public"."device_admin_commands" TO "service_role";



GRANT ALL ON SEQUENCE "public"."device_admin_commands_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."device_admin_commands_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."device_admin_commands_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."device_admin_ledger_entries" TO "anon";
GRANT ALL ON TABLE "public"."device_admin_ledger_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."device_admin_ledger_entries" TO "service_role";



GRANT ALL ON SEQUENCE "public"."device_admin_ledger_entries_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."device_admin_ledger_entries_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."device_admin_ledger_entries_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."device_daily_stats" TO "anon";
GRANT ALL ON TABLE "public"."device_daily_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."device_daily_stats" TO "service_role";



GRANT ALL ON TABLE "public"."device_game_sessions" TO "anon";
GRANT ALL ON TABLE "public"."device_game_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."device_game_sessions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."device_game_sessions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."device_game_sessions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."device_game_sessions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."device_ledger" TO "anon";
GRANT ALL ON TABLE "public"."device_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."device_ledger" TO "service_role";



GRANT ALL ON SEQUENCE "public"."device_ledger_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."device_ledger_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."device_ledger_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."device_metric_events" TO "anon";
GRANT ALL ON TABLE "public"."device_metric_events" TO "authenticated";
GRANT ALL ON TABLE "public"."device_metric_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."device_metric_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."device_metric_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."device_metric_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."device_spin_event_dedup" TO "anon";
GRANT ALL ON TABLE "public"."device_spin_event_dedup" TO "authenticated";
GRANT ALL ON TABLE "public"."device_spin_event_dedup" TO "service_role";



GRANT ALL ON SEQUENCE "public"."device_spin_event_dedup_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."device_spin_event_dedup_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."device_spin_event_dedup_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."devices" TO "anon";
GRANT ALL ON TABLE "public"."devices" TO "authenticated";
GRANT ALL ON TABLE "public"."devices" TO "service_role";



GRANT ALL ON TABLE "public"."device_stats_live" TO "anon";
GRANT ALL ON TABLE "public"."device_stats_live" TO "authenticated";
GRANT ALL ON TABLE "public"."device_stats_live" TO "service_role";



GRANT ALL ON TABLE "public"."jackpot_payout_queue" TO "anon";
GRANT ALL ON TABLE "public"."jackpot_payout_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."jackpot_payout_queue" TO "service_role";



GRANT ALL ON TABLE "public"."devices_dashboard_live" TO "anon";
GRANT ALL ON TABLE "public"."devices_dashboard_live" TO "authenticated";
GRANT ALL ON TABLE "public"."devices_dashboard_live" TO "service_role";



GRANT ALL ON TABLE "public"."global_daily_stats" TO "anon";
GRANT ALL ON TABLE "public"."global_daily_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."global_daily_stats" TO "service_role";



GRANT ALL ON TABLE "public"."global_stats_live" TO "anon";
GRANT ALL ON TABLE "public"."global_stats_live" TO "authenticated";
GRANT ALL ON TABLE "public"."global_stats_live" TO "service_role";



GRANT ALL ON SEQUENCE "public"."happy_hour_pots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."happy_hour_pots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."happy_hour_pots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."jackpot_payout_plan_steps" TO "anon";
GRANT ALL ON TABLE "public"."jackpot_payout_plan_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."jackpot_payout_plan_steps" TO "service_role";



GRANT ALL ON SEQUENCE "public"."jackpot_payout_plan_steps_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."jackpot_payout_plan_steps_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."jackpot_payout_plan_steps_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."jackpot_payout_queue_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."jackpot_payout_queue_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."jackpot_payout_queue_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."jackpot_pots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."jackpot_pots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."jackpot_pots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."live_config" TO "anon";
GRANT ALL ON TABLE "public"."live_config" TO "authenticated";
GRANT ALL ON TABLE "public"."live_config" TO "service_role";



GRANT ALL ON TABLE "public"."over_cap_win_events" TO "anon";
GRANT ALL ON TABLE "public"."over_cap_win_events" TO "authenticated";
GRANT ALL ON TABLE "public"."over_cap_win_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."over_cap_win_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."over_cap_win_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."over_cap_win_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."over_cap_win_events_live" TO "anon";
GRANT ALL ON TABLE "public"."over_cap_win_events_live" TO "authenticated";
GRANT ALL ON TABLE "public"."over_cap_win_events_live" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








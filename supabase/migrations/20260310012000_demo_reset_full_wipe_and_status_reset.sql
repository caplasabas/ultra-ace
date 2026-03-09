-- Refresh demo reset helper so fresh tests truly start from zero.

create or replace function public.demo_reset_runtime_metrics(
  p_keep_device_ids text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kept_count integer := 0;
  v_removed_count integer := 0;
begin
  with keep_ids as (
    select distinct nullif(trim(x), '') as device_id
    from unnest(coalesce(p_keep_device_ids, array[]::text[])) x
  )
  select count(*)::int
  into v_kept_count
  from public.devices d
  join keep_ids k on k.device_id = d.device_id;

  -- Remove non-kept devices first.
  with keep_ids as (
    select distinct nullif(trim(x), '') as device_id
    from unnest(coalesce(p_keep_device_ids, array[]::text[])) x
  ),
  deleted as (
    delete from public.devices d
    where not exists (
      select 1 from keep_ids k where k.device_id = d.device_id
    )
    returning 1
  )
  select count(*)::int into v_removed_count from deleted;

  -- Clear event/stat history.
  truncate table public.device_metric_events, public.device_daily_stats;

  -- Clear queue/pot state for clean jackpot/happy testing.
  if to_regclass('public.jackpot_payout_queue') is not null then
    execute 'truncate table public.jackpot_payout_queue';
  end if;

  if to_regclass('public.happy_hour_pots') is not null then
    execute 'truncate table public.happy_hour_pots restart identity';
  end if;

  if to_regclass('public.jackpot_pots') is not null then
    execute 'truncate table public.jackpot_pots restart identity';
  end if;

  if to_regclass('public.device_game_sessions') is not null then
    execute 'truncate table public.device_game_sessions restart identity';
  end if;

  -- Optional legacy tables.
  if to_regclass('public.device_admin_ledger_entries') is not null then
    execute 'truncate table public.device_admin_ledger_entries';
  end if;

  if to_regclass('public.ledger_entries') is not null then
    execute 'truncate table public.ledger_entries';
  end if;

  if to_regclass('public.ledger_events') is not null then
    execute 'truncate table public.ledger_events';
  end if;

  -- Reset live device counters and status fields.
  update public.devices
  set
    balance = 0,
    coins_in_total = 0,
    hopper_balance = 0,
    hopper_in_total = 0,
    hopper_out_total = 0,
    bet_total = 0,
    win_total = 0,
    house_take_total = 0,
    jackpot_contrib_total = 0,
    jackpot_win_total = 0,
    last_bet_amount = null,
    last_bet_at = null,
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
    updated_at = now()
  where true;

  -- Reset runtime banks/counters and active pot pointers.
  update public.casino_runtime
  set
    active_mode = 'BASE',
    manual_happy_enabled = false,
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

  return jsonb_build_object(
    'ok', true,
    'kept_devices', v_kept_count,
    'removed_devices', v_removed_count
  );
end;
$$;

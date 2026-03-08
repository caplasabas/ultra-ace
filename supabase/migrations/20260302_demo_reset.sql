-- Demo reset helper:
-- - clears metrics history
-- - removes non-kept devices
-- - zeros counters/balances for kept devices
-- - resets runtime banks/mode

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
  -- Normalize keep list.
  with keep_ids as (
    select distinct nullif(trim(x), '') as device_id
    from unnest(coalesce(p_keep_device_ids, array[]::text[])) x
  )
  select count(*)::int
  into v_kept_count
  from public.devices d
  join keep_ids k on k.device_id = d.device_id;

  -- Remove non-kept devices first (stats/events cascade by FK).
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

  -- Clear remaining rollups/history (TRUNCATE avoids safe-delete blockers).
  truncate table public.device_metric_events, public.device_daily_stats;

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

  -- Reset live device counters.
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
    updated_at = now()
  where true;

  -- Reset runtime mode + pools.
  update public.casino_runtime
  set
    active_mode = 'BASE',
    manual_happy_enabled = false,
    prize_pool_balance = 0,
    happy_hour_prize_balance = 0,
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

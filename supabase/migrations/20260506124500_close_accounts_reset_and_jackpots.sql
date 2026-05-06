alter table public.device_revenue_closings
  add column if not exists jackpot_total numeric not null default 0,
  add column if not exists jackpot_delta numeric not null default 0;

with closing_jackpots as (
  select
    c.id,
    coalesce(sum(q.target_amount), 0) as jackpot_delta
  from public.device_revenue_closings c
  left join (
    public.jackpot_payout_queue q
    join public.jackpot_pots jp
      on jp.id = q.jackpot_pot_id
     and jp.status = 'completed'
  )
    on q.device_id = c.device_id
   and q.completed_at is not null
   and q.completed_at > coalesce(c.previous_closed_at, '-infinity'::timestamp with time zone)
   and q.completed_at <= c.closed_at
  group by c.id
),
ordered as (
  select
    c.id,
    cj.jackpot_delta,
    sum(cj.jackpot_delta) over (
      partition by c.device_id
      order by c.closed_at, c.id
      rows between unbounded preceding and current row
    ) as jackpot_total
  from public.device_revenue_closings c
  join closing_jackpots cj on cj.id = c.id
)
update public.device_revenue_closings c
set
  jackpot_delta = ordered.jackpot_delta,
  jackpot_total = ordered.jackpot_total
from ordered
where ordered.id = c.id;

create or replace function public.close_device_revenue_period(p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_device_id text := trim(coalesce(p_device_id, ''));
  v_role text := public.current_dashboard_role();
  v_device public.devices%rowtype;
  v_previous public.device_revenue_closings%rowtype;
  v_closing public.device_revenue_closings%rowtype;
  v_prev_coins_in numeric := 0;
  v_prev_withdraw numeric := 0;
  v_prev_bet numeric := 0;
  v_prev_win numeric := 0;
  v_prev_house_take numeric := 0;
  v_prev_spins bigint := 0;
  v_prev_jackpot numeric := 0;
  v_current_coins_in numeric := 0;
  v_current_withdraw numeric := 0;
  v_current_bet numeric := 0;
  v_current_win numeric := 0;
  v_current_house_take numeric := 0;
  v_current_spins bigint := 0;
  v_delta_coins_in numeric := 0;
  v_delta_withdraw numeric := 0;
  v_delta_bet numeric := 0;
  v_delta_win numeric := 0;
  v_delta_house_take numeric := 0;
  v_delta_spins bigint := 0;
  v_delta_jackpot numeric := 0;
  v_jackpot_pot_ids bigint[] := array[]::bigint[];
  v_deleted_metric_events integer := 0;
  v_deleted_daily_rows integer := 0;
  v_deleted_arcade_events integer := 0;
  v_deleted_admin_ledger_rows integer := 0;
begin
  if v_role not in ('superadmin', 'admin', 'accounts') then
    raise exception 'Only admin/accounts users can close device accounts';
  end if;

  if v_device_id = '' then
    raise exception 'p_device_id is required';
  end if;

  select *
    into v_device
  from public.devices
  where device_id = v_device_id
  for update;

  if not found then
    raise exception 'device not found: %', v_device_id;
  end if;

  if public.resolve_device_presence_status(v_device.device_status, v_device.last_seen_at) = 'playing'
     or v_device.active_session_id is not null
     or coalesce(v_device.is_free_game, false)
     or coalesce(v_device.free_spins_left, 0) > 0
     or coalesce(v_device.pending_free_spins, 0) > 0 then
    raise exception 'Device % must be idle with no active session or free-spin flow before closing accounts', v_device_id;
  end if;

  select *
    into v_previous
  from public.device_revenue_closings
  where device_id = v_device_id
  order by closed_at desc, id desc
  limit 1;

  if found then
    v_prev_coins_in := coalesce(v_previous.coins_in_total, 0);
    v_prev_withdraw := coalesce(v_previous.withdraw_total, 0);
    v_prev_bet := coalesce(v_previous.bet_total, 0);
    v_prev_win := coalesce(v_previous.win_total, 0);
    v_prev_house_take := coalesce(v_previous.house_take_total, 0);
    v_prev_spins := coalesce(v_previous.spins_total, 0);
    v_prev_jackpot := coalesce(v_previous.jackpot_total, 0);
  end if;

  select
    coalesce(sum(s.included_coins_in_amount), 0),
    coalesce(sum(s.included_withdrawal_amount), 0),
    coalesce(sum(s.included_bet_amount), 0),
    coalesce(sum(s.included_win_amount), 0),
    coalesce(sum(s.included_house_take_amount), 0),
    coalesce(sum(s.included_spins_count), 0)::bigint
    into
      v_current_coins_in,
      v_current_withdraw,
      v_current_bet,
      v_current_win,
      v_current_house_take,
      v_current_spins
  from public.device_daily_stats s
  where s.device_id = v_device_id;

  v_delta_coins_in := case
    when v_current_coins_in >= v_prev_coins_in then v_current_coins_in - v_prev_coins_in
    else v_current_coins_in
  end;
  v_delta_withdraw := case
    when v_current_withdraw >= v_prev_withdraw then v_current_withdraw - v_prev_withdraw
    else v_current_withdraw
  end;
  v_delta_bet := case
    when v_current_bet >= v_prev_bet then v_current_bet - v_prev_bet
    else v_current_bet
  end;
  v_delta_win := case
    when v_current_win >= v_prev_win then v_current_win - v_prev_win
    else v_current_win
  end;
  v_delta_house_take := case
    when v_current_house_take >= v_prev_house_take then v_current_house_take - v_prev_house_take
    else v_current_house_take
  end;
  v_delta_spins := case
    when v_current_spins >= v_prev_spins then v_current_spins - v_prev_spins
    else v_current_spins
  end;

  select
    coalesce(sum(q.target_amount), 0),
    coalesce(array_agg(distinct jp.id) filter (where jp.id is not null), array[]::bigint[])
    into v_delta_jackpot, v_jackpot_pot_ids
  from public.jackpot_payout_queue q
  join public.jackpot_pots jp on jp.id = q.jackpot_pot_id
  where q.device_id = v_device_id
    and q.completed_at is not null
    and jp.status = 'completed'
    and coalesce(q.completed_at, jp.completed_at) > coalesce(v_previous.closed_at, '-infinity'::timestamp with time zone)
    and coalesce(q.completed_at, jp.completed_at) <= now();

  insert into public.device_revenue_closings (
    device_id,
    closed_by,
    previous_closing_id,
    previous_closed_at,
    coins_in_total,
    withdraw_total,
    bet_total,
    win_total,
    house_take_total,
    spins_total,
    jackpot_total,
    coins_in_delta,
    withdraw_delta,
    bet_delta,
    win_delta,
    house_take_delta,
    spins_delta,
    jackpot_delta,
    metadata
  )
  values (
    v_device_id,
    auth.uid(),
    case when v_previous.id is null then null else v_previous.id end,
    v_previous.closed_at,
    greatest(v_prev_coins_in + v_delta_coins_in, 0),
    greatest(v_prev_withdraw + v_delta_withdraw, 0),
    greatest(v_prev_bet + v_delta_bet, 0),
    greatest(v_prev_win + v_delta_win, 0),
    greatest(v_prev_house_take + v_delta_house_take, 0),
    greatest(v_prev_spins + v_delta_spins, 0),
    greatest(v_prev_jackpot + v_delta_jackpot, 0),
    greatest(v_delta_coins_in, 0),
    greatest(v_delta_withdraw, 0),
    greatest(v_delta_bet, 0),
    greatest(v_delta_win, 0),
    greatest(v_delta_house_take, 0),
    greatest(v_delta_spins, 0),
    greatest(v_delta_jackpot, 0),
    jsonb_build_object(
      'source', 'dashboard_device_close_accounts',
      'deviceName', v_device.name,
      'deploymentMode', v_device.deployment_mode,
      'jackpotPotIds', v_jackpot_pot_ids,
      'resetVisibleCounters', true
    )
  )
  returning * into v_closing;

  delete from public.device_metric_events
  where device_id = v_device_id;
  get diagnostics v_deleted_metric_events = row_count;

  delete from public.device_daily_stats
  where device_id = v_device_id;
  get diagnostics v_deleted_daily_rows = row_count;

  delete from public.device_arcade_events
  where device_id = v_device_id;
  get diagnostics v_deleted_arcade_events = row_count;

  delete from public.device_admin_ledger_entries
  where device_id = v_device_id;
  get diagnostics v_deleted_admin_ledger_rows = row_count;

  update public.devices
  set balance = 0,
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
      house_take_total = 0,
      jackpot_contrib_total = 0,
      jackpot_win_total = 0,
      arcade_total = 0,
      last_bet_amount = 0,
      avg_bet_amount = 0,
      last_bet_at = null,
      updated_at = now()
  where device_id = v_device_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_closing.id,
    'device_id', v_closing.device_id,
    'closed_at', v_closing.closed_at,
    'coins_in', v_closing.coins_in_delta,
    'withdrawal', v_closing.withdraw_delta,
    'income', v_closing.coins_in_delta - v_closing.withdraw_delta,
    'bet', v_closing.bet_delta,
    'win', v_closing.win_delta,
    'house_take', v_closing.house_take_delta,
    'spins', v_closing.spins_delta,
    'jackpot', v_closing.jackpot_delta,
    'deleted_metric_events', v_deleted_metric_events,
    'deleted_daily_rows', v_deleted_daily_rows,
    'deleted_arcade_events', v_deleted_arcade_events,
    'deleted_admin_ledger_rows', v_deleted_admin_ledger_rows,
    'reset_visible_counters', true
  );
end;
$$;

create or replace view public.boss_revenue_daily as
with closed_rows as (
  select
    (c.closed_at at time zone 'Asia/Manila')::date as report_date,
    coalesce(c.coins_in_delta, 0) as coins_in,
    coalesce(c.withdraw_delta, 0) as withdrawal,
    coalesce(c.bet_delta, 0) as bet,
    coalesce(c.win_delta, 0) as win,
    coalesce(c.house_take_delta, 0) as house_take,
    coalesce(c.spins_delta, 0) as spins,
    coalesce(c.jackpot_delta, 0) as jackpot
  from public.device_revenue_closings c
),
latest_closing as (
  select distinct on (c.device_id)
    c.device_id,
    c.coins_in_total,
    c.withdraw_total,
    c.bet_total,
    c.win_total,
    c.house_take_total,
    c.spins_total,
    c.jackpot_total
  from public.device_revenue_closings c
  order by c.device_id, c.closed_at desc, c.id desc
),
eligible_totals as (
  select
    s.device_id,
    coalesce(sum(s.included_coins_in_amount), 0) as coins_in_total,
    coalesce(sum(s.included_withdrawal_amount), 0) as withdraw_total,
    coalesce(sum(s.included_bet_amount), 0) as bet_total,
    coalesce(sum(s.included_win_amount), 0) as win_total,
    coalesce(sum(s.included_house_take_amount), 0) as house_take_total,
    coalesce(sum(s.included_spins_count), 0)::bigint as spins_total
  from public.device_daily_stats s
  group by s.device_id
),
open_rows as (
  select
    (now() at time zone 'Asia/Manila')::date as report_date,
    greatest(coalesce(t.coins_in_total, 0) - coalesce(l.coins_in_total, 0), 0) as coins_in,
    greatest(coalesce(t.withdraw_total, 0) - coalesce(l.withdraw_total, 0), 0) as withdrawal,
    greatest(coalesce(t.bet_total, 0) - coalesce(l.bet_total, 0), 0) as bet,
    greatest(coalesce(t.win_total, 0) - coalesce(l.win_total, 0), 0) as win,
    greatest(coalesce(t.house_take_total, 0) - coalesce(l.house_take_total, 0), 0) as house_take,
    greatest(coalesce(t.spins_total, 0) - coalesce(l.spins_total, 0), 0) as spins,
    0::numeric as jackpot
  from public.devices d
  left join latest_closing l on l.device_id = d.device_id
  left join eligible_totals t on t.device_id = d.device_id
),
all_rows as (
  select * from closed_rows
  union all
  select * from open_rows
)
select
  report_date,
  sum(coins_in) as coins_in,
  sum(withdrawal) as withdrawal,
  sum(coins_in - withdrawal) as income,
  sum(bet) as bet,
  sum(win) as win,
  sum(house_take) as house_take,
  sum(spins) as spins,
  sum(jackpot) as jackpot
from all_rows
group by report_date
having
  sum(coins_in) <> 0
  or sum(withdrawal) <> 0
  or sum(bet) <> 0
  or sum(win) <> 0
  or sum(house_take) <> 0
  or sum(spins) <> 0
  or sum(jackpot) <> 0;

alter function public.close_device_revenue_period(text) owner to postgres;
alter view public.boss_revenue_daily owner to postgres;

grant all on function public.close_device_revenue_period(text) to anon;
grant all on function public.close_device_revenue_period(text) to authenticated;
grant all on function public.close_device_revenue_period(text) to service_role;

grant all on table public.boss_revenue_daily to anon;
grant all on table public.boss_revenue_daily to authenticated;
grant all on table public.boss_revenue_daily to service_role;

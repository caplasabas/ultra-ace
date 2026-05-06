alter table public.device_revenue_closings
  add column if not exists hopper_in_total numeric not null default 0,
  add column if not exists hopper_out_total numeric not null default 0,
  add column if not exists hopper_in_delta numeric not null default 0,
  add column if not exists hopper_out_delta numeric not null default 0;

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
  v_prev_hopper_in numeric := 0;
  v_prev_hopper_out numeric := 0;
  v_prev_bet numeric := 0;
  v_prev_win numeric := 0;
  v_prev_house_take numeric := 0;
  v_prev_spins bigint := 0;
  v_prev_jackpot numeric := 0;
  v_current_coins_in numeric := 0;
  v_current_withdraw numeric := 0;
  v_current_hopper_in numeric := 0;
  v_current_hopper_out numeric := 0;
  v_current_bet numeric := 0;
  v_current_win numeric := 0;
  v_current_house_take numeric := 0;
  v_current_spins bigint := 0;
  v_delta_coins_in numeric := 0;
  v_delta_withdraw numeric := 0;
  v_delta_hopper_in numeric := 0;
  v_delta_hopper_out numeric := 0;
  v_delta_bet numeric := 0;
  v_delta_win numeric := 0;
  v_delta_house_take numeric := 0;
  v_delta_spins bigint := 0;
  v_delta_jackpot numeric := 0;
  v_jackpot_pot_ids bigint[] := array[]::bigint[];
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
    v_prev_hopper_in := coalesce(v_previous.hopper_in_total, 0);
    v_prev_hopper_out := coalesce(v_previous.hopper_out_total, 0);
    v_prev_bet := coalesce(v_previous.bet_total, 0);
    v_prev_win := coalesce(v_previous.win_total, 0);
    v_prev_house_take := coalesce(v_previous.house_take_total, 0);
    v_prev_spins := coalesce(v_previous.spins_total, 0);
    v_prev_jackpot := coalesce(v_previous.jackpot_total, 0);
  end if;

  select
    coalesce(sum(s.included_coins_in_amount), 0),
    coalesce(sum(s.included_withdrawal_amount), 0),
    coalesce(sum(s.included_hopper_in_amount), 0),
    coalesce(sum(s.included_hopper_out_amount), 0),
    coalesce(sum(s.included_bet_amount), 0),
    coalesce(sum(s.included_win_amount), 0),
    coalesce(sum(s.included_house_take_amount), 0),
    coalesce(sum(s.included_spins_count), 0)::bigint
    into
      v_current_coins_in,
      v_current_withdraw,
      v_current_hopper_in,
      v_current_hopper_out,
      v_current_bet,
      v_current_win,
      v_current_house_take,
      v_current_spins
  from public.device_daily_stats s
  where s.device_id = v_device_id;

  v_delta_coins_in := case when v_current_coins_in >= v_prev_coins_in then v_current_coins_in - v_prev_coins_in else v_current_coins_in end;
  v_delta_withdraw := case when v_current_withdraw >= v_prev_withdraw then v_current_withdraw - v_prev_withdraw else v_current_withdraw end;
  v_delta_hopper_in := case when v_current_hopper_in >= v_prev_hopper_in then v_current_hopper_in - v_prev_hopper_in else v_current_hopper_in end;
  v_delta_hopper_out := case when v_current_hopper_out >= v_prev_hopper_out then v_current_hopper_out - v_prev_hopper_out else v_current_hopper_out end;
  v_delta_bet := case when v_current_bet >= v_prev_bet then v_current_bet - v_prev_bet else v_current_bet end;
  v_delta_win := case when v_current_win >= v_prev_win then v_current_win - v_prev_win else v_current_win end;
  v_delta_house_take := case when v_current_house_take >= v_prev_house_take then v_current_house_take - v_prev_house_take else v_current_house_take end;
  v_delta_spins := case when v_current_spins >= v_prev_spins then v_current_spins - v_prev_spins else v_current_spins end;

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
    hopper_in_total,
    hopper_out_total,
    bet_total,
    win_total,
    house_take_total,
    spins_total,
    jackpot_total,
    coins_in_delta,
    withdraw_delta,
    hopper_in_delta,
    hopper_out_delta,
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
    greatest(v_current_coins_in, 0),
    greatest(v_current_withdraw, 0),
    greatest(v_current_hopper_in, 0),
    greatest(v_current_hopper_out, 0),
    greatest(v_current_bet, 0),
    greatest(v_current_win, 0),
    greatest(v_current_house_take, 0),
    greatest(v_current_spins, 0),
    greatest(v_prev_jackpot + v_delta_jackpot, 0),
    greatest(v_delta_coins_in, 0),
    greatest(v_delta_withdraw, 0),
    greatest(v_delta_hopper_in, 0),
    greatest(v_delta_hopper_out, 0),
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
      'periodBasedCounters', true,
      'clearsDeviceHistory', false
    )
  )
  returning * into v_closing;

  return jsonb_build_object(
    'ok', true,
    'id', v_closing.id,
    'device_id', v_closing.device_id,
    'closed_at', v_closing.closed_at,
    'period_from', v_closing.previous_closed_at,
    'coins_in', v_closing.coins_in_delta,
    'withdrawal', v_closing.withdraw_delta,
    'income', v_closing.coins_in_delta - v_closing.withdraw_delta,
    'hopper_in', v_closing.hopper_in_delta,
    'hopper_out', v_closing.hopper_out_delta,
    'bet', v_closing.bet_delta,
    'win', v_closing.win_delta,
    'house_take', v_closing.house_take_delta,
    'spins', v_closing.spins_delta,
    'jackpot', v_closing.jackpot_delta,
    'reset_visible_counters', false
  );
end;
$$;

create or replace view public.device_accounting_totals as
with latest_closing as (
  select distinct on (c.device_id)
    c.device_id,
    c.closed_at,
    coalesce(c.coins_in_total, 0) as coins_in_total,
    coalesce(c.withdraw_total, 0) as withdraw_total,
    coalesce(c.hopper_in_total, 0) as hopper_in_total,
    coalesce(c.hopper_out_total, 0) as hopper_out_total,
    coalesce(c.bet_total, 0) as bet_total,
    coalesce(c.win_total, 0) as win_total,
    coalesce(c.house_take_total, 0) as house_take_total,
    coalesce(c.spins_total, 0) as spins_total
  from public.device_revenue_closings c
  order by c.device_id, c.closed_at desc, c.id desc
),
included as (
  select
    s.device_id,
    coalesce(sum(s.included_balance_change), 0) as eligible_balance,
    case
      when coalesce(sum(s.included_coins_in_amount), 0) >= coalesce(l.coins_in_total, 0)
      then coalesce(sum(s.included_coins_in_amount), 0) - coalesce(l.coins_in_total, 0)
      else coalesce(sum(s.included_coins_in_amount), 0)
    end as eligible_coins_in_total,
    coalesce(sum(s.included_hopper_in_amount - s.included_hopper_out_amount), 0) as eligible_hopper_balance,
    case
      when coalesce(sum(s.included_hopper_in_amount), 0) >= coalesce(l.hopper_in_total, 0)
      then coalesce(sum(s.included_hopper_in_amount), 0) - coalesce(l.hopper_in_total, 0)
      else coalesce(sum(s.included_hopper_in_amount), 0)
    end as eligible_hopper_in_total,
    case
      when coalesce(sum(s.included_hopper_out_amount), 0) >= coalesce(l.hopper_out_total, 0)
      then coalesce(sum(s.included_hopper_out_amount), 0) - coalesce(l.hopper_out_total, 0)
      else coalesce(sum(s.included_hopper_out_amount), 0)
    end as eligible_hopper_out_total,
    case
      when coalesce(sum(s.included_bet_amount), 0) >= coalesce(l.bet_total, 0)
      then coalesce(sum(s.included_bet_amount), 0) - coalesce(l.bet_total, 0)
      else coalesce(sum(s.included_bet_amount), 0)
    end as eligible_bet_total,
    case
      when coalesce(sum(s.included_win_amount), 0) >= coalesce(l.win_total, 0)
      then coalesce(sum(s.included_win_amount), 0) - coalesce(l.win_total, 0)
      else coalesce(sum(s.included_win_amount), 0)
    end as eligible_win_total,
    case
      when coalesce(sum(s.included_withdrawal_amount), 0) >= coalesce(l.withdraw_total, 0)
      then coalesce(sum(s.included_withdrawal_amount), 0) - coalesce(l.withdraw_total, 0)
      else coalesce(sum(s.included_withdrawal_amount), 0)
    end as eligible_withdraw_total,
    case
      when coalesce(sum(s.included_spins_count), 0)::bigint >= coalesce(l.spins_total, 0)::bigint
      then coalesce(sum(s.included_spins_count), 0)::bigint - coalesce(l.spins_total, 0)::bigint
      else coalesce(sum(s.included_spins_count), 0)::bigint
    end as eligible_spins_total,
    coalesce(sum(s.included_prize_pool_contrib_amount), 0) as eligible_prize_pool_contrib_total,
    coalesce(sum(s.included_prize_pool_paid_amount), 0) as eligible_prize_pool_paid_total,
    case
      when coalesce(sum(s.included_house_take_amount), 0) >= coalesce(l.house_take_total, 0)
      then coalesce(sum(s.included_house_take_amount), 0) - coalesce(l.house_take_total, 0)
      else coalesce(sum(s.included_house_take_amount), 0)
    end as eligible_house_take_total,
    coalesce(sum(s.included_jackpot_contrib_amount), 0) as eligible_jackpot_contrib_total,
    coalesce(sum(s.included_jackpot_win_amount), 0) as eligible_jackpot_win_total
  from public.device_daily_stats s
  left join latest_closing l on l.device_id = s.device_id
  group by
    s.device_id,
    l.coins_in_total,
    l.withdraw_total,
    l.hopper_in_total,
    l.hopper_out_total,
    l.bet_total,
    l.win_total,
    l.house_take_total,
    l.spins_total
),
arcade as (
  select
    e.device_id,
    coalesce(sum(case when e.counts_toward_global then e.amount else 0 end), 0) as eligible_arcade_total,
    coalesce(sum(case when e.counts_toward_global then e.credit_delta else 0 end), 0)::integer as eligible_arcade_credit,
    coalesce(sum(case when e.counts_toward_global then e.time_ms_delta else 0 end), 0)::bigint as eligible_arcade_time_ms
  from public.device_arcade_events e
  left join latest_closing l on l.device_id = e.device_id
  where l.closed_at is null or e.event_ts > l.closed_at
  group by e.device_id
),
admin_adjustments as (
  select
    a.device_id,
    coalesce(sum(
      case
        when coalesce((a.metadata ->> 'counts_toward_global')::boolean, false)
         and a.target = 'accounting_balance'
        then case when a.entry_kind = 'credit' then a.amount else -a.amount end
        else 0
      end
    ), 0) as eligible_balance_delta,
    0::numeric as eligible_coins_in_delta,
    coalesce(sum(
      case
        when coalesce((a.metadata ->> 'counts_toward_global')::boolean, false)
         and a.target = 'hopper_balance'
         and a.entry_kind = 'credit'
        then case when l.closed_at is null or a.created_at > l.closed_at then a.amount else 0 end
        else 0
      end
    ), 0) as eligible_hopper_in_delta,
    coalesce(sum(
      case
        when coalesce((a.metadata ->> 'counts_toward_global')::boolean, false)
         and a.target = 'hopper_balance'
         and a.entry_kind = 'debit'
        then case when l.closed_at is null or a.created_at > l.closed_at then a.amount else 0 end
        else 0
      end
    ), 0) as eligible_hopper_out_delta,
    coalesce(sum(
      case
        when coalesce((a.metadata ->> 'counts_toward_global')::boolean, false)
         and a.target = 'hopper_balance'
        then case when a.entry_kind = 'credit' then a.amount else -a.amount end
        else 0
      end
    ), 0) as eligible_hopper_balance_delta
  from public.device_admin_ledger_entries a
  left join latest_closing l on l.device_id = a.device_id
  group by a.device_id
)
select
  d.device_id,
  coalesce(i.eligible_balance, 0) + coalesce(a.eligible_balance_delta, 0) as eligible_balance,
  coalesce(i.eligible_coins_in_total, 0) + coalesce(a.eligible_coins_in_delta, 0) as eligible_coins_in_total,
  coalesce(i.eligible_hopper_balance, 0) + coalesce(a.eligible_hopper_balance_delta, 0) as eligible_hopper_balance,
  coalesce(i.eligible_hopper_in_total, 0) + coalesce(a.eligible_hopper_in_delta, 0) as eligible_hopper_in_total,
  coalesce(i.eligible_hopper_out_total, 0) + coalesce(a.eligible_hopper_out_delta, 0) as eligible_hopper_out_total,
  coalesce(i.eligible_bet_total, 0) as eligible_bet_total,
  coalesce(i.eligible_win_total, 0) as eligible_win_total,
  coalesce(i.eligible_withdraw_total, 0) as eligible_withdraw_total,
  coalesce(i.eligible_spins_total, 0) as eligible_spins_total,
  coalesce(i.eligible_prize_pool_contrib_total, 0) as eligible_prize_pool_contrib_total,
  coalesce(i.eligible_prize_pool_paid_total, 0) as eligible_prize_pool_paid_total,
  coalesce(i.eligible_house_take_total, 0) as eligible_house_take_total,
  coalesce(i.eligible_jackpot_contrib_total, 0) as eligible_jackpot_contrib_total,
  coalesce(i.eligible_jackpot_win_total, 0) as eligible_jackpot_win_total,
  coalesce(ar.eligible_arcade_total, 0) as eligible_arcade_total,
  coalesce(ar.eligible_arcade_credit, 0) as eligible_arcade_credit,
  coalesce(ar.eligible_arcade_time_ms, 0) as eligible_arcade_time_ms
from public.devices d
left join included i on i.device_id = d.device_id
left join arcade ar on ar.device_id = d.device_id
left join admin_adjustments a on a.device_id = d.device_id;

comment on function public.close_device_revenue_period(text) is
  'Snapshots a device revenue period without deleting event history or mutating player balance/hopper balance. Live accounting totals are calculated after the latest closing.';

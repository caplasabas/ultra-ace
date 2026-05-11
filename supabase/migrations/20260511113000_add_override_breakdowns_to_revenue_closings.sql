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
  v_presence_status text := 'offline';
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
  v_delta_manual_jackpot_override numeric := 0;
  v_delta_happy_override numeric := 0;
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

  v_presence_status := public.resolve_device_presence_status(
    v_device.device_status,
    v_device.last_seen_at
  );

  if v_presence_status = 'playing'
     or (v_device.active_session_id is not null and v_presence_status <> 'offline')
     or coalesce(v_device.is_free_game, false)
     or coalesce(v_device.free_spins_left, 0) > 0
     or coalesce(v_device.pending_free_spins, 0) > 0
     or coalesce(v_device.show_free_spin_intro, false) then
    raise exception 'Device % must be idle or offline with no active online session or free-spin flow before closing accounts', v_device_id;
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

  select coalesce(sum(jp.amount_total), 0)
    into v_delta_manual_jackpot_override
  from public.jackpot_pots jp
  where coalesce(jp.goal_snapshot->>'source', '') = 'dashboard_device_override'
    and coalesce(jp.goal_snapshot->>'deviceId', '') = v_device_id
    and coalesce(jp.activated_at, jp.created_at) > coalesce(v_previous.closed_at, '-infinity'::timestamp with time zone)
    and coalesce(jp.activated_at, jp.created_at) <= now();

  select coalesce(sum(greatest(coalesce(
      case
        when trim(coalesce(e.metadata->>'acceptedWin', '')) ~ '^[+-]?[0-9]+(\.[0-9]+)?$'
        then (e.metadata->>'acceptedWin')::numeric
        else null
      end,
      case
        when trim(coalesce(e.metadata->>'accepted_win', '')) ~ '^[+-]?[0-9]+(\.[0-9]+)?$'
        then (e.metadata->>'accepted_win')::numeric
        else null
      end,
      e.amount,
      0
    ), 0)), 0)
    into v_delta_happy_override
  from public.device_metric_events e
  where e.device_id = v_device_id
    and e.counts_toward_global is true
    and e.event_type = 'win'
    and lower(trim(coalesce(e.metadata->>'winFundingSource', ''))) = 'device_happy_override'
    and e.event_ts > coalesce(v_previous.closed_at, '-infinity'::timestamp with time zone)
    and e.event_ts <= now();

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
      'presenceStatus', v_presence_status,
      'jackpotPotIds', v_jackpot_pot_ids,
      'manualJackpotOverride', greatest(v_delta_manual_jackpot_override, 0),
      'happyOverride', greatest(v_delta_happy_override, 0),
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
    'manual_jackpot_override', greatest(v_delta_manual_jackpot_override, 0),
    'happy_override', greatest(v_delta_happy_override, 0),
    'reset_visible_counters', false
  );
end;
$$;

comment on function public.close_device_revenue_period(text) is
  'Snapshots a device revenue period without deleting event history or mutating player balance/hopper balance. Stale session ids do not block closings after the device resolves offline. Override breakdowns are saved in metadata.';

create or replace function public.post_device_admin_ledger_entry(
  p_device_id text,
  p_target text,
  p_entry_kind text,
  p_amount numeric,
  p_account_name text,
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_device public.devices;
  v_before numeric := 0;
  v_after numeric := 0;
  v_applied numeric := 0;
  v_target text := lower(trim(coalesce(p_target, '')));
  v_kind text := lower(trim(coalesce(p_entry_kind, '')));
  v_requested numeric := greatest(coalesce(p_amount, 0), 0);
  v_deployment_mode text := 'online';
  v_entry_scope text := 'eligible';
  v_counts_toward_global boolean := false;
  v_admin_counts_toward_global boolean := false;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_event_ts timestamptz := now();
  v_stat_date date := (now() at time zone 'utc')::date;
  v_actor_user_id uuid := auth.uid();
  v_actor_email text := null;
  v_actor_full_name text := null;
  v_metric_event_type text := null;
  v_coins_in_amount numeric := 0;
  v_hopper_in_amount numeric := 0;
  v_hopper_out_amount numeric := 0;
  v_balance_change numeric := 0;
begin
  if coalesce(trim(p_device_id), '') = '' then
    raise exception 'p_device_id is required';
  end if;

  if v_target not in ('accounting_balance', 'hopper_balance', 'coins_in') then
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

  if v_actor_user_id is not null then
    select du.email, du.full_name
    into v_actor_email, v_actor_full_name
    from public.dashboard_users du
    where du.user_id = v_actor_user_id;
  end if;

  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  select *
  into v_device
  from public.devices
  where device_id = p_device_id
  for update;

  v_deployment_mode := coalesce(nullif(trim(v_device.deployment_mode), ''), 'online');
  v_entry_scope := case when v_deployment_mode = 'online' then 'eligible' else 'raw' end;
  v_counts_toward_global := (v_deployment_mode = 'online');
  v_admin_counts_toward_global := (v_target = 'accounting_balance' and v_counts_toward_global);

  if v_entry_scope = 'eligible' then
    if v_target = 'accounting_balance' then
      select coalesce(t.eligible_balance, 0::numeric)
      into v_before
      from public.device_accounting_totals t
      where t.device_id = p_device_id;
    elsif v_target = 'hopper_balance' then
      select coalesce(t.eligible_hopper_balance, 0::numeric)
      into v_before
      from public.device_accounting_totals t
      where t.device_id = p_device_id;
    else
      select coalesce(t.eligible_coins_in_total, 0::numeric)
      into v_before
      from public.device_accounting_totals t
      where t.device_id = p_device_id;
    end if;
  elsif v_target = 'accounting_balance' then
    v_before := greatest(coalesce(v_device.balance, 0), 0);
  elsif v_target = 'hopper_balance' then
    v_before := greatest(coalesce(v_device.hopper_balance, 0), 0);
  else
    v_before := greatest(coalesce(v_device.coins_in_total, 0), 0);
  end if;

  if v_kind = 'credit' then
    v_applied := v_requested;
    v_after := v_before + v_applied;
  else
    v_applied := least(v_requested, v_before);
    v_after := greatest(0, v_before - v_applied);
  end if;

  v_metadata := v_metadata || jsonb_build_object(
    'override_source', 'admin_override',
    'requested_amount', v_requested,
    'entry_scope', v_entry_scope,
    'deployment_mode_at_entry', v_deployment_mode,
    'counts_toward_global', v_counts_toward_global,
    'admin_counts_toward_global', v_admin_counts_toward_global,
    'actor_user_id', v_actor_user_id,
    'actor_email', v_actor_email,
    'actor_full_name', v_actor_full_name,
    'target', v_target,
    'entry_kind', v_kind
  );

  if v_target = 'coins_in' then
    if v_kind = 'credit' then
      v_metric_event_type := 'coins_in';
      v_coins_in_amount := v_applied;
    else
      v_metric_event_type := 'coins_out';
      v_coins_in_amount := -v_applied;
    end if;

    update public.devices
    set coins_in_total = greatest(0, coins_in_total + v_coins_in_amount),
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
      included_coins_in_amount,
      included_hopper_in_amount,
      included_hopper_out_amount,
      included_bet_amount,
      included_win_amount,
      included_house_take_amount,
      included_jackpot_contrib_amount,
      included_jackpot_win_amount,
      included_withdrawal_amount,
      included_balance_change,
      included_event_count,
      included_spins_count,
      included_prize_pool_contrib_amount,
      included_prize_pool_paid_amount,
      updated_at
    )
    values (
      v_stat_date,
      p_device_id,
      v_coins_in_amount,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      case when v_counts_toward_global then v_coins_in_amount else 0 end,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      case when v_counts_toward_global then 1 else 0 end,
      0,
      0,
      0,
      now()
    )
    on conflict (stat_date, device_id) do update
    set coins_in_amount = public.device_daily_stats.coins_in_amount + excluded.coins_in_amount,
        balance_change = public.device_daily_stats.balance_change + excluded.balance_change,
        event_count = public.device_daily_stats.event_count + excluded.event_count,
        included_coins_in_amount = public.device_daily_stats.included_coins_in_amount + excluded.included_coins_in_amount,
        included_balance_change = public.device_daily_stats.included_balance_change + excluded.included_balance_change,
        included_event_count = public.device_daily_stats.included_event_count + excluded.included_event_count,
        updated_at = now();

    insert into public.device_metric_events (
      event_ts,
      device_id,
      event_type,
      amount,
      metadata,
      deployment_mode,
      device_status,
      counts_toward_global
    )
    values (
      v_event_ts,
      p_device_id,
      v_metric_event_type,
      v_applied,
      v_metadata,
      v_deployment_mode,
      coalesce(v_device.device_status, 'offline'),
      v_counts_toward_global
    );
  elsif v_target = 'hopper_balance' then
    if v_kind = 'credit' then
      v_metric_event_type := 'hopper_in';
      v_hopper_in_amount := v_applied;
    else
      v_metric_event_type := 'hopper_out';
      v_hopper_out_amount := v_applied;
    end if;

    update public.devices
    set hopper_balance = greatest(0, hopper_balance + v_hopper_in_amount - v_hopper_out_amount),
        hopper_in_total = hopper_in_total + v_hopper_in_amount,
        hopper_out_total = hopper_out_total + v_hopper_out_amount,
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
      included_coins_in_amount,
      included_hopper_in_amount,
      included_hopper_out_amount,
      included_bet_amount,
      included_win_amount,
      included_house_take_amount,
      included_jackpot_contrib_amount,
      included_jackpot_win_amount,
      included_withdrawal_amount,
      included_balance_change,
      included_event_count,
      included_spins_count,
      included_prize_pool_contrib_amount,
      included_prize_pool_paid_amount,
      updated_at
    )
    values (
      v_stat_date,
      p_device_id,
      0,
      v_hopper_in_amount,
      v_hopper_out_amount,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      case when v_counts_toward_global then v_hopper_in_amount else 0 end,
      case when v_counts_toward_global then v_hopper_out_amount else 0 end,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      case when v_counts_toward_global then 1 else 0 end,
      0,
      0,
      0,
      now()
    )
    on conflict (stat_date, device_id) do update
    set hopper_in_amount = public.device_daily_stats.hopper_in_amount + excluded.hopper_in_amount,
        hopper_out_amount = public.device_daily_stats.hopper_out_amount + excluded.hopper_out_amount,
        event_count = public.device_daily_stats.event_count + excluded.event_count,
        included_hopper_in_amount = public.device_daily_stats.included_hopper_in_amount + excluded.included_hopper_in_amount,
        included_hopper_out_amount = public.device_daily_stats.included_hopper_out_amount + excluded.included_hopper_out_amount,
        included_event_count = public.device_daily_stats.included_event_count + excluded.included_event_count,
        updated_at = now();

    insert into public.device_metric_events (
      event_ts,
      device_id,
      event_type,
      amount,
      metadata,
      deployment_mode,
      device_status,
      counts_toward_global
    )
    values (
      v_event_ts,
      p_device_id,
      v_metric_event_type,
      v_applied,
      v_metadata,
      v_deployment_mode,
      coalesce(v_device.device_status, 'offline'),
      v_counts_toward_global
    );
  elsif v_entry_scope = 'raw' then
    update public.devices
    set balance = v_after,
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
    v_metadata || jsonb_build_object('counts_toward_global', v_admin_counts_toward_global)
  );

  return jsonb_build_object(
    'ok', true,
    'device_id', p_device_id,
    'target', v_target,
    'entry_kind', v_kind,
    'amount', v_applied,
    'before', v_before,
    'after', v_after,
    'entry_scope', v_entry_scope,
    'counts_toward_global', v_counts_toward_global,
    'admin_counts_toward_global', v_admin_counts_toward_global,
    'metric_event_type', v_metric_event_type
  );
end;
$$;

alter function public.post_device_admin_ledger_entry(
  text,
  text,
  text,
  numeric,
  text,
  text,
  jsonb
) owner to postgres;

alter table public.device_admin_ledger_entries
  drop constraint if exists device_admin_ledger_entries_target_check;

alter table public.device_admin_ledger_entries
  add constraint device_admin_ledger_entries_target_check
  check (target = any (array['accounting_balance'::text, 'hopper_balance'::text, 'coins_in'::text]));

alter table public.jackpot_payout_queue
  add column if not exists payout_ready_at timestamptz;

create or replace function public.finalize_device_jackpot_payouts(
  p_device_id text,
  p_event_ts timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    updated_at = now()
  where device_id = p_device_id
    and completed_at is null
    and payout_ready_at is not null
    and coalesce(remaining_amount, 0) <= 0.0001
    and coalesce(payouts_left, 0) <= 0;

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
  v_cap_total numeric := null;
  v_cap_remaining numeric := null;
  v_paid_so_far numeric := 0;
  v_overflow numeric := 0;
  v_unallocated numeric := 0;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return 0;
  end if;

  -- Next event from device acts as payout confirmation for previous ready rows.
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
      -- No bet context yet: do not force payout to zero.
      v_cap_remaining := null;
    else
      v_cap_remaining := greatest(v_cap_total - coalesce(v_paid_so_far, 0), 0);
    end if;
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
      payouts_left = greatest(payouts_left - 1, 0),
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

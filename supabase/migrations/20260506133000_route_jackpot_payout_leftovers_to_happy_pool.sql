CREATE OR REPLACE FUNCTION public.finalize_device_jackpot_payouts(
  p_device_id text,
  p_event_ts timestamp with time zone DEFAULT now()
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_updated bigint := 0;
  v_next_active_pot_id bigint := null;
  v_leftover_to_happy numeric := 0;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return;
  end if;

  select coalesce(sum(greatest(coalesce(q.remaining_amount, 0), 0)), 0)
    into v_leftover_to_happy
  from public.jackpot_payout_queue q
  where q.device_id = p_device_id
    and q.completed_at is null
    and coalesce(q.payouts_left, 0) <= 0
    and coalesce(q.remaining_amount, 0) > 0.0001;

  if v_leftover_to_happy > 0.0001 then
    update public.casino_runtime
    set
      prize_pool_balance = greatest(coalesce(prize_pool_balance, 0) + v_leftover_to_happy, 0),
      updated_at = now()
    where id = true;

    update public.jackpot_payout_queue q
    set
      remaining_amount = 0,
      updated_at = now()
    where q.device_id = p_device_id
      and q.completed_at is null
      and coalesce(q.payouts_left, 0) <= 0
      and coalesce(q.remaining_amount, 0) > 0.0001;
  end if;

  update public.jackpot_payout_queue
  set
    completed_at = coalesce(p_event_ts, now()),
    payouts_left = 0,
    updated_at = now()
  where device_id = p_device_id
    and completed_at is null
    and (
      coalesce(remaining_amount, 0) <= 0.0001
      or coalesce(payouts_left, 0) <= 0
    );

  get diagnostics v_updated = row_count;

  if v_updated <= 0 then
    return;
  end if;

  update public.jackpot_pots jp
  set
    status = 'completed',
    amount_remaining = 0,
    completed_at = coalesce(p_event_ts, now())
  where jp.status = 'processing'
    and not exists (
      select 1
      from public.jackpot_payout_queue q
      where q.jackpot_pot_id = jp.id
        and q.completed_at is null
    );

  select jp.id
    into v_next_active_pot_id
  from public.jackpot_pots jp
  where jp.status = 'processing'
    and exists (
      select 1
      from public.jackpot_payout_queue q
      where q.jackpot_pot_id = jp.id
        and q.completed_at is null
    )
  order by jp.activated_at asc nulls last, jp.id asc
  limit 1;

  update public.casino_runtime
  set
    jackpot_pending_payout = v_next_active_pot_id is not null,
    active_jackpot_pot_id = v_next_active_pot_id,
    updated_at = now()
  where id = true;

  perform public.trigger_jackpot_payout_if_ready(coalesce(p_event_ts, now()));
end;
$$;

ALTER FUNCTION public.finalize_device_jackpot_payouts(text, timestamp with time zone) OWNER TO postgres;

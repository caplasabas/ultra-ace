-- Guard jackpot payout variance per payout step.
-- Keeps configured variance bounded to avoid extreme chunk swings.

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
  v_next_spins_until_start integer := 0;
  v_device_is_free_game boolean := false;
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

  -- Hard guard: never allow >500 payout jitter per step.
  v_variance := least(greatest(coalesce(v_runtime.jackpot_win_variance, 0), 0), 500);
  v_curve := lower(coalesce(v_runtime.jackpot_payout_curve, 'center'));
  if v_curve not in ('flat', 'front', 'center', 'back') then
    v_curve := 'center';
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

  if v_payout <= 0 and coalesce(v_row.remaining_amount, 0) > 0 then
    v_payout := least(v_row.remaining_amount, 0.0001);
  end if;

  if v_payout <= 0 then
    return 0;
  end if;

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

  if v_row.jackpot_pot_id is not null then
    update public.jackpot_pots
    set
      amount_remaining = greatest(amount_remaining - v_payout, 0)
    where id = v_row.jackpot_pot_id;
  end if;

  return greatest(v_payout, 0);
end;
$$;

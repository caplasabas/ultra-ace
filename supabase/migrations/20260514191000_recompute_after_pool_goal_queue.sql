create or replace function public.process_pool_goal_queues(
  p_event_ts timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_runtime public.casino_runtime;
  v_recomputed public.casino_runtime;
  v_now timestamptz := coalesce(p_event_ts, now());
  v_happy_reached boolean := false;
  v_jackpot_reached boolean := false;
  v_spin_target bigint := 1000;
  v_time_target integer := 1800;
  v_mode text := 'amount';
  v_jackpot_pot_amount numeric := 0;
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
    v_jackpot_pot_amount := case
      when v_mode = 'amount' then greatest(coalesce(v_runtime.jackpot_pool_goal, 0), 0)
      else greatest(coalesce(v_runtime.jackpot_pool_balance, 0), 0)
    end;

    insert into public.jackpot_pots (
      amount_total,
      amount_remaining,
      status,
      goal_mode,
      goal_snapshot,
      created_at
    )
    values (
      v_jackpot_pot_amount,
      v_jackpot_pot_amount,
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
      jackpot_pool_balance = greatest(coalesce(jackpot_pool_balance, 0) - v_jackpot_pot_amount, 0),
      jackpot_pool_spin_counter = 0,
      jackpot_pool_goal_anchor_at = v_now,
      updated_at = now()
    where id = true;
  end if;

  if v_happy_reached or v_jackpot_reached then
    v_recomputed := public.recompute_casino_mode();
  else
    v_recomputed := v_runtime;
  end if;

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'happyReached', v_happy_reached,
    'jackpotReached', v_jackpot_reached,
    'activeMode', v_recomputed.active_mode,
    'happyHourPrizeBalance', greatest(coalesce(v_recomputed.happy_hour_prize_balance, 0), 0)
  );
end;
$$;

alter function public.process_pool_goal_queues(timestamptz) owner to postgres;
grant all on function public.process_pool_goal_queues(timestamptz) to anon;
grant all on function public.process_pool_goal_queues(timestamptz) to authenticated;
grant all on function public.process_pool_goal_queues(timestamptz) to service_role;


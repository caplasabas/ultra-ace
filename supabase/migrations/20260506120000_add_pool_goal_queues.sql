alter table public.casino_runtime
  add column if not exists happy_pool_goal_queue numeric[] not null default '{}',
  add column if not exists happy_pool_goal_queue_index integer not null default 0,
  add column if not exists jackpot_pool_goal_queue numeric[] not null default '{}',
  add column if not exists jackpot_pool_goal_queue_index integer not null default 0;

update public.casino_runtime
set
  happy_pool_goal_queue = case
    when cardinality(coalesce(happy_pool_goal_queue, '{}')) = 0
      and coalesce(prize_pool_goal, 0) > 0
    then array[prize_pool_goal]
    else happy_pool_goal_queue
  end,
  jackpot_pool_goal_queue = case
    when cardinality(coalesce(jackpot_pool_goal_queue, '{}')) = 0
      and coalesce(jackpot_pool_goal, 0) > 0
    then array[jackpot_pool_goal]
    else jackpot_pool_goal_queue
  end,
  happy_pool_goal_queue_index = greatest(coalesce(happy_pool_goal_queue_index, 0), 0),
  jackpot_pool_goal_queue_index = greatest(coalesce(jackpot_pool_goal_queue_index, 0), 0)
where id = true;

create or replace view public.casino_runtime_live as
 select r.id,
    r.active_mode,
    r.base_profile_id,
    r.happy_profile_id,
    r.manual_happy_enabled,
    r.auto_happy_enabled,
    r.prize_pool_balance,
    r.happy_hour_prize_balance,
    r.prize_pool_goal,
    r.jackpot_pool_balance,
    r.jackpot_pool_goal,
    r.jackpot_contrib_pct,
    r.jackpot_min_winners,
    r.jackpot_max_winners,
    r.jackpot_delay_min_spins,
    r.jackpot_delay_max_spins,
    r.jackpot_chunk_min,
    r.jackpot_chunk_max,
    r.jackpot_win_variance,
    r.jackpot_pending_payout,
    r.last_jackpot_triggered_at,
    r.active_happy_pot_id,
    r.active_jackpot_pot_id,
    r.pool_goal_mode,
    r.pool_goal_spins,
    r.pool_goal_time_seconds,
    r.happy_pool_spin_counter,
    r.jackpot_pool_spin_counter,
    r.happy_pool_goal_anchor_at,
    r.jackpot_pool_goal_anchor_at,
    r.max_win_enabled,
    r.max_win_multiplier,
    coalesce((select count(*) from public.happy_hour_pots hp_1 where hp_1.status = 'queued'), 0::bigint) as happy_pots_queued_count,
    coalesce((select sum(hp_1.amount_remaining) from public.happy_hour_pots hp_1 where hp_1.status = 'queued'), 0::numeric) as happy_pots_queued_amount,
    coalesce((select count(*) from public.jackpot_pots jp where jp.status = 'queued'), 0::bigint) as jackpot_pots_queued_count,
    coalesce((select sum(jp.amount_remaining) from public.jackpot_pots jp where jp.status = 'queued'), 0::numeric) as jackpot_pots_queued_amount,
    r.hopper_alert_threshold,
    r.updated_at,
    bp.name as base_profile_name,
    hp.name as happy_profile_name,
    bp.house_pct as base_house_pct,
    bp.pool_pct as base_pool_pct,
    bp.player_pct as base_player_pct,
    hp.house_pct as happy_house_pct,
    hp.pool_pct as happy_pool_pct,
    hp.player_pct as happy_player_pct,
    hp.prize_pct as happy_prize_pct,
    case
      when r.active_mode = 'HAPPY' then hp.player_pct + hp.prize_pct
      else bp.player_pct
    end as active_target_rtp_pct,
    r.jackpot_payout_curve,
    r.jackpot_delivery_mode,
    r.happy_pool_goal_queue,
    r.happy_pool_goal_queue_index,
    r.jackpot_pool_goal_queue,
    r.jackpot_pool_goal_queue_index
   from public.casino_runtime r
     left join public.rtp_profiles bp on bp.id = r.base_profile_id
     left join public.rtp_profiles hp on hp.id = r.happy_profile_id;

alter view public.casino_runtime_live owner to postgres;
grant all on table public.casino_runtime_live to anon;
grant all on table public.casino_runtime_live to authenticated;
grant all on table public.casino_runtime_live to service_role;

create or replace function public.process_pool_goal_queues(p_event_ts timestamp with time zone default now()) returns jsonb
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  v_runtime public.casino_runtime;
  v_now timestamptz := coalesce(p_event_ts, now());
  v_happy_reached boolean := false;
  v_jackpot_reached boolean := false;
  v_spin_target bigint := 1000;
  v_time_target integer := 1800;
  v_mode text := 'amount';
  v_jackpot_pot_amount numeric := 0;
  v_happy_goal_queue numeric[] := '{}';
  v_jackpot_goal_queue numeric[] := '{}';
  v_happy_queue_len integer := 0;
  v_jackpot_queue_len integer := 0;
  v_next_happy_queue_index integer := 0;
  v_next_jackpot_queue_index integer := 0;
  v_next_happy_goal numeric := null;
  v_next_jackpot_goal numeric := null;
begin
  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'runtime_missing');
  end if;

  select coalesce(array_agg(goal_amount order by ord), '{}')
    into v_happy_goal_queue
  from unnest(coalesce(v_runtime.happy_pool_goal_queue, '{}')) with ordinality as q(goal_amount, ord)
  where goal_amount > 0;

  select coalesce(array_agg(goal_amount order by ord), '{}')
    into v_jackpot_goal_queue
  from unnest(coalesce(v_runtime.jackpot_pool_goal_queue, '{}')) with ordinality as q(goal_amount, ord)
  where goal_amount > 0;

  v_happy_queue_len := cardinality(v_happy_goal_queue);
  v_jackpot_queue_len := cardinality(v_jackpot_goal_queue);

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
        'triggeredAt', v_now,
        'goalQueueIndex', v_runtime.happy_pool_goal_queue_index,
        'goalQueue', v_happy_goal_queue
      ),
      v_now
    );

    if v_mode = 'amount' and v_happy_queue_len > 0 then
      v_next_happy_queue_index := (greatest(coalesce(v_runtime.happy_pool_goal_queue_index, 0), 0) + 1) % v_happy_queue_len;
      v_next_happy_goal := v_happy_goal_queue[v_next_happy_queue_index + 1];
    else
      v_next_happy_queue_index := greatest(coalesce(v_runtime.happy_pool_goal_queue_index, 0), 0);
      v_next_happy_goal := v_runtime.prize_pool_goal;
    end if;

    update public.casino_runtime
    set
      prize_pool_balance = 0,
      prize_pool_goal = coalesce(v_next_happy_goal, prize_pool_goal),
      happy_pool_goal_queue = v_happy_goal_queue,
      happy_pool_goal_queue_index = v_next_happy_queue_index,
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
        'triggeredAt', v_now,
        'goalQueueIndex', v_runtime.jackpot_pool_goal_queue_index,
        'goalQueue', v_jackpot_goal_queue
      ),
      v_now
    );

    if v_mode = 'amount' and v_jackpot_queue_len > 0 then
      v_next_jackpot_queue_index := (greatest(coalesce(v_runtime.jackpot_pool_goal_queue_index, 0), 0) + 1) % v_jackpot_queue_len;
      v_next_jackpot_goal := v_jackpot_goal_queue[v_next_jackpot_queue_index + 1];
    else
      v_next_jackpot_queue_index := greatest(coalesce(v_runtime.jackpot_pool_goal_queue_index, 0), 0);
      v_next_jackpot_goal := v_runtime.jackpot_pool_goal;
    end if;

    update public.casino_runtime
    set
      jackpot_pool_balance = greatest(coalesce(jackpot_pool_balance, 0) - v_jackpot_pot_amount, 0),
      jackpot_pool_goal = coalesce(v_next_jackpot_goal, jackpot_pool_goal),
      jackpot_pool_goal_queue = v_jackpot_goal_queue,
      jackpot_pool_goal_queue_index = v_next_jackpot_queue_index,
      jackpot_pool_spin_counter = 0,
      jackpot_pool_goal_anchor_at = v_now,
      updated_at = now()
    where id = true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'happyReached', v_happy_reached,
    'jackpotReached', v_jackpot_reached,
    'happyGoal', v_next_happy_goal,
    'jackpotGoal', v_next_jackpot_goal
  );
end;
$$;

alter function public.process_pool_goal_queues(timestamp with time zone) owner to postgres;
grant all on function public.process_pool_goal_queues(timestamp with time zone) to anon;
grant all on function public.process_pool_goal_queues(timestamp with time zone) to authenticated;
grant all on function public.process_pool_goal_queues(timestamp with time zone) to service_role;

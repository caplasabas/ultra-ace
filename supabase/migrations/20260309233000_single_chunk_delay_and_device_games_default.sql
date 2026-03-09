-- Jackpot payout should be single chunk (delayed only), and new devices
-- should auto-enable globally enabled games.

create or replace function public.trigger_jackpot_payout_if_ready(
  p_event_ts timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_runtime public.casino_runtime;
  v_pot public.jackpot_pots;
  v_pool numeric := 0;
  v_min_winners integer := 1;
  v_max_winners integer := 1;
  v_requested integer := 1;
  v_count integer := 0;
  v_share numeric := 0;
  v_remaining numeric := 0;
  v_campaign_id uuid := (
    (
      substr(md5(random()::text || clock_timestamp()::text), 1, 8) || '-' ||
      substr(md5(random()::text || clock_timestamp()::text), 1, 4) || '-' ||
      substr(md5(random()::text || clock_timestamp()::text), 1, 4) || '-' ||
      substr(md5(random()::text || clock_timestamp()::text), 1, 4) || '-' ||
      substr(md5(random()::text || clock_timestamp()::text), 1, 12)
    )::uuid
  );
  v_device_ids text[] := '{}';
  v_device_id text;
  v_delay integer := 0;
  v_winner_index integer := 0;
begin
  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if not found then
    return jsonb_build_object('triggered', false, 'reason', 'runtime_missing');
  end if;

  if coalesce(v_runtime.jackpot_pending_payout, false) then
    return jsonb_build_object('triggered', false, 'reason', 'pending_campaign');
  end if;

  select * into v_pot
  from public.jackpot_pots
  where status = 'queued'
  order by created_at asc, id asc
  limit 1
  for update skip locked;

  if not found then
    return jsonb_build_object('triggered', false, 'reason', 'no_queued_pot');
  end if;

  v_pool := greatest(coalesce(v_pot.amount_remaining, 0), 0);
  if v_pool <= 0 then
    update public.jackpot_pots
    set
      status = 'completed',
      amount_remaining = 0,
      completed_at = now()
    where id = v_pot.id;

    return jsonb_build_object('triggered', false, 'reason', 'empty_queued_pot');
  end if;

  select array_agg(t.device_id), count(*)
    into v_device_ids, v_count
  from (
    select d.device_id
    from public.devices d
    where d.device_status = 'playing'
    order by random()
    limit greatest(coalesce(v_runtime.jackpot_max_winners, 1), 1)
  ) t;

  if coalesce(v_count, 0) <= 0 then
    return jsonb_build_object('triggered', false, 'reason', 'no_eligible_devices');
  end if;

  v_min_winners := greatest(coalesce(v_runtime.jackpot_min_winners, 1), 1);
  v_max_winners := greatest(coalesce(v_runtime.jackpot_max_winners, v_min_winners), v_min_winners);
  v_requested := floor(random() * (v_max_winners - v_min_winners + 1))::integer + v_min_winners;
  v_requested := least(v_requested, v_count);

  if v_requested <= 0 then
    return jsonb_build_object('triggered', false, 'reason', 'winner_count_zero');
  end if;

  v_share := round(v_pool / v_requested, 4);
  v_remaining := v_pool;

  v_winner_index := 0;
  foreach v_device_id in array v_device_ids loop
    exit when v_winner_index >= v_requested;
    v_winner_index := v_winner_index + 1;

    v_delay := floor(
      random() * (greatest(coalesce(v_runtime.jackpot_delay_max_spins, 3), coalesce(v_runtime.jackpot_delay_min_spins, 2))
      - greatest(coalesce(v_runtime.jackpot_delay_min_spins, 2), 0) + 1)
    )::integer + greatest(coalesce(v_runtime.jackpot_delay_min_spins, 2), 0);

    insert into public.jackpot_payout_queue (
      campaign_id,
      jackpot_pot_id,
      device_id,
      target_amount,
      remaining_amount,
      spins_until_start,
      payouts_left,
      created_at,
      updated_at
    )
    values (
      v_campaign_id,
      v_pot.id,
      v_device_id,
      case when v_winner_index < v_requested then v_share else greatest(v_remaining, 0) end,
      case when v_winner_index < v_requested then v_share else greatest(v_remaining, 0) end,
      v_delay,
      1,
      coalesce(p_event_ts, now()),
      now()
    );

    if v_winner_index < v_requested then
      v_remaining := greatest(v_remaining - v_share, 0);
    else
      v_remaining := 0;
    end if;
  end loop;

  update public.jackpot_pots
  set
    status = 'processing',
    campaign_id = v_campaign_id,
    activated_at = coalesce(activated_at, coalesce(p_event_ts, now()))
  where id = v_pot.id;

  update public.casino_runtime
  set
    jackpot_pending_payout = true,
    active_jackpot_pot_id = v_pot.id,
    last_jackpot_triggered_at = coalesce(p_event_ts, now()),
    updated_at = now()
  where id = true;

  return jsonb_build_object(
    'triggered', true,
    'campaign_id', v_campaign_id,
    'pot_id', v_pot.id,
    'winners', v_requested,
    'amount', v_pool
  );
end;
$$;

create or replace function public.auto_enable_global_games_for_new_device()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.games') is null or to_regclass('public.cabinet_games') is null then
    return new;
  end if;

  insert into public.cabinet_games (device_id, game_id, installed)
  select
    new.device_id,
    g.id,
    true
  from public.games g
  where coalesce(g.enabled, false) = true
  on conflict (device_id, game_id) do update
  set installed = excluded.installed;

  return new;
end;
$$;

drop trigger if exists trg_auto_enable_global_games_for_new_device on public.devices;
create trigger trg_auto_enable_global_games_for_new_device
after insert on public.devices
for each row
execute function public.auto_enable_global_games_for_new_device();

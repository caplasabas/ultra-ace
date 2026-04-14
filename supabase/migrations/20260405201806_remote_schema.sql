drop view if exists "public"."device_stats_live";

drop view if exists "public"."devices_dashboard_live";

drop view if exists "public"."devices_with_location";

drop view if exists "public"."global_stats_live";

drop view if exists "public"."over_cap_win_events_live";

alter table "public"."areas" add column "station" text;

create or replace view "public"."device_stats_live" as  SELECT device_id,
    balance,
    hopper_balance,
    coins_in_total,
    hopper_in_total,
    hopper_out_total,
    bet_total,
    win_total,
    withdraw_total,
    updated_at,
    name,
    spins_total,
    prize_pool_contrib_total,
    prize_pool_paid_total,
    current_game_id,
    current_game_name,
    device_status,
    active_session_id,
    session_started_at,
    session_last_heartbeat,
    session_ended_at,
    runtime_mode,
    is_free_game,
    free_spins_left,
    pending_free_spins,
    show_free_spin_intro,
    current_spin_id,
    session_metadata,
    arcade_shell_version,
    current_ip
   FROM public.devices d;


create or replace view "public"."devices_dashboard_live" as  SELECT d.id,
    d.device_id,
    d.name,
    d.created_at,
    d.updated_at,
    d.balance,
    d.coins_in_total,
    d.hopper_balance,
    d.hopper_in_total,
    d.hopper_out_total,
    d.bet_total,
    d.win_total,
    d.withdraw_total,
    d.spins_total,
    d.prize_pool_contrib_total,
    d.prize_pool_paid_total,
    d.current_game_id,
    d.current_game_name,
    d.device_status,
    d.active_session_id,
    d.session_started_at,
    d.session_last_heartbeat,
    d.session_ended_at,
    d.runtime_mode,
    d.is_free_game,
    d.free_spins_left,
    d.pending_free_spins,
    d.show_free_spin_intro,
    d.current_spin_id,
    d.session_metadata,
    d.house_take_total,
    d.last_bet_amount,
    d.last_bet_at,
    d.jackpot_contrib_total,
    d.jackpot_win_total,
    d.arcade_shell_version,
    d.current_ip,
    d.agent_id,
    d.area_id,
    d.station,
    d.location_address,
    ag.name AS agent_name,
    ar.name AS area_name,
    ar.station AS station_name
   FROM ((public.devices d
     LEFT JOIN public.agents ag ON ((ag.id = d.agent_id)))
     LEFT JOIN public.areas ar ON ((ar.id = d.area_id)));


create or replace view "public"."devices_with_location" as  SELECT d.id,
    d.device_id,
    d.name,
    d.created_at,
    d.updated_at,
    d.balance,
    d.coins_in_total,
    d.hopper_balance,
    d.hopper_in_total,
    d.hopper_out_total,
    d.bet_total,
    d.win_total,
    d.withdraw_total,
    d.spins_total,
    d.prize_pool_contrib_total,
    d.prize_pool_paid_total,
    d.current_game_id,
    d.current_game_name,
    d.device_status,
    d.active_session_id,
    d.session_started_at,
    d.session_last_heartbeat,
    d.session_ended_at,
    d.runtime_mode,
    d.is_free_game,
    d.free_spins_left,
    d.pending_free_spins,
    d.show_free_spin_intro,
    d.current_spin_id,
    d.session_metadata,
    d.house_take_total,
    d.last_bet_amount,
    d.last_bet_at,
    d.jackpot_contrib_total,
    d.jackpot_win_total,
    d.arcade_shell_version,
    d.current_ip,
    d.agent_id,
    d.area_id,
    d.station,
    d.location_address,
    a.name AS agent_name,
    ar.name AS area_name
   FROM ((public.devices d
     LEFT JOIN public.agents a ON ((a.id = d.agent_id)))
     LEFT JOIN public.areas ar ON ((ar.id = d.area_id)));


create or replace view "public"."global_stats_live" as  WITH totals AS (
         SELECT COALESCE(sum(d.balance), (0)::numeric) AS total_balance,
            COALESCE(sum(d.coins_in_total), (0)::numeric) AS total_coins_in,
            COALESCE(sum(d.hopper_balance), (0)::numeric) AS total_hopper,
            COALESCE(sum(d.bet_total), (0)::numeric) AS total_bet_amount,
            COALESCE(sum(d.win_total), (0)::numeric) AS total_win_amount,
            COALESCE(sum(d.withdraw_total), (0)::numeric) AS total_withdraw_amount,
            (COALESCE(sum(d.spins_total), (0)::numeric))::bigint AS total_spins,
            GREATEST(1, COALESCE(round(sum(d.bet_total) / nullif(sum(d.spins_total), 0)), 0)) AS global_avg_bet,
            COALESCE(sum(d.house_take_total), (0)::numeric) AS total_house_take,
            COALESCE(sum(d.jackpot_contrib_total), (0)::numeric) AS total_jackpot_contrib,
            COALESCE(sum(d.jackpot_win_total), (0)::numeric) AS total_jackpot_win,
            count(*) AS device_count
           FROM public.devices d
        ), runtime AS (
         SELECT COALESCE(r.prize_pool_balance, (0)::numeric) AS prize_pool_balance,
            COALESCE(r.happy_hour_prize_balance, (0)::numeric) AS happy_hour_prize_balance,
            COALESCE(r.jackpot_pool_balance, (0)::numeric) AS jackpot_pool_balance
           FROM public.casino_runtime r
          WHERE (r.id = true)
         LIMIT 1
        ), liabilities AS (
         SELECT COALESCE(( SELECT sum(hp.amount_remaining) AS sum
                   FROM public.happy_hour_pots hp
                  WHERE (hp.status = 'queued'::text)), (0)::numeric) AS happy_queued_amount,
            COALESCE(( SELECT sum(jp.amount_remaining) AS sum
                   FROM public.jackpot_pots jp
                  WHERE (jp.status = 'queued'::text)), (0)::numeric) AS jackpot_queued_amount,
            COALESCE(( SELECT sum(jp.amount_remaining) AS sum
                   FROM public.jackpot_pots jp
                  WHERE (jp.status = 'processing'::text)), (0)::numeric) AS jackpot_processing_amount
        )
 SELECT t.total_balance,
    t.total_coins_in,
    t.total_hopper,
    t.total_bet_amount,
    t.total_win_amount,
    t.total_withdraw_amount,
    t.total_spins,
        CASE
            WHEN (t.total_bet_amount > (0)::numeric) THEN round(((t.total_win_amount / NULLIF(t.total_bet_amount, (0)::numeric)) * 100.0), 4)
            ELSE (0)::numeric
        END AS global_rtp_percent,
    t.device_count,
    now() AS generated_at,
    t.total_house_take,
        CASE
            WHEN (t.total_bet_amount > (0)::numeric) THEN round(((t.total_house_take / NULLIF(t.total_bet_amount, (0)::numeric)) * 100.0), 4)
            ELSE (0)::numeric
        END AS global_house_edge_percent,
    t.total_jackpot_contrib,
    t.total_jackpot_win,
    ((((((((t.total_coins_in - t.total_withdraw_amount) - t.total_balance) - COALESCE(rt.prize_pool_balance, (0)::numeric)) - COALESCE(rt.happy_hour_prize_balance, (0)::numeric)) - COALESCE(rt.jackpot_pool_balance, (0)::numeric)) - COALESCE(lb.happy_queued_amount, (0)::numeric)) - COALESCE(lb.jackpot_queued_amount, (0)::numeric)) - COALESCE(lb.jackpot_processing_amount, (0)::numeric)) AS total_house_net,
        CASE
            WHEN (t.total_coins_in > (0)::numeric) THEN round(((((((((((t.total_coins_in - t.total_withdraw_amount) - t.total_balance) - COALESCE(rt.prize_pool_balance, (0)::numeric)) - COALESCE(rt.happy_hour_prize_balance, (0)::numeric)) - COALESCE(rt.jackpot_pool_balance, (0)::numeric)) - COALESCE(lb.happy_queued_amount, (0)::numeric)) - COALESCE(lb.jackpot_queued_amount, (0)::numeric)) - COALESCE(lb.jackpot_processing_amount, (0)::numeric)) / NULLIF(t.total_coins_in, (0)::numeric)) * 100.0), 4)
            ELSE (0)::numeric
        END AS global_house_net_percent
   FROM ((totals t
     LEFT JOIN runtime rt ON (true))
     LEFT JOIN liabilities lb ON (true));


create or replace view "public"."over_cap_win_events_live" as  SELECT e.id,
    e.device_id,
    d.name AS device_name,
    e.spin_key,
    e.event_ts,
    e.runtime_mode,
    e.funding_source,
    e.requested_amount,
    e.accepted_amount,
    e.funding_cap_amount,
    e.over_amount,
    e.metadata,
    e.created_at
   FROM (public.over_cap_win_events e
     LEFT JOIN public.devices d ON ((d.device_id = e.device_id)));




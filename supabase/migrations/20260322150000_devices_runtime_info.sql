alter table public.devices
  add column if not exists arcade_shell_version text,
  add column if not exists current_ip text;

drop view if exists public.devices_dashboard_live;
drop view if exists public.device_stats_live;

create view public.device_stats_live as
select
  device_id,
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
from public.devices d;

create view public.devices_dashboard_live as
select
  d.id,
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
  coalesce(j.has_active, false) as jackpot_selected,
  coalesce(j.target_amount, 0::numeric) as jackpot_target_amount,
  coalesce(j.remaining_amount, 0::numeric) as jackpot_remaining_amount,
  coalesce(j.spins_until_start, 0) as jackpot_spins_until_start
from public.devices d
left join (
  select
    q.device_id,
    true as has_active,
    sum(q.target_amount) as target_amount,
    sum(q.remaining_amount) as remaining_amount,
    min(q.spins_until_start) as spins_until_start
  from public.jackpot_payout_queue q
  where q.completed_at is null
  group by q.device_id
) j
  on j.device_id = d.device_id;

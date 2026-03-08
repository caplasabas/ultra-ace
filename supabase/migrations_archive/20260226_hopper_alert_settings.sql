alter table public.casino_runtime
  add column if not exists hopper_alert_threshold numeric not null default 500;

drop view if exists public.casino_runtime_live;
create or replace view public.casino_runtime_live as
select
  r.id,
  r.active_mode,
  r.base_profile_id,
  r.happy_profile_id,
  r.manual_happy_enabled,
  r.auto_happy_enabled,
  r.prize_pool_balance,
  r.prize_pool_goal,
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
  end as active_target_rtp_pct
from public.casino_runtime r
left join public.rtp_profiles bp on bp.id = r.base_profile_id
left join public.rtp_profiles hp on hp.id = r.happy_profile_id;

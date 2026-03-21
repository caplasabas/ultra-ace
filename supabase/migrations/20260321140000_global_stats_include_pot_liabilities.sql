-- Include queued/processing pot liabilities in global totals and show negative net
-- instead of masking deficits as zero.

create or replace view public.global_stats_live as
with totals as (
  select
    coalesce(sum(d.balance), 0) as total_balance,
    coalesce(sum(d.coins_in_total), 0) as total_coins_in,
    coalesce(sum(d.hopper_balance), 0) as total_hopper,
    coalesce(sum(d.bet_total), 0) as total_bet_amount,
    coalesce(sum(d.win_total), 0) as total_win_amount,
    coalesce(sum(d.withdraw_total), 0) as total_withdraw_amount,
    coalesce(sum(d.spins_total), 0)::bigint as total_spins,
    coalesce(sum(d.house_take_total), 0) as total_house_take,
    coalesce(sum(d.jackpot_contrib_total), 0) as total_jackpot_contrib,
    coalesce(sum(d.jackpot_win_total), 0) as total_jackpot_win,
    count(*)::bigint as device_count
  from public.devices d
),
runtime as (
  select
    coalesce(r.prize_pool_balance, 0) as prize_pool_balance,
    coalesce(r.happy_hour_prize_balance, 0) as happy_hour_prize_balance,
    coalesce(r.jackpot_pool_balance, 0) as jackpot_pool_balance
  from public.casino_runtime r
  where r.id = true
  limit 1
),
liabilities as (
  select
    coalesce((
      select sum(hp.amount_remaining)
      from public.happy_hour_pots hp
      where hp.status = 'queued'
    ), 0) as happy_queued_amount,
    coalesce((
      select sum(jp.amount_remaining)
      from public.jackpot_pots jp
      where jp.status = 'queued'
    ), 0) as jackpot_queued_amount,
    coalesce((
      select sum(jp.amount_remaining)
      from public.jackpot_pots jp
      where jp.status = 'processing'
    ), 0) as jackpot_processing_amount
)
select
  t.total_balance,
  t.total_coins_in,
  t.total_hopper,
  t.total_bet_amount,
  t.total_win_amount,
  t.total_withdraw_amount,
  t.total_spins,
  case
    when t.total_bet_amount > 0
      then round((t.total_win_amount / nullif(t.total_bet_amount, 0)) * 100.0, 4)
    else 0
  end as global_rtp_percent,
  t.device_count,
  now() as generated_at,
  t.total_house_take,
  case
    when t.total_bet_amount > 0
      then round((t.total_house_take / nullif(t.total_bet_amount, 0)) * 100.0, 4)
    else 0
  end as global_house_edge_percent,
  t.total_jackpot_contrib,
  t.total_jackpot_win,
  (
    t.total_coins_in
      - t.total_withdraw_amount
      - t.total_balance
      - coalesce(rt.prize_pool_balance, 0)
      - coalesce(rt.happy_hour_prize_balance, 0)
      - coalesce(rt.jackpot_pool_balance, 0)
      - coalesce(lb.happy_queued_amount, 0)
      - coalesce(lb.jackpot_queued_amount, 0)
      - coalesce(lb.jackpot_processing_amount, 0)
  ) as total_house_net,
  case
    when t.total_coins_in > 0 then round(
      (
        (
          t.total_coins_in
            - t.total_withdraw_amount
            - t.total_balance
            - coalesce(rt.prize_pool_balance, 0)
            - coalesce(rt.happy_hour_prize_balance, 0)
            - coalesce(rt.jackpot_pool_balance, 0)
            - coalesce(lb.happy_queued_amount, 0)
            - coalesce(lb.jackpot_queued_amount, 0)
            - coalesce(lb.jackpot_processing_amount, 0)
        ) / nullif(t.total_coins_in, 0)
      ) * 100.0,
      4
    )
    else 0
  end as global_house_net_percent
from totals t
left join runtime rt on true
left join liabilities lb on true;

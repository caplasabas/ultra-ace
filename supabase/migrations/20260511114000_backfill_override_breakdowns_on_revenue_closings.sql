with closing_periods as (
  select
    c.id,
    c.device_id,
    coalesce(c.previous_closed_at, '-infinity'::timestamp with time zone) as period_start,
    c.closed_at as period_end
  from public.device_revenue_closings c
),
manual_jackpot_overrides as (
  select
    cp.id,
    coalesce(sum(jp.amount_total), 0) as amount
  from closing_periods cp
  left join public.jackpot_pots jp
    on coalesce(jp.goal_snapshot->>'source', '') = 'dashboard_device_override'
   and coalesce(jp.goal_snapshot->>'deviceId', '') = cp.device_id
   and coalesce(jp.activated_at, jp.created_at) > cp.period_start
   and coalesce(jp.activated_at, jp.created_at) <= cp.period_end
  group by cp.id
),
happy_overrides as (
  select
    cp.id,
    coalesce(sum(greatest(coalesce(
      case
        when trim(coalesce(e.metadata->>'acceptedWin', '')) ~ '^[+-]?[0-9]+(\.[0-9]+)?$'
        then (e.metadata->>'acceptedWin')::numeric
        else null
      end,
      case
        when trim(coalesce(e.metadata->>'accepted_win', '')) ~ '^[+-]?[0-9]+(\.[0-9]+)?$'
        then (e.metadata->>'accepted_win')::numeric
        else null
      end,
      e.amount,
      0
    ), 0)), 0) as amount
  from closing_periods cp
  left join public.device_metric_events e
    on e.device_id = cp.device_id
   and e.counts_toward_global is true
   and e.event_type = 'win'
   and lower(trim(coalesce(e.metadata->>'winFundingSource', ''))) = 'device_happy_override'
   and e.event_ts > cp.period_start
   and e.event_ts <= cp.period_end
  group by cp.id
)
update public.device_revenue_closings c
set metadata =
  coalesce(c.metadata, '{}'::jsonb)
  || jsonb_build_object(
    'manualJackpotOverride',
    coalesce(m.amount, 0),
    'happyOverride',
    coalesce(h.amount, 0),
    'overrideBreakdownBackfilledAt',
    now()
  )
from manual_jackpot_overrides m
join happy_overrides h on h.id = m.id
where c.id = m.id;

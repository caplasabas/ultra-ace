create or replace function public.dashboard_admin_rtp_totals()
returns table (
  device_id text,
  bet numeric,
  win numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with latest_closing as (
    select distinct on (c.device_id)
      c.device_id,
      c.closed_at
    from public.device_revenue_closings c
    order by c.device_id, c.closed_at desc, c.id desc
  )
  select
    e.device_id,
    coalesce(sum(
      case
        when e.event_type = 'spin'
          and coalesce(e.amount, 0) > 0
          and lower(trim(coalesce(e.metadata->>'triggerType', ''))) <> 'buy'
          and lower(trim(coalesce(e.metadata->>'isFreeGame', 'false'))) not in ('true', 't', '1', 'yes')
        then e.amount
        else 0
      end
    ), 0) as bet,
    coalesce(sum(
      case
        when e.event_type = 'win'
          and lower(trim(coalesce(e.metadata->>'winFundingSource', ''))) not in (
            'happy_prize_pool',
            'device_happy_override'
          )
          and lower(trim(coalesce(e.metadata->>'triggerType', ''))) <> 'buy'
          and lower(trim(coalesce(e.metadata->>'isFreeGame', 'false'))) not in ('true', 't', '1', 'yes')
          and lower(trim(coalesce(e.metadata->>'jackpotCampaignPayout', 'false'))) not in ('true', 't', '1', 'yes')
          and (
            case
              when trim(coalesce(e.metadata->>'jackpotPayout', '')) ~ '^[+-]?[0-9]+(\.[0-9]+)?$'
              then (e.metadata->>'jackpotPayout')::numeric
              else 0
            end
          ) <= 0
          and (
            case
              when trim(coalesce(e.metadata->>'jackpot_payout', '')) ~ '^[+-]?[0-9]+(\.[0-9]+)?$'
              then (e.metadata->>'jackpot_payout')::numeric
              else 0
            end
          ) <= 0
        then greatest(
          coalesce(
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
          ),
          0
        )
        else 0
      end
    ), 0) as win
  from public.device_metric_events e
  join public.devices d on d.device_id = e.device_id
  left join latest_closing lc on lc.device_id = e.device_id
  where e.counts_toward_global is true
    and e.event_type in ('spin', 'win')
    and e.event_ts > coalesce(lc.closed_at, '-infinity'::timestamp with time zone)
  group by e.device_id;
$$;

alter function public.dashboard_admin_rtp_totals() owner to postgres;
grant all on function public.dashboard_admin_rtp_totals() to anon;
grant all on function public.dashboard_admin_rtp_totals() to authenticated;
grant all on function public.dashboard_admin_rtp_totals() to service_role;

create or replace function public.dashboard_override_totals()
returns table (
  manual_jackpot_total numeric,
  manual_jackpot_remaining numeric,
  manual_jackpot_count bigint,
  happy_override_total numeric,
  happy_override_remaining numeric,
  happy_override_count bigint
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with latest_closing as (
    select distinct on (c.device_id)
      c.device_id,
      c.closed_at
    from public.device_revenue_closings c
    order by c.device_id, c.closed_at desc, c.id desc
  ),
  manual_jackpot as (
    select
      coalesce(sum(q.target_amount), 0) as total,
      coalesce(sum(q.remaining_amount), 0) as remaining,
      count(*) as count
    from public.jackpot_payout_queue q
    join public.jackpot_pots jp on jp.id = q.jackpot_pot_id
    left join latest_closing lc on lc.device_id = q.device_id
    where coalesce(jp.goal_snapshot->>'source', '') = 'dashboard_device_override'
      and (
        q.completed_at is null
        or q.completed_at > coalesce(lc.closed_at, '-infinity'::timestamp with time zone)
      )
  ),
  happy_override as (
    select
      coalesce(sum(greatest(coalesce(d.happy_override_target_amount, 0), 0)), 0) as total,
      coalesce(sum(greatest(coalesce(d.happy_override_remaining_amount, 0), 0)), 0) as remaining,
      count(*) filter (
        where coalesce(d.happy_override_selected, false)
          and coalesce(d.happy_override_remaining_amount, 0) > 0
      ) as count
    from public.devices d
    where coalesce(d.happy_override_selected, false)
      and coalesce(d.happy_override_remaining_amount, 0) > 0
  )
  select
    manual_jackpot.total,
    manual_jackpot.remaining,
    manual_jackpot.count,
    happy_override.total,
    happy_override.remaining,
    happy_override.count
  from manual_jackpot, happy_override;
$$;

alter function public.dashboard_override_totals() owner to postgres;
grant all on function public.dashboard_override_totals() to anon;
grant all on function public.dashboard_override_totals() to authenticated;
grant all on function public.dashboard_override_totals() to service_role;

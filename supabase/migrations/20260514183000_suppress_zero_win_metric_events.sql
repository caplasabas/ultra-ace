create or replace function public.suppress_zero_win_metric_events()
returns trigger
language plpgsql
as $$
begin
  if lower(coalesce(new.event_type, '')) = 'win'
    and greatest(coalesce(new.amount, 0), 0) <= 0 then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists suppress_zero_win_metric_events_before_insert
  on public.device_metric_events;

create trigger suppress_zero_win_metric_events_before_insert
before insert on public.device_metric_events
for each row
execute function public.suppress_zero_win_metric_events();


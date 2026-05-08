create or replace function public.coerce_casino_device_presence_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_recent_bet boolean := false;
begin
  if coalesce(nullif(trim(new.current_game_type), ''), '') <> 'casino' then
    return new;
  end if;

  if coalesce(nullif(trim(new.device_status), ''), 'offline') not in ('idle', 'playing') then
    return new;
  end if;

  v_recent_bet := new.last_bet_at is not null
    and new.last_bet_at >= now() - interval '2 minutes';

  if v_recent_bet
    and new.last_seen_at is not null
    and new.last_seen_at >= now() - interval '90 seconds'
  then
    new.device_status := 'playing';
  elsif new.device_status = 'playing' and not v_recent_bet then
    new.device_status := 'idle';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_coerce_casino_device_presence_status on public.devices;

create trigger trg_coerce_casino_device_presence_status
before insert or update of device_status, current_game_type, last_bet_at, last_seen_at
on public.devices
for each row
execute function public.coerce_casino_device_presence_status();

update public.devices
set
  device_status = 'idle',
  updated_at = now()
where device_status = 'playing'
  and current_game_type = 'casino'
  and (last_bet_at is null or last_bet_at < now() - interval '2 minutes');

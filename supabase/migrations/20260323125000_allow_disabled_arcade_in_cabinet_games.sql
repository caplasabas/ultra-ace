create or replace function public.prevent_install_if_disabled()
returns trigger
language plpgsql
as $$
declare
  game_row public.games;
begin
  if new.installed = true then
    select *
    into game_row
    from public.games
    where id = new.game_id;

    if found and game_row.enabled = false and game_row.type = 'casino' then
      raise exception 'Cannot install disabled game';
    end if;
  end if;

  return new;
end;
$$;

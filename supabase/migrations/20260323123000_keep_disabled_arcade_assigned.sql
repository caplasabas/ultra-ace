create or replace function public.disable_game_from_cabinets()
returns trigger
language plpgsql
as $$
begin
  if old.enabled = true and new.enabled = false and new.type = 'casino' then
    update public.cabinet_games
    set installed = false
    where game_id = new.id;
  end if;

  return new;
end;
$$;

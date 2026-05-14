create or replace function public.update_device_game_state(
  p_device_id text,
  p_session_id bigint default null,
  p_state jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_runtime_mode text;
  v_is_free_game boolean;
  v_free_spins_left integer;
  v_pending_free_spins integer;
  v_show_intro boolean;
  v_current_spin_id bigint;
  v_game_type text := nullif(trim(coalesce(p_state->>'gameType', '')), '');
  v_mark_active boolean := coalesce((p_state->>'markActive')::boolean, true);
  v_preserve_device_status boolean := coalesce((p_state->>'preserveDeviceStatus')::boolean, false);
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  v_runtime_mode := nullif(trim(coalesce(p_state->>'runtimeMode', '')), '');
  v_is_free_game := case when p_state ? 'isFreeGame' then coalesce((p_state->>'isFreeGame')::boolean, false) else null end;
  v_free_spins_left := case when p_state ? 'freeSpinsLeft' then greatest(0, coalesce((p_state->>'freeSpinsLeft')::integer, 0)) else null end;
  v_pending_free_spins := case when p_state ? 'pendingFreeSpins' then greatest(0, coalesce((p_state->>'pendingFreeSpins')::integer, 0)) else null end;
  v_show_intro := case when p_state ? 'showFreeSpinIntro' then coalesce((p_state->>'showFreeSpinIntro')::boolean, false) else null end;
  v_current_spin_id := case when p_state ? 'spinId' then greatest(0, coalesce((p_state->>'spinId')::bigint, 0)) else null end;

  update public.devices
  set
    device_status = case when v_preserve_device_status then device_status else 'playing' end,
    active_session_id = case
      when v_preserve_device_status then active_session_id
      else coalesce(p_session_id, active_session_id)
    end,
    session_last_heartbeat = case
      when v_preserve_device_status then session_last_heartbeat
      else now()
    end,
    runtime_mode = coalesce(v_runtime_mode, runtime_mode),
    current_game_type = case
      when v_game_type in ('arcade', 'casino') then v_game_type
      else current_game_type
    end,
    is_free_game = coalesce(v_is_free_game, is_free_game),
    free_spins_left = coalesce(v_free_spins_left, free_spins_left),
    pending_free_spins = coalesce(v_pending_free_spins, pending_free_spins),
    show_free_spin_intro = coalesce(v_show_intro, show_free_spin_intro),
    current_spin_id = coalesce(v_current_spin_id, current_spin_id),
    session_metadata = case
      when v_preserve_device_status then coalesce(session_metadata, '{}'::jsonb) || coalesce(p_state, '{}'::jsonb)
      else coalesce(p_state, '{}'::jsonb)
    end,
    last_seen_at = now(),
    last_activity_at = case
      when v_preserve_device_status then last_activity_at
      when v_mark_active then now()
      else last_activity_at
    end,
    updated_at = now()
  where device_id = p_device_id;

  if p_session_id is not null and not v_preserve_device_status then
    update public.device_game_sessions
    set
      last_heartbeat = now(),
      last_state = coalesce(p_state, '{}'::jsonb),
      updated_at = now()
    where id = p_session_id;
  end if;
end;
$$;

alter function public.update_device_game_state(text, bigint, jsonb) owner to postgres;
grant all on function public.update_device_game_state(text, bigint, jsonb) to anon;
grant all on function public.update_device_game_state(text, bigint, jsonb) to authenticated;
grant all on function public.update_device_game_state(text, bigint, jsonb) to service_role;


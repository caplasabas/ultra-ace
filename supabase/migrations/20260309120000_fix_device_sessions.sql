-- Minimal patch: only missing device session/status objects + grants.
-- Safe to run multiple times.

create sequence if not exists public.device_game_sessions_id_seq;

create table if not exists public.device_game_sessions (
                                                           id bigint not null default nextval('public.device_game_sessions_id_seq'::regclass) primary key,
                                                           device_id text not null references public.devices(device_id) on delete cascade,
    game_id text not null,
    game_name text,
    status text not null default 'active' check (status in ('active', 'ended')),
    started_at timestamptz not null default now(),
    ended_at timestamptz,
    last_heartbeat timestamptz not null default now(),
    last_state jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
    );

alter sequence public.device_game_sessions_id_seq
    owned by public.device_game_sessions.id;

create index if not exists idx_device_game_sessions_device_started
    on public.device_game_sessions (device_id, started_at desc);

create index if not exists idx_device_game_sessions_status
    on public.device_game_sessions (status, last_heartbeat desc);

create or replace function public.start_device_game_session(
  p_device_id text,
  p_game_id text,
  p_game_name text default null,
  p_runtime_mode text default null,
  p_state jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
v_session_id bigint;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
end if;

  if p_game_id is null or trim(p_game_id) = '' then
    raise exception 'p_game_id is required';
end if;

insert into public.devices (device_id)
values (p_device_id)
    on conflict (device_id) do nothing;

update public.device_game_sessions
set
    status = 'ended',
    ended_at = now(),
    updated_at = now()
where device_id = p_device_id and status = 'active';

insert into public.device_game_sessions (
    device_id,
    game_id,
    game_name,
    status,
    started_at,
    last_heartbeat,
    last_state,
    updated_at
)
values (
           p_device_id,
           p_game_id,
           p_game_name,
           'active',
           now(),
           now(),
           coalesce(p_state, '{}'::jsonb),
           now()
       )
    returning id into v_session_id;

update public.devices
set
    current_game_id = p_game_id,
    current_game_name = p_game_name,
    device_status = 'playing',
    active_session_id = v_session_id,
    session_started_at = now(),
    session_last_heartbeat = now(),
    session_ended_at = null,
    runtime_mode = coalesce(p_runtime_mode, runtime_mode),
    session_metadata = coalesce(p_state, '{}'::jsonb),
    updated_at = now()
where device_id = p_device_id;

return v_session_id;
end;
$$;

create or replace function public.update_device_game_state(
  p_device_id text,
  p_session_id bigint default null,
  p_state jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
v_runtime_mode text;
  v_is_free_game boolean;
  v_free_spins_left integer;
  v_pending_free_spins integer;
  v_show_intro boolean;
  v_current_spin_id bigint;
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
    device_status = 'playing',
    active_session_id = coalesce(p_session_id, active_session_id),
    session_last_heartbeat = now(),
    runtime_mode = coalesce(v_runtime_mode, runtime_mode),
    is_free_game = coalesce(v_is_free_game, is_free_game),
    free_spins_left = coalesce(v_free_spins_left, free_spins_left),
    pending_free_spins = coalesce(v_pending_free_spins, pending_free_spins),
    show_free_spin_intro = coalesce(v_show_intro, show_free_spin_intro),
    current_spin_id = coalesce(v_current_spin_id, current_spin_id),
    session_metadata = coalesce(p_state, '{}'::jsonb),
    updated_at = now()
where device_id = p_device_id;

if p_session_id is not null then
update public.device_game_sessions
set
    last_heartbeat = now(),
    last_state = coalesce(p_state, '{}'::jsonb),
    updated_at = now()
where id = p_session_id;
end if;
end;
$$;

create or replace function public.end_device_game_session(
  p_device_id text,
  p_session_id bigint default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
end if;

update public.device_game_sessions
set
    status = 'ended',
    ended_at = now(),
    updated_at = now()
where device_id = p_device_id
  and (p_session_id is null or id = p_session_id)
  and status = 'active';

update public.devices
set
    device_status = 'idle',
    active_session_id = null,
    session_last_heartbeat = now(),
    session_ended_at = now(),
    is_free_game = false,
    free_spins_left = 0,
    pending_free_spins = 0,
    show_free_spin_intro = false,
    current_spin_id = 0,
    session_metadata = jsonb_build_object(
            'endReason', coalesce(p_reason, 'unknown'),
            'endedAt', now()
                       ),
    updated_at = now()
where device_id = p_device_id;
end;
$$;

grant execute on function public.start_device_game_session(text, text, text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.update_device_game_state(text, bigint, jsonb) to anon, authenticated, service_role;
grant execute on function public.end_device_game_session(text, bigint, text) to anon, authenticated, service_role;

-- Per-device remote admin controls (restart / shutdown) from dashboard.

create table if not exists public.device_admin_commands (
  id bigserial primary key,
  device_id text not null,
  command text not null check (command in ('restart', 'shutdown')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  reason text null,
  requested_by text null,
  requested_at timestamptz not null default now(),
  processed_at timestamptz null,
  completed_at timestamptz null,
  error text null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_device_admin_commands_device_status
  on public.device_admin_commands (device_id, status, requested_at desc);

create index if not exists idx_device_admin_commands_status_requested
  on public.device_admin_commands (status, requested_at asc);

drop trigger if exists device_admin_commands_set_updated_at on public.device_admin_commands;
create trigger device_admin_commands_set_updated_at
before update on public.device_admin_commands
for each row execute function public.set_updated_at();

alter table public.device_admin_commands enable row level security;

drop policy if exists "device_admin_commands_select" on public.device_admin_commands;
create policy "device_admin_commands_select"
  on public.device_admin_commands
  for select
  using (true);

drop policy if exists "device_admin_commands_insert" on public.device_admin_commands;
create policy "device_admin_commands_insert"
  on public.device_admin_commands
  for insert
  with check (true);

drop policy if exists "device_admin_commands_update" on public.device_admin_commands;
create policy "device_admin_commands_update"
  on public.device_admin_commands
  for update
  using (true)
  with check (true);

create or replace function public.enqueue_device_admin_command(
  p_device_id text,
  p_command text,
  p_reason text default null,
  p_requested_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_id text := trim(coalesce(p_device_id, ''));
  v_command text := lower(trim(coalesce(p_command, '')));
  v_row public.device_admin_commands;
begin
  if v_device_id = '' then
    raise exception 'p_device_id is required';
  end if;

  if v_command not in ('restart', 'shutdown') then
    raise exception 'Unsupported command: %', v_command;
  end if;

  select * into v_row
  from public.device_admin_commands c
  where c.device_id = v_device_id
    and c.command = v_command
    and c.status in ('queued', 'processing')
  order by c.id desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'deduped', true,
      'id', v_row.id,
      'device_id', v_row.device_id,
      'command', v_row.command,
      'status', v_row.status
    );
  end if;

  insert into public.device_admin_commands (
    device_id,
    command,
    status,
    reason,
    requested_by,
    requested_at,
    created_at,
    updated_at
  )
  values (
    v_device_id,
    v_command,
    'queued',
    nullif(trim(coalesce(p_reason, '')), ''),
    nullif(trim(coalesce(p_requested_by, '')), ''),
    now(),
    now(),
    now()
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'deduped', false,
    'id', v_row.id,
    'device_id', v_row.device_id,
    'command', v_row.command,
    'status', v_row.status
  );
end;
$$;

grant execute on function public.enqueue_device_admin_command(text, text, text, text) to anon;
grant execute on function public.enqueue_device_admin_command(text, text, text, text) to authenticated;
grant execute on function public.enqueue_device_admin_command(text, text, text, text) to service_role;

grant select, insert, update on table public.device_admin_commands to anon;
grant select, insert, update on table public.device_admin_commands to authenticated;
grant select, insert, update on table public.device_admin_commands to service_role;

grant usage, select on sequence public.device_admin_commands_id_seq to anon;
grant usage, select on sequence public.device_admin_commands_id_seq to authenticated;
grant usage, select on sequence public.device_admin_commands_id_seq to service_role;

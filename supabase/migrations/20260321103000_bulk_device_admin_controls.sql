-- Extend admin device controls with bulk actions and reset support.

create table if not exists public.device_admin_ledger_entries (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  device_id text not null references public.devices(device_id) on delete cascade,
  target text not null check (target in ('accounting_balance', 'hopper_balance')),
  entry_kind text not null check (entry_kind in ('debit', 'credit')),
  amount numeric not null check (amount > 0),
  account_name text not null,
  notes text null,
  balance_before numeric not null,
  balance_after numeric not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_device_admin_ledger_entries_device_time
  on public.device_admin_ledger_entries (device_id, created_at desc);

alter table public.device_admin_commands
  drop constraint if exists device_admin_commands_command_check;

alter table public.device_admin_commands
  add constraint device_admin_commands_command_check
  check (command in ('restart', 'shutdown', 'reset'));

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

  if v_command not in ('restart', 'shutdown', 'reset') then
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

create or replace function public.enqueue_bulk_device_admin_command(
  p_command text,
  p_device_ids text[] default null,
  p_reason text default null,
  p_requested_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_command text := lower(trim(coalesce(p_command, '')));
  v_device_ids text[];
  v_device_id text;
  v_result jsonb;
  v_target_count integer := 0;
  v_queued_count integer := 0;
  v_deduped_count integer := 0;
begin
  if v_command not in ('restart', 'shutdown', 'reset') then
    raise exception 'Unsupported command: %', v_command;
  end if;

  select coalesce(array_agg(d.device_id order by d.device_id), array[]::text[])
  into v_device_ids
  from (
    select distinct trim(device_id) as device_id
    from public.devices
    where trim(coalesce(device_id, '')) <> ''
      and (
        coalesce(array_length(p_device_ids, 1), 0) = 0
        or device_id = any(p_device_ids)
      )
  ) d;

  v_target_count := coalesce(array_length(v_device_ids, 1), 0);

  if v_target_count = 0 then
    raise exception 'No target devices found';
  end if;

  foreach v_device_id in array v_device_ids
  loop
    v_result := public.enqueue_device_admin_command(
      p_device_id := v_device_id,
      p_command := v_command,
      p_reason := p_reason,
      p_requested_by := p_requested_by
    );

    if coalesce((v_result->>'deduped')::boolean, false) then
      v_deduped_count := v_deduped_count + 1;
    else
      v_queued_count := v_queued_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'command', v_command,
    'target_count', v_target_count,
    'queued_count', v_queued_count,
    'deduped_count', v_deduped_count
  );
end;
$$;

create or replace function public.post_device_admin_ledger_entry(
  p_device_id text,
  p_target text,
  p_entry_kind text,
  p_amount numeric,
  p_account_name text,
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.devices;
  v_before numeric := 0;
  v_after numeric := 0;
  v_applied numeric := 0;
  v_target text := lower(trim(coalesce(p_target, '')));
  v_kind text := lower(trim(coalesce(p_entry_kind, '')));
  v_requested numeric := greatest(coalesce(p_amount, 0), 0);
begin
  if coalesce(trim(p_device_id), '') = '' then
    raise exception 'p_device_id is required';
  end if;

  if v_target not in ('accounting_balance', 'hopper_balance') then
    raise exception 'unsupported target: %', p_target;
  end if;

  if v_kind not in ('debit', 'credit') then
    raise exception 'unsupported entry kind: %', p_entry_kind;
  end if;

  if v_requested <= 0 then
    raise exception 'amount must be > 0';
  end if;

  if coalesce(trim(p_account_name), '') = '' then
    raise exception 'account_name is required';
  end if;

  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  select *
  into v_device
  from public.devices
  where device_id = p_device_id
  for update;

  if v_target = 'accounting_balance' then
    v_before := greatest(coalesce(v_device.balance, 0), 0);
  else
    v_before := greatest(coalesce(v_device.hopper_balance, 0), 0);
  end if;

  if v_kind = 'credit' then
    v_applied := v_requested;
    v_after := v_before + v_applied;
  else
    v_applied := least(v_requested, v_before);
    v_after := greatest(0, v_before - v_applied);
  end if;

  if v_target = 'accounting_balance' then
    update public.devices
    set
      balance = v_after,
      updated_at = now()
    where device_id = p_device_id;
  else
    update public.devices
    set
      hopper_balance = v_after,
      updated_at = now()
    where device_id = p_device_id;
  end if;

  insert into public.device_admin_ledger_entries (
    device_id,
    target,
    entry_kind,
    amount,
    account_name,
    notes,
    balance_before,
    balance_after,
    metadata
  )
  values (
    p_device_id,
    v_target,
    v_kind,
    v_applied,
    trim(p_account_name),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_before,
    v_after,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('requested_amount', v_requested)
  );

  return jsonb_build_object(
    'ok', true,
    'device_id', p_device_id,
    'target', v_target,
    'entry_kind', v_kind,
    'amount', v_applied,
    'before', v_before,
    'after', v_after
  );
end;
$$;

create or replace function public.post_bulk_device_admin_ledger_entry(
  p_target text,
  p_entry_kind text,
  p_amount numeric,
  p_account_name text,
  p_device_ids text[] default null,
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target text := lower(trim(coalesce(p_target, '')));
  v_kind text := lower(trim(coalesce(p_entry_kind, '')));
  v_requested numeric := greatest(coalesce(p_amount, 0), 0);
  v_device_ids text[];
  v_device_id text;
  v_result jsonb;
  v_events jsonb;
  v_target_count integer := 0;
  v_processed_count integer := 0;
  v_total_applied numeric := 0;
begin
  if v_target not in ('accounting_balance', 'hopper_balance') then
    raise exception 'unsupported target: %', p_target;
  end if;

  if v_kind not in ('debit', 'credit') then
    raise exception 'unsupported entry kind: %', p_entry_kind;
  end if;

  if v_requested <= 0 then
    raise exception 'amount must be > 0';
  end if;

  if coalesce(trim(p_account_name), '') = '' then
    raise exception 'account_name is required';
  end if;

  select coalesce(array_agg(d.device_id order by d.device_id), array[]::text[])
  into v_device_ids
  from (
    select distinct trim(device_id) as device_id
    from public.devices
    where trim(coalesce(device_id, '')) <> ''
      and (
        coalesce(array_length(p_device_ids, 1), 0) = 0
        or device_id = any(p_device_ids)
      )
  ) d;

  v_target_count := coalesce(array_length(v_device_ids, 1), 0);

  if v_target_count = 0 then
    raise exception 'No target devices found';
  end if;

  if v_target = 'accounting_balance' and v_kind = 'credit' then
    select jsonb_agg(
      jsonb_build_object(
        'device_id', item.device_id,
        'event_type', 'coins_in',
        'amount', v_requested,
        'event_ts', now(),
        'metadata', coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
          'source', 'dashboard_global_controls',
          'target', v_target,
          'entry_kind', v_kind,
          'account_name', trim(p_account_name),
          'notes', nullif(trim(coalesce(p_notes, '')), '')
        )
      )
    )
    into v_events
    from unnest(v_device_ids) as item(device_id);

    perform public.apply_metric_events(v_events, true);

    v_processed_count := v_target_count;
    v_total_applied := v_requested * v_target_count;
  else
    foreach v_device_id in array v_device_ids
    loop
      v_result := public.post_device_admin_ledger_entry(
        p_device_id := v_device_id,
        p_target := v_target,
        p_entry_kind := v_kind,
        p_amount := v_requested,
        p_account_name := p_account_name,
        p_notes := p_notes,
        p_metadata := p_metadata
      );

      v_processed_count := v_processed_count + 1;
      v_total_applied := v_total_applied + coalesce((v_result->>'amount')::numeric, 0);
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'target', v_target,
    'entry_kind', v_kind,
    'target_count', v_target_count,
    'processed_count', v_processed_count,
    'amount_per_device', v_requested,
    'total_applied', v_total_applied
  );
end;
$$;

grant execute on function public.enqueue_device_admin_command(text, text, text, text) to anon;
grant execute on function public.enqueue_device_admin_command(text, text, text, text) to authenticated;
grant execute on function public.enqueue_device_admin_command(text, text, text, text) to service_role;

grant execute on function public.enqueue_bulk_device_admin_command(text, text[], text, text) to anon;
grant execute on function public.enqueue_bulk_device_admin_command(text, text[], text, text) to authenticated;
grant execute on function public.enqueue_bulk_device_admin_command(text, text[], text, text) to service_role;

grant execute on function public.post_device_admin_ledger_entry(text, text, text, numeric, text, text, jsonb) to anon;
grant execute on function public.post_device_admin_ledger_entry(text, text, text, numeric, text, text, jsonb) to authenticated;
grant execute on function public.post_device_admin_ledger_entry(text, text, text, numeric, text, text, jsonb) to service_role;

grant execute on function public.post_bulk_device_admin_ledger_entry(text, text, numeric, text, text[], text, jsonb) to anon;
grant execute on function public.post_bulk_device_admin_ledger_entry(text, text, numeric, text, text[], text, jsonb) to authenticated;
grant execute on function public.post_bulk_device_admin_ledger_entry(text, text, numeric, text, text[], text, jsonb) to service_role;

grant select, insert on table public.device_admin_ledger_entries to anon;
grant select, insert on table public.device_admin_ledger_entries to authenticated;
grant select, insert on table public.device_admin_ledger_entries to service_role;

grant usage, select on sequence public.device_admin_ledger_entries_id_seq to anon;
grant usage, select on sequence public.device_admin_ledger_entries_id_seq to authenticated;
grant usage, select on sequence public.device_admin_ledger_entries_id_seq to service_role;

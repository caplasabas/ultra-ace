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


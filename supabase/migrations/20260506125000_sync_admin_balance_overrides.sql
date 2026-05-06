create or replace function public.sync_admin_accounting_balance_override()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.target = 'accounting_balance' then
    update public.devices
    set
      balance = greatest(coalesce(new.balance_after, 0), 0),
      updated_at = now()
    where device_id = new.device_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_admin_accounting_balance_override on public.device_admin_ledger_entries;

create trigger trg_sync_admin_accounting_balance_override
after insert on public.device_admin_ledger_entries
for each row
execute function public.sync_admin_accounting_balance_override();

update public.devices d
set
  balance = greatest(coalesce(s.balance, 0), 0),
  updated_at = now()
from public.device_stats_live s
where s.device_id = d.device_id
  and coalesce(d.balance, 0) <> greatest(coalesce(s.balance, 0), 0);

alter function public.sync_admin_accounting_balance_override() owner to postgres;

grant all on function public.sync_admin_accounting_balance_override() to anon;
grant all on function public.sync_admin_accounting_balance_override() to authenticated;
grant all on function public.sync_admin_accounting_balance_override() to service_role;

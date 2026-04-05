drop extension if exists "pg_net";


  create table "public"."agents" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."areas" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "agent_id" uuid not null,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."devices" add column "agent_id" uuid;

alter table "public"."devices" add column "area_id" uuid;

alter table "public"."devices" add column "location_address" text;

alter table "public"."devices" add column "station" text;

CREATE UNIQUE INDEX agents_name_key ON public.agents USING btree (name);

CREATE UNIQUE INDEX agents_pkey ON public.agents USING btree (id);

CREATE UNIQUE INDEX areas_agent_id_name_key ON public.areas USING btree (agent_id, name);

CREATE UNIQUE INDEX areas_pkey ON public.areas USING btree (id);

CREATE INDEX idx_devices_agent_id ON public.devices USING btree (agent_id);

CREATE INDEX idx_devices_area_id ON public.devices USING btree (area_id);

alter table "public"."agents" add constraint "agents_pkey" PRIMARY KEY using index "agents_pkey";

alter table "public"."areas" add constraint "areas_pkey" PRIMARY KEY using index "areas_pkey";

alter table "public"."agents" add constraint "agents_name_key" UNIQUE using index "agents_name_key";

alter table "public"."areas" add constraint "areas_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE RESTRICT not valid;

alter table "public"."areas" validate constraint "areas_agent_id_fkey";

alter table "public"."areas" add constraint "areas_agent_id_name_key" UNIQUE using index "areas_agent_id_name_key";

alter table "public"."devices" add constraint "devices_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL not valid;

alter table "public"."devices" validate constraint "devices_agent_id_fkey";

alter table "public"."devices" add constraint "devices_area_id_fkey" FOREIGN KEY (area_id) REFERENCES public.areas(id) ON DELETE SET NULL not valid;

alter table "public"."devices" validate constraint "devices_area_id_fkey";

set check_function_bodies = off;

create or replace view "public"."devices_with_location" as  SELECT d.id,
    d.device_id,
    d.name,
    d.created_at,
    d.updated_at,
    d.balance,
    d.coins_in_total,
    d.hopper_balance,
    d.hopper_in_total,
    d.hopper_out_total,
    d.bet_total,
    d.win_total,
    d.withdraw_total,
    d.spins_total,
    d.prize_pool_contrib_total,
    d.prize_pool_paid_total,
    d.current_game_id,
    d.current_game_name,
    d.device_status,
    d.active_session_id,
    d.session_started_at,
    d.session_last_heartbeat,
    d.session_ended_at,
    d.runtime_mode,
    d.is_free_game,
    d.free_spins_left,
    d.pending_free_spins,
    d.show_free_spin_intro,
    d.current_spin_id,
    d.session_metadata,
    d.house_take_total,
    d.last_bet_amount,
    d.last_bet_at,
    d.jackpot_contrib_total,
    d.jackpot_win_total,
    d.arcade_shell_version,
    d.current_ip,
    d.agent_id,
    d.area_id,
    d.station,
    d.location_address,
    a.name AS agent_name,
    ar.name AS area_name
   FROM ((public.devices d
     LEFT JOIN public.agents a ON ((a.id = d.agent_id)))
     LEFT JOIN public.areas ar ON ((ar.id = d.area_id)));


CREATE OR REPLACE FUNCTION public.sync_device_agent_from_area()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.area_id is not null then
    select agent_id into new.agent_id
    from public.areas where id = new.area_id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_device_area_agent()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_area_agent uuid;
begin
  if new.area_id is not null then
    select agent_id into v_area_agent
    from public.areas where id = new.area_id;

    if new.agent_id is not null and v_area_agent <> new.agent_id then
      raise exception 'Area does not belong to Agent';
    end if;
  end if;

  return new;
end;
$function$
;

grant delete on table "public"."agents" to "anon";

grant insert on table "public"."agents" to "anon";

grant references on table "public"."agents" to "anon";

grant select on table "public"."agents" to "anon";

grant trigger on table "public"."agents" to "anon";

grant truncate on table "public"."agents" to "anon";

grant update on table "public"."agents" to "anon";

grant delete on table "public"."agents" to "authenticated";

grant insert on table "public"."agents" to "authenticated";

grant references on table "public"."agents" to "authenticated";

grant select on table "public"."agents" to "authenticated";

grant trigger on table "public"."agents" to "authenticated";

grant truncate on table "public"."agents" to "authenticated";

grant update on table "public"."agents" to "authenticated";

grant delete on table "public"."agents" to "service_role";

grant insert on table "public"."agents" to "service_role";

grant references on table "public"."agents" to "service_role";

grant select on table "public"."agents" to "service_role";

grant trigger on table "public"."agents" to "service_role";

grant truncate on table "public"."agents" to "service_role";

grant update on table "public"."agents" to "service_role";

grant delete on table "public"."areas" to "anon";

grant insert on table "public"."areas" to "anon";

grant references on table "public"."areas" to "anon";

grant select on table "public"."areas" to "anon";

grant trigger on table "public"."areas" to "anon";

grant truncate on table "public"."areas" to "anon";

grant update on table "public"."areas" to "anon";

grant delete on table "public"."areas" to "authenticated";

grant insert on table "public"."areas" to "authenticated";

grant references on table "public"."areas" to "authenticated";

grant select on table "public"."areas" to "authenticated";

grant trigger on table "public"."areas" to "authenticated";

grant truncate on table "public"."areas" to "authenticated";

grant update on table "public"."areas" to "authenticated";

grant delete on table "public"."areas" to "service_role";

grant insert on table "public"."areas" to "service_role";

grant references on table "public"."areas" to "service_role";

grant select on table "public"."areas" to "service_role";

grant trigger on table "public"."areas" to "service_role";

grant truncate on table "public"."areas" to "service_role";

grant update on table "public"."areas" to "service_role";

CREATE TRIGGER trg_sync_device_agent BEFORE INSERT OR UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.sync_device_agent_from_area();

CREATE TRIGGER trg_validate_device_area_agent BEFORE INSERT OR UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.validate_device_area_agent();


  create policy "public read game packages"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'game-packages'::text));




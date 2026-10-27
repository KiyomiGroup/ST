-- SCRATCH ONLY: minimal stand-ins for the parts of the owner's Supabase project that 4B-2 touches.
-- Reconstructed from the earlier SQL files and handoffs (the exported schema file was not in this
-- session's zips). It is NOT the real schema. Signatures match the owner's introspect export.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$; do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$; do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth; create schema storage;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
create table auth.users (id uuid primary key, aud text, role text, email text, banned_until timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'sub','')::uuid $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create table public.users (id uuid primary key, name text, role text, profile_details jsonb, whatsapp text, dob date);
create table public.taskers (id text primary key, user_id text, name text, phone text, whatsapp text, available boolean, created_at text, profile_details jsonb,
  service text, service_name text, category text, rate_value numeric, price numeric, rate_unit text, rate text, location text, bio text, description text,
  specialties text[], availability_status text, is_verified boolean, verified boolean, photo_url text, photo text);
create table public.services (id uuid primary key default gen_random_uuid(), user_id uuid not null, service_name text, category text, price numeric, rate_unit text,
  description text, location text, specialties text[], availability_status text, available boolean, verified boolean, rating numeric, reviews_count int, photo text,
  created_at timestamptz not null default now());
create table public.task_applications (id uuid primary key default gen_random_uuid(), tasker_id uuid);
create table public.coordinators (user_id uuid primary key, display_name text, status text not null default 'pending');
create table public.coordinator_assignments (id uuid primary key default gen_random_uuid(), tasker_user_id uuid not null, coordinator_id uuid not null, assigned_by uuid, assign_reason text, ended_at timestamptz, end_reason text);
create table public.local_tasker_profiles (tasker_user_id uuid primary key, taskers_row_id text, full_name text, phone text, areas_served text, skills text[] not null default '{}', availability_notes text,
  status text not null default 'draft', published_at timestamptz, published_by uuid, verification_method text, verified_at timestamptz, verified_by uuid, verification_notes text,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.local_tasker_consents (id uuid primary key default gen_random_uuid(), tasker_user_id uuid not null, purpose text not null, method text not null,
  recorded_by uuid, recorded_at timestamptz not null default now(), evidence_ref text, details text, revoked_at timestamptz, revoke_reason text);
create table public.local_tasker_audit_log (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), action text, entity text, entity_id text,
  before_data jsonb, after_data jsonb, actor_id uuid, actor_role text);

create function public.is_active_coordinator(p_user uuid) returns boolean language sql security definer as $$ select exists(select 1 from public.coordinators where user_id=p_user and status='active') $$;
create function public.is_active_coordinator() returns boolean language sql security definer as $$ select public.is_active_coordinator(auth.uid()) $$;
create function public.coordinator_manages_tasker(p_coordinator uuid, p_tasker uuid) returns boolean language sql security definer as $$
  select public.is_active_coordinator(p_coordinator) and exists(select 1 from public.coordinator_assignments a where a.tasker_user_id=p_tasker and a.coordinator_id=p_coordinator and a.ended_at is null) $$;
create function public.coordinator_manages_tasker(p_tasker uuid) returns boolean language sql security definer as $$ select public.coordinator_manages_tasker(auth.uid(), p_tasker) $$;
create function public.is_local_tasker_admin() returns boolean language sql security definer as $$ select false $$;
create function public.local_tasker_row_visible(p_user text) returns boolean language sql security definer as $$
  select not exists(select 1 from public.local_tasker_profiles where tasker_user_id::text=p_user and status<>'published')
      or public.coordinator_manages_tasker(p_user::uuid) or public.is_local_tasker_admin() $$;
create function public.local_tasker_audit(p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb, p_actor uuid) returns uuid language plpgsql security definer as $$
declare v uuid; begin insert into public.local_tasker_audit_log(action,entity,entity_id,before_data,after_data,actor_id,actor_role) values (p_action,p_entity,p_entity_id,p_before,p_after,p_actor,'coordinator') returning id into v; return v; end $$;
revoke all on function public.local_tasker_audit(text,text,text,jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.is_active_coordinator(), public.coordinator_manages_tasker(uuid), public.is_local_tasker_admin(), public.local_tasker_row_visible(text) to anon, authenticated, service_role;

-- storage (shape as in Supabase)
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql as $$ declare _parts text[]; begin select string_to_array(name,'/') into _parts; return _parts[1:array_length(_parts,1)-1]; end $$;
grant select, insert, update, delete on storage.objects to authenticated; grant select on storage.objects to anon; grant select on storage.buckets to authenticated, anon;
-- an existing owner policy, shaped like the owner's four app buckets (bucket-scoped)
create policy "app buckets insert" on storage.objects for insert to authenticated with check (bucket_id in ('post-images','profile-images','service-images','task-images'));
create policy "app buckets read" on storage.objects for select to anon, authenticated using (bucket_id in ('post-images','profile-images','service-images','task-images'));

create function public.local_tasker_identity_email(p_request uuid) returns text language sql immutable as $$ select 'lt-' || p_request::text || '@local-tasker.invalid' $$;
create function public.create_local_tasker(p_coordinator uuid, p_request uuid, p_tasker_user uuid, p_public_name text, p_full_name text, p_phone text, p_areas_served text,
  p_skills text[], p_availability_notes text, p_consent_method text, p_consent_evidence_ref text, p_consent_details text) returns jsonb language plpgsql security definer as $$
begin
  insert into public.local_tasker_profiles (tasker_user_id, full_name, phone, areas_served, skills, status) values (p_tasker_user, p_full_name, p_phone, p_areas_served, p_skills, 'draft');
  insert into public.users (id, name, role, profile_details) values (p_tasker_user, p_public_name, 'tasker', '{}');
  insert into public.taskers (id, user_id, name, available, created_at, profile_details) values ('t-' || p_tasker_user::text, p_tasker_user::text, p_public_name, false, now()::text, '{}');
  insert into public.coordinator_assignments (tasker_user_id, coordinator_id, assigned_by, assign_reason) values (p_tasker_user, p_coordinator, p_coordinator, 'Created by coordinator');
  insert into public.local_tasker_consents (tasker_user_id, purpose, method, recorded_by) values (p_tasker_user, 'profile', p_consent_method, p_coordinator);
  return jsonb_build_object('created', true);
end $$;
grant execute on function public.create_local_tasker(uuid,uuid,uuid,text,text,text,text,text[],text,text,text,text) to service_role;

-- the 2C trigger (shape read from the owner's export): Local Taskers cannot apply to customer tasks
create function public.local_tasker_block_applications() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.local_tasker_profiles where tasker_user_id = new.tasker_id) then
    raise exception 'Local Taskers cannot apply to customer tasks.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger lt_block_applications before insert on public.task_applications for each row execute function public.local_tasker_block_applications();

-- RLS stand-ins for 2C: open reads for visitors + the RESTRICTIVE hide-unpublished policies
alter table public.users enable row level security; alter table public.taskers enable row level security; alter table public.services enable row level security;
grant select on public.users, public.taskers, public.services to anon, authenticated; grant select, insert, update on public.users, public.taskers, public.services to service_role;
grant select, insert, update, delete on public.task_applications to authenticated;
create policy open_read_users on public.users for select to anon, authenticated using (true);
create policy open_read_taskers on public.taskers for select to anon, authenticated using (true);
create policy open_read_services on public.services for select to anon, authenticated using (true);
create policy lt_hide_unpublished_users on public.users as restrictive for select to anon, authenticated using (public.local_tasker_row_visible(id::text));
create policy lt_hide_unpublished_taskers on public.taskers as restrictive for select to anon, authenticated using (public.local_tasker_row_visible(user_id));
create policy lt_hide_unpublished_services on public.services as restrictive for select to anon, authenticated using (public.local_tasker_row_visible(user_id::text));
grant select, insert, update, delete on all tables in schema public to postgres;
grant select, insert, update on public.local_tasker_profiles, public.local_tasker_consents to service_role;

-- LOCAL STAND-INS ONLY (never run on Supabase). Run AFTER standin.sql. Adds imitations of the coordinator tables and of the three
-- existing admin_*_coordinator_* functions (their real bodies were NOT seen; these only imitate "returns a link / a code").
create function auth.role() returns text language sql stable as $$ select nullif(coalesce(current_setting('request.jwt.claim.role', true), ''), '') $$;
alter table auth.users add column if not exists last_sign_in_at timestamptz;
alter table public.users add column if not exists name text;
alter table public.coordinators add column if not exists display_name text;
alter table public.coordinators add column if not exists created_at timestamptz default now();
create table public.coordinator_tiers_state (coordinator_id uuid primary key, tier int default 1);
create function public.coordinator_capacity(p uuid) returns int language sql stable as $$ select 2 $$;   -- tiny capacity so the limit is easy to hit
create function public.is_active_coordinator(p uuid) returns boolean language sql stable security definer as $$ select exists (select 1 from public.coordinators c where c.user_id = p and c.status = 'active') $$;
create table public.local_tasker_profiles (tasker_user_id uuid primary key, full_name text, status text, areas_served text);
create table public.bookings (id uuid primary key default gen_random_uuid(), status text);
create table public.local_booking_state (booking_id uuid, coordinator_id uuid, tasker_user_id uuid);
create table public.coordinator_assignments (id uuid primary key default gen_random_uuid(), tasker_user_id uuid not null, coordinator_id uuid not null,
  previous_coordinator_id uuid, assigned_by uuid, assign_reason text, assigned_at timestamptz default now(), ended_at timestamptz, ended_by uuid, end_reason text);
create unique index on public.coordinator_assignments (tasker_user_id) where ended_at is null;
create function public.local_tasker_assignment_guard() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.coordinators c where c.user_id = new.coordinator_id and c.status = 'active') then
    raise exception 'coordinator not active' using hint = 'coordinator_not_active'; end if;
  if new.ended_at is null and (select count(*) from public.coordinator_assignments a where a.coordinator_id = new.coordinator_id and a.ended_at is null) >= public.coordinator_capacity(new.coordinator_id) then
    raise exception 'This coordinator has no free place on their plan.' using hint = 'coordinator_cap'; end if;
  return new; end $$;
create trigger coordinator_assignments_guard before insert on public.coordinator_assignments for each row execute function public.local_tasker_assignment_guard();
revoke all on public.coordinator_assignments from anon, authenticated; grant select on public.coordinator_assignments to authenticated;
create table public.lt_audit (id serial, action text, target text, old jsonb, new jsonb);
create function public.local_tasker_audit(a text, tt text, ti text, o jsonb, n jsonb, actor uuid) returns void language sql as $$ insert into public.lt_audit(action,target,old,new) values (a,ti,o,n) $$;
create table public.notes_sent (id serial, to_user uuid, title text);
create function public._notify(u uuid, k text, t text, b text, d jsonb) returns void language sql as $$ insert into public.notes_sent(to_user,title) values (u,t) $$;
create table public.coordinator_applications (id uuid primary key default gen_random_uuid(), full_name text, email text, phone text, whatsapp text, state text, city text,
  tasker_count int, area_sqm int, can_meet_taskers boolean, can_explain boolean, explain_text text, answers jsonb default '{}', status text default 'new',
  created_at timestamptz default now(), token_hash text, token_expires_at timestamptz, code text);
create table public.coordinator_codes (code text primary key, note text, expires_at timestamptz, used_by uuid, used_at timestamptz, application_id uuid);
create function public.admin_approve_coordinator_application(p_id uuid, p_days int default 7) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare t text := 'TOKEN-SECRET-' || p_id::text;
begin
  if not public._is_support() then raise exception 'Not allowed.'; end if;
  update public.coordinator_applications set status='approved', token_hash='hash-of-'||t, token_expires_at=now()+make_interval(days=>p_days) where id=p_id;
  return 'https://streettasker.com/coordinator-test.html?t=' || t; end $$;
create function public.admin_reject_coordinator_application(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public._is_support() then raise exception 'Not allowed.'; end if;
  update public.coordinator_applications set status='rejected' where id=p_id; end $$;
create function public.admin_create_coordinator_code(p_note text, p_days int default 30) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare c text := 'CODE-SECRET-123';
begin
  if not public._is_support() then raise exception 'Not allowed.'; end if;
  insert into public.coordinator_codes(code,note,expires_at) values (c,p_note,now()+make_interval(days=>p_days)); return c; end $$;

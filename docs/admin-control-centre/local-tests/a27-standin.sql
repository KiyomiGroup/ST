-- LOCAL STAND-INS ONLY (never run on Supabase). Just enough objects for sql/admin/a27-security-checks.sql on a scratch Postgres,
-- built so that SOME checks are meant to fail (so the test proves the check can see a problem), then fixed one by one.
drop schema if exists public cascade; create schema public;
drop schema if exists auth cascade; create schema auth;
drop schema if exists storage cascade; create schema storage;
drop schema if exists cron cascade; create schema cron;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
create table auth.users (id uuid primary key, last_sign_in_at timestamptz);
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text);
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create table cron.job (jobid serial primary key, jobname text, command text);
create table public.admin_users (user_id uuid primary key, display_name text, status text not null default 'active', created_by uuid, created_at timestamptz default now(), last_seen_at timestamptz, removed_at timestamptz);
create table public.admin_user_roles (user_id uuid, role_key text, primary key (user_id, role_key));
create table public.admin_audit_log (id bigint generated always as identity primary key, at timestamptz default now(), actor_id uuid, action text, outcome text not null default 'ok');
create table public.support_staff (user_id uuid primary key);
create table public.users (id uuid primary key, name text, dob date, whatsapp text, is_flagged boolean);
create table public.taskers (id uuid primary key, name text);
create table public.wallets (id uuid primary key, balance numeric);
create table public.payment_intents (id uuid primary key, purpose text check (purpose in ('booking','request','subscription','topup')), status text);
create table public.subscription_card_authorizations (id uuid primary key, authorization_code text);
create table public.verifications (id uuid primary key, id_number text);
-- a table with RLS off and a loose policy table
create table public.notes (id uuid primary key, body text);
alter table public.users enable row level security; alter table public.taskers enable row level security;
alter table public.wallets enable row level security; alter table public.payment_intents enable row level security;
alter table public.admin_users enable row level security; alter table public.admin_audit_log enable row level security;
alter table public.subscription_card_authorizations enable row level security; alter table public.verifications enable row level security;
alter table public.support_staff enable row level security; alter table public.admin_user_roles enable row level security;
create policy auth_read_users on public.users for select to authenticated using (true);
create policy anyone_write_taskers on public.taskers for update to anon using (true) with check (true);
-- grants (the badly set ones are deliberate)
grant select on public.users, public.taskers to authenticated;
grant select on public.wallets to anon;
grant select, update on public.wallets to authenticated;
grant truncate on public.notes to authenticated;
create view public.v_open as select * from public.users;
grant select on public.v_open to anon;
-- functions: one good, one bad of each kind
create function public.admin_has(p text) returns boolean language sql stable security definer set search_path = public as $$ select false $$;
revoke all on function public.admin_has(text) from public, anon, authenticated; grant execute on function public.admin_has(text) to authenticated;
create function public.admin_bad_public() returns int language sql security definer set search_path = public as $$ select 1 $$;     -- default PUBLIC execute
create function public.admin_bad_nopath() returns int language sql security definer as $$ select 1 $$;
revoke all on function public.admin_bad_nopath() from public, anon; grant execute on function public.admin_bad_nopath() to authenticated;
create function public.admin_not_definer() returns int language sql as $$ select 1 $$;
revoke all on function public.admin_not_definer() from public, anon; grant execute on function public.admin_not_definer() to authenticated;
create function public._a99_helper() returns int language sql security definer set search_path = public as $$ select 1 $$;
revoke all on function public._a99_helper() from public, anon; grant execute on function public._a99_helper() to authenticated;
create function public.leaky_fn() returns text language sql as $$ select 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghij' $$;
-- trigger / cron with a secret-looking header
create function public.t_noop() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger push_trg after insert on public.notes for each row execute function public.t_noop('Authorization: Bearer abc','x-push-secret');
insert into cron.job (jobname, command) values ('gift-card-deliveries', 'select 1 -- x-cron-secret: abc'), ('clean', 'select 1');
insert into storage.buckets values ('a','post-images',true),('b','job-evidence',false);
insert into auth.users values ('00000000-0000-0000-0000-000000000001', now()), ('00000000-0000-0000-0000-000000000002', now() - interval '90 days');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into public.admin_user_roles values ('00000000-0000-0000-0000-000000000001','super_admin');
insert into auth.mfa_factors (user_id, status) values ('00000000-0000-0000-0000-000000000001','verified');
insert into public.support_staff values ('00000000-0000-0000-0000-000000000009');
insert into public.subscription_card_authorizations values (gen_random_uuid(), 'AUTH_secretvalue');
grant select, insert on public.admin_audit_log to authenticated;

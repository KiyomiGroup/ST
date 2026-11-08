-- LOCAL STAND-INS ONLY (never run on Supabase). Builds just enough of the real database to run the admin SQL on a scratch Postgres.
-- The support_* functions here are SIMPLE IMITATIONS written from how js/support.js calls them; the real ones were not seen.
drop schema if exists public cascade; create schema public;
drop schema if exists auth cascade; create schema auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public, auth to anon, authenticated;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, factor_type text, status text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true), ''), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table public.users (id uuid primary key, role text, created_at timestamptz default now());
create table public.coordinators (user_id uuid primary key, status text);
create table public.support_staff (user_id uuid primary key, note text, added_at timestamptz default now());
alter table public.support_staff enable row level security; alter table public.support_staff force row level security;
-- the real _is_support() as described in ARCHITECTURE.md B2
create function public._is_support() returns boolean language sql security definer set search_path = public, pg_temp as $$
  select (auth.uid() is not null and exists (select 1 from public.support_staff s where s.user_id = auth.uid()))
      or (auth.uid() is null and session_user in ('postgres','supabase_admin')) $$;
create function public.is_local_tasker_admin() returns boolean language sql as $$ select public._is_support() $$;
-- dispute tables
create table public.job_disputes (id uuid primary key default gen_random_uuid(), thread_id uuid, status text default 'open', outcome text, resolution_note text, resolved_at timestamptz, opened_at timestamptz default now(), reason text, category text, opened_by_role text);
create table public.dispute_events (id bigserial primary key, dispute_id uuid, kind text, note text, actor_id uuid, created_at timestamptz default now());
create table public.job_refunds (id bigserial primary key, thread_id uuid, dispute_id uuid, amount numeric, paystack_ref text, note text, created_at timestamptz default now());
-- imitation support_* functions (named args as used by js/support.js)
create function public.support_start_review(p_dispute uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public._is_support() then return jsonb_build_object('ok', false, 'error', 'Not allowed.'); end if;
  update public.job_disputes set status='under_review' where id=p_dispute and status='open';
  if not found then return jsonb_build_object('ok', false, 'error', 'Report is not open.'); end if;
  insert into public.dispute_events(dispute_id, kind, actor_id) values (p_dispute,'under_review',auth.uid());
  return jsonb_build_object('ok', true);
end $$;
create function public.support_resolve_dispute(p_dispute uuid, p_outcome text, p_note text, p_refund_amount numeric default null, p_refund_ref text default null, p_refund_note text default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public._is_support() then return jsonb_build_object('ok', false, 'error', 'Not allowed.'); end if;
  if p_outcome in ('refund_full','refund_partial','split') and (p_refund_amount is null or p_refund_ref is null) then return jsonb_build_object('ok', false, 'error', 'Refund needs amount and reference.'); end if;
  update public.job_disputes set status='resolved', outcome=p_outcome, resolution_note=p_note, resolved_at=now() where id=p_dispute and status in ('open','under_review');
  if not found then return jsonb_build_object('ok', false, 'error', 'Report is closed.'); end if;
  insert into public.dispute_events(dispute_id, kind, actor_id) values (p_dispute,'resolved',auth.uid());
  return jsonb_build_object('ok', true, 'settlement', jsonb_build_object('action','released'));
end $$;
create function public.support_record_refund(p_dispute uuid, p_amount numeric, p_ref text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public._is_support() then return jsonb_build_object('ok', false, 'error', 'Not allowed.'); end if;
  insert into public.job_refunds(dispute_id, amount, paystack_ref) values (p_dispute, p_amount, p_ref);
  return jsonb_build_object('ok', true);
end $$;
create function public.support_remove_evidence(p_attachment uuid, p_reason text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public._is_support() then return jsonb_build_object('ok', false, 'error', 'Not allowed.'); end if;
  return jsonb_build_object('ok', true);
end $$;
create function public.support_dispute_messages(p_dispute uuid, p_limit integer default 200) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public._is_support() then return jsonb_build_object('ok', false, 'error', 'Not allowed.'); end if;
  insert into public.dispute_events(dispute_id, kind, actor_id) values (p_dispute,'chat_viewed',auth.uid());
  return jsonb_build_object('ok', true, 'messages', '[]'::jsonb);
end $$;
grant execute on all functions in schema public to authenticated;
grant usage on schema public to authenticated;

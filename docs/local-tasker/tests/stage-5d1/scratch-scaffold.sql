-- SCRATCH ONLY (stage 5D-1). Stand-ins for the parts of the owner's Supabase project that 5D-1 sits on.
-- NOT the real schema. The REAL files loaded on top of it, in this order: messaging-step6.sql, messaging-step7.sql,
-- stage-5c1-core.sql, stage-5c2-core.sql, stage-5d1-core.sql.
-- STAND-INS (because the real files were not in this session's zips): the stage 5A tables and helper functions
-- (state machine written from the 5C handoffs), the 2D/4B/4C functions used by the setup, the payment engine from messaging-step6a.sql,
-- and the base tables message_threads, messages, payment_requests, bookings.
-- psql variable ctx_type: 'text' or 'uuid' (type of message_threads.context_id; the real column type is not known).
\if :{?ctx_type}
\else
\set ctx_type text
\endif

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth;
grant usage on schema public, auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, aud text, role text, email text, banned_until timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'sub','')::uuid $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create table public.users (id uuid primary key, name text, role text, profile_details jsonb);
create table public.coordinators (user_id uuid primary key, display_name text, status text not null default 'pending');
create table public.coordinator_assignments (id uuid primary key default gen_random_uuid(), tasker_user_id uuid not null, coordinator_id uuid not null, ended_at timestamptz);
create table public.local_tasker_profiles (tasker_user_id uuid primary key, full_name text, phone text, status text default 'draft');
create table public.local_tasker_audit_log (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), action text, entity text, entity_id text,
  before_data jsonb, after_data jsonb, actor_id uuid, actor_role text);
create function public.local_tasker_audit(p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb, p_actor uuid) returns uuid language plpgsql security definer as $$
declare v uuid; begin insert into public.local_tasker_audit_log(action,entity,entity_id,before_data,after_data,actor_id) values (p_action,p_entity,p_entity_id,p_before,p_after,p_actor) returning id into v; return v; end $$;
create function public.is_active_coordinator(p_user uuid) returns boolean language sql security definer as $$ select exists(select 1 from public.coordinators where user_id=p_user and status='active') $$;
create function public.is_local_tasker_admin() returns boolean language sql security definer as $$ select coalesce(current_setting('st.test_admin', true), '') = '1' $$;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- base tables (before the Job Room money SQL)
create table public.bookings (id uuid primary key default gen_random_uuid(), customer_id uuid, tasker_id uuid, task_id uuid, service_id uuid, status text default 'pending',
  payment_status text, amount numeric, notes text, scheduled_time text, code_attempts int default 0, created_at timestamptz default now());
create table public.message_threads (id uuid primary key default gen_random_uuid(), customer_id uuid, tasker_id uuid, context_type text, context_id :ctx_type,
  last_message text, last_message_at timestamptz, customer_unread int default 0, tasker_unread int default 0, agreed_price numeric, customer_archived boolean default false);
create table public.messages (id uuid primary key default gen_random_uuid(), thread_id uuid references public.message_threads(id) on delete cascade, sender_id uuid, receiver_id uuid,
  body text, type text, flagged boolean default false, payment_request_id uuid, created_at timestamptz default now());
create table public.payment_requests (id uuid primary key default gen_random_uuid(), thread_id uuid references public.message_threads(id) on delete cascade, tasker_id uuid, customer_id uuid,
  amount numeric, status text default 'pending', created_at timestamptz default now(), updated_at timestamptz default now(), responded_at timestamptz,
  constraint payment_requests_status_chk check (status is null or status in ('pending', 'accepted', 'paid')));
alter table public.payment_requests enable row level security;
create policy "Participants read" on public.payment_requests for select to authenticated using (auth.uid() in (customer_id, tasker_id));
create policy "Customer can update payment request" on public.payment_requests for update to authenticated using (auth.uid() = customer_id) with check (auth.uid() = customer_id);
create policy "Tasker inserts" on public.payment_requests for insert to authenticated with check (auth.uid() = tasker_id);
grant select, insert, update on public.payment_requests to authenticated;
create table public.job_disputes (id uuid primary key default gen_random_uuid(), thread_id uuid, status text);

-- payment engine stand-ins (messaging-step7.sql replaces the two functions with the real bodies)
create table public.payment_intents (id uuid primary key default gen_random_uuid(), reference text, user_id uuid, purpose text, request_id uuid, booking_id uuid, amount numeric,
  platform_fee numeric, tasker_amount numeric, tasker_user_id uuid, status text default 'pending', result jsonb, paid_at timestamptz, provider_ref text, created_at timestamptz default now());
create function public._apply_payment(p_intent_id uuid, p_provider_ref text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public._prepare_intent(p_user uuid, p_purpose text, p_request uuid, p_booking uuid, p_amount numeric) returns public.payment_intents language sql as $$ select null::public.payment_intents $$;

-- stage 5A stand-ins (the machine is written from the 5C handoffs; the real SQL was not available)
create table public.local_booking_state (booking_id uuid primary key references public.bookings(id) on delete cascade, coordinator_id uuid, tasker_user_id uuid,
  lt_status text not null default 'assigned', updated_at timestamptz not null default now());
create table public.local_booking_events (id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade, kind text not null,
  from_status text, to_status text, coordinator_id uuid, tasker_user_id uuid, actor_id uuid, actor_role text, note text, created_at timestamptz not null default now());
create function public._local_booking_log(p_booking uuid, p_kind text, p_from text, p_to text, p_coordinator uuid, p_tasker uuid, p_actor uuid, p_role text, p_note text) returns void
language sql security definer as $$ insert into public.local_booking_events (booking_id, kind, from_status, to_status, coordinator_id, tasker_user_id, actor_id, actor_role, note)
  values (p_booking, p_kind, p_from, p_to, p_coordinator, p_tasker, p_actor, p_role, p_note) $$;
create function public._local_booking_is_open(p_status text) returns boolean language sql immutable as $$ select coalesce(p_status, 'pending') not in ('completed', 'cancelled', 'rejected', 'declined') $$;
create function public.job_booking_frozen(p_booking uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.job_disputes d join public.message_threads t on t.id = d.thread_id where t.context_id::text = p_booking::text and d.status = 'open') $$;
create function public._local_booking_allowed_next(p_from text, p_role text) returns text[] language sql immutable as $$
  select case when p_role = 'customer' then
      case p_from when 'quote_sent' then array['quote_approved', 'quote_declined']::text[] else array[]::text[] end
    else
      case p_from when 'assigned' then array['awaiting_tasker_confirmation']
                  when 'awaiting_tasker_confirmation' then array['tasker_confirmed', 'tasker_declined']
                  when 'tasker_confirmed' then array['quote_sent', 'awaiting_tasker_confirmation']
                  when 'tasker_declined' then array['awaiting_tasker_confirmation']
                  when 'quote_sent' then array['awaiting_tasker_confirmation']
                  when 'quote_declined' then array['quote_sent', 'awaiting_tasker_confirmation']
                  when 'quote_approved' then array['awaiting_tasker_confirmation']
                  else array[]::text[] end::text[] end $$;
create function public.local_booking_step(p_booking uuid, p_to text, p_note text) returns jsonb language plpgsql security definer as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null or not public.is_active_coordinator(v_me) or not exists (select 1 from public.local_booking_state s where s.booking_id = p_booking and s.coordinator_id = v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  return public._local_booking_transition(p_booking, p_to, v_me, 'coordinator', p_note);
end $$;
-- a booking for a Local Tasker gets its state row on insert (stand-in for stage 5A1)
create function public._st_standin_assign() returns trigger language plpgsql security definer as $$
begin
  if exists (select 1 from public.local_tasker_profiles where tasker_user_id = NEW.tasker_id) then
    insert into public.local_booking_state (booking_id, coordinator_id, tasker_user_id, lt_status)
    select NEW.id, a.coordinator_id, NEW.tasker_id, 'assigned' from public.coordinator_assignments a where a.tasker_user_id = NEW.tasker_id and a.ended_at is null limit 1;
  end if;
  return NEW;
end $$;
create trigger st_standin_assign after insert on public.bookings for each row execute function public._st_standin_assign();
grant select, insert, update on public.bookings to authenticated;

-- 2D / 4B / 4C stand-ins used only by the test setup
create function public.create_local_tasker(p_coordinator uuid, p_request uuid, p_tasker_user uuid, p_public_name text, p_full_name text, p_phone text, p_areas_served text,
  p_skills text[], p_availability_notes text, p_consent_method text, p_consent_evidence_ref text, p_consent_details text) returns jsonb language plpgsql security definer as $$
begin
  insert into public.users (id, name, role, profile_details) values (p_tasker_user, p_public_name, 'tasker', '{}');
  insert into public.local_tasker_profiles (tasker_user_id, full_name, phone) values (p_tasker_user, p_full_name, p_phone);
  insert into public.coordinator_assignments (tasker_user_id, coordinator_id) values (p_tasker_user, p_coordinator);
  return jsonb_build_object('created', true);
end $$;
create function public.save_local_tasker_service(uuid, uuid, text, text, numeric, text, text, text, text[], text, boolean, text, text, text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.publish_local_tasker(uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
grant execute on all functions in schema public to anon, authenticated, service_role;
create function public.local_tasker_identity_email(p_request uuid) returns text language sql immutable as $$ select 'lt-' || p_request::text || '@local-tasker.invalid' $$;
grant execute on function public.local_tasker_identity_email(uuid) to anon, authenticated, service_role;

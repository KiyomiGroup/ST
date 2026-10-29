-- SCRATCH ONLY (stage 5D-3b). NOT the real schema, but the Job Room money layer is the REAL thing where the owner's CSV (2026-10-29) gave it:
--   REAL: bookings columns and the guard triggers bookings_guard / bookings_guard_stage / bookings_block_exit_with_escrow / bookings_hide_code,
--         job_disputes (real columns and CHECKs) with the real job_disputes_guard and job_disputes_sync_booking triggers, job_booking_frozen,
--         _job_event, _notify, _booking_tasker_user, payment_requests_events, payment_requests columns and CHECKs.
--   STAND-INS: auth, users, coordinators, message_threads, messages, notifications, job_events (real columns, no checks known), escrow_payments,
--         job_money_snapshot, _thread_booking, the rest of payment_requests_guard, and everything from 5A, 5D-1 pre-flight (as in 5D-3a).
-- Load order on a plain Postgres: this file, stage-5d2-core.sql, stage-5d3a-core.sql, stage-5d3b-core.sql, stage-5d3b-tests.sql
-- (and stage-5d3a-tests.sql / stage-5d2-tests.sql afterwards as regression).
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
grant usage on schema public, auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, aud text, role text, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'sub','')::uuid $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create table public.coordinators (user_id uuid primary key, display_name text, status text not null default 'pending');
create function public.is_active_coordinator(p_user uuid) returns boolean language sql security definer as $$ select exists(select 1 from public.coordinators where user_id=p_user and status='active') $$;
create function public.is_local_tasker_admin() returns boolean language sql security definer as $$ select coalesce(current_setting('st.test_admin', true), '') = '1' $$;
create table public.local_tasker_audit_log (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), action text, entity text, entity_id text, before_data jsonb, after_data jsonb, actor_id uuid);
create function public.local_tasker_audit(p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb, p_actor uuid) returns uuid language plpgsql security definer as $$
declare v uuid; begin insert into public.local_tasker_audit_log(action,entity,entity_id,before_data,after_data,actor_id) values (p_action,p_entity,p_entity_id,p_before,p_after,p_actor) returning id into v; return v; end $$;

-- ---- Job Room layer ------------------------------------------------------------------------------------------------
create table public.taskers (id uuid primary key, user_id uuid);
create table public.users (id uuid primary key, name text, role text, profile_details jsonb);
create table public.message_threads (id uuid primary key default gen_random_uuid(), customer_id uuid references public.users(id), tasker_id uuid references public.users(id), context_type text, context_id uuid, task_id uuid,
  last_message text, last_message_at timestamptz, customer_unread int default 0, tasker_unread int default 0, agreed_price numeric);
create table public.messages (id uuid primary key default gen_random_uuid(), thread_id uuid references public.message_threads(id) on delete cascade, sender_id uuid references public.users(id), receiver_id uuid references public.users(id),
  body text, type text, flagged boolean default false, payment_request_id uuid, created_at timestamptz default now());
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, message text, data jsonb, is_read boolean, created_at timestamptz default now());
create table public.bookings (id uuid primary key default gen_random_uuid(), task_id uuid, service_id uuid, customer_id uuid, tasker_id uuid, status text default 'pending',
  created_at timestamptz default now(), notes text, scheduled_time text, scheduled_time_ts timestamptz, updated_at timestamptz default now(), payment_status text default 'unpaid',
  completion_code text, code_attempts integer default 0, payment_ref text, dispute_reason text, completed_at timestamptz, amount numeric, work_stage text,
  constraint bookings_work_stage_check check (work_stage is null or work_stage in ('en_route','arrived','in_progress','paused')));
create table public.payment_requests (id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.message_threads(id) on delete cascade,
  tasker_id uuid not null, customer_id uuid not null, amount numeric not null, status text not null default 'pending', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), kind text not null default 'payment', title text, reason text, breakdown jsonb, invoice_number text, due_date date,
  responded_at timestamptz, revises_id uuid, paid_at timestamptz, settlement text, booking_id uuid,
  constraint payment_requests_amount_check check (amount > 0),
  constraint payment_requests_kind_check check (kind = any (array['payment','full_payment','remaining_payment','transport','materials','additional_cost','invoice','refund'])),
  constraint payment_requests_settlement_check check (settlement is null or settlement = any (array['held','released'])),
  constraint payment_requests_status_check check (status is null or status = any (array['pending','processing','paid','failed','declined','cancelled','refunded'])));
create table public.payment_intents (id uuid primary key default gen_random_uuid(), booking_id uuid, amount numeric);
create table public.escrow_payments (id uuid primary key default gen_random_uuid(), booking_id uuid, status text, amount numeric, tasker_amount numeric, platform_fee numeric);
create table public.job_requests (id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.message_threads(id) on delete cascade, customer_id uuid not null,
  tasker_id uuid not null, requested_by uuid not null, kind text not null, status text not null default 'pending', note text, payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), responded_at timestamptz, responded_by uuid,
  constraint job_requests_status_check check (status = any (array['pending','fulfilled','declined','cancelled','expired'])));
create table public.job_events (id uuid primary key default gen_random_uuid(), booking_id uuid not null, thread_id uuid, customer_id uuid not null, tasker_user_id uuid, actor_id uuid,
  kind text not null, text text not null, note text, payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table public.job_disputes (id uuid primary key default gen_random_uuid(), thread_id uuid not null, opened_by uuid not null, opened_by_role text not null, category text not null,
  reason text not null, payment_request_id uuid, status text not null default 'open', outcome text, resolution_note text, resolved_by uuid, opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), resolved_at timestamptz, booking_prev_status text,
  constraint job_disputes_category_check check (category = any (array['not_done','poor_quality','no_show','wrong_amount','payment_issue','other'])),
  constraint job_disputes_opened_by_role_check check (opened_by_role = any (array['customer','tasker'])),
  constraint job_disputes_outcome_check check (outcome = any (array['refund_full','refund_partial','release_to_tasker','split','no_action'])),
  constraint job_disputes_reason_check check (char_length(reason) >= 10 and char_length(reason) <= 1000),
  constraint job_disputes_resolution_note_check check (resolution_note is null or (char_length(resolution_note) >= 10 and char_length(resolution_note) <= 1000)),
  constraint job_disputes_resolved_has_outcome check ((status = 'resolved') = ((outcome is not null) and (resolution_note is not null) and (resolved_at is not null))),
  constraint job_disputes_status_check check (status = any (array['open','under_review','resolved','withdrawn'])));
create unique index job_disputes_one_open on public.job_disputes (thread_id) where status in ('open','under_review');   -- stand-in: the real code handles unique_violation
create table public.dispute_events (id uuid primary key default gen_random_uuid(), dispute_id uuid not null, thread_id uuid not null, kind text not null, actor_id uuid, note text, created_at timestamptz not null default now());
create function public._thread_booking(p_thread text) returns uuid language sql stable security definer as $$ select t.context_id from public.message_threads t where t.id::text = p_thread and t.context_type = 'booking' $$;
create function public.job_money_snapshot(p_thread uuid) returns jsonb language plpgsql stable security definer as $$
begin
  -- stand-in that behaves like the real one did for a coordinator in the owner's project: it refuses anyone who is not a party of the room
  if auth.uid() is null or not exists (select 1 from public.message_threads t where t.id = p_thread and auth.uid() in (t.customer_id, t.tasker_id)) then raise exception 'Not your conversation.'; end if;
  return jsonb_build_object('paid', coalesce((select sum(amount) from public.payment_requests where thread_id = p_thread and status = 'paid'), 0));
end $$;
create table public.gift_card_holds (id uuid primary key default gen_random_uuid(), booking_id uuid, user_id uuid, status text, amount numeric not null, price numeric not null);

-- REAL _local_booking_thread, copied from stage-5d1-core.sql (5D-1 is not loaded on the scratch database)
-- The Job Room for this booking and customer: the existing one, or a new one.
create or replace function public._local_booking_thread(p_booking uuid, p_customer uuid, p_tasker uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select t.id into v_id from public.message_threads t
   where t.context_type = 'booking' and t.context_id::text = p_booking::text and t.customer_id = p_customer and t.tasker_id = p_tasker
   order by t.last_message_at desc nulls last limit 1;
  if v_id is not null then return v_id; end if;
  -- %L keeps the booking id an untyped literal, so this works whether context_id is uuid or text
  execute format('insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at, customer_unread, tasker_unread) '
                 'values (%L, %L, %L, %L, now(), 0, 0) returning id', p_customer, p_tasker, 'booking', p_booking) into v_id;
  return v_id;
end $$;

create or replace function public.job_booking_frozen(p_booking uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (select 1 from public.job_disputes d join public.message_threads t on t.id = d.thread_id
                  where t.context_type = 'booking' and t.context_id::text = p_booking::text
                    and d.status in ('open','under_review'))
$fn$;

create or replace function public._booking_tasker_user(b bookings) returns uuid language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(
    (select case when t.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 then t.user_id::text::uuid end
       from public.taskers t where t.id::text = b.tasker_id::text limit 1),
    case when b.tasker_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then b.tasker_id::text::uuid end
  )
$fn$;

create or replace function public._notify(p_user uuid, p_type text, p_title text, p_msg text, p_data jsonb) returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  insert into public.notifications (user_id, type, title, message, data, is_read)
  values (p_user, p_type, p_title, p_msg, p_data, false);
exception when others then
  null;   -- a notification problem must never block money movement
end $fn$;

create or replace function public.bookings_guard() returns trigger language plpgsql as $fn$
begin
  if current_user not in ('authenticated', 'anon') then
    return NEW;                    -- server code (service role / our functions / SQL editor)
  end if;

  if TG_OP = 'INSERT' then
    NEW.amount          := null;   -- the price is decided server-side, never by the booking customer
    NEW.completion_code := null;
    NEW.code_attempts   := 0;
    NEW.completed_at    := null;
    NEW.dispute_reason  := null;
    if NEW.payment_status is not null and NEW.payment_status not in ('unpaid', 'pending') then
      NEW.payment_status := 'unpaid';
    end if;
    NEW.status := 'pending';
    return NEW;
  end if;

  if NEW.payment_status  is distinct from OLD.payment_status
  or NEW.amount          is distinct from OLD.amount
  or NEW.completion_code is distinct from OLD.completion_code
  or NEW.code_attempts   is distinct from OLD.code_attempts
  or NEW.completed_at    is distinct from OLD.completed_at
  or NEW.dispute_reason  is distinct from OLD.dispute_reason
  or NEW.customer_id     is distinct from OLD.customer_id
  or NEW.tasker_id       is distinct from OLD.tasker_id then
    raise exception 'Payment and booking-owner fields can only be changed by the payment system.';
  end if;

  if NEW.status is distinct from OLD.status then
    if NEW.status in ('completed', 'awaiting_confirmation', 'disputed') then
      raise exception 'Use the Mark done / Confirm / Dispute buttons to move a booking to "%".', NEW.status;
    end if;
    if OLD.status in ('completed', 'awaiting_confirmation', 'disputed') then
      raise exception 'This booking is "%" and can no longer be changed here.', OLD.status;
    end if;
    if NEW.status = 'cancelled' and OLD.payment_status in ('paid', 'released') then
      raise exception 'A paid booking cannot be cancelled here. Raise a dispute so the money is handled safely.';
    end if;
  end if;
  return NEW;
end $fn$;

create or replace function public.bookings_guard_stage() returns trigger language plpgsql as $fn$
begin
  if current_user in ('authenticated', 'anon') then
    if TG_OP = 'INSERT' then NEW.work_stage := null;
    elsif NEW.work_stage is distinct from OLD.work_stage then
      raise exception 'Use the work buttons in Messages to update progress.';
    end if;
  end if;
  return NEW;
end $fn$;

create or replace function public.bookings_block_exit_with_escrow() returns trigger language plpgsql as $fn$
begin
  if current_user not in ('authenticated', 'anon') then return NEW; end if;
  if NEW.status in ('cancelled', 'rejected', 'declined') and NEW.status is distinct from OLD.status
     and exists (select 1 from public.escrow_payments e where e.booking_id = NEW.id and e.status = 'held') then
    raise exception 'Money is already held for this booking. Raise a dispute so it is handled safely.';
  end if;
  return NEW;
end $fn$;

create or replace function public.bookings_hide_code() returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if NEW.completion_code is not null and NEW.completion_code <> '' then
    insert into public.booking_secrets (booking_id, completion_code, updated_at)
    values (NEW.id, NEW.completion_code, now())
    on conflict (booking_id) do update set completion_code = excluded.completion_code, updated_at = now();
    NEW.completion_code := null;
  end if;
  return NEW;
end $fn$;

create or replace function public.job_disputes_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'Disputes cannot be deleted' using errcode = '42501';
  end if;
  if new.thread_id::text is distinct from old.thread_id::text
     or new.opened_by    is distinct from old.opened_by
     or new.opened_by_role is distinct from old.opened_by_role
     or new.category     is distinct from old.category
     or new.reason       is distinct from old.reason
     or new.opened_at    is distinct from old.opened_at
     or new.payment_request_id::text is distinct from old.payment_request_id::text then
    raise exception 'The details of a dispute cannot be changed' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'open'         and new.status in ('under_review','withdrawn','resolved'))
         or (old.status = 'under_review' and new.status = 'resolved')) then
      raise exception 'A dispute cannot go from % to %', old.status, new.status using errcode = '22023';
    end if;
  elsif old.status in ('resolved','withdrawn') then
    raise exception 'This dispute is closed' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $fn$;

create or replace function public.job_disputes_sync_booking() returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_b uuid; v_status text; v_prev text;
begin
  v_b := public._thread_booking(NEW.thread_id::text);
  if v_b is null then return NEW; end if;
  if TG_OP = 'INSERT' then
    select status into v_status from public.bookings where id = v_b;
    if v_status is not null and v_status not in ('completed','cancelled','rejected','declined','disputed') then
      NEW.booking_prev_status := v_status;
      update public.bookings set status = 'disputed', dispute_reason = left(NEW.reason, 1000) where id = v_b;
    end if;
    return NEW;
  end if;
  -- UPDATE OF status: closed reports give the booking its old status back (unless another report or the legacy dispute holds it)
  if NEW.status in ('resolved','withdrawn') and OLD.status in ('open','under_review')
     and NEW.booking_prev_status is not null and not public.job_booking_frozen(v_b) then
    update public.bookings set status = NEW.booking_prev_status, dispute_reason = null
     where id = v_b and status = 'disputed';
  end if;
  return NEW;
end $fn$;

create or replace function public.payment_requests_events() returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_actor uuid := auth.uid(); v_other uuid; v_label text; v_body text;
begin
  if NEW.status is not distinct from OLD.status or NEW.status not in ('declined', 'cancelled') then
    return NEW;
  end if;
  if v_actor is null or NEW.thread_id is null then return NEW; end if;
  v_label := case coalesce(NEW.kind, 'payment') when 'transport' then 'Transport' when 'additional_cost' then 'Additional cost' when 'materials' then 'Materials' when 'invoice' then 'Invoice'
                                                when 'remaining_payment' then 'Remaining payment' when 'full_payment' then 'Full payment'
                                                else 'Payment request' end;
  v_body := v_label || ' ' || NEW.status || ': ₦' || to_char(NEW.amount, 'FM999,999,999');
  v_other := case when v_actor = NEW.customer_id then NEW.tasker_id else NEW.customer_id end;
  begin
    insert into public.messages (thread_id, sender_id, receiver_id, body, type, flagged)
    values (NEW.thread_id, v_actor, v_other, v_body, 'system', false);
    update public.message_threads
       set last_message = left(v_body, 80), last_message_at = now(),
           customer_unread = case when v_actor = NEW.customer_id then customer_unread else coalesce(customer_unread, 0) + 1 end,
           tasker_unread   = case when v_actor = NEW.customer_id then coalesce(tasker_unread, 0) + 1 else tasker_unread end
     where id = NEW.thread_id;
  exception when others then null;
  end;
  return NEW;
end $fn$;

create table public.booking_secrets (booking_id uuid primary key, completion_code text, updated_at timestamptz);

CREATE OR REPLACE FUNCTION public._job_event(p_booking uuid, p_actor uuid, p_kind text, p_text text, p_note text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare b public.bookings; v_tasker uuid; v_thread uuid; v_other uuid; v_body text;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then return; end if;
  v_tasker := public._booking_tasker_user(b);
  select id into v_thread from public.message_threads
   where context_type = 'booking' and context_id::text = p_booking::text
   order by last_message_at desc nulls last limit 1;
  v_other := case when p_actor = b.customer_id then v_tasker else b.customer_id end;

  insert into public.job_events (booking_id, thread_id, customer_id, tasker_user_id, actor_id, kind, text, note, payload)
  values (p_booking, v_thread, b.customer_id, v_tasker, p_actor, p_kind, p_text, nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_payload, '{}'::jsonb));

  v_body := p_text || case when coalesce(btrim(p_note), '') <> '' then ': ' || left(btrim(p_note), 200) else '' end;
  if v_thread is not null then
    begin
      insert into public.messages (thread_id, sender_id, receiver_id, body, type, flagged)
      values (v_thread, p_actor, v_other, v_body, 'system', false);
      update public.message_threads
         set last_message = left(v_body, 80), last_message_at = now(),
             customer_unread = case when p_actor = b.customer_id then customer_unread else coalesce(customer_unread, 0) + 1 end,
             tasker_unread   = case when p_actor = b.customer_id then coalesce(tasker_unread, 0) + 1 else tasker_unread end
       where id = v_thread;
    exception when others then null;       -- the chat line must never block the action
    end;
  end if;
  perform public._notify(v_other, 'job_update', p_text, left(coalesce(p_note, ''), 120),
                         jsonb_build_object('booking_id', p_booking, 'thread_id', v_thread));
end $function$
;


create trigger bookings_guard before insert or update on public.bookings for each row execute function public.bookings_guard();
create trigger bookings_guard_stage before insert or update on public.bookings for each row execute function public.bookings_guard_stage();
create trigger bookings_block_exit_with_escrow before update on public.bookings for each row execute function public.bookings_block_exit_with_escrow();
create trigger bookings_hide_code before insert or update on public.bookings for each row execute function public.bookings_hide_code();
create trigger job_disputes_guard_trg before delete or update on public.job_disputes for each row execute function public.job_disputes_guard();
create trigger job_disputes_sync_ins before insert on public.job_disputes for each row execute function public.job_disputes_sync_booking();
create trigger job_disputes_sync_upd after update of status on public.job_disputes for each row execute function public.job_disputes_sync_booking();
create trigger payment_requests_events after update of status on public.payment_requests for each row execute function public.payment_requests_events();
-- the browser roles must be able to try a DIRECT write (the tests prove the real guards still stop them)
grant select, insert, update on public.bookings, public.payment_requests, public.job_requests to authenticated;
grant usage on schema public to authenticated, anon, service_role;

-- 5D-1 pre-flight stand-ins
create table public.local_booking_quote_decisions (id uuid primary key default gen_random_uuid());
create function public.local_booking_decide_quote(uuid, integer, uuid, text, text) returns jsonb language sql as $$ select '{}'::jsonb $$;

-- REAL 5A objects (copied from stage-5a1-core.sql)
create table public.local_booking_state (
  booking_id uuid primary key references public.bookings(id) on delete cascade, tasker_user_id uuid not null, coordinator_id uuid, original_coordinator_id uuid,
  lt_status text not null default 'assigned', resume_status text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint local_booking_state_status_check check (lt_status in ('needs_reassignment', 'assigned', 'awaiting_tasker_confirmation', 'tasker_confirmed', 'tasker_declined', 'quote_sent', 'quote_approved', 'quote_declined')));
create table public.local_booking_events (id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade, kind text not null,
  from_status text, to_status text, coordinator_id uuid, previous_coordinator_id uuid, actor_id uuid, actor_role text, note text, created_at timestamptz not null default clock_timestamp());
create function public._local_booking_is_open(p_status text) returns boolean language sql immutable as $$ select coalesce(p_status, 'pending') not in ('completed', 'cancelled', 'rejected', 'declined') $$;
create function public._local_booking_log(p_booking uuid, p_kind text, p_from text, p_to text, p_coord uuid, p_prev uuid, p_actor uuid, p_role text, p_note text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.local_booking_events (booking_id, kind, from_status, to_status, coordinator_id, previous_coordinator_id, actor_id, actor_role, note)
  values (p_booking, p_kind, p_from, p_to, p_coord, p_prev, p_actor, p_role, left(nullif(btrim(coalesce(p_note, '')), ''), 300)) $$;
grant select, insert, update on public.bookings to authenticated;
-- 5D-3a stand-in: only the columns the no-show rule reads (booking_id, superseded_at, created_at). The real table is stage-5c2-core.sql.
create table public.local_booking_quotes (id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade, superseded_at timestamptz, created_at timestamptz not null default now());

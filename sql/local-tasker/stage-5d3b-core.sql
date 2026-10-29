-- ============================================================================
-- StreetTasker Local Tasker: STAGE 5D-3b core (exceptions, part 2: the coordinator cancels, or reports a problem for the Local Tasker)
-- Additive and re-runnable. Rollback: stage-5d3b-rollback.sql. Needs stage-5d3a-core.sql (and so 5D-2, 5D-1, 5C-2, 5C-1, 5A) first,
-- and the Job Room money SQL (job_cancel, open_job_dispute, job_disputes, dispute_events, escrow_payments).
-- Run in the Supabase SQL editor (select all, Run). Safe to run twice.
--
-- Written against the REAL source of job_cancel, open_job_dispute, withdraw_job_dispute, job_booking_frozen, _job_event, _notify,
-- bookings_guard, bookings_block_exit_with_escrow, job_disputes_guard and job_disputes_sync_booking (owner's CSV, 2026-10-29).
-- Those guards only stop the BROWSER roles (authenticated, anon); a SECURITY DEFINER function runs as the owner and passes them,
-- exactly as job_cancel does. So nothing here weakens a guard: the money checks are repeated inside the function.
--
-- What it adds:
--   1. local_booking_cancellations: one immutable row per cancelled booking (reason, note, who, when, request id).
--   2. local_booking_cancel (coordinator rpc): cancels a booking ONLY when nothing is paid or held, with the SAME effects as job_cancel:
--        unpaid or failed payment_requests -> cancelled, pending job_requests -> expired, bookings.status -> cancelled,
--        one job event (the customer is told). Refused when money is held or a payment has just started: then use a problem report.
--        It does NOT touch lt_status, payment_status, escrow, wallets, the release code or any paid row.
--   3. local_booking_problem_reports + local_booking_open_problem (coordinator rpc): opens a REAL problem report (job_disputes row,
--        role 'tasker', opened_by = the Local Tasker, a dispute_events row) on behalf of the Local Tasker, who cannot sign in.
--        The database trigger then freezes the booking exactly as for any problem report; support decides it. Money is not touched here.
--   4. local_booking_withdraw_problem (coordinator rpc): withdraws a report this path opened, while it is still 'open'
--        (the Local Tasker cannot withdraw it: they cannot sign in).
--   5. local_booking_closeout (coordinator read): what can be done now and why not, the cancellation, and the reports opened here.
-- NEVER writes: payment_intents, escrow_payments, wallets, wallet_transactions, release code, lt_status, payment_status.
-- The only payment table it writes is payment_requests, and only status -> 'cancelled' on rows that are unpaid (pending, failed),
-- the same rows and the same value job_cancel and the 5D-1 quote-replaced trigger already change.
-- ============================================================================

-- 0. Pre-flight ----------------------------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.local_booking_record_exception(uuid,uuid,text,timestamptz,text)') is null
     or to_regclass('public.local_booking_milestones') is null then
    raise exception 'Run stage-5d3a-core.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.job_disputes') is null or to_regclass('public.dispute_events') is null or to_regclass('public.escrow_payments') is null
     or to_regclass('public.payment_requests') is null or to_regclass('public.job_requests') is null or to_regclass('public.message_threads') is null
     or to_regprocedure('public.job_money_snapshot(uuid)') is null or to_regprocedure('public._job_event(uuid,uuid,text,text,text,jsonb)') is null
     or to_regprocedure('public._notify(uuid,text,text,text,jsonb)') is null or to_regprocedure('public.job_booking_frozen(uuid)') is null
     or to_regprocedure('public._local_booking_thread(uuid,uuid,uuid)') is null
     or to_regprocedure('public._local_booking_log(uuid,text,text,text,uuid,uuid,uuid,text,text)') is null
     or to_regprocedure('public.local_tasker_audit(text,text,text,jsonb,jsonb,uuid)') is null then
    raise exception 'A Job Room money function or table (job_cancel family) or a Stage 5D-1 / 5A helper is missing. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'job_disputes' and column_name = 'booking_prev_status') then
    raise exception 'job_disputes.booking_prev_status is missing, so a problem report would not freeze the booking correctly. Nothing was changed.';
  end if;
end $$;

-- 1. the records ------------------------------------------------------------------------------------------------
create table if not exists public.local_booking_cancellations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,     -- a booking is cancelled once
  request_id uuid not null unique,                                                        -- makes a retried tap harmless
  reason_key text not null,
  note text,
  coordinator_id uuid not null,
  cancelled_at timestamptz not null default clock_timestamp(),
  constraint lbc_reason_check check (reason_key in ('customer_asked', 'customer_unreachable', 'tasker_unavailable', 'tasker_no_show', 'other')),
  constraint lbc_note_check check (note is null or char_length(note) <= 300)
);
alter table public.local_booking_cancellations enable row level security;
drop policy if exists lt_cancellations_admin_read on public.local_booking_cancellations;
create policy lt_cancellations_admin_read on public.local_booking_cancellations for select to authenticated using (public.is_local_tasker_admin());
revoke all on public.local_booking_cancellations from public, anon, authenticated;
grant select on public.local_booking_cancellations to authenticated;          -- RLS: administrators only
grant select, insert on public.local_booking_cancellations to service_role;

create table if not exists public.local_booking_problem_reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  dispute_id uuid not null unique,                                                        -- the job_disputes row this path opened
  request_id uuid not null unique,
  coordinator_id uuid not null,
  category text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists lbpr_booking_idx on public.local_booking_problem_reports (booking_id, created_at);
alter table public.local_booking_problem_reports enable row level security;
drop policy if exists lt_problem_reports_admin_read on public.local_booking_problem_reports;
create policy lt_problem_reports_admin_read on public.local_booking_problem_reports for select to authenticated using (public.is_local_tasker_admin());
revoke all on public.local_booking_problem_reports from public, anon, authenticated;
grant select on public.local_booking_problem_reports to authenticated;        -- RLS: administrators only
grant select, insert on public.local_booking_problem_reports to service_role;

create or replace function public.local_booking_closeout_guard() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    if pg_trigger_depth() > 1 then return OLD; end if;     -- only the booking cascade
    raise exception 'This record cannot be deleted.' using errcode = 'P0001', hint = 'immutable';
  end if;
  raise exception 'This record cannot be edited.' using errcode = 'P0001', hint = 'immutable';
end $$;
drop trigger if exists lbc_guard on public.local_booking_cancellations;
create trigger lbc_guard before update or delete on public.local_booking_cancellations
  for each row execute function public.local_booking_closeout_guard();
drop trigger if exists lbpr_guard on public.local_booking_problem_reports;
create trigger lbpr_guard before update or delete on public.local_booking_problem_reports
  for each row execute function public.local_booking_closeout_guard();
revoke all on function public.local_booking_closeout_guard() from public, anon, authenticated;

create or replace function public.local_booking_cancellations_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._local_booking_log(NEW.booking_id, 'cancelled', null, NEW.reason_key, NEW.coordinator_id, null, NEW.coordinator_id, 'coordinator', NEW.note);
  perform public.local_tasker_audit('local_booking_cancelled', 'booking', NEW.booking_id::text, null,
    jsonb_build_object('cancellation_id', NEW.id, 'reason', NEW.reason_key), NEW.coordinator_id);
  return NEW;
end $$;
drop trigger if exists lbc_audit on public.local_booking_cancellations;
create trigger lbc_audit after insert on public.local_booking_cancellations
  for each row execute function public.local_booking_cancellations_audit();
revoke all on function public.local_booking_cancellations_audit() from public, anon, authenticated;

create or replace function public.local_booking_problem_reports_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._local_booking_log(NEW.booking_id, 'problem_reported', null, NEW.category, NEW.coordinator_id, null, NEW.coordinator_id, 'coordinator',
                                    'Reported for the Local Tasker');
  perform public.local_tasker_audit('local_booking_problem_reported', 'booking', NEW.booking_id::text, null,
    jsonb_build_object('report_id', NEW.id, 'dispute_id', NEW.dispute_id, 'category', NEW.category), NEW.coordinator_id);
  return NEW;
end $$;
drop trigger if exists lbpr_audit on public.local_booking_problem_reports;
create trigger lbpr_audit after insert on public.local_booking_problem_reports
  for each row execute function public.local_booking_problem_reports_audit();
revoke all on function public.local_booking_problem_reports_audit() from public, anon, authenticated;

-- 2. helpers (internal, no browser access) -------------------------------------------------------------------------
-- Why can this booking NOT be cancelled right now? null = it can. Mirrors job_cancel, in the same order.
create or replace function public._local_booking_cancel_block(p_booking uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_thread uuid; snap jsonb; v_gift boolean;
begin
  select * into b from public.bookings where id = p_booking;
  if b.id is null then return 'not_found'; end if;
  if coalesce(b.status, '') in ('completed', 'cancelled', 'rejected', 'declined') then return 'booking_closed'; end if;
  if public.job_booking_frozen(p_booking) then return 'dispute_open'; end if;
  if b.status in ('disputed', 'awaiting_confirmation') then return 'wrong_status'; end if;
  select id into v_thread from public.message_threads where context_type = 'booking' and context_id::text = p_booking::text
   order by last_message_at desc nulls last limit 1;
  if v_thread is not null then
    begin
      snap := public.job_money_snapshot(v_thread);
      if coalesce((snap ->> 'paid')::numeric, 0) > 0 then return 'money_held'; end if;
    exception when others then
      null;   -- the real snapshot may refuse anyone who is not the customer or the tasker of the room (it did for the coordinator); the checks below do not depend on it
    end;
  end if;
  -- a gift card captured for this booking is money too (gift_return_on_cancel reverses exactly these holds)
  if to_regclass('public.gift_card_holds') is not null then
    execute 'select exists (select 1 from public.gift_card_holds h where h.booking_id = $1 and h.status = ''captured'')' into v_gift using p_booking;
    if v_gift then return 'money_held'; end if;
  end if;
  if coalesce(b.payment_status, 'unpaid') in ('paid', 'released') or exists (select 1 from public.escrow_payments e where e.booking_id = b.id and e.status = 'held') then
    return 'money_held';
  end if;
  if exists (select 1 from public.payment_requests r where r.status = 'paid'
               and r.thread_id in (select t.id from public.message_threads t where t.context_type = 'booking' and t.context_id::text = p_booking::text)) then
    return 'money_held';
  end if;
  if exists (select 1 from public.payment_requests r where r.status = 'processing'
               and r.thread_id in (select t.id from public.message_threads t where t.context_type = 'booking' and t.context_id::text = p_booking::text)) then
    return 'payment_started';
  end if;
  return null;
end $$;
revoke all on function public._local_booking_cancel_block(uuid) from public, anon, authenticated;
grant execute on function public._local_booking_cancel_block(uuid) to service_role;

-- Why can a problem report NOT be opened right now? null = it can.
create or replace function public._local_booking_report_block(p_booking uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking;
  if b.id is null then return 'not_found'; end if;
  if not public._local_booking_is_open(b.status) then return 'booking_closed'; end if;
  if b.status = 'disputed' or public.job_booking_frozen(p_booking) then return 'dispute_open'; end if;
  if (select count(*) from public.job_disputes d join public.message_threads t on t.id = d.thread_id
       where t.context_type = 'booking' and t.context_id::text = p_booking::text and d.opened_at > now() - interval '24 hours') >= 3 then
    return 'too_many';
  end if;
  return null;
end $$;
revoke all on function public._local_booking_report_block(uuid) from public, anon, authenticated;
grant execute on function public._local_booking_report_block(uuid) to service_role;

-- 3. coordinator: cancel a booking nothing was paid for ---------------------------------------------------------------
create or replace function public.local_booking_cancel(p_booking uuid, p_request_id uuid, p_reason text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; x public.local_booking_cancellations;
  v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_block text; v_text text; v_n int := 0; v_threads uuid[];
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if p_request_id is null or p_reason is null or p_reason not in ('customer_asked', 'customer_unreachable', 'tasker_unavailable', 'tasker_no_show', 'other') then
    raise exception 'Choose a reason.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'The note is too long.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if p_reason = 'other' and (v_note is null or char_length(v_note) < 3) then
    raise exception 'Say what the reason is in the note.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  select * into x from public.local_booking_cancellations where request_id = p_request_id;
  if found then                                              -- a retry: same answer, nothing new
    if x.booking_id <> p_booking or x.coordinator_id <> v_me or x.reason_key <> p_reason then
      raise exception 'That request was already used for something else.' using errcode = 'P0001', hint = 'bad_input';
    end if;
    return jsonb_build_object('cancelled', true, 'changed', false, 'duplicate', true, 'cancelled_at', x.cancelled_at);
  end if;

  select * into b from public.bookings where id = p_booking for update;
  v_block := public._local_booking_cancel_block(p_booking);
  if v_block = 'booking_closed' then raise exception 'This booking is closed.' using errcode = 'P0001', hint = 'booking_closed'; end if;
  if v_block = 'dispute_open' then raise exception 'A problem report is open on this booking.' using errcode = 'P0001', hint = 'dispute_open'; end if;
  if v_block = 'wrong_status' then raise exception 'This booking cannot be cancelled while it is %.', replace(b.status, '_', ' ') using errcode = 'P0001', hint = 'wrong_status'; end if;
  if v_block = 'money_held' then
    raise exception 'Money is already held or paid for this booking. Report a problem so support can cancel it and settle the money safely.'
      using errcode = 'P0001', hint = 'money_held';
  end if;
  if v_block = 'payment_started' then
    raise exception 'A payment has just started. Please wait a moment and try again.' using errcode = 'P0001', hint = 'payment_started';
  end if;
  if v_block is not null then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;

  select coalesce(array_agg(t.id), '{}') into v_threads from public.message_threads t where t.context_type = 'booking' and t.context_id::text = p_booking::text;
  -- the same three effects as job_cancel, in the same order
  update public.payment_requests set status = 'cancelled', updated_at = now()
   where thread_id = any (v_threads) and status in ('pending', 'failed');
  get diagnostics v_n = row_count;
  update public.job_requests set status = 'expired', responded_at = now()
   where thread_id = any (v_threads) and status = 'pending';
  update public.bookings set status = 'cancelled' where id = p_booking;

  insert into public.local_booking_cancellations (booking_id, request_id, reason_key, note, coordinator_id)
  values (p_booking, p_request_id, p_reason, v_note, v_me);

  -- The actor is the Local Tasker's user, not the coordinator: the Job Room line is a message and the real messages table only accepts
  -- people who exist in public.users as sender (a coordinator does not), so with the coordinator as actor the line was silently dropped
  -- (found by the owner's first run). The text says who cancelled; the coordinator is recorded in the cancellation row and the audit row.
  v_text := 'Job cancelled by your StreetTasker coordinator';
  perform public._job_event(p_booking, s.tasker_user_id, 'cancelled', v_text,
    (case p_reason when 'customer_asked' then 'Customer asked to cancel' when 'customer_unreachable' then 'Customer could not be reached'
                   when 'tasker_unavailable' then 'Local Tasker is not available' when 'tasker_no_show' then 'Local Tasker did not come'
                   else 'Other reason' end) || coalesce(' - ' || v_note, ''));
  return jsonb_build_object('cancelled', true, 'changed', true, 'duplicate', false, 'requests_cancelled', v_n);
end $$;
revoke all on function public.local_booking_cancel(uuid, uuid, text, text) from public, anon;
grant execute on function public.local_booking_cancel(uuid, uuid, text, text) to authenticated, service_role;

-- 4. coordinator: open a problem report for the Local Tasker --------------------------------------------------------
create or replace function public.local_booking_open_problem(p_booking uuid, p_request_id uuid, p_category text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; r public.local_booking_problem_reports;
  v_reason text := btrim(coalesce(p_reason, '')); v_block text; v_thread uuid; v_id uuid;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if p_request_id is null or p_category is null or p_category not in ('not_done', 'poor_quality', 'no_show', 'wrong_amount', 'payment_issue', 'other') then
    raise exception 'Choose what the problem is about.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if char_length(v_reason) < 10 or char_length(v_reason) > 1000 then
    raise exception 'Describe the problem in 10 to 1000 characters.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  select * into r from public.local_booking_problem_reports where request_id = p_request_id;
  if found then                                              -- a retry: same answer, nothing new
    if r.booking_id <> p_booking or r.coordinator_id <> v_me or r.category <> p_category then
      raise exception 'That request was already used for something else.' using errcode = 'P0001', hint = 'bad_input';
    end if;
    return jsonb_build_object('dispute_id', r.dispute_id, 'changed', false, 'duplicate', true);
  end if;

  select * into b from public.bookings where id = p_booking for update;
  v_block := public._local_booking_report_block(p_booking);
  if v_block = 'booking_closed' then raise exception 'This booking is closed.' using errcode = 'P0001', hint = 'booking_closed'; end if;
  if v_block = 'dispute_open' then raise exception 'A problem report is already open on this booking.' using errcode = 'P0001', hint = 'dispute_open'; end if;
  if v_block = 'too_many' then raise exception 'Too many reports today. Please wait before opening another.' using errcode = 'P0001', hint = 'too_many'; end if;
  if v_block is not null then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;

  v_thread := public._local_booking_thread(p_booking, b.customer_id, s.tasker_user_id);        -- the Job Room (existing, or a new one)
  begin
    -- the BEFORE INSERT trigger job_disputes_sync_booking freezes the booking (status 'disputed') and remembers the old status
    insert into public.job_disputes (thread_id, opened_by, opened_by_role, category, reason)
    values (v_thread, s.tasker_user_id, 'tasker', p_category, v_reason) returning id into v_id;
  exception when unique_violation then
    raise exception 'A problem report is already open on this booking.' using errcode = 'P0001', hint = 'dispute_open';
  end;
  insert into public.dispute_events (dispute_id, thread_id, kind, actor_id, note)
  values (v_id, v_thread, 'opened', v_me, 'Opened by the coordinator for the Local Tasker');
  insert into public.local_booking_problem_reports (booking_id, dispute_id, request_id, coordinator_id, category)
  values (p_booking, v_id, p_request_id, v_me, p_category);

  perform public._notify(b.customer_id, 'job_update', 'A problem was reported on your job',
    'Payments on this job are paused until StreetTasker support has decided it.',
    jsonb_build_object('booking_id', p_booking, 'thread_id', v_thread));
  return jsonb_build_object('dispute_id', v_id, 'changed', true, 'duplicate', false);
end $$;
revoke all on function public.local_booking_open_problem(uuid, uuid, text, text) from public, anon;
grant execute on function public.local_booking_open_problem(uuid, uuid, text, text) to authenticated, service_role;

-- 5. coordinator: withdraw a report this path opened (only while it is still 'open') ----------------------------------
create or replace function public.local_booking_withdraw_problem(p_booking uuid, p_dispute uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); s public.local_booking_state; r public.local_booking_problem_reports; d public.job_disputes;
begin
  if v_me is null or p_booking is null or p_dispute is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into r from public.local_booking_problem_reports where dispute_id = p_dispute and booking_id = p_booking;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into d from public.job_disputes where id = p_dispute for update;
  if d.status = 'withdrawn' then return jsonb_build_object('withdrawn', true, 'changed', false); end if;
  if d.status <> 'open' then
    raise exception 'Support is already reviewing or has decided this report, so it cannot be withdrawn.' using errcode = 'P0001', hint = 'not_open';
  end if;
  update public.job_disputes set status = 'withdrawn' where id = d.id;      -- the trigger gives the booking its earlier status back
  insert into public.dispute_events (dispute_id, thread_id, kind, actor_id, note)
  values (d.id, d.thread_id, 'withdrawn', v_me, 'Withdrawn by the coordinator');
  perform public._local_booking_log(p_booking, 'problem_withdrawn', null, r.category, s.coordinator_id, null, v_me, 'coordinator', null);
  perform public.local_tasker_audit('local_booking_problem_withdrawn', 'booking', p_booking::text, null,
    jsonb_build_object('dispute_id', d.id), v_me);
  return jsonb_build_object('withdrawn', true, 'changed', true);
end $$;
revoke all on function public.local_booking_withdraw_problem(uuid, uuid) from public, anon;
grant execute on function public.local_booking_withdraw_problem(uuid, uuid) to authenticated, service_role;

-- 6. coordinator: what can be done now, and why not ----------------------------------------------------------------------
create or replace function public.local_booking_closeout(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; c public.local_booking_cancellations;
  v_cb text; v_rb text; v_probs jsonb;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into b from public.bookings where id = p_booking;
  v_cb := public._local_booking_cancel_block(p_booking);
  v_rb := public._local_booking_report_block(p_booking);
  select * into c from public.local_booking_cancellations where booking_id = p_booking;
  select coalesce(jsonb_agg(jsonb_build_object('dispute_id', r.dispute_id, 'category', r.category, 'status', d.status, 'opened_at', d.opened_at,
                                               'can_withdraw', d.status = 'open') order by d.opened_at desc, r.created_at desc), '[]'::jsonb)
    into v_probs
    from public.local_booking_problem_reports r join public.job_disputes d on d.id = r.dispute_id where r.booking_id = p_booking;
  return jsonb_build_object('booking_id', p_booking, 'lt_status', s.lt_status, 'booking_status', b.status,
    'can_cancel', v_cb is null, 'cancel_blocked', v_cb, 'can_report', v_rb is null, 'report_blocked', v_rb,
    'cancellation', case when c.id is null then null else jsonb_build_object('reason', c.reason_key, 'note', c.note, 'at', c.cancelled_at) end,
    'problems', v_probs);
end $$;
revoke all on function public.local_booking_closeout(uuid) from public, anon;
grant execute on function public.local_booking_closeout(uuid) to authenticated, service_role;

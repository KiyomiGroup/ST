-- ============================================================================
-- StreetTasker Local Tasker: STAGE 5D-3a core (exceptions, part 1: customer unreachable, tasker no-show, going-back rule)
-- Additive and re-runnable. Rollback: stage-5d3a-rollback.sql. Needs stage-5d2-core.sql (and so 5D-1, 5C-2, 5C-1, 5A) first.
-- Run in the Supabase SQL editor (select all, Run). Safe to run twice.
--
-- What it adds:
--   1. local_booking_exceptions: one immutable row per recorded exception ('customer_unreachable', 'tasker_no_show'),
--      written only by local_booking_record_exception. Nobody can write it from the browser.
--   2. local_booking_record_exception (coordinator rpc). RECORDS what happened; it never changes lt_status, the booking,
--      a payment, escrow, a wallet or the release code.
--        customer_unreachable: the coordinator tried to reach the customer and could not. Allowed while the quote is waiting
--          for the customer (quote_sent) or approved (quote_approved); repeatable, at most 5 per booking.
--        tasker_no_show: the Local Tasker did not come as agreed. Allowed once the quote is approved, only if "arrived" is not
--          recorded, once per current quote. While a no-show stands, no day-of-the-job step can be recorded (the coordinator must
--          send the booking back to the Local Tasker for a new answer, or wait for 5D-3b: cancellation / dispute).
--   3. Going-back rule (owner decision, 5D-3): the booking cannot be sent back to the Local Tasker (a scope or price change)
--      once "arrived" is recorded. Done by a trigger on local_booking_state, so _local_booking_transition itself is NOT replaced.
--   4. _local_booking_milestone_block and local_booking_record_milestone (both from 5D-2) are replaced to know about a standing no-show.
--   5. local_booking_exceptions (coordinator read) and local_booking_customer_exceptions (customer read: kind and time only).
-- NEVER writes: bookings, payment_requests, payment_intents, escrow, wallets, release code, lt_status. Reads bookings.status only.
-- ============================================================================

-- 0. Pre-flight ----------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.local_booking_milestones') is null
     or to_regprocedure('public.local_booking_record_milestone(uuid,uuid,text,timestamptz,text)') is null
     or to_regprocedure('public._local_booking_milestone_block(uuid,text)') is null then
    raise exception 'Run stage-5d2-core.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.local_booking_quotes') is null or to_regclass('public.local_booking_state') is null
     or to_regprocedure('public._local_booking_log(uuid,text,text,text,uuid,uuid,uuid,text,text)') is null
     or to_regprocedure('public.job_booking_frozen(uuid)') is null or to_regprocedure('public.local_tasker_audit(text,text,text,jsonb,jsonb,uuid)') is null then
    raise exception 'A Stage 5A / 5C / 2B function is missing. Nothing was changed.';
  end if;
end $$;

-- 1. the exception records --------------------------------------------------------------------------------------
create table if not exists public.local_booking_exceptions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind text not null,
  request_id uuid not null unique,                         -- makes a retried tap harmless
  happened_at timestamptz not null,                        -- when it happened, as the coordinator says (not when it was typed)
  recorded_at timestamptz not null default clock_timestamp(),
  coordinator_id uuid not null,
  note text,
  constraint lbx_kind_check check (kind in ('customer_unreachable', 'tasker_no_show')),
  constraint lbx_note_check check (note is null or char_length(note) <= 300)
);
create index if not exists lbx_booking_idx on public.local_booking_exceptions (booking_id, happened_at);
alter table public.local_booking_exceptions enable row level security;
drop policy if exists lt_exceptions_admin_read on public.local_booking_exceptions;
create policy lt_exceptions_admin_read on public.local_booking_exceptions for select to authenticated using (public.is_local_tasker_admin());
revoke all on public.local_booking_exceptions from public, anon, authenticated;
grant select on public.local_booking_exceptions to authenticated;          -- RLS: administrators only
grant select, insert on public.local_booking_exceptions to service_role;

create or replace function public.local_booking_exceptions_guard() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    if pg_trigger_depth() > 1 then return OLD; end if;     -- only the booking cascade
    raise exception 'A recorded exception cannot be deleted.' using errcode = 'P0001', hint = 'immutable';
  end if;
  raise exception 'A recorded exception cannot be edited.' using errcode = 'P0001', hint = 'immutable';
end $$;
drop trigger if exists lbx_guard on public.local_booking_exceptions;
create trigger lbx_guard before update or delete on public.local_booking_exceptions
  for each row execute function public.local_booking_exceptions_guard();
revoke all on function public.local_booking_exceptions_guard() from public, anon, authenticated;

create or replace function public.local_booking_exceptions_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._local_booking_log(NEW.booking_id, 'exception', null, NEW.kind, NEW.coordinator_id, null, NEW.coordinator_id, 'coordinator', NEW.note);
  perform public.local_tasker_audit('local_booking_exception', 'booking', NEW.booking_id::text, null,
    jsonb_build_object('exception_id', NEW.id, 'kind', NEW.kind, 'happened_at', NEW.happened_at), NEW.coordinator_id);
  return NEW;
end $$;
drop trigger if exists lbx_audit on public.local_booking_exceptions;
create trigger lbx_audit after insert on public.local_booking_exceptions
  for each row execute function public.local_booking_exceptions_audit();
revoke all on function public.local_booking_exceptions_audit() from public, anon, authenticated;

-- 2. helper: is a no-show standing for the CURRENT quote? (internal, no browser access) ---------------------------
-- A no-show belongs to the quote that was current when it was recorded. Sending the booking back for a new answer replaces the
-- quote (5C-2), so the old no-show stops standing and the booking can move on.
create or replace function public._local_booking_no_show_standing(p_booking uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.local_booking_exceptions x
                   left join public.local_booking_quotes q on q.booking_id = x.booking_id and q.superseded_at is null
                  where x.booking_id = p_booking and x.kind = 'tasker_no_show' and x.recorded_at >= coalesce(q.created_at, '-infinity'::timestamptz))
$$;
revoke all on function public._local_booking_no_show_standing(uuid) from public, anon, authenticated;
grant execute on function public._local_booking_no_show_standing(uuid) to service_role;

-- 3. 5D-2 helper replaced: a standing no-show blocks the day-of-the-job steps ------------------------------------
create or replace function public._local_booking_milestone_block(p_booking uuid, p_next text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.local_booking_state; b public.bookings;
begin
  select * into s from public.local_booking_state where booking_id = p_booking;
  select * into b from public.bookings where id = p_booking;
  if s.booking_id is null or b.id is null then return 'not_found'; end if;
  if not public._local_booking_is_open(b.status) or b.status = 'disputed' then return 'booking_closed'; end if;
  if public.job_booking_frozen(p_booking) then return 'dispute_open'; end if;
  if s.lt_status <> 'quote_approved' then return 'not_approved'; end if;
  if public._local_booking_no_show_standing(p_booking) then return 'no_show'; end if;     -- 5D-3a
  if p_next is null then return 'all_recorded'; end if;
  if p_next = 'started' and coalesce(b.payment_status, 'unpaid') in ('unpaid', 'pending') then return 'payment_needed'; end if;
  return null;
end $$;
revoke all on function public._local_booking_milestone_block(uuid, text) from public, anon, authenticated;
grant execute on function public._local_booking_milestone_block(uuid, text) to service_role;

-- 4. 5D-2 record function replaced: identical to 5D-2 plus one refusal ('no_show_standing') ------------------------
create or replace function public.local_booking_record_milestone(
  p_booking uuid, p_request_id uuid, p_kind text, p_happened_at timestamptz, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; m public.local_booking_milestones; v_next text; v_block text;
  v_when timestamptz; v_prev timestamptz; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_order text[] := public._local_booking_milestone_order();
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if p_request_id is null or p_kind is null or not (p_kind = any (v_order)) then
    raise exception 'That milestone is not known.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'The note is too long.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  select * into m from public.local_booking_milestones where request_id = p_request_id;
  if found then                                              -- a retry: same answer, nothing new
    if m.booking_id <> p_booking or m.coordinator_id <> v_me or m.kind <> p_kind then
      raise exception 'That request was already used for something else.' using errcode = 'P0001', hint = 'bad_input';
    end if;
    return jsonb_build_object('kind', m.kind, 'happened_at', m.happened_at, 'changed', false, 'duplicate', true);
  end if;

  select k into v_next from unnest(v_order) with ordinality as t(k, o)
   where not exists (select 1 from public.local_booking_milestones x where x.booking_id = p_booking and x.kind = t.k) order by o limit 1;
  v_block := public._local_booking_milestone_block(p_booking, v_next);
  if v_block = 'booking_closed' then raise exception 'This booking is closed.' using errcode = 'P0001', hint = 'booking_closed'; end if;
  if v_block = 'dispute_open' then raise exception 'A problem report is open on this booking.' using errcode = 'P0001', hint = 'dispute_open'; end if;
  if v_block = 'not_approved' then raise exception 'The customer has not approved the quote yet.' using errcode = 'P0001', hint = 'not_approved'; end if;
  if v_block = 'no_show' then raise exception 'A no-show is on record for this booking, so no step can be recorded.' using errcode = 'P0001', hint = 'no_show_standing'; end if;
  if v_block = 'all_recorded' or exists (select 1 from public.local_booking_milestones x where x.booking_id = p_booking and x.kind = p_kind) then
    raise exception 'That milestone is already recorded.' using errcode = 'P0001', hint = 'already_recorded';
  end if;
  if p_kind <> v_next then
    raise exception 'Record the earlier steps first.' using errcode = 'P0001', hint = 'out_of_order';
  end if;
  if v_block = 'payment_needed' then
    raise exception 'The customer has not paid yet, so the work cannot be marked as started.' using errcode = 'P0001', hint = 'payment_needed';
  end if;

  v_when := coalesce(p_happened_at, now());
  if v_when > now() + interval '5 minutes' or v_when < now() - interval '3 days' then
    raise exception 'The time must be within the last 3 days and not in the future.' using errcode = 'P0001', hint = 'bad_time';
  end if;
  select max(happened_at) into v_prev from public.local_booking_milestones where booking_id = p_booking;
  if v_prev is not null and v_when < v_prev then
    raise exception 'That time is earlier than the step before it.' using errcode = 'P0001', hint = 'bad_time';
  end if;

  insert into public.local_booking_milestones (booking_id, kind, request_id, happened_at, coordinator_id, note)
  values (p_booking, p_kind, p_request_id, v_when, v_me, v_note);
  return jsonb_build_object('kind', p_kind, 'happened_at', v_when, 'changed', true, 'duplicate', false);
end $$;
revoke all on function public.local_booking_record_milestone(uuid, uuid, text, timestamptz, text) from public, anon;
grant execute on function public.local_booking_record_milestone(uuid, uuid, text, timestamptz, text) to authenticated, service_role;

-- 5. coordinator: record an exception ---------------------------------------------------------------------------------
create or replace function public.local_booking_record_exception(
  p_booking uuid, p_request_id uuid, p_kind text, p_happened_at timestamptz, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; x public.local_booking_exceptions;
  v_when timestamptz; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if p_request_id is null or p_kind is null or p_kind not in ('customer_unreachable', 'tasker_no_show') then
    raise exception 'That exception is not known.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'The note is too long.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  select * into x from public.local_booking_exceptions where request_id = p_request_id;
  if found then                                              -- a retry: same answer, nothing new
    if x.booking_id <> p_booking or x.coordinator_id <> v_me or x.kind <> p_kind then
      raise exception 'That request was already used for something else.' using errcode = 'P0001', hint = 'bad_input';
    end if;
    return jsonb_build_object('kind', x.kind, 'happened_at', x.happened_at, 'changed', false, 'duplicate', true);
  end if;

  select * into b from public.bookings where id = p_booking;
  if not public._local_booking_is_open(b.status) or b.status = 'disputed' then
    raise exception 'This booking is closed.' using errcode = 'P0001', hint = 'booking_closed';
  end if;
  if public.job_booking_frozen(p_booking) then
    raise exception 'A problem report is open on this booking.' using errcode = 'P0001', hint = 'dispute_open';
  end if;

  if p_kind = 'customer_unreachable' then
    if s.lt_status not in ('quote_sent', 'quote_approved') then
      raise exception 'The customer is not being waited on at this step.' using errcode = 'P0001', hint = 'wrong_step';
    end if;
    if (select count(*) from public.local_booking_exceptions e where e.booking_id = p_booking and e.kind = 'customer_unreachable') >= 5 then
      raise exception 'Five attempts are already recorded. Contact an administrator.' using errcode = 'P0001', hint = 'limit_reached';
    end if;
  else
    if s.lt_status <> 'quote_approved' then
      raise exception 'A no-show can only be recorded once the customer has approved the quote.' using errcode = 'P0001', hint = 'wrong_step';
    end if;
    if exists (select 1 from public.local_booking_milestones m where m.booking_id = p_booking and m.kind in ('arrived', 'started', 'finished')) then
      raise exception 'The Local Tasker is already recorded as arrived.' using errcode = 'P0001', hint = 'already_arrived';
    end if;
    if public._local_booking_no_show_standing(p_booking) then
      raise exception 'A no-show is already recorded.' using errcode = 'P0001', hint = 'already_recorded';
    end if;
  end if;

  v_when := coalesce(p_happened_at, now());
  if v_when > now() + interval '5 minutes' or v_when < now() - interval '3 days' then
    raise exception 'The time must be within the last 3 days and not in the future.' using errcode = 'P0001', hint = 'bad_time';
  end if;

  insert into public.local_booking_exceptions (booking_id, kind, request_id, happened_at, coordinator_id, note)
  values (p_booking, p_kind, p_request_id, v_when, v_me, v_note);
  return jsonb_build_object('kind', p_kind, 'happened_at', v_when, 'changed', true, 'duplicate', false);
end $$;
revoke all on function public.local_booking_record_exception(uuid, uuid, text, timestamptz, text) from public, anon;
grant execute on function public.local_booking_record_exception(uuid, uuid, text, timestamptz, text) to authenticated, service_role;

-- 6. coordinator: read the exceptions of one of their bookings ---------------------------------------------------------
create or replace function public.local_booking_exceptions(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; v_items jsonb;
  v_open boolean; v_unreach_reason text; v_noshow_reason text; v_n int;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into b from public.bookings where id = p_booking;
  v_open := public._local_booking_is_open(b.status) and b.status <> 'disputed';
  select count(*) into v_n from public.local_booking_exceptions e where e.booking_id = p_booking and e.kind = 'customer_unreachable';

  v_unreach_reason := case when not v_open then 'booking_closed' when public.job_booking_frozen(p_booking) then 'dispute_open'
                           when s.lt_status not in ('quote_sent', 'quote_approved') then 'wrong_step' when v_n >= 5 then 'limit_reached' else null end;
  v_noshow_reason := case when not v_open then 'booking_closed' when public.job_booking_frozen(p_booking) then 'dispute_open'
                          when s.lt_status <> 'quote_approved' then 'wrong_step'
                          when exists (select 1 from public.local_booking_milestones m where m.booking_id = p_booking and m.kind in ('arrived', 'started', 'finished')) then 'already_arrived'
                          when public._local_booking_no_show_standing(p_booking) then 'already_recorded' else null end;

  select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'happened_at', e.happened_at, 'recorded_at', e.recorded_at, 'note', e.note)
                            order by e.happened_at, e.recorded_at), '[]'::jsonb)
    into v_items from public.local_booking_exceptions e where e.booking_id = p_booking;
  return jsonb_build_object('booking_id', p_booking, 'lt_status', s.lt_status, 'items', v_items,
                            'can_unreachable', v_unreach_reason is null, 'unreachable_blocked', v_unreach_reason,
                            'can_no_show', v_noshow_reason is null, 'no_show_blocked', v_noshow_reason,
                            'no_show_standing', public._local_booking_no_show_standing(p_booking),
                            'can_go_back', not exists (select 1 from public.local_booking_milestones m where m.booking_id = p_booking and m.kind in ('arrived', 'started', 'finished')));
end $$;
revoke all on function public.local_booking_exceptions(uuid) from public, anon;
grant execute on function public.local_booking_exceptions(uuid) to authenticated, service_role;

-- 7. customer: read the exceptions of their own bookings (kind and time only: no ids, no notes) ------------------------
create or replace function public.local_booking_customer_exceptions(p_booking uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Please log in.' using errcode = 'P0001', hint = 'not_found'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('booking_id', t.booking_id, 'items', t.items) order by t.last_at desc)
      from (select s.booking_id, max(e.happened_at) as last_at,
                   jsonb_agg(jsonb_build_object('kind', e.kind, 'happened_at', e.happened_at) order by e.happened_at, e.recorded_at) as items
              from public.local_booking_state s
              join public.bookings b on b.id = s.booking_id and b.customer_id = v_me
              join public.local_booking_exceptions e on e.booking_id = s.booking_id
             where (p_booking is null or s.booking_id = p_booking)
             group by s.booking_id order by max(e.happened_at) desc limit 50) t), '[]'::jsonb);
end $$;
revoke all on function public.local_booking_customer_exceptions(uuid) from public, anon;
grant execute on function public.local_booking_customer_exceptions(uuid) to authenticated, service_role;

-- 8. going-back rule: no new price or scope once the Local Tasker has arrived ----------------------------------------
-- A trigger on the state table, so the 5D-1 _local_booking_transition does not need to be replaced. It raises inside the same
-- transaction, so the superseding of the confirmation and the quote done just before the status update is rolled back with it.
create or replace function public.local_booking_state_going_back_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if NEW.lt_status = 'awaiting_tasker_confirmation' and OLD.lt_status is distinct from 'awaiting_tasker_confirmation'
     and exists (select 1 from public.local_booking_milestones m where m.booking_id = NEW.booking_id and m.kind in ('arrived', 'started', 'finished')) then
    raise exception 'The Local Tasker has already arrived, so this booking cannot be sent back for a new price. Report a problem or contact an administrator.'
      using errcode = 'P0001', hint = 'work_started';
  end if;
  return NEW;
end $$;
drop trigger if exists lbs_going_back_guard on public.local_booking_state;
create trigger lbs_going_back_guard before update of lt_status on public.local_booking_state
  for each row execute function public.local_booking_state_going_back_guard();
revoke all on function public.local_booking_state_going_back_guard() from public, anon, authenticated;

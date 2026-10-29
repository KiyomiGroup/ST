-- ============================================================================
-- StreetTasker Local Tasker: STAGE 5D-2 core (milestones on the day of the job)
-- Additive and re-runnable. Rollback: stage-5d2-rollback.sql. Needs stage-5d1-core.sql (and so 5A, 5C-1, 5C-2) first.
-- Run in the Supabase SQL editor (select all, Run). Safe to run twice.
--
-- What it adds:
--   1. local_booking_milestones: one immutable row per milestone (address_confirmed, arrived, started, finished),
--      written only by local_booking_record_milestone. Nobody can write it from the browser.
--   2. local_booking_record_milestone (coordinator rpc): records WHAT HAPPENED and WHEN (as told by the Local Tasker
--      on the phone). Allowed only when the customer has approved the quote (lt_status = quote_approved), the booking is
--      open and not frozen by a problem report, in this order: address_confirmed -> arrived -> started -> finished.
--      'started' also needs the main payment to be on record (bookings.payment_status not unpaid/pending): work does not
--      begin on an unpaid booking. Retry-safe (same request id returns the earlier result).
--   3. local_booking_milestones (coordinator read) and local_booking_customer_milestones (customer read, no internal ids,
--      no coordinator notes).
-- NEVER writes: bookings, payment_requests, payment_intents, escrow, wallets, the release code, lt_status. It only READS
-- bookings.status / payment_status. 'finished' is a record only: it does not mark the job done, does not release money
-- and does not ask for the code (those stay in the existing flow, stages 6 and 7).
-- ============================================================================

-- 0. Pre-flight ----------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.local_booking_quote_decisions') is null
     or to_regprocedure('public.local_booking_decide_quote(uuid,integer,uuid,text,text)') is null then
    raise exception 'Run stage-5d1-core.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.local_booking_state') is null or to_regprocedure('public._local_booking_log(uuid,text,text,text,uuid,uuid,uuid,text,text)') is null
     or to_regprocedure('public.job_booking_frozen(uuid)') is null or to_regprocedure('public.local_tasker_audit(text,text,text,jsonb,jsonb,uuid)') is null then
    raise exception 'A Stage 5A / 2B function is missing. Nothing was changed.';
  end if;
end $$;

-- 1. the milestone records --------------------------------------------------------------------------------------
create table if not exists public.local_booking_milestones (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind text not null,
  request_id uuid not null unique,                         -- makes a retried tap harmless
  happened_at timestamptz not null,                        -- when it happened, as the Local Tasker said (not when it was typed)
  recorded_at timestamptz not null default clock_timestamp(),
  coordinator_id uuid not null,
  note text,
  constraint lbm_kind_check check (kind in ('address_confirmed', 'arrived', 'started', 'finished')),
  constraint lbm_note_check check (note is null or char_length(note) <= 300),
  constraint lbm_booking_kind_key unique (booking_id, kind)  -- each milestone is recorded once
);
create index if not exists lbm_booking_idx on public.local_booking_milestones (booking_id, happened_at);
alter table public.local_booking_milestones enable row level security;
drop policy if exists lt_milestones_admin_read on public.local_booking_milestones;
create policy lt_milestones_admin_read on public.local_booking_milestones for select to authenticated using (public.is_local_tasker_admin());
revoke all on public.local_booking_milestones from public, anon, authenticated;
grant select on public.local_booking_milestones to authenticated;          -- RLS: administrators only
grant select, insert on public.local_booking_milestones to service_role;

create or replace function public.local_booking_milestones_guard() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    if pg_trigger_depth() > 1 then return OLD; end if;     -- only the booking cascade
    raise exception 'A recorded milestone cannot be deleted.' using errcode = 'P0001', hint = 'immutable';
  end if;
  raise exception 'A recorded milestone cannot be edited.' using errcode = 'P0001', hint = 'immutable';
end $$;
drop trigger if exists lbm_guard on public.local_booking_milestones;
create trigger lbm_guard before update or delete on public.local_booking_milestones
  for each row execute function public.local_booking_milestones_guard();
revoke all on function public.local_booking_milestones_guard() from public, anon, authenticated;

-- automatic audit: every milestone writes an event row and an audit row, whoever inserted it
create or replace function public.local_booking_milestones_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._local_booking_log(NEW.booking_id, 'milestone', null, NEW.kind, NEW.coordinator_id, null, NEW.coordinator_id, 'coordinator', NEW.note);
  perform public.local_tasker_audit('local_booking_milestone', 'booking', NEW.booking_id::text, null,
    jsonb_build_object('milestone_id', NEW.id, 'kind', NEW.kind, 'happened_at', NEW.happened_at), NEW.coordinator_id);
  return NEW;
end $$;
drop trigger if exists lbm_audit on public.local_booking_milestones;
create trigger lbm_audit after insert on public.local_booking_milestones
  for each row execute function public.local_booking_milestones_audit();
revoke all on function public.local_booking_milestones_audit() from public, anon, authenticated;

-- 2. helpers (internal, no browser access) --------------------------------------------------------------------
create or replace function public._local_booking_milestone_order() returns text[]
language sql immutable as $$ select array['address_confirmed', 'arrived', 'started', 'finished'] $$;

-- why the next milestone cannot be recorded right now (null = it can)
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
  if p_next is null then return 'all_recorded'; end if;
  if p_next = 'started' and coalesce(b.payment_status, 'unpaid') in ('unpaid', 'pending') then return 'payment_needed'; end if;
  return null;
end $$;
revoke all on function public._local_booking_milestone_order(), public._local_booking_milestone_block(uuid, text) from public, anon, authenticated;
grant execute on function public._local_booking_milestone_order(), public._local_booking_milestone_block(uuid, text) to service_role;

-- 3. coordinator: record a milestone ---------------------------------------------------------------------------
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

-- 4. coordinator: read the milestones of one of their bookings --------------------------------------------------
create or replace function public.local_booking_milestones(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); s public.local_booking_state; v_next text; v_block text; v_items jsonb;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select k into v_next from unnest(public._local_booking_milestone_order()) with ordinality as t(k, o)
   where not exists (select 1 from public.local_booking_milestones x where x.booking_id = p_booking and x.kind = t.k) order by o limit 1;
  v_block := public._local_booking_milestone_block(p_booking, v_next);
  select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'happened_at', x.happened_at, 'recorded_at', x.recorded_at, 'note', x.note)
                            order by array_position(public._local_booking_milestone_order(), x.kind)), '[]'::jsonb)
    into v_items from public.local_booking_milestones x where x.booking_id = p_booking;
  return jsonb_build_object('booking_id', p_booking, 'lt_status', s.lt_status, 'items', v_items, 'next_kind', v_next,
                            'can_record', v_block is null, 'blocked_reason', v_block);
end $$;
revoke all on function public.local_booking_milestones(uuid) from public, anon;
grant execute on function public.local_booking_milestones(uuid) to authenticated, service_role;

-- 5. customer: read the milestones of their own bookings ------------------------------------------------------
create or replace function public.local_booking_customer_milestones(p_booking uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Please log in.' using errcode = 'P0001', hint = 'not_found'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('booking_id', t.booking_id, 'items', t.items) order by t.last_at desc)
      from (select s.booking_id, max(m.happened_at) as last_at,
                   jsonb_agg(jsonb_build_object('kind', m.kind, 'happened_at', m.happened_at)
                             order by array_position(public._local_booking_milestone_order(), m.kind)) as items
              from public.local_booking_state s
              join public.bookings b on b.id = s.booking_id and b.customer_id = v_me
              join public.local_booking_milestones m on m.booking_id = s.booking_id
             where (p_booking is null or s.booking_id = p_booking)
             group by s.booking_id order by max(m.happened_at) desc limit 50) t), '[]'::jsonb);
end $$;
revoke all on function public.local_booking_customer_milestones(uuid) from public, anon;
grant execute on function public.local_booking_customer_milestones(uuid) to authenticated, service_role;

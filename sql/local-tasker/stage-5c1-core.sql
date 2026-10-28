-- Stage 5C-1: the Local Tasker's confirmation, recorded by the coordinator from a phone call (settled design S3).
-- Additive and re-runnable. Rollback: stage-5c1-rollback.sql. Needs stage-5a1-core.sql and stage-5a2-core.sql first.
-- Run in the Supabase SQL editor (select all, Run). Run it twice; the second run must show no error.
--
-- What it does
--   1. local_booking_confirmations   one row per phone call: who was called, the number, when, the answers (available,
--        can do it, the tasker's OWN price, duration, transport, materials, limitations), and that the price was read
--        back to the tasker. Rows are never edited or deleted; a new call supersedes the old one. No grants to the
--        browser at all: the only way in is local_booking_record_confirmation, the only way out is
--        local_booking_confirmations. So the tasker's price cannot be written or changed by any other route.
--   2. an automatic audit row for every insert, supersede and second-check change (trigger; local_booking_events and
--        local_tasker_audit_log). It cannot be skipped by calling a different function.
--   3. local_booking_record_confirmation (coordinator rpc): records the call and, for "confirmed" / "declined", moves
--        the booking to tasker_confirmed / tasker_declined in the same transaction. "No answer" is logged and changes nothing.
--   4. optional second check (admin call-back): OFF by default. If the coordinator switches it on, the quote cannot be
--        sent until an administrator records "passed" (local_booking_second_check). No paid SMS or voice service.
--   5. _local_booking_transition (5A) now refuses quote_sent without a current, valid, confirmed record, refuses
--        tasker_confirmed / tasker_declined unless they come from the record function, and marks the record
--        superseded when the booking is sent back for a new confirmation.
--   6. local_booking_step (5A) refuses tasker_confirmed / tasker_declined: the coordinator cannot mark acceptance
--        without the capture step.
--   7. local_booking_confirmations(p_booking) (coordinator rpc, read only): the current record, the call attempts, and
--        the tasker's name and phone on file.
-- Touches NO column of bookings and no payment, escrow, wallet or release-code object. Regular bookings are not involved.

-- 1. table ------------------------------------------------------------------------------------------
create table if not exists public.local_booking_confirmations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  tasker_user_id uuid not null,
  coordinator_id uuid not null,                  -- who made the call and recorded it
  request_id uuid not null unique,               -- makes a retried save harmless
  outcome text not null,
  called_name text not null,
  called_number text not null,
  number_matches_profile boolean not null default false,
  called_at timestamptz not null,
  available boolean,
  can_do boolean,
  proposed_price numeric(12, 2),                 -- the Local Tasker's own price (service fee); only ever set here
  duration_text text,
  transport_amount numeric(12, 2) not null default 0,
  materials_amount numeric(12, 2) not null default 0,
  materials_notes text,
  limitations text,
  agreed_notes text,
  read_back_confirmed boolean not null default false,
  second_check_status text not null default 'off',
  second_check_by uuid,
  second_check_at timestamptz,
  second_check_note text,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint lbc_outcome_check check (outcome in ('confirmed', 'declined', 'no_answer')),
  constraint lbc_second_check_check check (second_check_status in ('off', 'requested', 'passed', 'failed')),
  constraint lbc_amounts_check check (coalesce(proposed_price, 0) >= 0 and transport_amount >= 0 and materials_amount >= 0
                                      and coalesce(proposed_price, 0) <= 10000000 and transport_amount <= 10000000 and materials_amount <= 10000000),
  constraint lbc_confirmed_check check (outcome <> 'confirmed' or (available is true and can_do is true and proposed_price > 0
                                        and nullif(btrim(coalesce(duration_text, '')), '') is not null and read_back_confirmed is true)),
  constraint lbc_text_check check (char_length(called_name) <= 100 and char_length(called_number) <= 30
                                   and char_length(coalesce(duration_text, '')) <= 80 and char_length(coalesce(materials_notes, '')) <= 300
                                   and char_length(coalesce(limitations, '')) <= 300 and char_length(coalesce(agreed_notes, '')) <= 300)
);
create index if not exists lbc_booking_idx on public.local_booking_confirmations (booking_id, created_at desc);
-- at most ONE current confirmed/declined record per booking
create unique index if not exists lbc_one_current_idx on public.local_booking_confirmations (booking_id)
  where superseded_at is null and outcome in ('confirmed', 'declined');
alter table public.local_booking_confirmations enable row level security;
drop policy if exists lt_confirmations_admin_read on public.local_booking_confirmations;
create policy lt_confirmations_admin_read on public.local_booking_confirmations for select to authenticated
  using (public.is_local_tasker_admin());
revoke all on public.local_booking_confirmations from public, anon, authenticated;
grant select on public.local_booking_confirmations to authenticated;      -- RLS: administrators only
grant select, insert, update on public.local_booking_confirmations to service_role;

-- 2. immutable rows + automatic audit ---------------------------------------------------------------
create or replace function public.local_booking_confirmations_guard() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    if pg_trigger_depth() > 1 then return OLD; end if;      -- the database's own cascade only (booking removed)
    raise exception 'A recorded confirmation cannot be deleted.' using errcode = 'P0001';
  end if;
  -- only "superseded" and the second-check fields may ever change; everything the tasker said stays as recorded
  if (to_jsonb(OLD) - 'superseded_at' - 'second_check_status' - 'second_check_by' - 'second_check_at' - 'second_check_note')
     is distinct from
     (to_jsonb(NEW) - 'superseded_at' - 'second_check_status' - 'second_check_by' - 'second_check_at' - 'second_check_note')
     or (OLD.superseded_at is not null and NEW.superseded_at is distinct from OLD.superseded_at) then
    raise exception 'A recorded confirmation cannot be edited. Record a new call instead.' using errcode = 'P0001', hint = 'immutable';
  end if;
  return NEW;
end $$;
drop trigger if exists lbc_guard on public.local_booking_confirmations;
create trigger lbc_guard before update or delete on public.local_booking_confirmations
  for each row execute function public.local_booking_confirmations_guard();

create or replace function public.local_booking_confirmations_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_kind text; v_note text; v_actor uuid; v_role text := 'coordinator';
begin
  if TG_OP = 'INSERT' then
    v_kind := 'confirmation_recorded'; v_actor := NEW.coordinator_id;
    v_note := case NEW.outcome when 'confirmed' then 'Local Tasker confirmed, price ₦' || to_char(NEW.proposed_price, 'FM999G999G990D00')
                               when 'declined' then 'Local Tasker declined' else 'No answer' end
              || case when NEW.second_check_status = 'requested' then ' (second check asked for)' else '' end;
    perform public._local_booking_log(NEW.booking_id, v_kind, null, null, NEW.coordinator_id, null, v_actor, v_role, v_note);
    perform public.local_tasker_audit('local_booking_confirmation', 'booking', NEW.booking_id::text, null,
      jsonb_build_object('confirmation_id', NEW.id, 'outcome', NEW.outcome, 'proposed_price', NEW.proposed_price,
                         'transport_amount', NEW.transport_amount, 'materials_amount', NEW.materials_amount,
                         'number_matches_profile', NEW.number_matches_profile, 'second_check', NEW.second_check_status), v_actor);
  elsif NEW.superseded_at is not null and OLD.superseded_at is null then
    perform public._local_booking_log(NEW.booking_id, 'confirmation_superseded', null, null, NEW.coordinator_id, null, null, 'system',
                                      'An earlier Local Tasker confirmation is no longer current');
    perform public.local_tasker_audit('local_booking_confirmation_superseded', 'booking', NEW.booking_id::text,
      jsonb_build_object('confirmation_id', NEW.id), null, null);
  elsif NEW.second_check_status is distinct from OLD.second_check_status then
    v_actor := NEW.second_check_by; v_role := 'admin';
    perform public._local_booking_log(NEW.booking_id, 'second_check_' || NEW.second_check_status, null, null, NEW.coordinator_id, null, v_actor, v_role,
                                      NEW.second_check_note);
    perform public.local_tasker_audit('local_booking_second_check', 'booking', NEW.booking_id::text,
      jsonb_build_object('status', OLD.second_check_status), jsonb_build_object('status', NEW.second_check_status, 'confirmation_id', NEW.id), v_actor);
  end if;
  return NEW;
end $$;
drop trigger if exists lbc_audit on public.local_booking_confirmations;
create trigger lbc_audit after insert or update on public.local_booking_confirmations
  for each row execute function public.local_booking_confirmations_audit();
revoke all on function public.local_booking_confirmations_guard(), public.local_booking_confirmations_audit() from public, anon, authenticated;

-- 3. the state machine learns about confirmations (replaces the 5A function, same signature) ----------
create or replace function public._local_booking_transition(p_booking uuid, p_to text, p_actor uuid, p_role text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.local_booking_state; b public.bookings; v_note text := nullif(btrim(coalesce(p_note, '')), '');
        c public.local_booking_confirmations;
begin
  select * into s from public.local_booking_state where booking_id = p_booking for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'The note is too long.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if p_to is null or p_to not in ('assigned', 'awaiting_tasker_confirmation', 'tasker_confirmed', 'tasker_declined',
                                  'quote_sent', 'quote_approved', 'quote_declined') then
    raise exception 'Unknown status.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  select * into b from public.bookings where id = p_booking;
  if not public._local_booking_is_open(b.status) or b.status = 'disputed' then
    raise exception 'This booking is closed.' using errcode = 'P0001', hint = 'booking_closed';
  end if;
  if public.job_booking_frozen(p_booking) then
    raise exception 'A problem report is open on this booking.' using errcode = 'P0001', hint = 'dispute_open';
  end if;
  if s.lt_status = p_to then return jsonb_build_object('lt_status', s.lt_status, 'changed', false); end if;
  if not (p_to = any (public._local_booking_allowed_next(s.lt_status, p_role))) then
    raise exception 'That step is not allowed from "%".', s.lt_status using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  -- 5C-1: acceptance and refusal exist only as the result of a recorded call
  if p_to in ('tasker_confirmed', 'tasker_declined') and coalesce(current_setting('st.lt_capture', true), '') <> '1' then
    raise exception 'The Local Tasker''s answer must be recorded from a call.' using errcode = 'P0001', hint = 'use_confirmation';
  end if;
  -- 5C-1: a quote needs a current, valid, confirmed record (and a passed second check if one was asked for)
  if p_to = 'quote_sent' then
    select * into c from public.local_booking_confirmations
     where booking_id = p_booking and outcome = 'confirmed' and superseded_at is null and tasker_user_id = s.tasker_user_id
     order by created_at desc limit 1;
    if not found then
      raise exception 'The Local Tasker''s confirmation must be recorded before a quote is sent.' using errcode = 'P0001', hint = 'confirmation_required';
    end if;
    if c.second_check_status not in ('off', 'passed') then
      raise exception 'An administrator call-back to the Local Tasker is still needed before a quote is sent.' using errcode = 'P0001', hint = 'second_check_pending';
    end if;
  end if;
  -- 5C-1: sending the booking back for a new answer retires the old record (a changed price needs a new call)
  if p_to = 'awaiting_tasker_confirmation' then
    update public.local_booking_confirmations set superseded_at = now()
     where booking_id = p_booking and superseded_at is null and outcome in ('confirmed', 'declined');
  end if;
  update public.local_booking_state set lt_status = p_to, updated_at = now() where booking_id = p_booking;
  perform public._local_booking_log(p_booking, 'status_changed', s.lt_status, p_to, s.coordinator_id, null, p_actor, p_role, v_note);
  return jsonb_build_object('lt_status', p_to, 'changed', true);
end $$;
revoke all on function public._local_booking_transition(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public._local_booking_transition(uuid, text, uuid, text, text) to service_role;

-- the browser step function: no direct acceptance or refusal (replaces the 5A function, same signature)
create or replace function public.local_booking_step(p_booking uuid, p_to text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me)
     or not exists (select 1 from public.local_booking_state s where s.booking_id = p_booking and s.coordinator_id = v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if p_to in ('tasker_confirmed', 'tasker_declined') then
    raise exception 'The Local Tasker''s answer must be recorded from a call.' using errcode = 'P0001', hint = 'use_confirmation';
  end if;
  return public._local_booking_transition(p_booking, p_to, v_me, 'coordinator', p_note);
end $$;
revoke all on function public.local_booking_step(uuid, text, text) from public, anon;
grant execute on function public.local_booking_step(uuid, text, text) to authenticated, service_role;

-- 4. record a call (coordinator rpc) --------------------------------------------------------------------
create or replace function public.local_booking_record_confirmation(
  p_booking uuid, p_request_id uuid, p_outcome text, p_called_name text, p_called_number text, p_called_at timestamptz,
  p_available boolean, p_can_do boolean, p_price numeric, p_duration text, p_transport numeric, p_materials numeric,
  p_materials_notes text, p_limitations text, p_notes text, p_read_back boolean, p_second_check boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; old public.local_booking_confirmations;
  v_name text := nullif(btrim(coalesce(p_called_name, '')), ''); v_num text := nullif(btrim(coalesce(p_called_number, '')), '');
  v_dur text := nullif(btrim(coalesce(p_duration, '')), ''); v_mat text := nullif(btrim(coalesce(p_materials_notes, '')), '');
  v_lim text := nullif(btrim(coalesce(p_limitations, '')), ''); v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_tr numeric := coalesce(p_transport, 0); v_ma numeric := coalesce(p_materials, 0); v_at timestamptz := coalesce(p_called_at, now());
  v_phone text; v_match boolean := false; v_id uuid; v_to text; v_res jsonb;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if p_request_id is null then raise exception 'Missing request id.' using errcode = 'P0001', hint = 'bad_input'; end if;

  -- a retried save returns what was already recorded
  select * into old from public.local_booking_confirmations where request_id = p_request_id;
  if found then
    if old.booking_id <> p_booking or old.coordinator_id <> v_me then
      raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
    end if;
    return jsonb_build_object('confirmation_id', old.id, 'outcome', old.outcome, 'lt_status', s.lt_status, 'changed', false, 'duplicate', true);
  end if;

  select * into b from public.bookings where id = p_booking;
  if not public._local_booking_is_open(b.status) or b.status = 'disputed' then
    raise exception 'This booking is closed.' using errcode = 'P0001', hint = 'booking_closed';
  end if;
  if public.job_booking_frozen(p_booking) then
    raise exception 'A problem report is open on this booking.' using errcode = 'P0001', hint = 'dispute_open';
  end if;
  if s.lt_status not in ('assigned', 'awaiting_tasker_confirmation') then
    raise exception 'An answer can only be recorded while the booking is waiting for the Local Tasker.' using errcode = 'P0001', hint = 'invalid_transition';
  end if;

  -- validation (the table checks repeat the hard rules)
  if p_outcome is null or p_outcome not in ('confirmed', 'declined', 'no_answer') then
    raise exception 'Choose what the Local Tasker said.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if v_name is null or char_length(v_name) > 100 then raise exception 'Say who you spoke to.' using errcode = 'P0001', hint = 'bad_input'; end if;
  if v_num is null or v_num !~ '^\+?[0-9][0-9 ()-]{5,28}$' then
    raise exception 'Enter the number you called.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if v_at > now() + interval '5 minutes' or v_at < b.created_at - interval '1 minute' then
    raise exception 'The time of the call is not valid.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if v_tr < 0 or v_ma < 0 or v_tr > 10000000 or v_ma > 10000000 or coalesce(p_price, 0) < 0 or coalesce(p_price, 0) > 10000000 then
    raise exception 'An amount is not valid.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if coalesce(char_length(v_dur), 0) > 80 or coalesce(char_length(v_mat), 0) > 300 or coalesce(char_length(v_lim), 0) > 300
     or coalesce(char_length(v_notes), 0) > 300 then
    raise exception 'A note is too long.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if p_outcome = 'confirmed' then
    if p_available is not true or p_can_do is not true then
      raise exception 'Confirm that the Local Tasker is available and can do the job, or record that they declined.' using errcode = 'P0001', hint = 'bad_input';
    end if;
    if p_price is null or p_price <= 0 then raise exception 'Enter the price the Local Tasker gave.' using errcode = 'P0001', hint = 'bad_input'; end if;
    if v_dur is null then raise exception 'Enter how long the Local Tasker says it will take.' using errcode = 'P0001', hint = 'bad_input'; end if;
    if p_read_back is not true then
      raise exception 'Read the price back to the Local Tasker and confirm they agree.' using errcode = 'P0001', hint = 'bad_input';
    end if;
  elsif p_outcome = 'declined' and coalesce(char_length(coalesce(v_lim, v_notes)), 0) < 3 then
    raise exception 'Note why the Local Tasker declined.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  select p.phone into v_phone from public.local_tasker_profiles p where p.tasker_user_id = s.tasker_user_id;
  if v_phone is not null and length(regexp_replace(v_phone, '\D', '', 'g')) >= 7 then
    v_match := right(regexp_replace(v_phone, '\D', '', 'g'), 10) = right(regexp_replace(v_num, '\D', '', 'g'), 10);
  end if;

  if s.lt_status = 'assigned' then
    perform public._local_booking_transition(p_booking, 'awaiting_tasker_confirmation', v_me, 'coordinator', 'Called the Local Tasker');
  end if;
  if p_outcome in ('confirmed', 'declined') then
    update public.local_booking_confirmations set superseded_at = now()
     where booking_id = p_booking and superseded_at is null and outcome in ('confirmed', 'declined');
  end if;

  insert into public.local_booking_confirmations (booking_id, tasker_user_id, coordinator_id, request_id, outcome, called_name, called_number,
    number_matches_profile, called_at, available, can_do, proposed_price, duration_text, transport_amount, materials_amount, materials_notes,
    limitations, agreed_notes, read_back_confirmed, second_check_status)
  values (p_booking, s.tasker_user_id, v_me, p_request_id, p_outcome, v_name, v_num, v_match, v_at,
          case when p_outcome = 'no_answer' then null else p_available end, case when p_outcome = 'no_answer' then null else p_can_do end,
          case when p_outcome = 'confirmed' then round(p_price, 2) end, v_dur, round(v_tr, 2), round(v_ma, 2), v_mat, v_lim, v_notes,
          coalesce(p_read_back, false) and p_outcome = 'confirmed',
          case when p_outcome = 'confirmed' and p_second_check is true then 'requested' else 'off' end)
  returning id into v_id;

  if p_outcome in ('confirmed', 'declined') then
    v_to := case p_outcome when 'confirmed' then 'tasker_confirmed' else 'tasker_declined' end;
    perform set_config('st.lt_capture', '1', true);
    v_res := public._local_booking_transition(p_booking, v_to, v_me, 'coordinator', null);
    perform set_config('st.lt_capture', '', true);
  end if;
  return jsonb_build_object('confirmation_id', v_id, 'outcome', p_outcome,
    'lt_status', (select lt_status from public.local_booking_state where booking_id = p_booking), 'changed', p_outcome <> 'no_answer', 'duplicate', false);
end $$;
revoke all on function public.local_booking_record_confirmation(uuid, uuid, text, text, text, timestamptz, boolean, boolean, numeric, text, numeric, numeric, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.local_booking_record_confirmation(uuid, uuid, text, text, text, timestamptz, boolean, boolean, numeric, text, numeric, numeric, text, text, text, boolean, boolean) to authenticated, service_role;

-- 5. optional second check, recorded by an administrator ------------------------------------------------
create or replace function public.local_booking_second_check(p_confirmation uuid, p_passed boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); c public.local_booking_confirmations; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_me is null or not public.is_local_tasker_admin() then
    raise exception 'Not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if p_passed is null or coalesce(char_length(v_note), 0) > 300 then
    raise exception 'The result is not valid.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  select * into c from public.local_booking_confirmations where id = p_confirmation for update;
  if not found or c.superseded_at is not null or c.second_check_status <> 'requested' then
    raise exception 'There is no second check waiting on this record.' using errcode = 'P0001', hint = 'not_found';
  end if;
  update public.local_booking_confirmations
     set second_check_status = case when p_passed then 'passed' else 'failed' end, second_check_by = v_me, second_check_at = now(), second_check_note = v_note
   where id = p_confirmation;
  return jsonb_build_object('second_check', case when p_passed then 'passed' else 'failed' end);
end $$;
revoke all on function public.local_booking_second_check(uuid, boolean, text) from public, anon;
grant execute on function public.local_booking_second_check(uuid, boolean, text) to authenticated, service_role;

-- 6. read for the managing coordinator (rpc, read only) --------------------------------------------------
create or replace function public.local_booking_confirmations(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); s public.local_booking_state; p public.local_tasker_profiles; v_cur jsonb; v_att jsonb;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into p from public.local_tasker_profiles where tasker_user_id = s.tasker_user_id;
  select to_jsonb(x) into v_cur from (
    select c.outcome, c.called_name, c.called_number, c.number_matches_profile, c.called_at, c.available, c.can_do, c.proposed_price,
           c.duration_text, c.transport_amount, c.materials_amount, c.materials_notes, c.limitations, c.agreed_notes,
           c.second_check_status, c.second_check_note, c.created_at
      from public.local_booking_confirmations c
     where c.booking_id = p_booking and c.superseded_at is null and c.outcome in ('confirmed', 'declined')
     order by c.created_at desc limit 1) x;
  select coalesce(jsonb_agg(to_jsonb(y) order by y.created_at desc), '[]'::jsonb) into v_att from (
    select c.outcome, c.called_name, c.called_at, c.proposed_price, (c.superseded_at is not null) as superseded, c.created_at
      from public.local_booking_confirmations c where c.booking_id = p_booking order by c.created_at desc limit 20) y;
  return jsonb_build_object('booking_id', p_booking, 'lt_status', s.lt_status, 'tasker_name', p.full_name, 'tasker_phone', p.phone,
                            'current', v_cur, 'attempts', v_att);
end $$;
revoke all on function public.local_booking_confirmations(uuid) from public, anon;
grant execute on function public.local_booking_confirmations(uuid) to authenticated, service_role;

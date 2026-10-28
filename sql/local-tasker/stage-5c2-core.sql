-- Stage 5C-2: the itemised quote for a Local Tasker booking (built by the coordinator from the recorded tasker confirmation).
-- Additive and re-runnable. Rollback: stage-5c2-rollback.sql. Needs stage-5a1, 5a2, 5b and stage-5c1-core.sql first.
-- Run in the Supabase SQL editor (select all, Run). Run it twice; the second run must show no error.
--
-- What it does
--   1. local_booking_quotes   one row per quote version: service fee, transport, materials, other agreed costs, total.
--        Rows are never edited or deleted (a revised quote is a new version). No grants to the browser at all.
--   2. SERVICE FEE = the Local Tasker's own price from the current confirmed record. It is copied by the database;
--        no function parameter or column the coordinator can reach sets it. To change it: record a new answer (5C-1).
--   3. Transport and materials start at what the tasker said and can only be LOWERED or dropped, never raised
--        (a higher figure needs a new recorded call). Each is 0 or at least 100 (the Job Room minimum).
--   4. "Other agreed costs": optional, needs a label (60 chars) and may not exceed the service fee. Shown to the
--        customer as its own line (5D). Default decision D74, easy to change.
--   5. local_booking_send_quote (coordinator rpc): the ONLY way to reach quote_sent. The raw step to quote_sent is
--        now refused. Needs a current confirmed record (and a passed second check if one was asked for).
--   6. local_booking_quote(p_booking) (coordinator rpc, read only): the current quote with its lines, what the
--        confirmation allows, and earlier versions.
--   7. Money mapping (one place, in the read function): service fee = escrow main payment (payment_requests kind
--        'full_payment'), transport = 'transport', materials = 'materials', other = 'additional_cost'. The Local Tasker
--        pays 0% commission, so there is NO fee line. NOTHING is written to payment_requests, bookings, escrow or wallets here.
-- Touches no column of bookings. Regular bookings are not involved.

-- 1. table ------------------------------------------------------------------------------------------
create table if not exists public.local_booking_quotes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  confirmation_id uuid not null references public.local_booking_confirmations(id) on delete cascade,
  coordinator_id uuid not null,
  request_id uuid not null unique,
  version integer not null,
  service_fee numeric(12, 2) not null,
  transport_amount numeric(12, 2) not null default 0,
  materials_amount numeric(12, 2) not null default 0,
  other_amount numeric(12, 2) not null default 0,
  other_label text,
  other_note text,
  total numeric(12, 2) not null,
  note text,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint lbq_amounts_check check (service_fee >= 100 and transport_amount >= 0 and materials_amount >= 0 and other_amount >= 0
                                      and (transport_amount = 0 or transport_amount >= 100) and (materials_amount = 0 or materials_amount >= 100)
                                      and (other_amount = 0 or other_amount >= 100) and total <= 10000000),
  constraint lbq_total_check check (total = service_fee + transport_amount + materials_amount + other_amount),
  constraint lbq_other_check check (other_amount = 0 or (nullif(btrim(coalesce(other_label, '')), '') is not null and other_amount <= service_fee)),
  constraint lbq_text_check check (char_length(coalesce(other_label, '')) <= 60 and char_length(coalesce(other_note, '')) <= 300 and char_length(coalesce(note, '')) <= 300),
  constraint lbq_version_unique unique (booking_id, version)
);
create unique index if not exists lbq_one_current_idx on public.local_booking_quotes (booking_id) where superseded_at is null;
alter table public.local_booking_quotes enable row level security;
drop policy if exists lt_quotes_admin_read on public.local_booking_quotes;
create policy lt_quotes_admin_read on public.local_booking_quotes for select to authenticated using (public.is_local_tasker_admin());
revoke all on public.local_booking_quotes from public, anon, authenticated;
grant select on public.local_booking_quotes to authenticated;               -- RLS: administrators only
grant select, insert, update on public.local_booking_quotes to service_role;

-- 2. immutable rows + automatic audit ---------------------------------------------------------------
create or replace function public.local_booking_quotes_guard() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    if pg_trigger_depth() > 1 then return OLD; end if;
    raise exception 'A recorded quote cannot be deleted.' using errcode = 'P0001';
  end if;
  if (to_jsonb(OLD) - 'superseded_at') is distinct from (to_jsonb(NEW) - 'superseded_at')
     or (OLD.superseded_at is not null and NEW.superseded_at is distinct from OLD.superseded_at) then
    raise exception 'A recorded quote cannot be edited. Send a revised quote instead.' using errcode = 'P0001', hint = 'immutable';
  end if;
  return NEW;
end $$;
drop trigger if exists lbq_guard on public.local_booking_quotes;
create trigger lbq_guard before update or delete on public.local_booking_quotes
  for each row execute function public.local_booking_quotes_guard();

create or replace function public.local_booking_quotes_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if TG_OP = 'INSERT' then
    perform public._local_booking_log(NEW.booking_id, 'quote_recorded', null, null, NEW.coordinator_id, null, NEW.coordinator_id, 'coordinator',
      'Quote version ' || NEW.version || ', total ₦' || to_char(NEW.total, 'FM999G999G990D00'));
    perform public.local_tasker_audit('local_booking_quote', 'booking', NEW.booking_id::text, null,
      jsonb_build_object('quote_id', NEW.id, 'version', NEW.version, 'service_fee', NEW.service_fee, 'transport_amount', NEW.transport_amount,
                         'materials_amount', NEW.materials_amount, 'other_amount', NEW.other_amount, 'total', NEW.total,
                         'confirmation_id', NEW.confirmation_id), NEW.coordinator_id);
  elsif NEW.superseded_at is not null and OLD.superseded_at is null then
    perform public._local_booking_log(NEW.booking_id, 'quote_superseded', null, null, NEW.coordinator_id, null, null, 'system',
      'Quote version ' || NEW.version || ' is no longer current');
  end if;
  return NEW;
end $$;
drop trigger if exists lbq_audit on public.local_booking_quotes;
create trigger lbq_audit after insert or update on public.local_booking_quotes
  for each row execute function public.local_booking_quotes_audit();
revoke all on function public.local_booking_quotes_guard(), public.local_booking_quotes_audit() from public, anon, authenticated;

-- 3. the state machine (replaces the 5C-1 function, same signature) ---------------------------------------
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
  if p_to in ('tasker_confirmed', 'tasker_declined') and coalesce(current_setting('st.lt_capture', true), '') <> '1' then
    raise exception 'The Local Tasker''s answer must be recorded from a call.' using errcode = 'P0001', hint = 'use_confirmation';
  end if;
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
    -- 5C-2: a quote built from THIS confirmation, and only through the quote function
    if not exists (select 1 from public.local_booking_quotes q where q.booking_id = p_booking and q.superseded_at is null and q.confirmation_id = c.id)
       or coalesce(current_setting('st.lt_quote', true), '') <> '1' then
      raise exception 'Build the quote from the Local Tasker''s confirmed price.' using errcode = 'P0001', hint = 'use_quote';
    end if;
  end if;
  if p_to = 'awaiting_tasker_confirmation' then
    update public.local_booking_confirmations set superseded_at = now()
     where booking_id = p_booking and superseded_at is null and outcome in ('confirmed', 'declined');
    update public.local_booking_quotes set superseded_at = now() where booking_id = p_booking and superseded_at is null;
  end if;
  update public.local_booking_state set lt_status = p_to, updated_at = now() where booking_id = p_booking;
  perform public._local_booking_log(p_booking, 'status_changed', s.lt_status, p_to, s.coordinator_id, null, p_actor, p_role, v_note);
  return jsonb_build_object('lt_status', p_to, 'changed', true);
end $$;
revoke all on function public._local_booking_transition(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public._local_booking_transition(uuid, text, uuid, text, text) to service_role;

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
  if p_to = 'quote_sent' then
    raise exception 'Build the quote from the Local Tasker''s confirmed price.' using errcode = 'P0001', hint = 'use_quote';
  end if;
  return public._local_booking_transition(p_booking, p_to, v_me, 'coordinator', p_note);
end $$;
revoke all on function public.local_booking_step(uuid, text, text) from public, anon;
grant execute on function public.local_booking_step(uuid, text, text) to authenticated, service_role;

-- 4. build and send a quote (coordinator rpc) --------------------------------------------------------------
create or replace function public.local_booking_send_quote(
  p_booking uuid, p_request_id uuid, p_transport numeric, p_materials numeric, p_other numeric, p_other_label text, p_other_note text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; c public.local_booking_confirmations; old public.local_booking_quotes;
  v_tr numeric; v_ma numeric; v_ot numeric := coalesce(p_other, 0); v_label text := nullif(btrim(coalesce(p_other_label, '')), '');
  v_onote text := nullif(btrim(coalesce(p_other_note, '')), ''); v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_ver int; v_id uuid; v_total numeric;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if p_request_id is null then raise exception 'Missing request id.' using errcode = 'P0001', hint = 'bad_input'; end if;

  select * into old from public.local_booking_quotes where request_id = p_request_id;
  if found then
    if old.booking_id <> p_booking or old.coordinator_id <> v_me then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
    return jsonb_build_object('quote_id', old.id, 'version', old.version, 'total', old.total, 'lt_status', s.lt_status, 'changed', false, 'duplicate', true);
  end if;

  select * into b from public.bookings where id = p_booking;
  if not public._local_booking_is_open(b.status) or b.status = 'disputed' then
    raise exception 'This booking is closed.' using errcode = 'P0001', hint = 'booking_closed';
  end if;
  if public.job_booking_frozen(p_booking) then
    raise exception 'A problem report is open on this booking.' using errcode = 'P0001', hint = 'dispute_open';
  end if;
  if s.lt_status not in ('tasker_confirmed', 'quote_declined') then
    raise exception 'A quote can only be sent after the Local Tasker has confirmed, or after the customer declined one.' using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  select * into c from public.local_booking_confirmations
   where booking_id = p_booking and outcome = 'confirmed' and superseded_at is null and tasker_user_id = s.tasker_user_id
   order by created_at desc limit 1;
  if not found then
    raise exception 'The Local Tasker''s confirmation must be recorded before a quote is sent.' using errcode = 'P0001', hint = 'confirmation_required';
  end if;
  if c.second_check_status not in ('off', 'passed') then
    raise exception 'An administrator call-back to the Local Tasker is still needed before a quote is sent.' using errcode = 'P0001', hint = 'second_check_pending';
  end if;

  -- transport and materials: what the tasker said is the ceiling; lowering or dropping is allowed
  v_tr := coalesce(p_transport, c.transport_amount); v_ma := coalesce(p_materials, c.materials_amount);
  if v_tr < 0 or v_ma < 0 or v_ot < 0 or v_tr > 10000000 or v_ma > 10000000 or v_ot > 10000000 then
    raise exception 'An amount is not valid.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if v_tr > c.transport_amount or v_ma > c.materials_amount then
    raise exception 'Transport and materials can''t be more than the Local Tasker confirmed. To change them, record a new answer from the Local Tasker.' using errcode = 'P0001', hint = 'exceeds_confirmed';
  end if;
  if (v_tr > 0 and v_tr < 100) or (v_ma > 0 and v_ma < 100) or (v_ot > 0 and v_ot < 100) then
    raise exception 'Each cost must be 0 or at least ₦100.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if v_ot > 0 and v_label is null then raise exception 'Say what the other cost is for.' using errcode = 'P0001', hint = 'bad_input'; end if;
  if v_ot > 0 and v_ot > c.proposed_price then
    raise exception 'Other costs can''t be more than the service fee.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if coalesce(char_length(v_label), 0) > 60 or coalesce(char_length(v_onote), 0) > 300 or coalesce(char_length(v_note), 0) > 300 then
    raise exception 'A note is too long.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  v_total := c.proposed_price + v_tr + v_ma + v_ot;
  if v_total > 10000000 then raise exception 'The total is too large. Check for a typing mistake.' using errcode = 'P0001', hint = 'bad_input'; end if;

  select coalesce(max(version), 0) + 1 into v_ver from public.local_booking_quotes where booking_id = p_booking;
  update public.local_booking_quotes set superseded_at = now() where booking_id = p_booking and superseded_at is null;
  insert into public.local_booking_quotes (booking_id, confirmation_id, coordinator_id, request_id, version, service_fee, transport_amount, materials_amount,
                                           other_amount, other_label, other_note, total, note)
  values (p_booking, c.id, v_me, p_request_id, v_ver, c.proposed_price, v_tr, v_ma, v_ot, case when v_ot > 0 then v_label end,
          case when v_ot > 0 then v_onote end, v_total, v_note)
  returning id into v_id;

  perform set_config('st.lt_quote', '1', true);
  perform public._local_booking_transition(p_booking, 'quote_sent', v_me, 'coordinator', null);
  perform set_config('st.lt_quote', '', true);
  return jsonb_build_object('quote_id', v_id, 'version', v_ver, 'total', v_total, 'lt_status', 'quote_sent', 'changed', true, 'duplicate', false);
end $$;
revoke all on function public.local_booking_send_quote(uuid, uuid, numeric, numeric, numeric, text, text, text) from public, anon;
grant execute on function public.local_booking_send_quote(uuid, uuid, numeric, numeric, numeric, text, text, text) to authenticated, service_role;

-- 5. read for the managing coordinator (rpc, read only) ---------------------------------------------------
create or replace function public._local_booking_quote_lines(q public.local_booking_quotes) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(l order by (l->>'sort')::int), '[]'::jsonb) from (
    select jsonb_build_object('sort', 1, 'key', 'service_fee', 'label', 'Service fee (the Local Tasker''s price)', 'amount', q.service_fee, 'payment_kind', 'full_payment', 'held_in_escrow', true) l
    union all select jsonb_build_object('sort', 2, 'key', 'transport', 'label', 'Transport', 'amount', q.transport_amount, 'payment_kind', 'transport', 'held_in_escrow', false) where q.transport_amount > 0
    union all select jsonb_build_object('sort', 3, 'key', 'materials', 'label', 'Materials', 'amount', q.materials_amount, 'payment_kind', 'materials', 'held_in_escrow', false) where q.materials_amount > 0
    union all select jsonb_build_object('sort', 4, 'key', 'other', 'label', coalesce(q.other_label, 'Other agreed cost'), 'amount', q.other_amount, 'payment_kind', 'additional_cost', 'held_in_escrow', false) where q.other_amount > 0
  ) x
$$;
revoke all on function public._local_booking_quote_lines(public.local_booking_quotes) from public, anon, authenticated;
grant execute on function public._local_booking_quote_lines(public.local_booking_quotes) to service_role;

create or replace function public.local_booking_quote(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); s public.local_booking_state; c public.local_booking_confirmations; q public.local_booking_quotes; v_cur jsonb; v_conf jsonb; v_hist jsonb;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into c from public.local_booking_confirmations
   where booking_id = p_booking and outcome = 'confirmed' and superseded_at is null and tasker_user_id = s.tasker_user_id order by created_at desc limit 1;
  if found then
    v_conf := jsonb_build_object('service_fee', c.proposed_price, 'transport_amount', c.transport_amount, 'materials_amount', c.materials_amount,
                                 'materials_notes', c.materials_notes, 'second_check_status', c.second_check_status);
  end if;
  select * into q from public.local_booking_quotes where booking_id = p_booking and superseded_at is null;
  if found then
    v_cur := jsonb_build_object('version', q.version, 'service_fee', q.service_fee, 'transport_amount', q.transport_amount, 'materials_amount', q.materials_amount,
                                'other_amount', q.other_amount, 'other_label', q.other_label, 'other_note', q.other_note, 'total', q.total, 'note', q.note,
                                'created_at', q.created_at, 'lines', public._local_booking_quote_lines(q));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('version', h.version, 'total', h.total, 'superseded', h.superseded_at is not null, 'created_at', h.created_at) order by h.version desc), '[]'::jsonb)
    into v_hist from public.local_booking_quotes h where h.booking_id = p_booking;
  return jsonb_build_object('booking_id', p_booking, 'lt_status', s.lt_status, 'confirmed', v_conf, 'current', v_cur, 'history', v_hist);
end $$;
revoke all on function public.local_booking_quote(uuid) from public, anon;
grant execute on function public.local_booking_quote(uuid) to authenticated, service_role;

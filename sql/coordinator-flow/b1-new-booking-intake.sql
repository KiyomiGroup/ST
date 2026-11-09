-- Stage B1: new-booking intake (2026-11-08)
-- WHAT THIS DOES
--  1. New table local_booking_customer_chats: one row per booking = "the coordinator chatted with the customer and
--     confirmed date, price, place and details" (4 ticks + a note). Not readable or writable from the browser except
--     through the functions below (row level security on, no policies).
--  2. New function local_booking_record_customer_chat(...) writes that row.
--  3. A quote cannot be sent until the row exists (hint: customer_chat_required), checked in BOTH
--     local_booking_send_quote and _local_booking_transition.
--  4. local_booking_detail now also returns customer_chat_recorded + customer_chat; local_booking_list returns customer_chat_recorded.
--  5. Bookings already at quote_sent / quote_approved / quote_declined get a row marked "recorded before this step existed",
--     so a customer who declines a quote does not strand an old booking. Bookings still at assigned / awaiting / tasker_confirmed
--     need the coordinator to record the chat before quoting.
-- The four functions below were patched from the exact source you pasted (only the marked B1 lines were added).
-- UNDO: b1-rollback.sql.   RUN THIS FIRST, THEN push the changed files.

begin;

create table if not exists public.local_booking_customer_chats (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  request_id uuid not null unique,
  coordinator_id uuid not null,
  date_ok boolean not null,
  price_ok boolean not null,
  place_ok boolean not null,
  details_ok boolean not null,
  note text not null check (char_length(btrim(note)) between 3 and 500),
  created_at timestamptz not null default now(),
  check (date_ok and price_ok and place_ok and details_ok)
);
alter table public.local_booking_customer_chats enable row level security;
revoke all on public.local_booking_customer_chats from anon, authenticated;

create or replace function public.local_booking_record_customer_chat(
  p_booking uuid, p_request_id uuid, p_date_ok boolean, p_price_ok boolean, p_place_ok boolean, p_details_ok boolean, p_note text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; old public.local_booking_customer_chats;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if p_request_id is null then raise exception 'Missing request id.' using errcode = 'P0001', hint = 'bad_input'; end if;

  -- a retried save, or a record that already exists, returns what is already there
  select * into old from public.local_booking_customer_chats where request_id = p_request_id or booking_id = p_booking
   order by (request_id = p_request_id) desc limit 1;
  if found then
    if old.booking_id <> p_booking then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
    return jsonb_build_object('chat_id', old.id, 'changed', false, 'duplicate', true);
  end if;

  select * into b from public.bookings where id = p_booking;
  if not public._local_booking_is_open(b.status) or b.status = 'disputed' then
    raise exception 'This booking is closed.' using errcode = 'P0001', hint = 'booking_closed';
  end if;
  if public.job_booking_frozen(p_booking) then
    raise exception 'A problem report is open on this booking.' using errcode = 'P0001', hint = 'dispute_open';
  end if;
  if s.lt_status not in ('assigned', 'awaiting_tasker_confirmation', 'tasker_confirmed', 'tasker_declined', 'quote_declined') then
    raise exception 'The chat with the customer can only be recorded before a quote is sent.' using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  if p_date_ok is not true or p_price_ok is not true or p_place_ok is not true or p_details_ok is not true then
    raise exception 'Tick all four boxes once you have confirmed each one with the customer.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if v_note is null or char_length(v_note) < 3 then
    raise exception 'Write what you agreed with the customer.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'The note is too long.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  insert into public.local_booking_customer_chats (booking_id, request_id, coordinator_id, date_ok, price_ok, place_ok, details_ok, note)
  values (p_booking, p_request_id, v_me, true, true, true, true, v_note)
  returning * into old;
  return jsonb_build_object('chat_id', old.id, 'changed', true, 'duplicate', false);
end $function$;

revoke all on function public.local_booking_record_customer_chat(uuid, uuid, boolean, boolean, boolean, boolean, text) from public, anon;
grant execute on function public.local_booking_record_customer_chat(uuid, uuid, boolean, boolean, boolean, boolean, text) to authenticated;

CREATE OR REPLACE FUNCTION public._local_booking_transition(p_booking uuid, p_to text, p_actor uuid, p_role text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- B1: the quote is blocked until the chat with the customer has been recorded
    if not exists (select 1 from public.local_booking_customer_chats cc where cc.booking_id = p_booking) then
      raise exception 'Chat with the customer and record it before a quote is sent.' using errcode = 'P0001', hint = 'customer_chat_required';
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
    if not exists (select 1 from public.local_booking_quotes q where q.booking_id = p_booking and q.superseded_at is null and q.confirmation_id = c.id)
       or coalesce(current_setting('st.lt_quote', true), '') <> '1' then
      raise exception 'Build the quote from the Local Tasker''s confirmed price.' using errcode = 'P0001', hint = 'use_quote';
    end if;
  end if;
  if p_to = 'awaiting_tasker_confirmation' then
    -- 5D-1: never strand money. Once a payment for the current quote has started or is held, the booking cannot be re-quoted here.
    if exists (select 1 from public.local_booking_quotes q
                 join public.local_booking_quote_requests l on l.quote_id = q.id
                 join public.payment_requests r on r.id = l.payment_request_id
                where q.booking_id = p_booking and q.superseded_at is null and r.status in ('processing', 'paid', 'accepted')) then
      raise exception 'The customer has already started paying this quote, so it cannot be sent back for a new price. Contact an administrator.'
        using errcode = 'P0001', hint = 'payment_started';
    end if;
    update public.local_booking_confirmations set superseded_at = now()
     where booking_id = p_booking and superseded_at is null and outcome in ('confirmed', 'declined');
    update public.local_booking_quotes set superseded_at = now() where booking_id = p_booking and superseded_at is null;
  end if;
  update public.local_booking_state set lt_status = p_to, updated_at = now() where booking_id = p_booking;
  perform public._local_booking_log(p_booking, 'status_changed', s.lt_status, p_to, s.coordinator_id, null, p_actor, p_role, v_note);
  return jsonb_build_object('lt_status', p_to, 'changed', true);
end $function$;

CREATE OR REPLACE FUNCTION public.local_booking_send_quote(p_booking uuid, p_request_id uuid, p_transport numeric, p_materials numeric, p_other numeric, p_other_label text, p_other_note text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- B1: the quote is blocked until the chat with the customer has been recorded
  if not exists (select 1 from public.local_booking_customer_chats cc where cc.booking_id = p_booking) then
    raise exception 'Chat with the customer and record it before a quote is sent.' using errcode = 'P0001', hint = 'customer_chat_required';
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
end $function$;

CREATE OR REPLACE FUNCTION public.local_booking_detail(p_booking uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; v_open boolean;
  v_task jsonb := null; v_svc jsonb := null; v_cust_name text := null; v_phone text := null; v_tasker_name text := null; v_events jsonb; v_chat jsonb := null;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into b from public.bookings where id = p_booking;
  v_open := public._local_booking_is_open(b.status) and b.status <> 'disputed';
  select jsonb_build_object('recorded_at', cc.created_at, 'note', cc.note) into v_chat
    from public.local_booking_customer_chats cc where cc.booking_id = p_booking;

  select p.full_name into v_tasker_name from public.local_tasker_profiles p where p.tasker_user_id = s.tasker_user_id;
  select u.name into v_cust_name from public.users u where u.id = b.customer_id;

  begin
    select jsonb_build_object('title', to_jsonb(t) ->> 'title', 'description', to_jsonb(t) ->> 'description',
                              'location', to_jsonb(t) ->> 'location', 'category', to_jsonb(t) ->> 'category', 'budget', to_jsonb(t) ->> 'budget')
      into v_task from public.tasks t where t.id = b.task_id;
  exception when others then v_task := null; end;
  begin
    select jsonb_build_object('service_name', to_jsonb(sv) ->> 'service_name', 'category', to_jsonb(sv) ->> 'category',
                              'price', to_jsonb(sv) ->> 'price', 'rate_unit', to_jsonb(sv) ->> 'rate_unit', 'location', to_jsonb(sv) ->> 'location')
      into v_svc from public.services sv where sv.id = b.service_id;
  exception when others then v_svc := null; end;
  if v_open then
    begin
      execute 'select v.phone::text from public.verifications v where v.user_id = $1 limit 1' into v_phone using b.customer_id;
    exception when others then v_phone := null; end;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'from_status', e.from_status, 'to_status', e.to_status,
                                               'actor_role', e.actor_role, 'note', e.note, 'created_at', e.created_at)
                           order by e.created_at desc, e.id), '[]'::jsonb)
    into v_events
    from (select * from public.local_booking_events where booking_id = p_booking order by created_at desc, id limit 50) e;

  return jsonb_build_object(
    'booking_id', b.id, 'lt_status', s.lt_status, 'booking_status', b.status, 'work_stage', b.work_stage,
    'payment_status', b.payment_status, 'amount', b.amount, 'scheduled_time', b.scheduled_time,
    'created_at', b.created_at, 'notes', b.notes,
    'tasker_user_id', s.tasker_user_id, 'tasker_name', v_tasker_name,
    'customer_name', v_cust_name, 'customer_phone', v_phone,
    'task', v_task, 'service', v_svc,
    'original_coordinator_is_me', s.original_coordinator_id is not distinct from v_me,
    'customer_chat_recorded', v_chat is not null, 'customer_chat', v_chat,
    'frozen', public.job_booking_frozen(b.id), 'open', v_open,
    'allowed_next', to_jsonb(public._local_booking_allowed_next(s.lt_status, 'coordinator')),
    'events', v_events);
end $function$;

CREATE OR REPLACE FUNCTION public.local_booking_list(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_me uuid := auth.uid(); v_lim integer := least(greatest(coalesce(p_limit, 100), 1), 200); v_out jsonb;
begin
  if v_me is null or not public.is_active_coordinator(v_me) then
    raise exception 'Not available.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select coalesce(jsonb_agg(x.row order by x.created_at desc, x.id), '[]'::jsonb) into v_out
  from (
    select b.id, b.created_at, jsonb_build_object(
      'booking_id', b.id,
      'tasker_user_id', s.tasker_user_id,
      'tasker_name', p.full_name,
      'customer_name', u.name,
      'title', coalesce(
         nullif(btrim(coalesce((select to_jsonb(t) ->> 'title' from public.tasks t where t.id = b.task_id), '')), ''),
         nullif(btrim(coalesce((select to_jsonb(sv) ->> 'service_name' from public.services sv where sv.id = b.service_id), '')), ''),
         nullif(left(btrim(coalesce(b.notes, '')), 60), ''), 'Booking'),
      'lt_status', s.lt_status,
      'booking_status', b.status,
      'work_stage', b.work_stage,
      'payment_status', b.payment_status,
      'amount', b.amount,
      'scheduled_time', b.scheduled_time,
      'created_at', b.created_at,
      'updated_at', s.updated_at,
      'customer_chat_recorded', exists (select 1 from public.local_booking_customer_chats cc where cc.booking_id = b.id),
      'frozen', public.job_booking_frozen(b.id),
      'open', public._local_booking_is_open(b.status) and b.status <> 'disputed'
    ) as row
    from public.local_booking_state s
    join public.bookings b on b.id = s.booking_id
    left join public.local_tasker_profiles p on p.tasker_user_id = s.tasker_user_id
    left join public.users u on u.id = b.customer_id
    where s.coordinator_id = v_me
    order by b.created_at desc, b.id
    limit v_lim
  ) x;
  return v_out;
end $function$;

-- 5. one-time backfill (only rows that do not exist yet)
insert into public.local_booking_customer_chats (booking_id, request_id, coordinator_id, date_ok, price_ok, place_ok, details_ok, note)
select s.booking_id, gen_random_uuid(), coalesce(s.coordinator_id, s.original_coordinator_id), true, true, true, true,
       'Recorded before this step existed (not checked).'
  from public.local_booking_state s
 where s.lt_status in ('quote_sent', 'quote_approved', 'quote_declined')
   and coalesce(s.coordinator_id, s.original_coordinator_id) is not null
   and not exists (select 1 from public.local_booking_customer_chats c where c.booking_id = s.booking_id);

commit;

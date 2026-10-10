-- ============================================================
-- StreetTasker Job Room, step 7: WORK LIFECYCLE
-- File:    sql/messaging-step7.sql
-- Run in:  Supabase dashboard > SQL Editor. READ IT FIRST.
-- Order:   after messaging-step5.sql, messaging-step6.sql and messaging-step6a.sql.
-- Safe to run more than once (idempotent).
--
-- What it adds
--   1. bookings.work_stage      on-site progress (en_route / arrived / in_progress / paused).
--                               bookings.status is NOT touched, so the dashboards keep working.
--   2. job_events               the audit trail of every step (also feeds the Activity timeline, step 9).
--   3. job_progress()           tasker: on my way / arrived / start / pause / resume.
--   4. job_request_changes()    customer sends completed work back.
--   5. job_mark_done / job_confirm_complete / job_submit_code / job_raise_dispute
--                               replaced with versions that also record the event and post the
--                               "system" line in the conversation (spec section 36).
--   6. System lines cannot be forged any more: browsers may no longer insert messages of type
--      'system' or 'payment_confirmed'. Approve / decline / cancel of a payment request now posts
--      its line from the database.
-- ============================================================

-- 0. Pre-flight ------------------------------------------------------
do $$
declare missing text;
begin
  select string_agg(t, ', ') into missing
  from unnest(array['bookings', 'message_threads', 'messages', 'payment_requests', 'job_requests', 'booking_secrets']) as t
  where to_regclass('public.' || t) is null;
  if missing is not null then
    raise exception 'Missing tables: %. Run sql/messaging-step5.sql, step6 and step6a first. Nothing was changed.', missing;
  end if;
  if to_regprocedure('public._booking_tasker_user(public.bookings)') is null
     or to_regprocedure('public._notify(uuid,text,text,text,jsonb)') is null
     or to_regprocedure('public._release_escrow(uuid)') is null then
    raise exception 'Run sql/messaging-step6a.sql first (payment functions are missing). Nothing was changed.';
  end if;
end $$;

-- 1. Progress column ------------------------------------------------------
alter table public.bookings add column if not exists work_stage text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_work_stage_check'
                 and conrelid = 'public.bookings'::regclass) then
    alter table public.bookings add constraint bookings_work_stage_check
      check (work_stage is null or work_stage in ('en_route', 'arrived', 'in_progress', 'paused'));
  end if;
end $$;

-- Only the functions below may change it
create or replace function public.bookings_guard_stage() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon') then
    if TG_OP = 'INSERT' then NEW.work_stage := null;
    elsif NEW.work_stage is distinct from OLD.work_stage then
      raise exception 'Use the work buttons in Messages to update progress.';
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists bookings_guard_stage on public.bookings;
create trigger bookings_guard_stage before insert or update on public.bookings
  for each row execute function public.bookings_guard_stage();

-- 2. Event log -----------------------------------------------------------
create table if not exists public.job_events (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings(id) on delete cascade,
  thread_id      uuid,
  customer_id    uuid not null,
  tasker_user_id uuid,
  actor_id       uuid,
  kind           text not null check (kind ~ '^[a-z_]{2,40}$'),
  text           text not null,
  note           text,
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists job_events_booking_idx on public.job_events (booking_id, created_at);
create index if not exists job_events_thread_idx  on public.job_events (thread_id, created_at);
alter table public.job_events enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'job_events' loop
    execute format('drop policy %I on public.job_events', p.policyname);
  end loop;
end $$;
create policy job_events_select on public.job_events
  for select to authenticated using (auth.uid() in (customer_id, tasker_user_id));
revoke insert, update, delete, truncate on public.job_events from anon, authenticated;
grant select on public.job_events to authenticated;    -- explicit: do not rely on default privileges
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select on public.job_events to service_role';
  end if;
end $$;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'job_events') then
    alter publication supabase_realtime add table public.job_events;
  end if;
end $$;

-- Records an event, posts the system line in the conversation, notifies the other person
create or replace function public._job_event(
  p_booking uuid, p_actor uuid, p_kind text, p_text text, p_note text default null, p_payload jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
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
end $$;

-- 3. Tasker progress ---------------------------------------------------------
create or replace function public.job_progress(p_booking uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_stage text; v_new text; v_text text; v_thread uuid; v_kind text;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or public._booking_tasker_user(b) is distinct from auth.uid() then
    raise exception 'Only the tasker on this booking can update the work progress.';
  end if;
  if b.status in ('completed', 'cancelled', 'disputed', 'rejected', 'declined', 'awaiting_confirmation')
     or b.payment_status = 'released' then
    raise exception 'This booking is % and its progress can no longer be changed.', coalesce(b.status, 'closed');
  end if;
  if b.status is distinct from 'confirmed' then
    raise exception 'Confirm the booking first.';
  end if;

  v_stage := b.work_stage;
  case p_action
    when 'on_my_way' then
      if v_stage is not null then raise exception 'You have already told the customer you are on the way.'; end if;
      v_new := 'en_route'; v_kind := 'on_my_way'; v_text := 'Tasker is on the way';
    when 'arrived' then
      if v_stage is not null and v_stage <> 'en_route' then raise exception 'You have already arrived.'; end if;
      v_new := 'arrived'; v_kind := 'arrived'; v_text := 'Tasker has arrived';
    when 'start' then
      if v_stage = 'in_progress' then raise exception 'Work has already started.'; end if;
      if v_stage = 'paused' then raise exception 'Resume the work instead.'; end if;
      if b.payment_status is distinct from 'paid' then
        raise exception 'Wait until the customer has paid and the money is held safely before starting.';
      end if;
      v_new := 'in_progress'; v_kind := 'work_started'; v_text := 'Work started';
    when 'pause' then
      if v_stage is distinct from 'in_progress' then raise exception 'Work can only be paused while it is in progress.'; end if;
      if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Please choose a reason for pausing.'; end if;
      v_new := 'paused'; v_kind := 'work_paused'; v_text := 'Work paused';
    when 'resume' then
      if v_stage is distinct from 'paused' then raise exception 'Work is not paused.'; end if;
      v_new := 'in_progress'; v_kind := 'work_resumed'; v_text := 'Work resumed';
    else
      raise exception 'Unknown action.';
  end case;

  update public.bookings set work_stage = v_new where id = p_booking;
  perform public._job_event(p_booking, auth.uid(), v_kind, v_text, left(btrim(coalesce(p_note, '')), 200), jsonb_build_object('stage', v_new));

  -- an "arrival time" question from the customer is answered by saying you are on the way / arrived
  if p_action in ('on_my_way', 'arrived') then
    select id into v_thread from public.message_threads
     where context_type = 'booking' and context_id::text = p_booking::text limit 1;
    if v_thread is not null then
      update public.job_requests set status = 'fulfilled'
       where thread_id = v_thread and kind = 'arrival' and status = 'pending';
    end if;
  end if;
  return jsonb_build_object('ok', true, 'stage', v_new);
end $$;

-- 4. Completion ------------------------------------------------------------------
drop function if exists public.job_mark_done(uuid);
create or replace function public.job_mark_done(p_booking uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or public._booking_tasker_user(b) is distinct from auth.uid() then
    raise exception 'Only the tasker on this booking can mark it done.';
  end if;
  if b.status in ('completed', 'cancelled', 'disputed') then raise exception 'This booking is already %.', b.status; end if;
  if b.work_stage = 'paused' then raise exception 'Resume the work before marking it complete.'; end if;
  update public.bookings set status = 'awaiting_confirmation' where id = p_booking;
  perform public._job_event(p_booking, auth.uid(), 'work_completed', 'Work completed', left(btrim(coalesce(p_note, '')), 300));
  perform public._notify(b.customer_id, 'job_done', '✅ Job Marked Complete',
    'The provider says the job is done. If you agree, confirm completion to release payment.',
    jsonb_build_object('booking_id', p_booking));
  return jsonb_build_object('success', true);
end $$;

create or replace function public.job_confirm_complete(p_booking uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_code text;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.customer_id is distinct from auth.uid() then
    raise exception 'Only the customer of this booking can confirm it.';
  end if;
  if b.payment_status is distinct from 'paid' then raise exception 'Payment not made yet.'; end if;
  if b.status = 'completed' then raise exception 'This booking is already completed.'; end if;
  if b.status = 'disputed' then raise exception 'This booking is under dispute.'; end if;
  update public.bookings set status = 'awaiting_confirmation' where id = p_booking;
  select completion_code into v_code from public.booking_secrets where booking_id = p_booking;
  perform public._job_event(p_booking, auth.uid(), 'completion_confirmed',
    'Customer confirmed the work. The tasker can now enter the completion code');
  return jsonb_build_object('code', v_code);
end $$;

create or replace function public.job_request_changes(p_booking uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.customer_id is distinct from auth.uid() then
    raise exception 'Only the customer of this booking can ask for changes.';
  end if;
  if b.status is distinct from 'awaiting_confirmation' then raise exception 'There is no completed work to send back.'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Please say what needs to change.'; end if;
  update public.bookings set status = 'confirmed', work_stage = 'in_progress' where id = p_booking;
  perform public._job_event(p_booking, auth.uid(), 'changes_requested', 'Customer asked for changes', left(btrim(p_note), 300));
  return jsonb_build_object('success', true);
end $$;

-- Wrong codes are COUNTED, so this returns a result instead of raising
create or replace function public.job_submit_code(p_booking uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_code text; v_attempts int; v_paid numeric;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or public._booking_tasker_user(b) is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'Only the tasker on this booking can enter the code.');
  end if;
  if b.payment_status is null or b.payment_status in ('unpaid', 'failed', '') then
    return jsonb_build_object('ok', false, 'error', 'Payment not made for this booking yet.');
  end if;
  if b.payment_status = 'released' then return jsonb_build_object('ok', false, 'error', 'Payment has already been released for this booking.'); end if;
  if b.status = 'completed' then return jsonb_build_object('ok', false, 'error', 'This booking is already completed.'); end if;
  if b.status = 'disputed' then return jsonb_build_object('ok', false, 'error', 'This booking is under dispute.'); end if;

  v_attempts := coalesce(b.code_attempts, 0);
  if v_attempts >= 3 then
    return jsonb_build_object('ok', false, 'error', 'Too many incorrect attempts. Contact support.', 'remaining', 0);
  end if;

  select completion_code into v_code from public.booking_secrets where booking_id = p_booking;
  if v_code is null or btrim(coalesce(p_code, '')) <> v_code then
    v_attempts := v_attempts + 1;
    update public.bookings set code_attempts = v_attempts where id = p_booking;
    return jsonb_build_object('ok', false, 'remaining', greatest(0, 3 - v_attempts),
      'error', 'Incorrect code. ' || case when 3 - v_attempts > 0
        then (3 - v_attempts) || ' attempt' || case when 3 - v_attempts = 1 then '' else 's' end || ' remaining.'
        else 'No attempts left. Contact support.' end);
  end if;

  v_paid := public._release_escrow(p_booking);
  update public.bookings set work_stage = null where id = p_booking;
  delete from public.booking_secrets where booking_id = p_booking;
  perform public._job_event(p_booking, auth.uid(), 'payment_released',
    'Payment released to the tasker. Task completed', null, jsonb_build_object('released', v_paid));
  return jsonb_build_object('ok', true, 'released', v_paid);
end $$;

create or replace function public.job_raise_dispute(p_booking uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_other uuid; v_tasker uuid;
begin
  select * into b from public.bookings where id = p_booking for update;
  v_tasker := public._booking_tasker_user(b);
  if not found or auth.uid() is null or auth.uid() not in (b.customer_id, v_tasker) then
    raise exception 'Only the customer or tasker on this booking can raise a dispute.';
  end if;
  if b.status = 'completed' then raise exception 'This booking is already completed.'; end if;
  if b.status = 'disputed' then raise exception 'This booking is already under dispute.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Please describe the problem.'; end if;
  update public.bookings set status = 'disputed', dispute_reason = left(btrim(p_reason), 1000) where id = p_booking;
  perform public._job_event(p_booking, auth.uid(), 'dispute_raised',
    'A dispute was raised. Payment stays protected while it is reviewed', left(btrim(p_reason), 300));
  return jsonb_build_object('success', true);
end $$;

-- 5. Permissions --------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    '_job_event(uuid,uuid,text,text,text,jsonb)', 'job_progress(uuid,text,text)', 'job_request_changes(uuid,text)',
    'job_mark_done(uuid,text)', 'job_confirm_complete(uuid)', 'job_submit_code(uuid,text)', 'job_raise_dispute(uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['job_progress(uuid,text,text)', 'job_request_changes(uuid,text)', 'job_mark_done(uuid,text)',
    'job_confirm_complete(uuid)', 'job_submit_code(uuid,text)', 'job_raise_dispute(uuid,text)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- 6. System lines cannot be forged ---------------------------------------------------
create or replace function public.messages_guard() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon') and NEW.type::text in ('system', 'payment_confirmed') then
    raise exception 'System messages are created by the server only.';
  end if;
  return NEW;
end $$;
drop trigger if exists messages_guard on public.messages;
create trigger messages_guard before insert on public.messages
  for each row execute function public.messages_guard();

-- approve / decline / cancel of a payment request: the database posts the line
create or replace function public.payment_requests_events() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_other uuid; v_label text; v_verb text; v_body text;
begin
  if NEW.status is not distinct from OLD.status or NEW.status not in ('approved', 'declined', 'cancelled') then
    return NEW;
  end if;
  if v_actor is null or NEW.thread_id is null then return NEW; end if;
  v_label := case coalesce(NEW.kind, 'payment') when 'transport' then 'Transport' when 'additional_cost' then 'Additional cost'
                                                when 'remaining_payment' then 'Remaining payment' when 'full_payment' then 'Full payment'
                                                else 'Payment request' end;
  v_verb := NEW.status;
  v_body := v_label || ' ' || v_verb || ': ₦' || to_char(NEW.amount, 'FM999,999,999');
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
end $$;
drop trigger if exists payment_requests_events on public.payment_requests;
create trigger payment_requests_events after update of status on public.payment_requests
  for each row execute function public.payment_requests_events();

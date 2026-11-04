-- ============================================================================
-- StreetTasker Local Tasker: STAGE 6D-3 core (coordinator chat: photos, camera, video, files, location)
-- Additive and re-runnable. Rollback: stage-6d3-rollback.sql. Needs stage-6b-core.sql (local_chat_access, coordinator_message_authors).
-- Run in the Supabase SQL editor (select all, Run). Safe to run twice. NOT RUN by the assistant: no Postgres was available for a scratch test.
--
-- WHAT THIS ADDS
--   1. _lt_coord_thread_ok(thread, write)   helper: is the signed-in user the CURRENT coordinator (write) or a current/former coordinator (read) of the
--                                           booking behind this conversation? Used by two storage policies only.
--   2. Two ADDITIVE storage policies on bucket job-evidence (existing policies are not touched):
--        job_evidence_coord_insert   the current coordinator may upload under <thread_id>/...
--        job_evidence_coord_select   a current or former coordinator may open files of the thread (support-removed files stay hidden)
--   3. coordinator_send_attachment(...)     writes the job_attachments row (uploader = the Local Tasker identity, as the real
--                                           messages_attachment_check requires) and the chat message, records the coordinator in
--                                           coordinator_message_authors. Retry-safe by request id. One transaction.
--   4. coordinator_send_location(...)       a location message (lat/lng/label).
--   5. coordinator_chat_thread(...)         REPLACED: same answer as 6B plus `payload` for image/video/file/location messages
--                                           (only attachment_id, path, name, size, mime, caption, lat, lng, label).
-- The real job_attachments_guard still decides type, size (photo 10 MB, video 50 MB, file 10 MB) and that the file exists in storage.
-- NEVER touches: payment tables, escrow, wallets, existing policies, job_attachments_guard, messages_attachment_check, messages_guard.
-- ============================================================================

-- 0. Pre-flight ----------------------------------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.local_chat_access(uuid)') is null or to_regclass('public.coordinator_message_authors') is null
     or to_regprocedure('public.open_local_thread(uuid)') is null then
    raise exception 'Run stage-6b-core.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.job_attachments') is null or to_regclass('public.evidence_removals') is null then
    raise exception 'job_attachments or evidence_removals is missing (Stage 9). Nothing was changed.';
  end if;
  if not exists (select 1 from storage.buckets where id = 'job-evidence') then
    raise exception 'The storage bucket job-evidence is missing. Nothing was changed.';
  end if;
end $$;

-- 1. Helper for the storage rules -------------------------------------------------------------------------------------
create or replace function public._lt_coord_thread_ok(p_thread text, p_write boolean)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_booking text; v_access text;
begin
  if auth.uid() is null or p_thread is null then return false; end if;
  select t.context_id::text into v_booking from public.message_threads t
   where t.id::text = p_thread and t.context_type = 'booking' limit 1;
  if v_booking is null or v_booking !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  v_access := public.local_chat_access(v_booking::uuid);
  if v_access is null then return false; end if;
  return case when p_write then v_access = 'coordinator' else true end;
end $$;
revoke all on function public._lt_coord_thread_ok(text, boolean) from public, anon;
grant execute on function public._lt_coord_thread_ok(text, boolean) to authenticated, service_role;

-- 2. Storage policies (additive) ---------------------------------------------------------------------------------------
drop policy if exists job_evidence_coord_insert on storage.objects;
create policy job_evidence_coord_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'job-evidence' and public._lt_coord_thread_ok((storage.foldername(name))[1], true));

drop policy if exists job_evidence_coord_select on storage.objects;
create policy job_evidence_coord_select on storage.objects for select to authenticated
  using (bucket_id = 'job-evidence' and public._lt_coord_thread_ok((storage.foldername(name))[1], false)
         and not exists (select 1 from public.evidence_removals r where r.storage_path = objects.name));

-- 3. Internal: post one message as the Local Tasker, record the coordinator ------------------------------------------------
create or replace function public._lt_6d3_post(p_booking uuid, p_request_id uuid, p_thread uuid, p_type text, p_body text, p_payload jsonb, p_preview text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; v_msg_id text; v_msg_at timestamptz; v_cu0 integer; v_cu1 integer;
begin
  select * into s from public.local_booking_state where booking_id = p_booking;
  select * into b from public.bookings where id = p_booking;
  select coalesce(customer_unread, 0) into v_cu0 from public.message_threads where id = p_thread;
  insert into public.messages (thread_id, sender_id, receiver_id, body, type, payload, flagged, created_at)
  values (p_thread, s.tasker_user_id, b.customer_id, p_body, p_type, p_payload, false, clock_timestamp())
  returning id::text, created_at into v_msg_id, v_msg_at;
  insert into public.coordinator_message_authors (message_id, booking_id, coordinator_id, request_id) values (v_msg_id, p_booking, v_me, p_request_id);
  select coalesce(customer_unread, 0) into v_cu1 from public.message_threads where id = p_thread;
  update public.message_threads
     set last_message = left(p_preview, 80), last_message_at = clock_timestamp(),
         customer_unread = case when v_cu1 > v_cu0 then v_cu1 else v_cu0 + 1 end
   where id = p_thread;
  insert into public.coordinator_thread_reads (coordinator_id, thread_id, last_read_at) values (v_me, p_thread, clock_timestamp())
    on conflict (coordinator_id, thread_id) do update set last_read_at = excluded.last_read_at;
  return jsonb_build_object('message_id', v_msg_id, 'thread_id', p_thread, 'created_at', v_msg_at, 'duplicate', false);
end $$;
revoke all on function public._lt_6d3_post(uuid, uuid, uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public._lt_6d3_post(uuid, uuid, uuid, text, text, jsonb, text) to service_role;

-- 4. Send a photo, video or file ---------------------------------------------------------------------------------------------
-- The browser first uploads the file to job-evidence under <thread_id>/<anything> (storage policy above), then calls this.
-- p_kind: 'photo' | 'video' | 'file'. Refusals (hint): not_found, read_only, bad_input, contact_info, bad_file (the message says why).
create or replace function public.coordinator_send_attachment(p_booking uuid, p_request_id uuid, p_kind text, p_path text, p_name text, p_caption text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid(); v_access text; s public.local_booking_state; b public.bookings; v_open jsonb; v_thread uuid; a public.coordinator_message_authors;
  v_cap text := nullif(btrim(coalesce(p_caption, '')), ''); v_name text := left(btrim(coalesce(p_name, '')), 120);
  att public.job_attachments; v_type text; v_body text; v_payload jsonb; v_msg_at timestamptz;
begin
  v_access := public.local_chat_access(p_booking);
  if v_access is null or p_request_id is null then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if v_access <> 'coordinator' then raise exception 'This conversation is read only for you.' using errcode = 'P0001', hint = 'read_only'; end if;

  select * into a from public.coordinator_message_authors where request_id = p_request_id;
  if found then
    if a.coordinator_id is distinct from v_me or a.booking_id is distinct from p_booking then
      raise exception 'Something went wrong. Please try again.' using errcode = 'P0001', hint = 'bad_input';
    end if;
    select m.created_at into v_msg_at from public.messages m where m.id::text = a.message_id;
    return jsonb_build_object('message_id', a.message_id, 'created_at', coalesce(v_msg_at, a.created_at), 'duplicate', true);
  end if;

  if p_kind not in ('photo', 'video', 'file') or v_name = '' or p_path is null or char_length(p_path) > 300 then
    raise exception 'Something went wrong. Please try again.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if v_cap is not null and char_length(v_cap) > 500 then
    raise exception 'A caption can have up to 500 characters.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if v_cap is not null and public._lt_contains_contact(v_cap) then
    raise exception 'This message appears to contain contact details, which are not allowed on StreetTasker.' using errcode = 'P0001', hint = 'contact_info';
  end if;

  select * into s from public.local_booking_state where booking_id = p_booking;
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  v_open := public.open_local_thread(p_booking);
  v_thread := (v_open ->> 'thread_id')::uuid;
  if v_thread is null or v_open ->> 'role' <> 'coordinator' then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if p_path not like (v_thread::text || '/%') then
    raise exception 'Something went wrong. Please try again.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  begin
    -- mime and size are replaced by the real values from storage inside job_attachments_guard; uploader = the Local Tasker identity
    insert into public.job_attachments (thread_id, uploader_id, kind, storage_path, mime, size, label)
    values (v_thread, s.tasker_user_id, p_kind, p_path, 'application/octet-stream', 1, v_cap)
    returning * into att;
  exception
    when sqlstate '22023' then
      raise exception '%', sqlerrm using errcode = 'P0001', hint = 'bad_file';
    when unique_violation then
      raise exception 'This file was already sent.' using errcode = 'P0001', hint = 'bad_file';
  end;

  v_type := case p_kind when 'photo' then 'image' when 'video' then 'video' else 'file' end;
  v_body := coalesce(v_cap, case v_type when 'image' then 'Photo' when 'video' then 'Video' else left(v_name, 80) end);
  v_payload := jsonb_build_object('attachment_id', att.id, 'path', att.storage_path, 'name', v_name, 'size', att.size, 'mime', att.mime);
  if v_cap is not null then v_payload := v_payload || jsonb_build_object('caption', v_cap); end if;

  begin
    return public._lt_6d3_post(p_booking, p_request_id, v_thread, v_type, v_body, v_payload, v_body);
  exception when unique_violation then
    select * into a from public.coordinator_message_authors where request_id = p_request_id;
    if not found then raise; end if;
    return jsonb_build_object('message_id', a.message_id, 'created_at', a.created_at, 'duplicate', true);
  end;
end $$;
revoke all on function public.coordinator_send_attachment(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.coordinator_send_attachment(uuid, uuid, text, text, text, text) to authenticated, service_role;

-- 5. Send a location ---------------------------------------------------------------------------------------------------------
create or replace function public.coordinator_send_location(p_booking uuid, p_request_id uuid, p_lat numeric, p_lng numeric, p_label text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid(); v_access text; a public.coordinator_message_authors; v_open jsonb; v_thread uuid; v_msg_at timestamptz;
  v_label text := nullif(btrim(coalesce(p_label, '')), ''); v_payload jsonb;
begin
  v_access := public.local_chat_access(p_booking);
  if v_access is null or p_request_id is null then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if v_access <> 'coordinator' then raise exception 'This conversation is read only for you.' using errcode = 'P0001', hint = 'read_only'; end if;

  select * into a from public.coordinator_message_authors where request_id = p_request_id;
  if found then
    if a.coordinator_id is distinct from v_me or a.booking_id is distinct from p_booking then
      raise exception 'Something went wrong. Please try again.' using errcode = 'P0001', hint = 'bad_input';
    end if;
    select m.created_at into v_msg_at from public.messages m where m.id::text = a.message_id;
    return jsonb_build_object('message_id', a.message_id, 'created_at', coalesce(v_msg_at, a.created_at), 'duplicate', true);
  end if;

  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'That location is not valid.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if v_label is not null and char_length(v_label) > 80 then
    raise exception 'A location name can have up to 80 characters.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if v_label is not null and public._lt_contains_contact(v_label) then
    raise exception 'This message appears to contain contact details, which are not allowed on StreetTasker.' using errcode = 'P0001', hint = 'contact_info';
  end if;

  v_open := public.open_local_thread(p_booking);
  v_thread := (v_open ->> 'thread_id')::uuid;
  if v_thread is null or v_open ->> 'role' <> 'coordinator' then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;

  v_payload := jsonb_build_object('lat', round(p_lat, 6), 'lng', round(p_lng, 6));
  if v_label is not null then v_payload := v_payload || jsonb_build_object('label', v_label); end if;
  begin
    return public._lt_6d3_post(p_booking, p_request_id, v_thread, 'location', coalesce(v_label, 'Shared location'), v_payload, coalesce(v_label, 'Shared location'));
  exception when unique_violation then
    select * into a from public.coordinator_message_authors where request_id = p_request_id;
    if not found then raise; end if;
    return jsonb_build_object('message_id', a.message_id, 'created_at', a.created_at, 'duplicate', true);
  end;
end $$;
revoke all on function public.coordinator_send_location(uuid, uuid, numeric, numeric, text) from public, anon;
grant execute on function public.coordinator_send_location(uuid, uuid, numeric, numeric, text) to authenticated, service_role;

-- 6. The conversation, now with the attachment details ---------------------------------------------------------------------------
-- Identical to the Stage 6B function except for the new 'payload' key on image/video/file/location messages.
create or replace function public.coordinator_chat_thread(p_booking uuid, p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); v_access text; v_lim integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  s public.local_booking_state; b public.bookings; v_thread uuid; v_msgs jsonb := '[]'::jsonb; v_notes jsonb; v_total integer := 0; v_read timestamptz;
begin
  v_access := public.local_chat_access(p_booking);
  if v_access is null then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into s from public.local_booking_state where booking_id = p_booking;
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;

  select t.id into v_thread from public.message_threads t
   where t.context_type = 'booking' and t.context_id::text = p_booking::text and t.customer_id = b.customer_id and t.tasker_id = s.tasker_user_id
   order by t.last_message_at desc nulls last limit 1;

  if v_thread is not null then
    select count(*) into v_total from public.messages where thread_id = v_thread;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', q.id::text,
             'kind', case when q.sender_id = b.customer_id then 'customer'
                          when q.author_id is not null then 'coordinator'
                          when q.sender_id = s.tasker_user_id then 'local_tasker' else 'other' end,
             'type', q.type, 'body', q.body, 'created_at', q.created_at,
             'author_name', case when q.author_id is not null then coalesce(nullif(btrim(coalesce(q.author_name, '')), ''), 'Coordinator') end,
             'author_is_me', q.author_id is not distinct from v_me,
             'payload', case when q.type in ('image', 'video', 'file', 'location') and jsonb_typeof(q.payload) = 'object'
                             then (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(q.payload) e
                                    where e.key in ('attachment_id', 'path', 'name', 'size', 'mime', 'caption', 'lat', 'lng', 'label')) end
           ) order by q.created_at, q.id), '[]'::jsonb)
      into v_msgs
      from (select m.id, m.sender_id, m.type, m.body, m.payload, m.created_at, a.coordinator_id as author_id, to_jsonb(c) ->> 'display_name' as author_name
              from public.messages m
              left join public.coordinator_message_authors a on a.message_id = m.id::text
              left join public.coordinators c on c.user_id = a.coordinator_id
             where m.thread_id = v_thread
             order by m.created_at desc, m.id desc limit v_lim) q;
    select r.last_read_at into v_read from public.coordinator_thread_reads r where r.thread_id = v_thread and r.coordinator_id = v_me;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'body', q.body, 'created_at', q.created_at,
           'author_name', coalesce(nullif(btrim(coalesce(q.author_name, '')), ''), 'Coordinator'),
           'author_is_me', q.author_id = v_me
         ) order by q.created_at, q.id), '[]'::jsonb)
    into v_notes
    from (select n.id, n.body, n.created_at, n.author_id, to_jsonb(c) ->> 'display_name' as author_name
            from public.coordinator_internal_notes n
            left join public.coordinators c on c.user_id = n.author_id
           where n.booking_id = p_booking
           order by n.created_at desc, n.id desc limit 200) q;

  return jsonb_build_object('booking_id', p_booking, 'access', v_access, 'read_only', v_access <> 'coordinator',
                            'thread_id', v_thread, 'total_messages', v_total, 'last_read_at', v_read,
                            'messages', v_msgs, 'notes', v_notes);
end $$;
revoke all on function public.coordinator_chat_thread(uuid, integer) from public, anon;
grant execute on function public.coordinator_chat_thread(uuid, integer) to authenticated, service_role;

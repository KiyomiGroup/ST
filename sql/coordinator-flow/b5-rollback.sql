-- B5 rollback: puts submit_offer back to the exact text you pasted, removes the booked-task read policy and the service image function.
-- Service images already saved stay in services.photo (they are only data).
drop policy if exists "Public can read booked tasks" on public.tasks;
drop function if exists public.set_local_tasker_service_photo(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.submit_offer(p_task uuid, p_message text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_whatsapp text DEFAULT NULL::text, p_client_request_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  uid        uuid := auth.uid();
  v_now      timestamptz := now();
  v_msg      text;
  v_phone    text;
  v_wa       text;
  v_prev     public.offer_usage;
  v_role     text;
  v_roles    text[];
  v_uname    text;
  v_tasker   boolean := false;
  t          public.tasks;
  v_owner    uuid;
  app        public.task_applications;
  v_resub    boolean := false;
  ent        jsonb;
  v_period   timestamptz;
  v_source   text;
  v_credit   uuid;
  v_app_id   uuid;
  v_name     text;
  v_day_cap  integer; v_day_used integer;
begin
  -- 1. who is asking, and is the request well formed
  if uid is null then raise exception 'not_signed_in' using errcode = '28000', detail = 'Please sign in to send an offer.'; end if;
  if p_client_request_id is null or length(p_client_request_id) not between 8 and 80 then
    raise exception 'bad_request_id' using errcode = 'P0001', detail = 'The request id must be 8 to 80 characters.';
  end if;
  if p_task is null then raise exception 'task_not_found' using errcode = 'P0001', detail = 'This task could not be found.'; end if;
  v_msg   := nullif(btrim(coalesce(p_message, '')), '');
  v_phone := nullif(btrim(coalesce(p_phone, '')), '');
  v_wa    := nullif(btrim(coalesce(p_whatsapp, '')), '');
  if length(coalesce(v_msg, '')) > 5000 then      -- owner may change: largest offer text accepted
    raise exception 'message_too_long' using errcode = 'P0001', detail = 'Your offer text is too long.';
  end if;
  if length(coalesce(v_phone, '')) > 40 or length(coalesce(v_wa, '')) > 40 then   -- owner may change: longest phone or WhatsApp value
    raise exception 'bad_contact' using errcode = 'P0001', detail = 'That phone or WhatsApp number is too long.';
  end if;

  -- 2. one offer at a time per person (released at commit or rollback)
  perform pg_advisory_xact_lock(hashtext('offer:' || uid::text));

  -- 3. a repeat of a request that already went through returns the first answer and consumes nothing
  select * into v_prev from public.offer_usage
   where user_id = uid and kind = 'consume' and client_request_id = p_client_request_id;
  if found then
    if v_prev.task_id is distinct from p_task then
      raise exception 'request_id_reused' using errcode = 'P0001', detail = 'This request id was already used for a different task.';
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'resubmitted', false, 'application_id', v_prev.application_id,
                              'source', v_prev.source, 'entitlements', public._entitlements_for(uid, v_now));
  end if;

  -- 4. taskers only; Local Taskers are handled by their coordinator
  if public.is_local_tasker(uid) then
    raise exception 'local_tasker' using errcode = 'P0001', detail = 'Local Taskers cannot send offers. Their coordinator handles bookings.';
  end if;
  select u.role, u.roles, u.name into v_role, v_roles, v_uname from public.users u where u.id = uid;
  if found then v_tasker := (v_role = 'tasker') or ('tasker' = any (coalesce(v_roles, '{}'::text[]))); end if;
  if not v_tasker then
    raise exception 'not_a_tasker' using errcode = 'P0001', detail = 'Only taskers can send offers.';
  end if;

  -- 5. the task must exist and belong to someone else
  select * into t from public.tasks where id = p_task for share;
  if not found then raise exception 'task_not_found' using errcode = 'P0001', detail = 'This task could not be found.'; end if;
  if t.customer_id = uid or t.user_id = uid then
    raise exception 'own_task' using errcode = 'P0001', detail = 'You cannot send an offer on your own task.';
  end if;
  v_owner := coalesce(t.customer_id, t.user_id);

  -- 6. one offer per task; only a withdrawn one can be sent again (your own earlier offer is reported before "closed")
  select * into app from public.task_applications where task_id = p_task and tasker_id = uid for update;
  if found then
    if app.status = 'withdrawn' then v_resub := true;
    else raise exception 'already_offered' using errcode = 'P0001', detail = 'You have already sent an offer for this task.';
    end if;
  end if;
  if coalesce(t.status, 'open') <> 'open'
     or exists (select 1 from public.task_applications a where a.task_id = p_task and a.status = 'accepted') then
    raise exception 'task_closed' using errcode = 'P0001', detail = 'This task is no longer taking offers.';
  end if;

  -- 7. what may this person still do? (S2c decides; nothing is recomputed here)
  ent      := public._entitlements_for(uid, v_now);
  v_period := (ent->>'period_start')::timestamptz;
  if (ent #>> '{offers,unlimited}')::boolean then
    if (ent #>> '{offers,fair_use_remaining}')::integer <= 0 then
      v_day_cap  := (ent #>> '{offers,fair_use_day_cap}')::integer;
      v_day_used := (ent #>> '{offers,fair_use_day_used}')::integer;
      if v_day_cap is not null and v_day_used >= v_day_cap then
        raise exception 'fair_use_daily' using errcode = 'P0001', detail = 'You have reached the daily fair-use limit for offers. Please try again tomorrow.';
      end if;
      raise exception 'fair_use_monthly' using errcode = 'P0001', detail = 'You have reached the monthly fair-use limit for offers.';
    end if;
    v_source := 'allowance';
  elsif (ent #>> '{offers,remaining}')::integer > 0 then
    v_source := 'allowance';
  else
    select c.id into v_credit from public.offer_credits c
     where c.user_id = uid and c.remaining > 0 and (c.expires_at is null or c.expires_at > v_now)
     order by c.expires_at asc nulls last, c.created_at, c.id
     limit 1 for update;
    if not found then
      raise exception 'offer_limit_reached' using errcode = 'P0001', detail = 'You have used all your offers for this period.';
    end if;
    update public.offer_credits set remaining = remaining - 1 where id = v_credit;
    v_source := 'credit';
  end if;

  -- 8. save the offer (a revived one keeps its row, and counts again)
  if v_resub then
    update public.task_applications
       set status = 'pending', message = v_msg, applicant_phone = v_phone, applicant_whatsapp = v_wa, created_at = v_now
     where id = app.id;
    v_app_id := app.id;
  else
    begin
      insert into public.task_applications (task_id, tasker_id, message, status, applicant_phone, applicant_whatsapp)
      values (p_task, uid, v_msg, 'pending', v_phone, v_wa)
      returning id into v_app_id;
    exception when unique_violation then
      raise exception 'already_offered' using errcode = 'P0001', detail = 'You have already sent an offer for this task.';
    end;
  end if;

  -- 9. write the ledger row (the unique request index is the last line of defence against a double count)
  insert into public.offer_usage (user_id, period_start, kind, source, credit_id, quantity, client_request_id, application_id, task_id)
  values (uid, v_period, 'consume', v_source, v_credit, 1, p_client_request_id, v_app_id, p_task);

  -- 10. tell the task owner (same type, title, message and data as the website sends today; _notify never raises)
  if v_owner is not null then
    select nullif(btrim(tk.name), '') into v_name from public.taskers tk where tk.user_id = uid::text limit 1;
    v_name := coalesce(v_name, nullif(btrim(v_uname), ''), 'A tasker');
    perform public._notify(v_owner, 'task_application', 'New Application',
                           v_name || ' applied for your task "' || coalesce(t.title, 'a task') || '"',
                           jsonb_build_object('task_id', p_task, 'application_id', v_app_id, 'tasker_id', uid));
  end if;

  return jsonb_build_object('ok', true, 'replayed', false, 'resubmitted', v_resub, 'application_id', v_app_id,
                            'source', v_source, 'entitlements', public._entitlements_for(uid, v_now));
end $function$;

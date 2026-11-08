-- Stage F-2 SQL. Run ONCE in the Supabase SQL editor (safe to run twice). Changes:
--  A. A Local Tasker can only be PUBLISHED when their identity is VERIFIED (or the account is on the test-account exempt list).
--     Local Taskers that are ALREADY published stay live and can still be refreshed (owner decision 2026-11-07: "leave it").
--  B. The administrator call-back (second check) is switched off for good: new confirmations are always 'off', the 2 open
--     requests are cleared, and the admin function that answered call-backs is removed.
-- Every function below is the LIVE text from the F1 results with one marked change.

begin;

-- ---------- A. identity gate ----------
create or replace function public._local_tasker_identity_ok(p_tasker uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select exists (select 1 from public.identity_verifications where user_id = p_tasker and status = 'VERIFIED')
      or public.idv_is_exempt(p_tasker)
$$;
revoke all on function public._local_tasker_identity_ok(uuid) from public, anon, authenticated;

create or replace function public.local_tasker_publish_status(p_tasker uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare v_me uuid := auth.uid(); v_status text; r jsonb; v_ok boolean;
begin
  if v_me is null or p_tasker is null
     or not public.is_active_coordinator(v_me)
     or not public.coordinator_manages_tasker(v_me, p_tasker) then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select status into v_status from public.local_tasker_profiles where tasker_user_id = p_tasker;
  if not found then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;
  r := public._local_tasker_readiness(p_tasker);
  -- CHANGE (F-2): a blocking "identity" check; a Local Tasker that is already published is not held back by it
  v_ok := public._local_tasker_identity_ok(p_tasker) or v_status = 'published';
  r := jsonb_set(r, '{checks}', coalesce(r->'checks', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('key', 'identity', 'ok', v_ok, 'blocking', true)));
  r := jsonb_set(r, '{ready}', to_jsonb(coalesce((r->>'ready')::boolean, false) and v_ok));
  return r || jsonb_build_object('status', v_status);
end $function$;

create or replace function public.publish_local_tasker(p_tasker uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_me uuid := auth.uid();
  p public.local_tasker_profiles;
  r jsonb;
  v_failed text[];
  v_primary uuid;
  v_again boolean;
begin
  if v_me is null or p_tasker is null
     or not public.is_active_coordinator(v_me)
     or not public.coordinator_manages_tasker(v_me, p_tasker) then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into p from public.local_tasker_profiles where tasker_user_id = p_tasker for update;
  if not found then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;

  -- CHANGE (F-2): a first publish needs the Local Tasker's identity VERIFIED; a refresh of a live listing is not blocked
  if p.status <> 'published' and not public._local_tasker_identity_ok(p_tasker) then
    raise exception 'This Local Tasker cannot be published until their identity is verified.' using errcode = 'P0001', hint = 'identity_not_verified';
  end if;

  r := public._local_tasker_readiness(p_tasker);
  select array_agg(c->>'key') into v_failed
    from jsonb_array_elements(r->'checks') c
   where (c->>'blocking')::boolean and not (c->>'ok')::boolean;
  if v_failed is not null then
    raise exception 'This Local Tasker is not ready to publish: %', array_to_string(v_failed, ', ')
      using errcode = 'P0001', hint = 'not_ready';
  end if;

  v_again := (p.status = 'published');
  v_primary := public._local_tasker_sync_public(p_tasker);
  if v_primary is null then
    raise exception 'This Local Tasker needs at least one active service with a price.' using errcode = 'P0001', hint = 'not_ready';
  end if;

  if not v_again then
    update public.local_tasker_profiles
       set status = 'published', published_at = now(), published_by = v_me
     where tasker_user_id = p_tasker;
  end if;

  perform public.local_tasker_audit(
    case when v_again then 'local_tasker_listing_refreshed' else 'local_tasker_published' end,
    'local_tasker', p_tasker::text,
    jsonb_build_object('status', p.status),
    jsonb_build_object('status', 'published', 'primary_service_id', v_primary,
                       'services', (r->>'services')::int, 'photos', (r->>'photos')::int,
                       'verification_recorded', (select (c->>'ok')::boolean from jsonb_array_elements(r->'checks') c where c->>'key' = 'verification')),
    v_me);
  return jsonb_build_object('status', 'published', 'already_published', v_again, 'primary_service_id', v_primary);
end $function$;

-- ---------- B. no more administrator call-back ----------
create or replace function public.local_booking_confirmations_no_second_check()
returns trigger language plpgsql as $$
begin
  new.second_check_status := 'off'; new.second_check_by := null; new.second_check_at := null; new.second_check_note := null;
  return new;
end $$;
drop trigger if exists local_booking_confirmations_a_no_second_check on public.local_booking_confirmations;
create trigger local_booking_confirmations_a_no_second_check before insert on public.local_booking_confirmations
  for each row execute function public.local_booking_confirmations_no_second_check();

-- clear the open requests quietly (no timeline row: the old audit trigger would write an administrator entry)
set local session_replication_role = replica;
update public.local_booking_confirmations set second_check_status = 'off' where second_check_status in ('requested', 'failed');
set local session_replication_role = origin;

drop function if exists public.local_booking_second_check(uuid, boolean, text);

commit;

-- Check (read-only): both numbers must be 0 on the first row, and the second query must show only 'off' and 'passed' (or nothing)
select count(*) as open_callbacks_left from public.local_booking_confirmations where second_check_status in ('requested', 'failed');
select second_check_status, count(*) from public.local_booking_confirmations group by 1;

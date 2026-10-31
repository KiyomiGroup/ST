-- Stage 4C-1: preview + publish for a Local Tasker, and the customer-safe read functions.
-- Additive and re-runnable. Rollback: stage-4c1-rollback.sql.
-- Run in the Supabase SQL editor (select all, Run). Run it twice; the second run must show no error.
--
-- Creates:
--   1. _local_tasker_readiness(uuid)         internal: the publish checklist. Not callable from the browser.
--   2. local_tasker_publish_status(uuid)     the managing coordinator reads the checklist (rpc).
--   3. _local_tasker_sync_public(uuid)       internal: copies the primary service onto the `taskers` row
--                                            the way postService in js/db.js does. Not callable from the browser.
--   4. publish_local_tasker(uuid)            the ONLY way a Local Tasker becomes public (rpc). Authority comes
--                                            from auth.uid(). Refuses unless every blocking check passes. Audited.
--                                            Pressing it again on a published person refreshes the public listing.
--   5. unpublish_local_tasker(uuid, text)    hides the person again (rpc). Nothing is deleted. Audited.
--   6. local_tasker_public_info(text[])      customer-safe: which of these user ids are PUBLISHED Local Taskers,
--                                            and the path of their cover photo. Callable by anon (no private data).
--   7. local_tasker_public_photos(uuid)      customer-safe: the photo paths and captions of a PUBLISHED person.
--   8. local_tasker_photo_is_public(text) and ONE storage policy so customers and visitors may read a photo
--      file (through short-lived signed links) ONLY while its owner is published and the photo is not removed.
--      The bucket stays private: no photo can be opened by a plain URL.
-- Changes NO existing object. Regular taskers, customers and their policies are untouched.
-- Nothing else flips `status` to published: use these functions only.

-- 1. Readiness (internal) ---------------------------------------------------------------------
-- blocking = true  : publishing is refused while it is false.
-- blocking = false : shown to the coordinator as a recommendation only.
create or replace function public._local_tasker_readiness(p_tasker uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p public.local_tasker_profiles;
  u public.users;
  t public.taskers;
  v_services int; v_photos int; v_checks jsonb; v_ready boolean := true;
  v_has_user boolean; v_has_tasker boolean;
begin
  select * into p from public.local_tasker_profiles where tasker_user_id = p_tasker;
  if not found then return jsonb_build_object('ready', false, 'checks', '[]'::jsonb, 'services', 0, 'photos', 0); end if;
  select * into u from public.users where id = p_tasker;       v_has_user := found;
  select * into t from public.taskers where user_id = p_tasker::text; v_has_tasker := found;
  select count(*) into v_services from public.services s
   where s.user_id = p_tasker and s.available is true and s.price is not null and s.price > 0;
  select count(*) into v_photos from public.local_tasker_photos ph
   where ph.tasker_user_id = p_tasker and ph.removed_at is null;

  -- each check: key, ok, blocking
  v_checks := jsonb_build_array(
    jsonb_build_object('key', 'not_retired', 'blocking', true, 'ok', p.status in ('draft', 'ready', 'published')),
    jsonb_build_object('key', 'public_name', 'blocking', true,
                       'ok', v_has_user and char_length(btrim(coalesce(u.name, ''))) >= 2),
    jsonb_build_object('key', 'tasker_row', 'blocking', true, 'ok', v_has_tasker),
    jsonb_build_object('key', 'agreement_profile', 'blocking', true,
                       'ok', exists (select 1 from public.local_tasker_consents c
                                      where c.tasker_user_id = p_tasker and c.purpose = 'profile' and c.revoked_at is null)),
    jsonb_build_object('key', 'agreement_publish', 'blocking', true,
                       'ok', exists (select 1 from public.local_tasker_consents c
                                      where c.tasker_user_id = p_tasker and c.purpose = 'publish_info' and c.revoked_at is null)),
    jsonb_build_object('key', 'agreement_photos', 'blocking', true,
                       'ok', v_photos = 0 or exists (select 1 from public.local_tasker_consents c
                                                      where c.tasker_user_id = p_tasker and c.purpose = 'photos' and c.revoked_at is null)),
    jsonb_build_object('key', 'service', 'blocking', true, 'ok', v_services >= 1),
    -- Publishing makes the users/taskers rows readable by everyone: private contact data must not be there.
    jsonb_build_object('key', 'private_clear', 'blocking', true,
                       'ok', (not v_has_tasker or (btrim(coalesce(t.phone, '')) = '' and btrim(coalesce(t.whatsapp, '')) = ''))
                             and (not v_has_user or (btrim(coalesce(u.whatsapp, '')) = '' and u.dob is null))),
    jsonb_build_object('key', 'verification', 'blocking', false,
                       'ok', p.verification_method is not null and p.verified_at is not null),
    jsonb_build_object('key', 'photo', 'blocking', false, 'ok', v_photos >= 1)
  );
  select coalesce(bool_and((c->>'ok')::boolean or not (c->>'blocking')::boolean), true)
    into v_ready from jsonb_array_elements(v_checks) c;
  return jsonb_build_object('ready', v_ready, 'checks', v_checks, 'services', v_services, 'photos', v_photos);
end $$;
revoke all on function public._local_tasker_readiness(uuid) from public, anon, authenticated;
grant execute on function public._local_tasker_readiness(uuid) to service_role;

-- 2. Checklist for the coordinator ------------------------------------------------------------
create or replace function public.local_tasker_publish_status(p_tasker uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); v_status text;
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
  return public._local_tasker_readiness(p_tasker) || jsonb_build_object('status', v_status);
end $$;
revoke all on function public.local_tasker_publish_status(uuid) from public, anon;
grant execute on function public.local_tasker_publish_status(uuid) to authenticated, service_role;

-- 3. Copy the primary service onto the public `taskers` row (internal) -------------------------
-- Primary service = the oldest ACTIVE service with a price. Mirrors js/db.js postService:
-- service, category, rate_value, rate ("₦12,500/job"), location, bio, available. The picture is NOT
-- copied: photos live in a private bucket and customers get short-lived signed links (decision D46),
-- so photo_url / photo stay empty. A Local Tasker is never "verified" (that flag is for the site's own checks).
create or replace function public._local_tasker_sync_public(p_tasker uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.local_tasker_profiles;
  s public.services;
  v_rate text;
begin
  select * into p from public.local_tasker_profiles where tasker_user_id = p_tasker;
  select * into s from public.services x
   where x.user_id = p_tasker and x.available is true and x.price is not null and x.price > 0
   order by x.created_at asc, x.id asc limit 1;
  if p.tasker_user_id is null or s.id is null then return null; end if;
  v_rate := '₦' || rtrim(rtrim(to_char(s.price, 'FM999,999,999,990.00'), '0'), '.') || coalesce(s.rate_unit, '/job');
  update public.taskers t
     set service = s.service_name, service_name = s.service_name, category = s.category,
         rate_value = s.price, price = s.price, rate_unit = s.rate_unit, rate = v_rate,
         location = coalesce(nullif(btrim(coalesce(s.location, '')), ''), p.areas_served),
         bio = s.description, description = s.description,
         specialties = coalesce(s.specialties, '{}'::text[]),
         availability_status = coalesce(s.availability_status, 'available_this_week'),
         is_verified = false, verified = false,
         photo_url = null, photo = null,
         available = true
   where t.user_id = p_tasker::text;
  return s.id;
end $$;
revoke all on function public._local_tasker_sync_public(uuid) from public, anon, authenticated;
grant execute on function public._local_tasker_sync_public(uuid) to service_role;

-- 4. publish_local_tasker ---------------------------------------------------------------------
create or replace function public.publish_local_tasker(p_tasker uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
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
end $$;
revoke all on function public.publish_local_tasker(uuid) from public, anon;
grant execute on function public.publish_local_tasker(uuid) to authenticated, service_role;

-- 5. unpublish_local_tasker -------------------------------------------------------------------
create or replace function public.unpublish_local_tasker(p_tasker uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid();
  p public.local_tasker_profiles;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
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
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'The reason is too long.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if p.status <> 'published' then
    return jsonb_build_object('status', p.status, 'changed', false);
  end if;

  update public.local_tasker_profiles set status = 'ready' where tasker_user_id = p_tasker;
  update public.taskers set available = false where user_id = p_tasker::text;

  perform public.local_tasker_audit('local_tasker_unpublished', 'local_tasker', p_tasker::text,
    jsonb_build_object('status', 'published'),
    jsonb_build_object('status', 'ready', 'reason', v_reason), v_me);
  return jsonb_build_object('status', 'ready', 'changed', true);
end $$;
revoke all on function public.unpublish_local_tasker(uuid, text) from public, anon;
grant execute on function public.unpublish_local_tasker(uuid, text) to authenticated, service_role;

-- 6. Customer-safe: which ids are published Local Taskers (+ cover photo path) ----------------
-- Returns ONLY rows for published people. No name, phone, notes or status other than "published".
create or replace function public.local_tasker_public_info(p_ids text[])
returns table (user_id text, cover_path text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.tasker_user_id::text,
         (select ph.storage_path from public.local_tasker_photos ph
           where ph.tasker_user_id = p.tasker_user_id and ph.removed_at is null
           order by ph.is_cover desc, ph.created_at asc limit 1)
    from public.local_tasker_profiles p
   where p.status = 'published'
     and cardinality(coalesce(p_ids, '{}'::text[])) between 1 and 100
     and p.tasker_user_id::text = any (p_ids)
$$;
revoke all on function public.local_tasker_public_info(text[]) from public;
grant execute on function public.local_tasker_public_info(text[]) to anon, authenticated, service_role;

-- 7. Customer-safe: the photos of ONE published person ----------------------------------------
create or replace function public.local_tasker_public_photos(p_tasker uuid)
returns table (path text, caption text, is_cover boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select ph.storage_path, ph.caption, ph.is_cover
    from public.local_tasker_photos ph
    join public.local_tasker_profiles p on p.tasker_user_id = ph.tasker_user_id
   where ph.tasker_user_id = p_tasker and ph.removed_at is null and p.status = 'published'
   order by ph.is_cover desc, ph.created_at asc
   limit 8
$$;
revoke all on function public.local_tasker_public_photos(uuid) from public;
grant execute on function public.local_tasker_public_photos(uuid) to anon, authenticated, service_role;

-- 8. Public read of a photo FILE, only while published and not removed -------------------------
create or replace function public.local_tasker_photo_is_public(p_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.local_tasker_photos ph
      join public.local_tasker_profiles p on p.tasker_user_id = ph.tasker_user_id
     where ph.storage_path = p_name and ph.removed_at is null and p.status = 'published')
$$;
revoke all on function public.local_tasker_photo_is_public(text) from public;
grant execute on function public.local_tasker_photo_is_public(text) to anon, authenticated, service_role;

drop policy if exists lt_photos_storage_public_read on storage.objects;
create policy lt_photos_storage_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'local-tasker-photos' and public.local_tasker_photo_is_public(name));

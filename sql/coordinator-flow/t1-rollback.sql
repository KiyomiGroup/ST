-- Undo t1-local-tasker-rules.sql: restores the six original functions and drops the new triggers and functions. The new COLUMNS stay (harmless).
begin;
drop trigger if exists services_live_limit on public.services;
drop trigger if exists services_mark_republish on public.services;
drop trigger if exists photos_mark_republish on public.local_tasker_photos;
drop trigger if exists profile_mark_republish on public.local_tasker_profiles;
drop function if exists public.services_live_limit_guard();
drop function if exists public._lt_services_changed();
drop function if exists public._lt_photos_changed();
drop function if exists public._lt_profile_changed();
drop function if exists public._lt_mark_republish(uuid);
drop function if exists public.set_local_tasker_main_service(uuid, uuid);
drop function if exists public.add_local_tasker_avatar(uuid, text, text, text, text);
CREATE OR REPLACE FUNCTION public._local_tasker_readiness(p_tasker uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public._local_tasker_sync_public(p_tasker uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.publish_local_tasker(p_tasker uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

CREATE OR REPLACE FUNCTION public.add_local_tasker_photo(p_tasker uuid, p_path text, p_caption text, p_make_cover boolean, p_consent_method text, p_consent_evidence text, p_consent_details text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me uuid := auth.uid();
  v_path text := btrim(coalesce(p_path, ''));
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
  v_method text := nullif(btrim(coalesce(p_consent_method, '')), '');
  v_has_consent boolean;
  v_consent uuid;
  v_id uuid;
  v_cover boolean;
  v_count int;
  ph public.local_tasker_photos;
  o storage.objects;
begin
  if v_me is null or p_tasker is null
     or not public.is_active_coordinator(v_me)
     or not public.coordinator_manages_tasker(v_me, p_tasker) then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;
  perform 1 from public.local_tasker_profiles where tasker_user_id = p_tasker for update;
  if not found then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;

  if v_path !~ ('^' || p_tasker::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
     or (v_caption is not null and char_length(v_caption) > 120)
     or p_make_cover is null then
    raise exception 'Invalid photo details.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  -- Retry of an earlier successful call: same path, same person.
  select * into ph from public.local_tasker_photos where storage_path = v_path;
  if found then
    if ph.tasker_user_id <> p_tasker or ph.removed_at is not null then
      raise exception 'Invalid photo details.' using errcode = 'P0001', hint = 'bad_input';
    end if;
    return jsonb_build_object('photo_id', ph.id, 'created', false, 'is_cover', ph.is_cover);
  end if;

  -- The file must really be in the bucket (uploaded under this coordinator's own permission).
  select * into o from storage.objects where bucket_id = 'local-tasker-photos' and name = v_path;
  if not found then
    raise exception 'The file did not finish uploading.' using errcode = 'P0001', hint = 'upload_missing';
  end if;
  if coalesce((o.metadata->>'size')::bigint, 0) > 5242880 then
    raise exception 'The file is larger than 5 MB.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  select count(*) into v_count from public.local_tasker_photos where tasker_user_id = p_tasker and removed_at is null;
  if v_count >= 8 then
    raise exception 'A Local Tasker can have at most 8 photos.' using errcode = 'P0001', hint = 'photo_limit';
  end if;

  select exists (select 1 from public.local_tasker_consents c
                  where c.tasker_user_id = p_tasker and c.purpose = 'photos' and c.revoked_at is null)
    into v_has_consent;
  if not v_has_consent and (v_method is null or v_method not in ('in_person', 'phone', 'written')) then
    raise exception 'Record how they agreed to have their photos used.' using errcode = 'P0001', hint = 'consent_required';
  end if;

  -- The first photo is the cover; or the coordinator asked for this one to be.
  v_cover := (v_count = 0) or p_make_cover;
  if v_cover then
    update public.local_tasker_photos set is_cover = false where tasker_user_id = p_tasker and is_cover and removed_at is null;
  end if;
  insert into public.local_tasker_photos (tasker_user_id, storage_path, caption, is_cover, added_by)
  values (p_tasker, v_path, v_caption, v_cover, v_me)
  returning id into v_id;

  if not v_has_consent then
    insert into public.local_tasker_consents (tasker_user_id, purpose, method, recorded_by, evidence_ref, details)
    values (p_tasker, 'photos', v_method, v_me,
            nullif(btrim(coalesce(p_consent_evidence, '')), ''), nullif(btrim(coalesce(p_consent_details, '')), ''))
    returning id into v_consent;
    perform public.local_tasker_audit('consent_recorded', 'local_tasker_consent', v_consent::text, null,
      jsonb_build_object('tasker_user_id', p_tasker, 'purpose', 'photos', 'method', v_method), v_me);
  end if;

  perform public.local_tasker_audit('local_tasker_photo_added', 'local_tasker_photo', v_id::text, null,
    jsonb_build_object('tasker_user_id', p_tasker, 'is_cover', v_cover, 'has_caption', v_caption is not null), v_me);
  return jsonb_build_object('photo_id', v_id, 'created', true, 'is_cover', v_cover);
end $function$;

CREATE OR REPLACE FUNCTION public.remove_local_tasker_photo(p_tasker uuid, p_photo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me uuid := auth.uid();
  ph public.local_tasker_photos;
  v_new uuid;
begin
  if v_me is null or p_tasker is null or p_photo is null
     or not public.is_active_coordinator(v_me)
     or not public.coordinator_manages_tasker(v_me, p_tasker) then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into ph from public.local_tasker_photos
   where id = p_photo and tasker_user_id = p_tasker and removed_at is null for update;
  if not found then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;
  update public.local_tasker_photos set removed_at = now(), removed_by = v_me, is_cover = false where id = p_photo;
  if ph.is_cover then
    select id into v_new from public.local_tasker_photos
     where tasker_user_id = p_tasker and removed_at is null order by created_at, id limit 1;
    if v_new is not null then update public.local_tasker_photos set is_cover = true where id = v_new; end if;
  end if;
  perform public.local_tasker_audit('local_tasker_photo_removed', 'local_tasker_photo', p_photo::text,
    jsonb_build_object('was_cover', ph.is_cover),
    jsonb_build_object('tasker_user_id', p_tasker, 'new_cover', v_new), v_me);
  return jsonb_build_object('photo_id', p_photo, 'removed', true, 'new_cover', v_new);
end $function$;

CREATE OR REPLACE FUNCTION public.update_local_tasker_photo(p_tasker uuid, p_photo uuid, p_caption text, p_make_cover boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me uuid := auth.uid();
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
  v_changed text[] := '{}';
  ph public.local_tasker_photos;
begin
  if v_me is null or p_tasker is null or p_photo is null
     or not public.is_active_coordinator(v_me)
     or not public.coordinator_manages_tasker(v_me, p_tasker) then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into ph from public.local_tasker_photos
   where id = p_photo and tasker_user_id = p_tasker and removed_at is null for update;
  if not found then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if (v_caption is not null and char_length(v_caption) > 120) or p_make_cover is null then
    raise exception 'Invalid photo details.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  if ph.caption is distinct from v_caption then v_changed := v_changed || 'caption'::text; end if;
  if p_make_cover and not ph.is_cover then v_changed := v_changed || 'cover'::text; end if;
  if cardinality(v_changed) = 0 then
    return jsonb_build_object('photo_id', p_photo, 'changed', '[]'::jsonb);
  end if;

  if p_make_cover and not ph.is_cover then
    update public.local_tasker_photos set is_cover = false where tasker_user_id = p_tasker and is_cover and removed_at is null;
  end if;
  update public.local_tasker_photos
     set caption = v_caption, is_cover = (is_cover or coalesce(p_make_cover, false))
   where id = p_photo;
  perform public.local_tasker_audit('local_tasker_photo_updated', 'local_tasker_photo', p_photo::text, null,
    jsonb_build_object('tasker_user_id', p_tasker, 'changed_fields', to_jsonb(v_changed)), v_me);
  return jsonb_build_object('photo_id', p_photo, 'changed', to_jsonb(v_changed));
end $function$;

commit;

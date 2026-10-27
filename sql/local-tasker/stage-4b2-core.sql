-- Stage 4B-2: portfolio photos for a Local Tasker, added by the managing coordinator.
-- Additive and re-runnable. Rollback: stage-4b2-rollback.sql.
-- Run in the Supabase SQL editor (select all, Run). Run it twice; the second run must show no error.
--
-- Creates:
--   1. A PRIVATE storage bucket `local-tasker-photos` (5 MB, jpeg/png/webp). Not one of the
--      public app buckets: nobody can open a photo by URL; the coordinator portal uses short-lived
--      signed links. How customers see photos after publishing is decided in Stage 4C.
--   2. Storage policies on that bucket ONLY: an active coordinator who currently manages the Local
--      Tasker may UPLOAD (insert) and READ files under the folder named after that person's id.
--      Admins may read. There is no update and no delete policy: files are never overwritten or
--      removed from the browser.
--   3. Table public.local_tasker_photos (one row per photo; "removed" photos are marked, never deleted).
--   4. Three SECURITY DEFINER functions the browser calls through rpc. Each decides authority itself
--      from auth.uid() (never a parameter): add_local_tasker_photo, update_local_tasker_photo,
--      remove_local_tasker_photo. Every real change writes an audit row.
--   5. The first photo requires the person's `photos` agreement (consent), recorded in the same
--      transaction as an append-only consent row.
-- Changes NO existing object. Nothing here publishes anything or shows anything to customers.

-- 1. Bucket ------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('local-tasker-photos', 'local-tasker-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- 2. Table -------------------------------------------------------------------------------------
create table if not exists public.local_tasker_photos (
  id uuid primary key default gen_random_uuid(),
  tasker_user_id uuid not null references public.local_tasker_profiles (tasker_user_id),
  storage_path text not null unique,
  caption text check (caption is null or char_length(caption) <= 120),
  is_cover boolean not null default false,
  added_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz,
  removed_by uuid,
  constraint local_tasker_photos_path_shape check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  constraint local_tasker_photos_path_owner check (split_part(storage_path, '/', 1) = tasker_user_id::text),
  constraint local_tasker_photos_removed_no_cover check (removed_at is null or not is_cover)
);
-- At most one cover photo per person (among photos not removed).
create unique index if not exists local_tasker_photos_one_cover
  on public.local_tasker_photos (tasker_user_id) where is_cover and removed_at is null;
create index if not exists local_tasker_photos_by_tasker
  on public.local_tasker_photos (tasker_user_id, created_at) where removed_at is null;

alter table public.local_tasker_photos enable row level security;
revoke all on public.local_tasker_photos from public, anon, authenticated;
grant select on public.local_tasker_photos to authenticated;
grant select, insert, update on public.local_tasker_photos to service_role;

drop policy if exists lt_photos_read on public.local_tasker_photos;
create policy lt_photos_read on public.local_tasker_photos for select to authenticated
  using (public.coordinator_manages_tasker(tasker_user_id) or public.is_local_tasker_admin());
-- No insert/update/delete policy: only the functions below write. Customer visibility comes in Stage 4C.

-- 3. Storage policies (this bucket only; other buckets are untouched) ---------------------------
drop policy if exists lt_photos_storage_insert on storage.objects;
create policy lt_photos_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'local-tasker-photos'
    and case when name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
             then public.is_active_coordinator() and public.coordinator_manages_tasker(split_part(name, '/', 1)::uuid)
             else false end);

drop policy if exists lt_photos_storage_read on storage.objects;
create policy lt_photos_storage_read on storage.objects for select to authenticated
  using (
    bucket_id = 'local-tasker-photos'
    and case when name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
             then (public.is_active_coordinator() and public.coordinator_manages_tasker(split_part(name, '/', 1)::uuid))
                  or public.is_local_tasker_admin()
             else false end);

-- 4. add_local_tasker_photo --------------------------------------------------------------------
-- The browser first uploads the file to <tasker id>/<new uuid>.<jpg|png|webp>, then calls this to
-- register it. Safe to call again for the same path (a retry after a lost response).
create or replace function public.add_local_tasker_photo(
  p_tasker uuid, p_path text, p_caption text, p_make_cover boolean,
  p_consent_method text, p_consent_evidence text, p_consent_details text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
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
end $$;

-- 5. update_local_tasker_photo -----------------------------------------------------------------
-- Changes the caption and/or makes this photo the cover. p_caption is always applied (empty clears it).
create or replace function public.update_local_tasker_photo(
  p_tasker uuid, p_photo uuid, p_caption text, p_make_cover boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
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
end $$;

-- 6. remove_local_tasker_photo -----------------------------------------------------------------
-- Marks the photo removed (the row and the file stay, so nothing is destroyed). If it was the cover,
-- the oldest remaining photo becomes the cover.
create or replace function public.remove_local_tasker_photo(p_tasker uuid, p_photo uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
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
end $$;

revoke all on function public.add_local_tasker_photo(uuid, text, text, boolean, text, text, text) from public, anon;
revoke all on function public.update_local_tasker_photo(uuid, uuid, text, boolean) from public, anon;
revoke all on function public.remove_local_tasker_photo(uuid, uuid) from public, anon;
grant execute on function public.add_local_tasker_photo(uuid, text, text, boolean, text, text, text) to authenticated, service_role;
grant execute on function public.update_local_tasker_photo(uuid, uuid, text, boolean) to authenticated, service_role;
grant execute on function public.remove_local_tasker_photo(uuid, uuid) to authenticated, service_role;

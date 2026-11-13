-- StreetTasker Admin Control Centre, stage A14b: hide and restore services and reviews (with a reason and a history).
-- Run the WHOLE file once in the Supabase SQL editor. Safe to run twice. Rollback: a14b-rollback.sql.
-- The result at the end says DONE or NOT DONE (and lists anything else that still needs a look).
--
-- Written from the REAL function sources and policies in the owner's a14b-introspect result (2026-11-13).
--
-- What it adds
--   Tables (browser has NO access; only the functions below touch them):
--     admin_review_hides   one row per hide of a review (reason, note, who, when, and later who restored it)
--     admin_service_hides  one row per hide of a service listing (same). services.listing_status is NOT touched
--                          (it allows only active and paused, and the subscription rules own it).
--   Admin functions (SECURITY DEFINER, signed-in only, each checks its own permission, each writes admin_audit_log):
--     admin_review_hide(review, reason_code, note)      reviews.moderate   reasons: abuse, fake, personal_data, off_topic (no "negative")
--     admin_review_restore(review, note)                reviews.moderate
--     admin_service_hide(service, reason_code, note)    listings.moderate  reasons: prohibited, misleading, contact_details, inappropriate, other
--     admin_service_restore(service, note)              listings.moderate
--     admin_hide_history(kind, id, offset)              decision history
--     admin_service_list / admin_review_list            REPLACED (same name and arguments) to show hidden items and a "Hidden" filter
--   What makes a hide real for the public site:
--     reviews policy reviews_select           now also requires "not hidden"
--     services: NEW restrictive policy services_admin_hide (select only). The owner, the coordinator who looks after a
--                          Local Tasker, and a person who already booked that listing can still see it, so no page breaks for them.
--     _reviews_refresh_summary                REPLACED: the average and count leave out hidden reviews
--     profile_reviews                         REPLACED: hidden reviews are not listed
--     two small helpers moderation_review_hidden(uuid) and moderation_service_visible(text, uuid), runnable by anon and
--                          signed-in users because the policies call them (they only answer true or false for one id).
-- No existing table is changed. Hiding changes no row in services or reviews, so no trigger can undo it.

do $pre$
declare v_def text;
begin
  if to_regprocedure('public.admin_has(text)') is null or to_regprocedure('public.admin_guard(text,text)') is null
     or to_regprocedure('public.admin_log(text,text,text,jsonb,jsonb,text,uuid,text,jsonb)') is null then
    raise exception 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
  end if;
  if to_regclass('public.services') is null or to_regclass('public.reviews') is null or to_regclass('public.rating_summary') is null or to_regclass('public.admin_users') is null then
    raise exception 'NOT DONE: services, reviews, rating_summary or admin_users is missing. Nothing was changed.';
  end if;
  if to_regprocedure('public.admin_service_list(text,text,integer)') is null or to_regprocedure('public.admin_review_list(text,integer)') is null then
    raise exception 'NOT DONE: run a14-trust-read.sql (A14a) first. Nothing was changed.';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reviews' and policyname = 'reviews_select') then
    raise exception 'NOT DONE: the policy reviews_select was not found on reviews (the database differs from the one this stage was written from). Nothing was changed.';
  end if;
  -- The two public functions are replaced with copies of the real sources plus the hide rule. Refuse if the live ones are different from what was read.
  select pg_get_functiondef(to_regprocedure('public._reviews_refresh_summary(uuid,text)')) into v_def;
  if v_def is null then raise exception 'NOT DONE: _reviews_refresh_summary(uuid, text) was not found. Nothing was changed.'; end if;
  if v_def not like '%moderation_review_hidden%' and v_def not like '%from public.reviews where reviewee_id = p_user and reviewee_role = p_role;%' then
    raise exception 'NOT DONE: _reviews_refresh_summary is different from the version this stage was written from. Send its source to the builder. Nothing was changed.';
  end if;
  select pg_get_functiondef(to_regprocedure('public.profile_reviews(uuid,text,integer,integer)')) into v_def;
  if v_def is null then raise exception 'NOT DONE: profile_reviews(uuid, text, integer, integer) was not found. Nothing was changed.'; end if;
  if v_def not like '%moderation_review_hidden%' and v_def not like '%where r.reviewee_id = p_user and r.reviewee_role = p_role%' then
    raise exception 'NOT DONE: profile_reviews is different from the version this stage was written from. Send its source to the builder. Nothing was changed.';
  end if;
end
$pre$;

-- 1. Tables ---------------------------------------------------------------------------------------------------------
create table if not exists public.admin_review_hides (
  id            uuid primary key default gen_random_uuid(),
  review_id     uuid not null,
  reviewee_id   uuid,
  reviewee_role text,
  reviewer_id   uuid,
  reason_code   text not null,
  note          text not null,
  hidden_by     uuid,
  hidden_at     timestamptz not null default now(),
  restored_by   uuid,
  restored_at   timestamptz,
  restore_note  text
);
create unique index if not exists admin_review_hides_one_active on public.admin_review_hides (review_id) where restored_at is null;
create index if not exists admin_review_hides_review on public.admin_review_hides (review_id, hidden_at desc);

create table if not exists public.admin_service_hides (
  id            uuid primary key default gen_random_uuid(),
  service_id    text not null,
  owner_id      uuid,
  service_name  text,
  reason_code   text not null,
  note          text not null,
  hidden_by     uuid,
  hidden_at     timestamptz not null default now(),
  restored_by   uuid,
  restored_at   timestamptz,
  restore_note  text
);
create unique index if not exists admin_service_hides_one_active on public.admin_service_hides (service_id) where restored_at is null;
create index if not exists admin_service_hides_service on public.admin_service_hides (service_id, hidden_at desc);

alter table public.admin_review_hides enable row level security;
alter table public.admin_service_hides enable row level security;
revoke all on public.admin_review_hides from public, anon, authenticated;
revoke all on public.admin_service_hides from public, anon, authenticated;

-- 2. Helpers the policies call ---------------------------------------------------------------------------------------
create or replace function public.moderation_review_hidden(p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.admin_review_hides h where h.review_id = p_id and h.restored_at is null)
$$;

create or replace function public.moderation_service_visible(p_id text, p_owner uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid();
begin
  if not exists (select 1 from public.admin_service_hides h where h.service_id = p_id and h.restored_at is null) then return true; end if;   -- not hidden
  if v_me is null then return false; end if;                                                                                        -- signed out never sees a hidden listing
  if v_me = p_owner then return true; end if;                                                                                       -- the owner keeps their own dashboard
  begin
    if public.coordinator_manages_tasker(v_me, p_owner) then return true; end if;                                                   -- the coordinator of a Local Tasker
  exception when others then null;
  end;
  begin
    if exists (select 1 from public.bookings b where b.service_id::text = p_id and (b.customer_id = v_me or b.tasker_id::text = v_me::text)) then return true; end if;   -- someone with a booking on it
  exception when others then null;
  end;
  return false;
end $$;

revoke all on function public.moderation_review_hidden(uuid), public.moderation_service_visible(text, uuid) from public;
grant execute on function public.moderation_review_hidden(uuid), public.moderation_service_visible(text, uuid) to anon, authenticated;

-- 3. Public policies -------------------------------------------------------------------------------------------------
alter policy reviews_select on public.reviews using (not public.moderation_review_hidden(id));

drop policy if exists services_admin_hide on public.services;
create policy services_admin_hide on public.services as restrictive for select to anon, authenticated
  using (public.moderation_service_visible(id::text, user_id));

-- 4. The two public functions (real source + the hide rule) ----------------------------------------------------------
create or replace function public._reviews_refresh_summary(p_user uuid, p_role text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_avg numeric; v_cnt integer;
begin
  select round(avg(rating)::numeric, 2), count(*) into v_avg, v_cnt
    from public.reviews where reviewee_id = p_user and reviewee_role = p_role
     and not public.moderation_review_hidden(id);   -- A14b: a hidden review does not count

  if v_cnt = 0 then
    delete from public.rating_summary where user_id = p_user and role = p_role;
  else
    insert into public.rating_summary (user_id, role, rating_avg, rating_count, updated_at)
    values (p_user, p_role, v_avg, v_cnt, now())
    on conflict (user_id, role) do update
      set rating_avg = excluded.rating_avg, rating_count = excluded.rating_count, updated_at = now();
  end if;

  -- legacy sync: never allowed to block a review
  if p_role = 'tasker' and v_cnt > 0 then
    begin
      update public.taskers
         set rating = to_char(round(v_avg, 1), 'FM0.0'), review_count = v_cnt
       where user_id = p_user::text;
      update public.services
         set rating = round(v_avg, 1), reviews_count = v_cnt
       where user_id = p_user;
    exception when others then
      raise warning 'reviews legacy sync skipped for %: %', p_user, sqlerrm;
    end;
  end if;
end $function$;

create or replace function public.profile_reviews(p_user uuid, p_role text, p_limit integer default 20, p_offset integer default 0)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'avg',   (select s.rating_avg   from public.rating_summary s where s.user_id = p_user and s.role = p_role),
    'count', coalesce((select s.rating_count from public.rating_summary s where s.user_id = p_user and s.role = p_role), 0),
    'reviews', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id)
      from (
        select r.id, r.rating, r.comment,
               (r.created_at at time zone 'UTC') as created_at,
               r.reviewer_id, r.reviewer_role,
               coalesce(nullif(btrim(u.business_name), ''), nullif(btrim(u.name), ''),
                        nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '')) as reviewer_name,
               coalesce(nullif(btrim(u.avatar_url), ''), nullif(btrim(u.avatar), '')) as reviewer_avatar
          from public.reviews r
          left join public.users u on u.id = r.reviewer_id
         where r.reviewee_id = p_user and r.reviewee_role = p_role
           and not public.moderation_review_hidden(r.id)
         order by r.created_at desc, r.id
         limit least(greatest(coalesce(p_limit, 20), 1), 50)
        offset greatest(coalesce(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  )
$function$;

-- 5. Hide and restore ------------------------------------------------------------------------------------------------
create or replace function public.admin_review_hide(p_review uuid, p_reason text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_actor uuid := auth.uid(); v_reason text := lower(btrim(coalesce(p_reason, ''))); v_note text := btrim(coalesce(p_note, ''));
  r public.reviews; v_avg numeric; v_cnt integer;
begin
  if not public.admin_guard('reviews.moderate', 'review.hide') then return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.'); end if;
  if p_review is null then return jsonb_build_object('ok', false, 'error', 'Choose a review.'); end if;
  if v_reason not in ('abuse', 'fake', 'personal_data', 'off_topic') then return jsonb_build_object('ok', false, 'error', 'Choose a reason from the list.'); end if;
  if char_length(v_note) < 10 then return jsonb_build_object('ok', false, 'error', 'Write a note of at least 10 characters.'); end if;
  if char_length(v_note) > 300 then return jsonb_build_object('ok', false, 'error', 'The note is too long (300 characters at most).'); end if;
  select * into r from public.reviews where id = p_review;
  if not found then return jsonb_build_object('ok', false, 'error', 'Review not found.'); end if;
  if r.reviewer_id = v_actor or r.reviewee_id = v_actor then   -- Rule R-SELF
    perform public.admin_log('review.hide', 'review', p_review::text, null, null, v_reason || ': ' || v_note, null, 'refused', jsonb_build_object('why', 'own_account'));
    return jsonb_build_object('ok', false, 'error', 'This review is written by or about your own account. Another admin must do this.');
  end if;
  if public.moderation_review_hidden(p_review) then return jsonb_build_object('ok', false, 'error', 'This review is already hidden.'); end if;
  begin
    insert into public.admin_review_hides (review_id, reviewee_id, reviewee_role, reviewer_id, reason_code, note, hidden_by)
    values (p_review, r.reviewee_id, r.reviewee_role, r.reviewer_id, v_reason, v_note, v_actor);
    perform public._reviews_refresh_summary(r.reviewee_id, r.reviewee_role);
  exception
    when unique_violation then return jsonb_build_object('ok', false, 'error', 'This review is already hidden.');
    when others then
      perform public.admin_log('review.hide', 'review', p_review::text, null, null, v_reason || ': ' || v_note, null, 'error', jsonb_build_object('sqlstate', sqlstate));
      return jsonb_build_object('ok', false, 'error', 'The database refused this change. Nothing was changed.', 'sqlstate', sqlstate);
  end;
  select s.rating_avg, s.rating_count into v_avg, v_cnt from public.rating_summary s where s.user_id = r.reviewee_id and s.role = r.reviewee_role;
  perform public.admin_log('review.hide', 'review', p_review::text, jsonb_build_object('hidden', false),
    jsonb_build_object('hidden', true, 'reason_code', v_reason, 'reviewee_id', r.reviewee_id, 'reviewee_role', r.reviewee_role), v_reason || ': ' || v_note, null, 'ok', null);
  return jsonb_build_object('ok', true, 'hidden', true, 'rating_avg', v_avg, 'rating_count', coalesce(v_cnt, 0));
end $f$;

create or replace function public.admin_review_restore(p_review uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_actor uuid := auth.uid(); v_note text := btrim(coalesce(p_note, '')); r public.reviews; v_avg numeric; v_cnt integer; v_n integer;
begin
  if not public.admin_guard('reviews.moderate', 'review.restore') then return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.'); end if;
  if p_review is null then return jsonb_build_object('ok', false, 'error', 'Choose a review.'); end if;
  if char_length(v_note) < 10 then return jsonb_build_object('ok', false, 'error', 'Write a note of at least 10 characters.'); end if;
  if char_length(v_note) > 300 then return jsonb_build_object('ok', false, 'error', 'The note is too long (300 characters at most).'); end if;
  select * into r from public.reviews where id = p_review;
  if not found then return jsonb_build_object('ok', false, 'error', 'Review not found.'); end if;
  if r.reviewer_id = v_actor or r.reviewee_id = v_actor then   -- Rule R-SELF
    perform public.admin_log('review.restore', 'review', p_review::text, null, null, v_note, null, 'refused', jsonb_build_object('why', 'own_account'));
    return jsonb_build_object('ok', false, 'error', 'This review is written by or about your own account. Another admin must do this.');
  end if;
  begin
    update public.admin_review_hides set restored_by = v_actor, restored_at = now(), restore_note = v_note where review_id = p_review and restored_at is null;
    get diagnostics v_n = row_count;
    if v_n = 0 then return jsonb_build_object('ok', false, 'error', 'This review is not hidden.'); end if;
    perform public._reviews_refresh_summary(r.reviewee_id, r.reviewee_role);
  exception when others then
    perform public.admin_log('review.restore', 'review', p_review::text, null, null, v_note, null, 'error', jsonb_build_object('sqlstate', sqlstate));
    return jsonb_build_object('ok', false, 'error', 'The database refused this change. Nothing was changed.', 'sqlstate', sqlstate);
  end;
  select s.rating_avg, s.rating_count into v_avg, v_cnt from public.rating_summary s where s.user_id = r.reviewee_id and s.role = r.reviewee_role;
  perform public.admin_log('review.restore', 'review', p_review::text, jsonb_build_object('hidden', true), jsonb_build_object('hidden', false), v_note, null, 'ok', null);
  return jsonb_build_object('ok', true, 'hidden', false, 'rating_avg', v_avg, 'rating_count', coalesce(v_cnt, 0));
end $f$;

create or replace function public.admin_service_hide(p_service text, p_reason text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_actor uuid := auth.uid(); v_id text := btrim(coalesce(p_service, '')); v_reason text := lower(btrim(coalesce(p_reason, ''))); v_note text := btrim(coalesce(p_note, ''));
  v_owner uuid; v_name text; v_found boolean; v_coord uuid;
begin
  if not public.admin_guard('listings.moderate', 'service.hide') then return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.'); end if;
  if v_id = '' then return jsonb_build_object('ok', false, 'error', 'Choose a listing.'); end if;
  if v_reason not in ('prohibited', 'misleading', 'contact_details', 'inappropriate', 'other') then return jsonb_build_object('ok', false, 'error', 'Choose a reason from the list.'); end if;
  if char_length(v_note) < 10 then return jsonb_build_object('ok', false, 'error', 'Write a note of at least 10 characters.'); end if;
  if char_length(v_note) > 300 then return jsonb_build_object('ok', false, 'error', 'The note is too long (300 characters at most).'); end if;
  select s.user_id, s.service_name, true into v_owner, v_name, v_found from public.services s where s.id::text = v_id;
  if v_found is not true then return jsonb_build_object('ok', false, 'error', 'Listing not found.'); end if;
  select a.coordinator_id into v_coord from public.coordinator_assignments a where a.tasker_user_id = v_owner and a.ended_at is null;
  if v_owner = v_actor or v_coord = v_actor then   -- Rule R-SELF
    perform public.admin_log('service.hide', 'service', v_id, null, null, v_reason || ': ' || v_note, null, 'refused', jsonb_build_object('why', 'own_account'));
    return jsonb_build_object('ok', false, 'error', 'This listing belongs to your own account or a Local Tasker in your care. Another admin must do this.');
  end if;
  begin
    insert into public.admin_service_hides (service_id, owner_id, service_name, reason_code, note, hidden_by) values (v_id, v_owner, left(v_name, 120), v_reason, v_note, v_actor);
  exception
    when unique_violation then return jsonb_build_object('ok', false, 'error', 'This listing is already hidden.');
    when others then
      perform public.admin_log('service.hide', 'service', v_id, null, null, v_reason || ': ' || v_note, null, 'error', jsonb_build_object('sqlstate', sqlstate));
      return jsonb_build_object('ok', false, 'error', 'The database refused this change. Nothing was changed.', 'sqlstate', sqlstate);
  end;
  perform public.admin_log('service.hide', 'service', v_id, jsonb_build_object('hidden', false), jsonb_build_object('hidden', true, 'reason_code', v_reason, 'owner_id', v_owner), v_reason || ': ' || v_note, null, 'ok', null);
  return jsonb_build_object('ok', true, 'hidden', true);
end $f$;

create or replace function public.admin_service_restore(p_service text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_actor uuid := auth.uid(); v_id text := btrim(coalesce(p_service, '')); v_note text := btrim(coalesce(p_note, '')); v_owner uuid; v_found boolean; v_coord uuid; v_n integer;
begin
  if not public.admin_guard('listings.moderate', 'service.restore') then return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.'); end if;
  if v_id = '' then return jsonb_build_object('ok', false, 'error', 'Choose a listing.'); end if;
  if char_length(v_note) < 10 then return jsonb_build_object('ok', false, 'error', 'Write a note of at least 10 characters.'); end if;
  if char_length(v_note) > 300 then return jsonb_build_object('ok', false, 'error', 'The note is too long (300 characters at most).'); end if;
  select s.user_id, true into v_owner, v_found from public.services s where s.id::text = v_id;
  if v_found is not true then return jsonb_build_object('ok', false, 'error', 'Listing not found.'); end if;
  select a.coordinator_id into v_coord from public.coordinator_assignments a where a.tasker_user_id = v_owner and a.ended_at is null;
  if v_owner = v_actor or v_coord = v_actor then   -- Rule R-SELF
    perform public.admin_log('service.restore', 'service', v_id, null, null, v_note, null, 'refused', jsonb_build_object('why', 'own_account'));
    return jsonb_build_object('ok', false, 'error', 'This listing belongs to your own account or a Local Tasker in your care. Another admin must do this.');
  end if;
  update public.admin_service_hides set restored_by = v_actor, restored_at = now(), restore_note = v_note where service_id = v_id and restored_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'error', 'This listing is not hidden.'); end if;
  perform public.admin_log('service.restore', 'service', v_id, jsonb_build_object('hidden', true), jsonb_build_object('hidden', false), v_note, null, 'ok', null);
  return jsonb_build_object('ok', true, 'hidden', false);
end $f$;

-- 6. Decision history ------------------------------------------------------------------------------------------------
create or replace function public.admin_hide_history(p_kind text, p_id text default null, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare v_k text := lower(coalesce(p_kind, '')); v_id text := nullif(btrim(coalesce(p_id, '')), ''); v_off integer := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  if v_k = 'review' then
    if not public.admin_has('reviews.moderate') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
    select jsonb_build_object('ok', true, 'kind', 'review', 'offset', v_off, 'page_size', 25,
      'total', (select count(*) from public.admin_review_hides h where v_id is null or h.review_id::text = v_id),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'target_id', t.review_id, 'reason_code', t.reason_code, 'note', t.note,
          'hidden_at', t.hidden_at, 'hidden_by_name', (select a.display_name from public.admin_users a where a.user_id = t.hidden_by),
          'restored_at', t.restored_at, 'restored_by_name', (select a.display_name from public.admin_users a where a.user_id = t.restored_by), 'restore_note', t.restore_note,
          'active', t.restored_at is null, 'reviewee_id', t.reviewee_id, 'reviewee_role', t.reviewee_role) order by t.hidden_at desc, t.id), '[]'::jsonb)
        from (select * from public.admin_review_hides h where v_id is null or h.review_id::text = v_id order by h.hidden_at desc, h.id offset v_off limit 25) t)) into v_out;
  elsif v_k = 'service' then
    if not (public.admin_has('listings.moderate') or public.admin_has('taskers.view')) then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
    select jsonb_build_object('ok', true, 'kind', 'service', 'offset', v_off, 'page_size', 25,
      'total', (select count(*) from public.admin_service_hides h where v_id is null or h.service_id = v_id),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'target_id', t.service_id, 'service_name', t.service_name, 'reason_code', t.reason_code, 'note', t.note,
          'hidden_at', t.hidden_at, 'hidden_by_name', (select a.display_name from public.admin_users a where a.user_id = t.hidden_by),
          'restored_at', t.restored_at, 'restored_by_name', (select a.display_name from public.admin_users a where a.user_id = t.restored_by), 'restore_note', t.restore_note,
          'active', t.restored_at is null, 'owner_id', t.owner_id) order by t.hidden_at desc, t.id), '[]'::jsonb)
        from (select * from public.admin_service_hides h where v_id is null or h.service_id = v_id order by h.hidden_at desc, h.id offset v_off limit 25) t)) into v_out;
  else
    return jsonb_build_object('ok', false, 'error', 'Choose review or service.');
  end if;
  return v_out;
end $f$;

-- 7. The two A14a lists, replaced to show hidden items ----------------------------------------------------------------
create or replace function public.admin_service_list(p_filter text default 'all', p_search text default '', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_f text := lower(coalesce(p_filter, 'all')); v_q text := left(lower(btrim(coalesce(p_search, ''))), 80); v_off integer := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  if not (public.admin_has('listings.moderate') or public.admin_has('taskers.view')) then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_f not in ('all', 'active', 'paused', 'unavailable', 'hidden') then v_f := 'all'; end if;
  with b as (
    select s.id, s.user_id, s.service_name, s.category, s.price, s.price_max, s.rate_unit, s.location, s.description, s.listing_status, s.available,
           s.availability_status, s.verified, s.is_main, s.rating, s.reviews_count, s.created_at, s.updated_at, nullif(btrim(u.name), '') as tasker_name,
           (h.id is not null) as admin_hidden, h.reason_code as hide_reason, h.note as hide_note, h.hidden_at as hidden_at
      from public.services s left join public.users u on u.id = s.user_id
      left join public.admin_service_hides h on h.service_id = s.id::text and h.restored_at is null
  ), f as (
    select * from b
     where (v_f = 'all' or (v_f = 'active' and listing_status = 'active') or (v_f = 'paused' and listing_status = 'paused') or (v_f = 'unavailable' and available is not true) or (v_f = 'hidden' and admin_hidden))
       and (v_q = '' or position(v_q in lower(coalesce(service_name, '') || ' ' || coalesce(category, '') || ' ' || coalesce(tasker_name, '') || ' ' || coalesce(location, ''))) > 0)
  )
  select jsonb_build_object('ok', true, 'filter', v_f, 'search', v_q, 'offset', v_off, 'page_size', 25, 'total', (select count(*) from f),
    'counts', jsonb_build_object('total', (select count(*) from public.services),
       'active', (select count(*) from public.services where listing_status = 'active'),
       'paused', (select count(*) from public.services where listing_status = 'paused'),
       'unavailable', (select count(*) from public.services where available is not true),
       'hidden', (select count(*) from public.admin_service_hides where restored_at is null)),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('category', c.cat, 'n', c.n) order by c.n desc, c.cat), '[]'::jsonb)
                     from (select coalesce(nullif(btrim(category), ''), '(none)') as cat, count(*) as n from public.services group by 1) c),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'service_name', t.service_name, 'category', t.category, 'tasker_id', t.user_id, 'tasker_name', t.tasker_name,
        'price', t.price, 'price_max', t.price_max, 'rate_unit', t.rate_unit, 'location', t.location, 'description', left(t.description, 400),
        'listing_status', t.listing_status, 'available', t.available, 'availability_status', t.availability_status, 'verified', t.verified, 'is_main', t.is_main,
        'rating', t.rating, 'reviews_count', t.reviews_count, 'created_at', t.created_at, 'updated_at', t.updated_at,
        'admin_hidden', t.admin_hidden, 'hide_reason', t.hide_reason, 'hide_note', t.hide_note, 'hidden_at', t.hidden_at) order by t.created_at desc nulls last, t.id), '[]'::jsonb)
      from (select * from f order by created_at desc nulls last, id offset v_off limit 25) t)) into v_out;
  return v_out;
end $$;

create or replace function public.admin_review_list(p_filter text default 'all', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_f text := lower(coalesce(p_filter, 'all')); v_off integer := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  if not public.admin_has('reviews.moderate') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_f not in ('all', 'low', 'comment', 'hidden') then v_f := 'all'; end if;
  with b as (
    select r.*, (h.id is not null) as admin_hidden, h.reason_code as hide_reason, h.note as hide_note, h.hidden_at as hidden_at
      from public.reviews r left join public.admin_review_hides h on h.review_id = r.id and h.restored_at is null
  ), f as (
    select * from b
     where v_f = 'all' or (v_f = 'low' and rating <= 2) or (v_f = 'comment' and nullif(btrim(comment), '') is not null) or (v_f = 'hidden' and admin_hidden)
  )
  select jsonb_build_object('ok', true, 'filter', v_f, 'offset', v_off, 'page_size', 25, 'total', (select count(*) from f),
    'counts', jsonb_build_object('total', (select count(*) from b),
       'average', (select round(avg(rating)::numeric, 2) from b where not admin_hidden),
       'low', (select count(*) from b where rating <= 2),
       'with_comment', (select count(*) from b where nullif(btrim(comment), '') is not null),
       'hidden', (select count(*) from b where admin_hidden),
       'by_rating', (select coalesce(jsonb_object_agg(x.rating::text, x.n), '{}'::jsonb) from (select rating, count(*) n from b where not admin_hidden group by rating) x)),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'booking_ref', left(coalesce(t.booking_id::text, ''), 8), 'rating', t.rating, 'comment', left(t.comment, 600),
        'created_at', t.created_at, 'reviewer_id', t.reviewer_id, 'reviewer_role', t.reviewer_role, 'reviewee_id', t.reviewee_id, 'reviewee_role', t.reviewee_role,
        'reviewer_name', (select nullif(btrim(u.name), '') from public.users u where u.id = t.reviewer_id),
        'reviewee_name', (select nullif(btrim(u.name), '') from public.users u where u.id = t.reviewee_id),
        'admin_hidden', t.admin_hidden, 'hide_reason', t.hide_reason, 'hide_note', t.hide_note, 'hidden_at', t.hidden_at) order by t.created_at desc nulls last, t.id), '[]'::jsonb)
      from (select * from f order by created_at desc nulls last, id offset v_off limit 25) t)) into v_out;
  return v_out;
end $$;

-- 8. Who can run what ------------------------------------------------------------------------------------------------
revoke all on function public.admin_review_hide(uuid, text, text), public.admin_review_restore(uuid, text), public.admin_service_hide(text, text, text),
  public.admin_service_restore(text, text), public.admin_hide_history(text, text, integer), public.admin_service_list(text, text, integer), public.admin_review_list(text, integer)
  from public, anon, authenticated;
grant execute on function public.admin_review_hide(uuid, text, text), public.admin_review_restore(uuid, text), public.admin_service_hide(text, text, text),
  public.admin_service_restore(text, text), public.admin_hide_history(text, text, integer), public.admin_service_list(text, text, integer), public.admin_review_list(text, integer)
  to authenticated;

-- 9. Recalculate the ratings of anyone who already has a hidden review (none today, harmless) ---------------------------
do $fix$
declare x record;
begin
  for x in select distinct reviewee_id, reviewee_role from public.admin_review_hides where restored_at is null loop
    perform public._reviews_refresh_summary(x.reviewee_id, x.reviewee_role);
  end loop;
end
$fix$;

-- 10. Result. One table: the DONE line, then anything else a signed-out visitor can run that reads services or reviews and was not read yet.
select 'RESULT'::text as item,
  case when to_regprocedure('public.admin_review_hide(uuid,text,text)') is not null and to_regprocedure('public.admin_service_hide(text,text,text)') is not null
        and to_regprocedure('public.admin_hide_history(text,text,integer)') is not null and to_regprocedure('public.moderation_service_visible(text,uuid)') is not null
        and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'services' and policyname = 'services_admin_hide')
        and (select pg_get_functiondef(to_regprocedure('public.profile_reviews(uuid,text,integer,integer)'))) like '%moderation_review_hidden%'
       then 'DONE: A14b installed.' else 'NOT DONE: see the messages above.' end as detail
union all
select 'STILL READS services OR reviews (source not read)',
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
   and (p.prosrc ~* '(^|[^a-z_])services([^a-z_]|$)' or p.prosrc ~* 'public\.reviews|from[[:space:]]+reviews|join[[:space:]]+reviews')
   and p.proname not like 'admin\_%' escape '\' and p.proname not like 'moderation\_%' escape '\'
   and p.proname not in ('profile_reviews', '_reviews_refresh_summary', '_reviews_after_change', 'review_state', 'submit_review', 'coordinator_submit_review',
                         'services_listing_gate', 'services_listing_status_lock', 'services_live_limit_guard', '_sub_keep_paused_hidden', '_sub_sync_tasker_visibility')
 order by 1, 2;

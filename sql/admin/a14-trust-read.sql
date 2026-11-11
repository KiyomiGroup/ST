-- StreetTasker Admin Control Centre, stage A14a: Services, reviews, flagged users, community (READ ONLY).
-- Run the WHOLE file once in the Supabase SQL editor. Safe to run twice. Rollback: a14-rollback.sql. The last line says DONE or NOT DONE.
--
-- Adds (SECURITY DEFINER, execute for authenticated only, each checks its own permission):
--   admin_service_list(filter, search, offset)   services + tasker name, counts, categories     (listings.moderate OR taskers.view)
--   admin_review_list(filter, offset)            reviews (reviews table), counts by rating      (reviews.moderate)
--   admin_flagged_user_list(filter, offset)      users.is_flagged / contact_violations          (trust.flags.view)
--   admin_community_list(kind, offset)           feed_posts or comments                         (community.moderate)
--
-- Writes nothing. No table, policy, trigger or existing function is changed. NO hide or restore exists yet (stage A14b), because the public site
-- reads services and reviews through several existing policies and functions that must be read first (see a14b-introspect.sql).
-- Columns used are the real ones from the A14 introspect result (2026-11-11). public.profile_reviews is a FUNCTION, not a table; it is not touched.
-- Never returned: emails, phones, WhatsApp, dates of birth, image links, client_ip.

do $pre$
begin
  if to_regprocedure('public.admin_has(text)') is null then
    raise exception 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
  end if;
  if to_regclass('public.services') is null or to_regclass('public.reviews') is null or to_regclass('public.users') is null then
    raise exception 'NOT DONE: services, reviews or users is missing. Nothing was changed.';
  end if;
end
$pre$;

create or replace function public.admin_service_list(p_filter text default 'all', p_search text default '', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_f text := lower(coalesce(p_filter, 'all')); v_q text := left(lower(btrim(coalesce(p_search, ''))), 80); v_off integer := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  if not (public.admin_has('listings.moderate') or public.admin_has('taskers.view')) then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_f not in ('all', 'active', 'paused', 'unavailable') then v_f := 'all'; end if;
  with b as (
    select s.id, s.user_id, s.service_name, s.category, s.price, s.price_max, s.rate_unit, s.location, s.description, s.listing_status, s.available,
           s.availability_status, s.verified, s.is_main, s.rating, s.reviews_count, s.created_at, s.updated_at, nullif(btrim(u.name), '') as tasker_name
      from public.services s left join public.users u on u.id = s.user_id
  ), f as (
    select * from b
     where (v_f = 'all' or (v_f = 'active' and listing_status = 'active') or (v_f = 'paused' and listing_status = 'paused') or (v_f = 'unavailable' and available is not true))
       and (v_q = '' or position(v_q in lower(coalesce(service_name, '') || ' ' || coalesce(category, '') || ' ' || coalesce(tasker_name, '') || ' ' || coalesce(location, ''))) > 0)
  )
  select jsonb_build_object('ok', true, 'filter', v_f, 'search', v_q, 'offset', v_off, 'page_size', 25, 'total', (select count(*) from f),
    'counts', jsonb_build_object('total', (select count(*) from public.services),
       'active', (select count(*) from public.services where listing_status = 'active'),
       'paused', (select count(*) from public.services where listing_status = 'paused'),
       'unavailable', (select count(*) from public.services where available is not true)),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('category', c.cat, 'n', c.n) order by c.n desc, c.cat), '[]'::jsonb)
                     from (select coalesce(nullif(btrim(category), ''), '(none)') as cat, count(*) as n from public.services group by 1) c),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'service_name', t.service_name, 'category', t.category, 'tasker_id', t.user_id, 'tasker_name', t.tasker_name,
        'price', t.price, 'price_max', t.price_max, 'rate_unit', t.rate_unit, 'location', t.location, 'description', left(t.description, 400),
        'listing_status', t.listing_status, 'available', t.available, 'availability_status', t.availability_status, 'verified', t.verified, 'is_main', t.is_main,
        'rating', t.rating, 'reviews_count', t.reviews_count, 'created_at', t.created_at, 'updated_at', t.updated_at) order by t.created_at desc nulls last, t.id), '[]'::jsonb)
      from (select * from f order by created_at desc nulls last, id offset v_off limit 25) t)) into v_out;
  return v_out;
end $$;

create or replace function public.admin_review_list(p_filter text default 'all', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_f text := lower(coalesce(p_filter, 'all')); v_off integer := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  if not public.admin_has('reviews.moderate') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_f not in ('all', 'low', 'comment') then v_f := 'all'; end if;
  with f as (
    select r.* from public.reviews r
     where v_f = 'all' or (v_f = 'low' and r.rating <= 2) or (v_f = 'comment' and nullif(btrim(r.comment), '') is not null)
  )
  select jsonb_build_object('ok', true, 'filter', v_f, 'offset', v_off, 'page_size', 25, 'total', (select count(*) from f),
    'counts', jsonb_build_object('total', (select count(*) from public.reviews),
       'average', (select round(avg(rating)::numeric, 2) from public.reviews),
       'low', (select count(*) from public.reviews where rating <= 2),
       'with_comment', (select count(*) from public.reviews where nullif(btrim(comment), '') is not null),
       'by_rating', (select coalesce(jsonb_object_agg(x.rating::text, x.n), '{}'::jsonb) from (select rating, count(*) n from public.reviews group by rating) x)),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'booking_ref', left(coalesce(t.booking_id::text, ''), 8), 'rating', t.rating, 'comment', left(t.comment, 600),
        'created_at', t.created_at, 'reviewer_id', t.reviewer_id, 'reviewer_role', t.reviewer_role, 'reviewee_id', t.reviewee_id, 'reviewee_role', t.reviewee_role,
        'reviewer_name', (select nullif(btrim(u.name), '') from public.users u where u.id = t.reviewer_id),
        'reviewee_name', (select nullif(btrim(u.name), '') from public.users u where u.id = t.reviewee_id)) order by t.created_at desc nulls last, t.id), '[]'::jsonb)
      from (select * from f order by created_at desc nulls last, id offset v_off limit 25) t)) into v_out;
  return v_out;
end $$;

create or replace function public.admin_flagged_user_list(p_filter text default 'all', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_f text := lower(coalesce(p_filter, 'all')); v_off integer := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  if not public.admin_has('trust.flags.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_f not in ('all', 'flagged', 'warned') then v_f := 'all'; end if;
  with f as (
    select u.* from public.users u
     where (u.is_flagged is true or coalesce(u.contact_violations, 0) > 0)
       and (v_f = 'all' or (v_f = 'flagged' and u.is_flagged is true) or (v_f = 'warned' and u.is_flagged is not true))
  )
  select jsonb_build_object('ok', true, 'filter', v_f, 'offset', v_off, 'page_size', 25, 'total', (select count(*) from f),
    'counts', jsonb_build_object('flagged', (select count(*) from public.users where is_flagged is true),
       'warned', (select count(*) from public.users where is_flagged is not true and coalesce(contact_violations, 0) > 0)),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', nullif(btrim(t.name), ''), 'role', t.role, 'contact_violations', coalesce(t.contact_violations, 0),
        'is_flagged', t.is_flagged is true, 'flagged_reason', left(t.flagged_reason, 300), 'created_at', t.created_at)
        order by (t.is_flagged is true) desc, coalesce(t.contact_violations, 0) desc, t.id), '[]'::jsonb)
      from (select * from f order by (is_flagged is true) desc, coalesce(contact_violations, 0) desc, id offset v_off limit 25) t)) into v_out;
  return v_out;
end $$;

create or replace function public.admin_community_list(p_kind text default 'posts', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_k text := lower(coalesce(p_kind, 'posts')); v_off integer := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  if not public.admin_has('community.moderate') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_k not in ('posts', 'comments') then v_k := 'posts'; end if;
  if v_k = 'posts' then
    select jsonb_build_object('ok', true, 'kind', 'posts', 'offset', v_off, 'page_size', 25,
      'total', (select count(*) from public.feed_posts), 'comments_total', (select count(*) from public.comments),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'user_id', t.user_id, 'author', coalesce(nullif(btrim(t.author_name), ''), (select nullif(btrim(u.name), '') from public.users u where u.id = t.user_id)),
          'text', left(coalesce(nullif(btrim(t.content), ''), t.caption), 500), 'has_image', coalesce(nullif(t.image_url, ''), nullif(t.image, '')) is not null,
          'likes', t.likes, 'service', t.service, 'location', t.location, 'created_at', t.created_at,
          'comment_count', (select count(*) from public.comments c where c.post_id = t.id)) order by t.created_at desc nulls last, t.id), '[]'::jsonb)
        from (select * from public.feed_posts order by created_at desc nulls last, id offset v_off limit 25) t)) into v_out;
  else
    select jsonb_build_object('ok', true, 'kind', 'comments', 'offset', v_off, 'page_size', 25,
      'total', (select count(*) from public.comments), 'comments_total', (select count(*) from public.comments),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'post_id', t.post_id, 'user_id', t.user_id,
          'author', (select nullif(btrim(u.name), '') from public.users u where u.id = t.user_id),
          'text', left(coalesce(nullif(btrim(t.comment), ''), t.body), 500), 'created_at', t.created_at) order by t.created_at desc nulls last, t.id), '[]'::jsonb)
        from (select * from public.comments order by created_at desc nulls last, id offset v_off limit 25) t)) into v_out;
  end if;
  return v_out;
end $$;

revoke all on function public.admin_service_list(text, text, integer), public.admin_review_list(text, integer), public.admin_flagged_user_list(text, integer), public.admin_community_list(text, integer) from public, anon, authenticated;
grant execute on function public.admin_service_list(text, text, integer), public.admin_review_list(text, integer), public.admin_flagged_user_list(text, integer), public.admin_community_list(text, integer) to authenticated;

select case
  when to_regprocedure('public.admin_service_list(text,text,integer)') is not null
   and to_regprocedure('public.admin_review_list(text,integer)') is not null
   and to_regprocedure('public.admin_flagged_user_list(text,integer)') is not null
   and to_regprocedure('public.admin_community_list(text,integer)') is not null
  then 'DONE: A14a installed.'
  else 'NOT DONE: see the messages above.'
end as a14a_result;

-- StreetTasker Admin Control Centre, stage A14b: ROLLBACK. Run the whole file once in the Supabase SQL editor. Safe to run twice.
-- Puts back the real _reviews_refresh_summary and profile_reviews (copied from the owner's a14b-introspect result), the open reviews_select
-- policy, removes the services policy, the helpers and the A14b admin functions, and gives A14a's two list functions back (run a14-trust-read.sql
-- afterwards to restore the plain A14a lists).
-- KEEPS the two history tables (admin_review_hides, admin_service_hides) so no decision is lost. Everything hidden becomes visible again.
-- Last, ratings are recalculated for everyone who had a hidden review.

alter policy reviews_select on public.reviews using (true);
drop policy if exists services_admin_hide on public.services;

CREATE OR REPLACE FUNCTION public._reviews_refresh_summary(p_user uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_avg numeric; v_cnt integer;
begin
  select round(avg(rating)::numeric, 2), count(*) into v_avg, v_cnt
    from public.reviews where reviewee_id = p_user and reviewee_role = p_role;

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

CREATE OR REPLACE FUNCTION public.profile_reviews(p_user uuid, p_role text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
         order by r.created_at desc, r.id
         limit least(greatest(coalesce(p_limit, 20), 1), 50)
        offset greatest(coalesce(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  )
$function$;

drop function if exists public.admin_review_hide(uuid, text, text);
drop function if exists public.admin_review_restore(uuid, text);
drop function if exists public.admin_service_hide(text, text, text);
drop function if exists public.admin_service_restore(text, text);
drop function if exists public.admin_hide_history(text, text, integer);

do $fix$
declare x record;
begin
  for x in select distinct reviewee_id, reviewee_role from public.admin_review_hides where reviewee_id is not null loop
    perform public._reviews_refresh_summary(x.reviewee_id, x.reviewee_role);
  end loop;
end
$fix$;

drop function if exists public.moderation_service_visible(text, uuid);
drop function if exists public.moderation_review_hidden(uuid);

select case when to_regprocedure('public.moderation_review_hidden(uuid)') is null and to_regprocedure('public.admin_service_hide(text,text,text)') is null
  and not exists (select 1 from pg_policies where policyname = 'services_admin_hide')
  then 'DONE: A14b rolled back. Run a14-trust-read.sql to restore the plain A14a lists. History tables kept.' else 'NOT DONE: see the messages above.' end as a14b_rollback_result;

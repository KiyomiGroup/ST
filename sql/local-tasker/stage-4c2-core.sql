-- Stage 4C-2: customer-safe list of PUBLISHED Local Taskers for the public Local Taskers page.
-- Additive and re-runnable. Rollback: stage-4c2-rollback.sql. Needs stage-4c1-core.sql to have been run.
-- Run in the Supabase SQL editor (select all, Run). Run it twice; the second run must show no error.
--
-- Why: a visitor who is not signed in cannot be assumed to read the users/taskers/services tables
-- (stage 2C), and local-taskers.html has no list of ids to ask local_tasker_public_info about.
-- This ONE function returns the public card fields of published Local Taskers only.
-- Returns: public name, primary service (the same one publish copies onto the taskers row: the oldest
-- active service with a price), area, price, unit, specialties and the cover photo path.
-- Never returns: phone, full name, notes, status, assignment, consent or any id except the user id.
create or replace function public.local_tasker_public_cards(p_limit int default 12)
returns table (user_id text, display_name text, service_name text, category text, location text,
               price numeric, rate_unit text, specialties text[], cover_path text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.tasker_user_id::text,
         u.name,
         s.service_name,
         s.category,
         coalesce(nullif(btrim(coalesce(s.location, '')), ''), p.areas_served),
         s.price,
         s.rate_unit,
         coalesce(s.specialties, '{}'::text[]),
         (select ph.storage_path from public.local_tasker_photos ph
           where ph.tasker_user_id = p.tasker_user_id and ph.removed_at is null
           order by ph.is_cover desc, ph.created_at asc limit 1)
    from public.local_tasker_profiles p
    join public.users u on u.id = p.tasker_user_id
    join lateral (select x.* from public.services x
                   where x.user_id = p.tasker_user_id and x.available is true and x.price is not null and x.price > 0
                   order by x.created_at asc, x.id asc limit 1) s on true
   where p.status = 'published'
     and char_length(btrim(coalesce(u.name, ''))) >= 2
   order by p.published_at desc nulls last, p.tasker_user_id
   limit greatest(1, least(coalesce(p_limit, 12), 24))
$$;
revoke all on function public.local_tasker_public_cards(int) from public;
grant execute on function public.local_tasker_public_cards(int) to anon, authenticated, service_role;

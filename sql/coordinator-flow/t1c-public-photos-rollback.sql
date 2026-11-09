-- Undo t1c-public-photos.sql: the three original functions, as they were on 2026-11-08.
begin;
create or replace function public.local_tasker_public_photos(p_tasker uuid)
 returns table(path text, caption text, is_cover boolean)
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $f$
  select ph.storage_path, ph.caption, ph.is_cover
    from public.local_tasker_photos ph
    join public.local_tasker_profiles p on p.tasker_user_id = ph.tasker_user_id
   where ph.tasker_user_id = p_tasker and ph.removed_at is null and p.status = 'published'
   order by ph.is_cover desc, ph.created_at asc
   limit 8
$f$;

create or replace function public.local_tasker_public_cards(p_limit integer default 12)
 returns table(user_id text, display_name text, service_name text, category text, location text, price numeric, rate_unit text, specialties text[], cover_path text)
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $f$
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
$f$;

create or replace function public.local_tasker_public_info(p_ids text[])
 returns table(user_id text, cover_path text)
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $f$
  select p.tasker_user_id::text,
         (select ph.storage_path from public.local_tasker_photos ph
           where ph.tasker_user_id = p.tasker_user_id and ph.removed_at is null
           order by ph.is_cover desc, ph.created_at asc limit 1)
    from public.local_tasker_profiles p
   where p.status = 'published'
     and cardinality(coalesce(p_ids, '{}'::text[])) between 1 and 100
     and p.tasker_user_id::text = any (p_ids)
$f$;

commit;

-- Stage T1c: keep the profile picture OUT of the public portfolio gallery, and make the public card use the main service. Run once in the SQL editor,
-- AFTER t1-local-tasker-rules.sql (it needs local_tasker_photos.kind and services.is_main). Written by patching the three functions the owner pasted
-- on 2026-11-08. Same columns and types as before (no signature change), so the pages keep working. Tested on a scratch Postgres, NOT on the real project.
-- Undo: t1c-public-photos-rollback.sql.
--  - local_tasker_public_photos: portfolio photos only (the picture never takes one of the 8 gallery places).
--  - local_tasker_public_cards / local_tasker_public_info: the card photo is the cover PORTFOLIO photo; if there are no portfolio photos yet, the profile picture.
--  - local_tasker_public_cards: the service on the card is the MAIN service first (same rule as the published listing), then the oldest live one.
-- local_tasker_photo_is_public is NOT changed: the picture's file must be readable once published (the flyer and cards use it).
begin;

create or replace function public.local_tasker_public_photos(p_tasker uuid)
 returns table(path text, caption text, is_cover boolean)
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $f$
  select ph.storage_path, ph.caption, ph.is_cover
    from public.local_tasker_photos ph
    join public.local_tasker_profiles p on p.tasker_user_id = ph.tasker_user_id
   where ph.tasker_user_id = p_tasker and ph.removed_at is null and p.status = 'published'
     and ph.kind = 'portfolio'
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
           order by (ph.kind = 'portfolio') desc, ph.is_cover desc, ph.created_at asc limit 1)
    from public.local_tasker_profiles p
    join public.users u on u.id = p.tasker_user_id
    join lateral (select x.* from public.services x
                   where x.user_id = p.tasker_user_id and x.available is true and x.price is not null and x.price > 0
                   order by x.is_main desc, x.created_at asc, x.id asc limit 1) s on true
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
           order by (ph.kind = 'portfolio') desc, ph.is_cover desc, ph.created_at asc limit 1)
    from public.local_tasker_profiles p
   where p.status = 'published'
     and cardinality(coalesce(p_ids, '{}'::text[])) between 1 and 100
     and p.tasker_user_id::text = any (p_ids)
$f$;

commit;

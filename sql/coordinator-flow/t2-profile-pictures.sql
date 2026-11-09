-- Fix: Local Tasker cards show the PROFILE PICTURE (local_tasker_photos.kind = 'avatar'), not the cover/service photo.
-- Adds ONE new read-only function. Nothing existing is changed or dropped. Undo: t2-rollback.sql.
-- Same rule as local_tasker_public_info: published Local Taskers only, up to 100 ids, no names or bank details.
begin;
create or replace function public.local_tasker_public_avatars(p_ids text[])
 returns table(user_id text, avatar_path text)
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $f$
  select p.tasker_user_id::text,
         (select ph.storage_path from public.local_tasker_photos ph
           where ph.tasker_user_id = p.tasker_user_id and ph.kind = 'avatar' and ph.removed_at is null
           order by ph.created_at desc limit 1)
    from public.local_tasker_profiles p
   where p.status = 'published'
     and cardinality(coalesce(p_ids, '{}'::text[])) between 1 and 100
     and p.tasker_user_id::text = any (p_ids)
$f$;
revoke all on function public.local_tasker_public_avatars(text[]) from public;
grant execute on function public.local_tasker_public_avatars(text[]) to anon, authenticated;
commit;

-- CHECK: one row. Replace nothing. "published_with_picture" is how many published Local Taskers have a profile picture.
select exists (select 1 from pg_proc p where p.proname = 'local_tasker_public_avatars' and p.pronamespace = 'public'::regnamespace) as function_ok,
       (select count(*) from public.local_tasker_profiles where status = 'published') as published,
       (select count(*) from public.local_tasker_profiles p where p.status = 'published' and exists (
          select 1 from public.local_tasker_photos ph where ph.tasker_user_id = p.tasker_user_id and ph.kind = 'avatar' and ph.removed_at is null)) as published_with_picture;

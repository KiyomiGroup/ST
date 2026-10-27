-- Stage 4C-1 rollback: removes the functions and the one storage policy created by stage-4c1-core.sql.
-- NOTHING is deleted from data tables. People who were already published STAY published
-- (their status is in local_tasker_profiles); without publish/unpublish functions the only way to
-- hide one is a direct update by the project owner: update public.local_tasker_profiles set status = 'ready' where tasker_user_id = '<id>';
-- Customers lose the ability to open photo files (the bucket goes back to coordinators only).
drop policy if exists lt_photos_storage_public_read on storage.objects;
drop function if exists public.local_tasker_photo_is_public(text);
drop function if exists public.local_tasker_public_photos(uuid);
drop function if exists public.local_tasker_public_info(text[]);
drop function if exists public.unpublish_local_tasker(uuid, text);
drop function if exists public.publish_local_tasker(uuid);
drop function if exists public._local_tasker_sync_public(uuid);
drop function if exists public.local_tasker_publish_status(uuid);
drop function if exists public._local_tasker_readiness(uuid);

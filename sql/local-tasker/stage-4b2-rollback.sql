-- Stage 4B-2 rollback: removes the three functions and the storage and table policies only.
-- The table public.local_tasker_photos, the bucket and any uploaded files, and the consent and audit
-- rows STAY (nothing is destroyed). Without the policies the bucket is unreachable from the browser.
drop function if exists public.add_local_tasker_photo(uuid, text, text, boolean, text, text, text);
drop function if exists public.update_local_tasker_photo(uuid, uuid, text, boolean);
drop function if exists public.remove_local_tasker_photo(uuid, uuid);
drop policy if exists lt_photos_storage_insert on storage.objects;
drop policy if exists lt_photos_storage_read on storage.objects;
drop policy if exists lt_photos_read on public.local_tasker_photos;

-- Stage T1c: READ-ONLY. Run and paste ALL results. Function text only; no keys are returned.
-- Why: the public Local Tasker page reads photos through these functions. With the new profile picture stored in the same table
-- (local_tasker_photos.kind = 'avatar'), they may show it as a normal gallery photo or pick it as the cover. I need to see them to fix that safely.
select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('local_tasker_public_photos','local_tasker_public_info','local_tasker_public_cards','local_tasker_photo_is_public');

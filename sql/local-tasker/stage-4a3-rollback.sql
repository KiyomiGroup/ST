-- Stage 4A-3 rollback: removes only the function stage-4a3-core.sql added.
-- Edits already made stay (they are audited history); only the ability to edit goes away.
drop function if exists public.update_local_tasker_profile(uuid, text, text, text, text, text[], text);

-- Stage 6D-3 rollback: removes the two storage policies and the new functions, and puts the Stage 6B conversation function back.
-- Messages and job_attachments rows already written stay (evidence is never deleted).
drop policy if exists job_evidence_coord_insert on storage.objects;
drop policy if exists job_evidence_coord_select on storage.objects;
drop function if exists public.coordinator_send_attachment(uuid, uuid, text, text, text, text);
drop function if exists public.coordinator_send_location(uuid, uuid, numeric, numeric, text);
drop function if exists public._lt_6d3_post(uuid, uuid, uuid, text, text, jsonb, text);
drop function if exists public._lt_coord_thread_ok(text, boolean);
-- Then re-run the "5. One conversation" function block of stage-6b-core.sql to restore coordinator_chat_thread without `payload`
-- (the page still works with the 6D-3 version, so this last step is optional).

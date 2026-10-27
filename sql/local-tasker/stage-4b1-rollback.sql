-- Stage 4B-1 rollback: removes the function only. Services already saved stay (they are hidden
-- from customers while the Local Tasker is a draft). Consent and audit rows are append-only and stay.
drop function if exists public.save_local_tasker_service(uuid, uuid, text, text, numeric, text, text, text, text[], text, boolean, text, text, text);

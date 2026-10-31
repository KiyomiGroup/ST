-- Rollback for v1c2-idv-start-read.sql. Run BEFORE rolling back v1c1/v1b2/v1b1/v1a.
-- Drops the seven functions only. Attempt rows already created (and their audit rows) are kept.
begin;
drop function if exists public.idv_local_status_list();
drop function if exists public.idv_local_status(uuid);
drop function if exists public.idv_my_status();
drop function if exists public.idv_mark_pending(uuid);
drop function if exists public.idv_attach_session(uuid, text, text);
drop function if exists public.idv_start_attempt(uuid, text, uuid, text, text);
drop function if exists public.idv_subject_kind(uuid);
commit;

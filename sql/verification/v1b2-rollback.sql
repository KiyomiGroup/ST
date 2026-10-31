-- Rollback for v1b2-idv-apply-effects.sql: puts the no-op hook back and drops its helper.
-- It does NOT undo flags, audit rows or notifications already written (audit is append-only;
-- flags can be re-derived from identity_verifications.status = 'VERIFIED' if ever needed).
begin;
create or replace function public.idv_apply_effects(p_row public.identity_verifications, p_old_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $b$ begin null; end $b$;
drop function if exists public.idv_notify_subject(public.identity_verifications, text, text);
revoke all on function public.idv_apply_effects(public.identity_verifications, text) from public, anon, authenticated;
commit;

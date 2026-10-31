-- Rollback for v1b1-idv-apply-core.sql. Run BEFORE rolling back v1b-2 and v1a.
-- Does not delete any verification or ledger rows. Event rows with the new outcome
-- 'ignored_transition' are relabelled 'rejected' so the old (V1a) constraint can be restored.
-- If V1b-2 has already replaced idv_apply_effects, roll V1b-2 back first.

begin;
drop function if exists public.idv_apply_event(text, text, text, text, text, timestamptz, text,
                                               boolean, boolean, boolean, boolean, text, boolean, text[]);
drop function if exists public.idv_finish_event(text, text, jsonb);
drop function if exists public.idv_apply_effects(public.identity_verifications, text);
drop function if exists public.idv_decide_approved(boolean, boolean, text, boolean);
drop function if exists public.idv_is_terminal(text);
drop function if exists public.idv_map_status(text);

update public.identity_verification_events set outcome = 'rejected' where outcome = 'ignored_transition';
alter table public.identity_verification_events
  drop constraint if exists identity_verification_events_outcome_check;
alter table public.identity_verification_events
  add constraint identity_verification_events_outcome_check
  check (outcome in ('applied', 'duplicate', 'stale', 'ignored_environment', 'rejected'));
commit;

-- Rollback for v1c1-consent.sql. Run BEFORE rolling back v1b2/v1b1/v1a.
-- Drops the five functions and the guard. KEEPS the table identity_verification_consents and any
-- consent rows (they are records of what people agreed to; delete them yourself only if you mean to).
-- Restores the six-value purpose list on local_tasker_consents as NOT VALID: existing
-- 'identity_verification' rows are kept (the table is insert-only), new ones are refused.
begin;
drop function if exists public.idv_has_consent(uuid, text);
drop function if exists public.idv_record_local_consent(uuid, text, text, text);
drop function if exists public.idv_withdraw_consent(text);
drop function if exists public.idv_give_consent(text);
drop function if exists public.idv_consent_version();
drop trigger if exists idv_consents_guard on public.identity_verification_consents;
drop function if exists public.idv_consent_guard();

alter table public.local_tasker_consents drop constraint if exists local_tasker_consents_purpose_check;
alter table public.local_tasker_consents add constraint local_tasker_consents_purpose_check
  check (purpose = any (array['profile', 'publish_info', 'photos', 'payout', 'price_change', 'booking_confirmation'])) not valid;
-- To remove the self-consent records as well (IRREVERSIBLE), uncomment:
-- drop table if exists public.identity_verification_consents;
commit;

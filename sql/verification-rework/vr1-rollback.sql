-- Undo VR1. Deletes the stored names (they can be saved again by verifying, or with idv_set_name_manual).
drop trigger if exists idv_names_on_consent_revoke on public.identity_verification_consents;
drop function if exists public.idv_names_on_consent_revoke();
drop function if exists public.idv_set_name_manual(uuid, text);
drop function if exists public.idv_name_matches(uuid, text);
drop function if exists public.idv_name_check(uuid, text);
drop function if exists public.idv_store_name(text, text);
drop function if exists public.idv_names_match(text[], text[]);
drop function if exists public.idv_normalize_name(text);
drop table if exists public.idv_verified_names;
select 'DONE: VR1 removed' as result;

-- StreetTasker verification rework, stage VR1b: new consent version because VR1 keeps the verified name.
-- RUN THIS AT THE SAME TIME as you upload data-consent.html, privacy.html, verify.html and coordinator-identity.html
-- (those pages now say data-consent-version "v2" / "coordinator-v2"; if the database and the pages disagree, nobody can start a check).
-- Effect: people who agreed to version 1 are asked to agree again the next time they START a verification.
-- People who are already VERIFIED are not affected. A check that is already in progress is not affected (consent is only read when an attempt starts).
-- Undo: vr1b-rollback.sql (and put the old pages back).
create or replace function public.idv_consent_version()
 returns text language sql immutable set search_path to 'public', 'pg_temp'
as $$ select 'v2'::text $$;

create or replace function public.idv_coordinator_consent_version()
 returns text language sql immutable set search_path to 'public', 'pg_temp'
as $$ select 'coordinator-v2'::text $$;

select public.idv_consent_version() as customer_and_tasker_version, public.idv_coordinator_consent_version() as coordinator_version,
       case when public.idv_consent_version() = 'v2' and public.idv_coordinator_consent_version() = 'coordinator-v2'
            then 'DONE: VR1b installed' else 'NOT DONE' end as result;

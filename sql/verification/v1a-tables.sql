-- Stage V1a: Didit identity verification tables. ADDITIVE ONLY.
-- Touches no existing table, function or policy. Safe to run twice.
-- Run in the Supabase SQL editor (staging first). Rollback: v1a-rollback.sql.
--
-- Access model: both tables have RLS ON and NO policies, and all privileges are
-- revoked from anon / authenticated. The browser can neither read nor write them.
-- The page reads status through read functions (stage V1c). Only service_role
-- (Edge Functions) and SECURITY DEFINER functions owned by postgres touch them.

begin;

-- One row per verification attempt (Didit session).
create table if not exists public.identity_verifications (
  id                    uuid primary key default gen_random_uuid(),
  -- StreetTasker user, also sent to Didit as vendor_data. Set by the server, never
  -- by the browser. No foreign key on purpose: it must not block account deletion
  -- (retention decision D-V7 is open).
  user_id               uuid not null,
  -- D-V4: customers verify too (their workflow is added in stage V6).
  subject_kind          text not null
                          check (subject_kind in ('tasker_regular', 'tasker_local', 'customer')),
  provider              text not null default 'didit' check (provider = 'didit'),
  provider_session_id   text unique,
  workflow_id           text,
  environment           text not null check (environment in ('sandbox', 'live')),
  status                text not null default 'NOT_STARTED'
                          check (status in ('NOT_STARTED', 'IN_PROGRESS', 'PENDING', 'VERIFIED',
                                            'FAILED', 'REVIEW_REQUIRED', 'RESUBMIT_REQUESTED',
                                            'EXPIRED', 'ABANDONED')),
  provider_status       text,                       -- exact Didit string, e.g. 'In Review'
  status_reason_codes   text[] not null default '{}', -- warning codes only, no personal data
  liveness_ok           boolean,
  face_match_ok         boolean,
  document_ok           boolean,
  nin_database_match    text
                          check (nin_database_match in ('full_match', 'partial_match', 'no_match', 'not_run')),
  last_event_created_at timestamptz,                -- Didit created_at of the newest applied event
  request_id            text,                       -- retry key from the caller (create-session)
  created_by            uuid not null,              -- the user, or the coordinator in proxy mode
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  completed_at          timestamptz
);

-- ONE open attempt per user per environment. "Closed" = VERIFIED, FAILED, EXPIRED, ABANDONED.
-- V1b-1 defines the transitions and may adjust this list; if it does, recreate this index.
create unique index if not exists idv_one_open_per_user_env
  on public.identity_verifications (user_id, environment)
  where status not in ('VERIFIED', 'FAILED', 'EXPIRED', 'ABANDONED');

create unique index if not exists idv_request_id_uniq
  on public.identity_verifications (created_by, request_id)
  where request_id is not null;

create index if not exists idv_user_recent
  on public.identity_verifications (user_id, created_at desc);

create or replace function public.idv_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists idv_touch_updated_at on public.identity_verifications;
create trigger idv_touch_updated_at
  before update on public.identity_verifications
  for each row execute function public.idv_touch_updated_at();

-- Idempotency ledger: one row per Didit event_id. NO payload body is stored.
-- A repeated event_id is detected by the primary key (insert ... on conflict do nothing)
-- and is NOT stored a second time, so outcome 'duplicate' is for the caller's logs.
create table if not exists public.identity_verification_events (
  event_id            text primary key,           -- Didit event_id, or session_id|status|webhook_type fallback
  provider_session_id text,
  webhook_type        text,
  provider_status     text,
  environment         text check (environment in ('sandbox', 'live')),
  received_at         timestamptz not null default now(),
  processed_at        timestamptz,
  outcome             text
                        check (outcome in ('applied', 'duplicate', 'stale', 'ignored_environment', 'rejected')),
  payload_hash        text
);

create index if not exists idv_events_session
  on public.identity_verification_events (provider_session_id, received_at);

-- Lock down. RLS on with no policy = no rows for anyone using a policy-bound role.
alter table public.identity_verifications       enable row level security;
alter table public.identity_verification_events enable row level security;

-- Supabase grants ALL on new public tables to anon and authenticated by default: remove it.
revoke all on public.identity_verifications       from public, anon, authenticated;
revoke all on public.identity_verification_events from public, anon, authenticated;
revoke all on function public.idv_touch_updated_at() from public, anon, authenticated;

grant select, insert, update on public.identity_verifications       to service_role;
grant select, insert, update on public.identity_verification_events to service_role;

commit;

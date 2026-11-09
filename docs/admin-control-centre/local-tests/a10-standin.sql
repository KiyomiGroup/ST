-- LOCAL STAND-INS ONLY (never run on Supabase). Run AFTER standin.sql and a9-standin.sql. Widens the A9 stand-in profile table and adds
-- imitations of the other Local Tasker tables A10 reads or writes. Column lists follow what the site's own JS and SQL select; unseen
-- tables (payouts, consents beyond the known columns) include extra "private" columns so the tests can prove they never leak.
alter table public.local_tasker_profiles add column if not exists phone text;
alter table public.local_tasker_profiles add column if not exists skills text[];
alter table public.local_tasker_profiles add column if not exists availability_notes text;
alter table public.local_tasker_profiles add column if not exists published_at timestamptz;
alter table public.local_tasker_profiles add column if not exists published_by uuid;
alter table public.local_tasker_profiles add column if not exists created_at timestamptz default now();
alter table public.local_tasker_profiles add column if not exists needs_republish boolean not null default false;
alter table public.bookings add column if not exists created_at timestamptz default now();
alter table public.local_booking_state add column if not exists lt_status text;
create table public.identity_verifications (id uuid primary key default gen_random_uuid(), user_id uuid, status text, created_at timestamptz default now(), provider_session_id text);
create table public.taskers (user_id text primary key, available boolean default false, name text);
create table public.services (id uuid primary key default gen_random_uuid(), user_id uuid, service_name text, category text, price numeric, rate_unit text,
  available boolean default true, is_main boolean default false, availability_status text, location text, description text, created_at timestamptz default now());
create table public.local_tasker_photos (id uuid primary key default gen_random_uuid(), tasker_user_id uuid, storage_path text, kind text not null default 'portfolio',
  is_cover boolean default false, removed_at timestamptz);
create table public.local_tasker_consents (id uuid primary key default gen_random_uuid(), tasker_user_id uuid, purpose text, method text, evidence_ref text, details text,
  created_at timestamptz default now(), revoked_at timestamptz);
create table public.local_payouts (id uuid primary key default gen_random_uuid(), tasker_user_id uuid, booking_id uuid, status text, amount numeric, account_name text, created_at timestamptz default now());
create table public.local_payout_accounts (id uuid primary key default gen_random_uuid(), tasker_user_id uuid, bank_name text, account_number text, account_name text, last4 text, status text);

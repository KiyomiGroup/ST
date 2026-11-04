-- SCRATCH ONLY (stage 6D-1). Load AFTER the 5D-3b scaffold and BEFORE stage-6d1-core.sql.
-- The scaffold has no payment_receipts table. Columns copied from the owner's real export (2026-11-04, query 68).
create table if not exists public.payment_receipts (id uuid primary key default gen_random_uuid(), receipt_number text not null unique,
  payment_intent_id uuid not null unique, payment_request_id uuid, booking_id uuid, thread_id uuid, customer_id uuid not null, tasker_id uuid not null,
  kind text not null, title text, invoice_number text, amount numeric not null check (amount > 0), lines jsonb not null default '[]'::jsonb,
  paid_at timestamptz not null default now(), created_at timestamptz not null default now());
grant select on public.payment_receipts, public.payment_requests, public.job_requests, public.job_events to authenticated;

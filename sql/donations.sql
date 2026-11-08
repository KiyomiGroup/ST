-- Donations ledger. Run once in the Supabase SQL editor. Safe to run again.
-- Card donations (Paystack) are written by the donate-checkout and paystack-webhook functions (service role).
-- Bank transfers to Moniepoint can be added by hand so ONE table is your record of all donations (see bottom).

create table if not exists public.donations (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique,
  source                text not null default 'paystack' check (source in ('paystack','bank_transfer')),
  status                text not null default 'pending' check (status in ('pending','paid','failed','flagged')),
  amount                integer not null check (amount >= 500 and amount <= 5000000),   -- naira
  donor_name            text,
  donor_email           text not null,
  paid_kobo             bigint,
  paid_at               timestamptz,
  channel               text,
  flag_reason           text,
  receipt_claimed_at    timestamptz,
  receipt_sent_at       timestamptz,
  admin_claimed_at      timestamptz,
  admin_notified_at     timestamptz,
  client_ip             text,
  created_at            timestamptz not null default now()
);
create index if not exists donations_created_idx on public.donations (created_at desc);
create index if not exists donations_status_idx on public.donations (status);

-- Nobody reads or writes this from the browser. Only the Edge Functions (service role) and you in the SQL editor.
alter table public.donations enable row level security;
revoke all on public.donations from anon, authenticated;

-- ===== Monthly accounting: compare this with your Moniepoint / Paystack statements =====
-- select date_trunc('month', paid_at) m, source, count(*), sum(amount) naira from public.donations where status='paid' group by 1,2 order by 1 desc;
-- Stuck or suspicious:
-- select * from public.donations where status = 'flagged' or (status='pending' and created_at < now() - interval '1 day') order by created_at desc;
-- Paid but no receipt emailed:
-- select reference, donor_email, amount from public.donations where status='paid' and receipt_sent_at is null;

-- ===== Record a bank transfer you received on Moniepoint =====
-- insert into public.donations (reference, source, status, amount, donor_name, donor_email, paid_kobo, paid_at)
-- values ('BT-2026-11-08-001', 'bank_transfer', 'paid', 10000, 'Name', 'donor@example.com', 1000000, now());

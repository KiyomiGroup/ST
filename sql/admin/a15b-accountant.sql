-- ============================================================================
-- StreetTasker Admin Control Centre, stage A15b (rewritten 2026-11-11 to the owner's new rule):
-- THE ACCOUNTANT'S DAILY RELEASE REPORT AND THE LABELLED LEDGER.
-- ADDITIVE and safe to run twice. Rollback: a15b-rollback.sql.
--
-- OWNER RULE (2026-11-11)
--   The money the accountant must send to Paystack each day is the money of jobs whose RELEASE CODE
--   was entered that day. Nothing else. Window: 9:00 pm WAT yesterday up to 9:00 pm WAT today
--   (20:00 UTC to 20:00 UTC). At 9:00 pm WAT the site builds the report and emails it to the admins who
--   hold accounting.view. If no release code was entered, an email still goes: "No revenue to pay out today".
--   The 24 hour clearing gives the owner 24 hours to put the money in Paystack.
--   Gift card sales are NOT part of it (a gift card sale is not a release). Only jobs that were released.
--   The older "top-up batch" design in 04-ACCOUNTANT-ADMIN.md sections 1 to 8 is replaced by this.
--
-- WHAT THIS FILE CREATES
--   Tables : accountant_labels, accountant_ledger (append only), accountant_daily_reports.
--   Role   : 'accountant' with permissions accounting.view, accounting.record (+ accounting.capital for
--            Super Admin only, which Super Admin holds anyway).
--   Funcs  : _acct_sync_ledger, _acct_build_report, accountant_close_day (cron, 20:00 UTC),
--            admin_accountant_reports, admin_accountant_report, admin_accountant_mark_sent,
--            admin_accountant_ledger, admin_accountant_record, admin_accountant_reverse.
--   Cron   : st-accountant-daily at 0 20 * * * (only if pg_cron is installed).
--
-- RULES (hard boundaries of the admin project)
--   * Nothing here moves money, calls Paystack, or changes a wallet, escrow row, payout or payment status.
--     The site only READS its own tables and WRITES to the three new tables.
--   * The ledger is append only. A mistake is fixed by a reversing entry that points at the first.
--   * Amounts are integer KOBO in the new tables. The site's own tables hold naira; this file converts.
--   * Columns whose existence was not proven are read through to_jsonb(row) so a missing column gives
--     NULL, not an error. test_archive_* tables are never read.
--   * Customer, tasker and coordinator names, phones and emails are never written to the report or ledger.
--
-- NOT RUN ANYWHERE: this build environment has no Postgres. Read handoffs/A15b.md before running.
-- ============================================================================

-- ---------- 1. tables --------------------------------------------------------------------------
create table if not exists public.accountant_labels (
  key         text primary key,
  title       text not null,
  group_name  text not null,
  direction   text not null check (direction in ('in', 'out', 'memo')),
  manual      boolean not null default false,
  sort_order  integer not null default 100
);
comment on table public.accountant_labels is
  'Every label an accountant ledger line can carry. direction: in = cash arriving, out = cash leaving, memo = not a cash movement (recognition, a failed attempt, an amount owed).';

create table if not exists public.accountant_ledger (
  id            bigserial primary key,
  entry_at      timestamptz not null,
  label         text not null references public.accountant_labels (key),
  amount_kobo   bigint not null check (amount_kobo >= 0),
  reference     text,
  booking_ref   text,
  source_table  text,
  source_id     text,
  auto          boolean not null default true,
  note          text,
  recorded_by   uuid,
  recorded_at   timestamptz not null default now(),
  reverses      bigint references public.accountant_ledger (id)
);
create unique index if not exists accountant_ledger_source_uq
  on public.accountant_ledger (source_table, source_id, label) where source_table is not null;
create unique index if not exists accountant_ledger_reverses_uq
  on public.accountant_ledger (reverses) where reverses is not null;
create index if not exists accountant_ledger_at_idx on public.accountant_ledger (entry_at desc);
create index if not exists accountant_ledger_label_idx on public.accountant_ledger (label, entry_at desc);

create table if not exists public.accountant_daily_reports (
  report_date      date primary key,                 -- the Lagos date on which the window closes (9 pm WAT)
  window_start     timestamptz not null,
  window_end       timestamptz not null,
  jobs_released    integer not null default 0,
  tasker_kobo      bigint not null default 0,         -- regular + local tasker share: THE AMOUNT TO SEND
  regular_kobo     bigint not null default 0,
  local_kobo       bigint not null default 0,
  coordinator_kobo bigint,                            -- null = could not be read (never shown as 0)
  platform_kobo    bigint not null default 0,         -- the owner's own commission on those jobs (not sent)
  customer_kobo    bigint not null default 0,         -- what customers paid for those jobs
  lines            jsonb not null default '[]'::jsonb,
  status           text not null default 'no_release' check (status in ('no_release', 'to_send', 'sent')),
  emailed_at       timestamptz,
  built_at         timestamptz not null default now(),
  sent_kobo        bigint,
  sent_note        text,
  sent_by          uuid,
  sent_at          timestamptz
);

-- append only ledger (the daily report may be updated only by mark_sent, which sets the sent_* fields)
create or replace function public._acct_ledger_guard()
returns trigger language plpgsql as $$
begin
  raise exception 'The accountant ledger is append only. Add a reversing entry instead.' using errcode = 'P0001';
end $$;
drop trigger if exists accountant_ledger_no_change on public.accountant_ledger;
create trigger accountant_ledger_no_change before update or delete on public.accountant_ledger
  for each row execute function public._acct_ledger_guard();
drop trigger if exists accountant_ledger_no_truncate on public.accountant_ledger;
create trigger accountant_ledger_no_truncate before truncate on public.accountant_ledger
  for each statement execute function public._acct_ledger_guard();

alter table public.accountant_labels        enable row level security;
alter table public.accountant_ledger        enable row level security;
alter table public.accountant_daily_reports enable row level security;
revoke all on public.accountant_labels, public.accountant_ledger, public.accountant_daily_reports from anon, authenticated;
revoke all on sequence public.accountant_ledger_id_seq from anon, authenticated;

-- ---------- 2. labels ---------------------------------------------------------------------------
insert into public.accountant_labels (key, title, group_name, direction, manual, sort_order) values
  -- written by the site's own records (auto)
  ('customer_payment_job',    'Customer payment for a job (card or bank, Paystack)',       'Money in',          'in',   false, 10),
  ('wallet_topup',            'Customer wallet top-up (Paystack)',                         'Money in',          'in',   false, 11),
  ('gift_card_sold',          'Gift card sold (customer money, not income)',               'Money in',          'in',   false, 12),
  ('donation_received',       'Donation received (kept apart, not income)',                'Money in',          'in',   false, 13),
  ('other_paystack_payment',  'Other Paystack payment (plan, urgent fee or similar; see the note)', 'Money in', 'in',   false, 14),
  ('escrow_released_tasker',  'Tasker earnings released by release code (owed to the tasker)', 'Release by code', 'memo', false, 20),
  ('coordinator_commission',  'Coordinator commission earned on a released Local job',     'Release by code',   'memo', false, 21),
  ('platform_commission',     'Platform commission earned on a released job',              'Platform income',   'memo', false, 22),
  ('subscription_income',     'Subscription payment received (platform income)',           'Platform income',   'memo', false, 23),
  ('transfer_fee',            'Transfer fee deducted from the tasker (covers the Paystack transfer fee)', 'Platform income', 'memo', false, 24),
  ('stamp_duty_charged',      'Stamp duty deducted from the tasker (covers Paystack stamp duty)',         'Platform income', 'memo', false, 25),
  ('gift_card_used_on_job',   'Gift card value used to pay a job',                         'Release by code',   'memo', false, 26),
  ('escrow_cancelled',        'Escrow cancelled (job cancelled, money not released)',      'Release by code',   'memo', false, 27),
  ('tasker_withdrawal_sent',  'Withdrawal sent to a tasker bank account (after the fee)',  'Money out',         'out',  false, 30),
  ('local_payout_sent',       'Local Tasker payout sent to the bank account',              'Money out',         'out',  false, 31),
  ('refund_paid',             'Refund paid to a customer',                                 'Money out',         'out',  false, 33),
  ('withdrawal_failed',       'Withdrawal attempt that failed (no money moved)',           'Failed attempts',   'memo', false, 34),
  -- typed in by the accountant
  ('paystack_topup',          'Money the accountant sent to Paystack for released jobs',   'Moves between accounts', 'memo', true, 50),
  ('settlement_received',     'Paystack settlement paid into the bank',                    'Moves between accounts', 'in',   true, 51),
  ('commission_moved',        'Platform commission moved to the operating account',        'Moves between accounts', 'memo', true, 52),
  ('paystack_fee_collection', 'Paystack fee on customer payments (from the statement)',    'Fees and costs',    'out',  true, 60),
  ('paystack_fee_transfer',   'Paystack transfer fee (from the statement)',                'Fees and costs',    'out',  true, 61),
  ('paystack_stamp_duty',     'Stamp duty charged by Paystack (from the statement)',       'Fees and costs',    'out',  true, 62),
  ('expense_hosting',         'Hosting and database',                                      'Fees and costs',    'out',  true, 63),
  ('expense_email',           'Email service',                                             'Fees and costs',    'out',  true, 64),
  ('expense_id_verification', 'ID verification service',                                   'Fees and costs',    'out',  true, 65),
  ('expense_domain',          'Domain',                                                    'Fees and costs',    'out',  true, 66),
  ('expense_marketing',       'Marketing',                                                 'Fees and costs',    'out',  true, 67),
  ('expense_tax',             'Tax',                                                       'Fees and costs',    'out',  true, 68),
  ('expense_other',           'Other expense (the note must say what)',                    'Fees and costs',    'out',  true, 69),
  ('capital_in',              'Owner put money into the business (a loan, not income)',    'Owner capital',     'in',   true, 80),
  ('capital_repaid',          'Owner took money back (repaying the loan)',                 'Owner capital',     'out',  true, 81),
  ('reversal',                'Reversal of an earlier entry (mistake fixed)',              'Corrections',       'memo', true, 99)
on conflict (key) do update
  set title = excluded.title, group_name = excluded.group_name, direction = excluded.direction,
      manual = excluded.manual, sort_order = excluded.sort_order;

-- v2 clean-up (2026-11-11): lines copied automatically by the first version used the wrong source for release
-- by code. Automatic lines are always rebuilt from the site's records, so they are removed here and rebuilt by the
-- next sync. Typed lines (auto = false) and any report already marked "sent" are never touched.
do $clean$
begin
  alter table public.accountant_ledger disable trigger accountant_ledger_no_change;
  delete from public.accountant_ledger where auto;
  alter table public.accountant_ledger enable trigger accountant_ledger_no_change;
  delete from public.accountant_daily_reports where status <> 'sent';
end $clean$;

-- ---------- 3. role and permissions -------------------------------------------------------------
insert into public.admin_roles (key, label) values ('accountant', 'Accountant') on conflict (key) do nothing;

insert into public.admin_permissions (key, label, group_name, sensitive) values
  ('accounting.view',    'See the accountant desk (daily report and ledger)', 'Money', false),
  ('accounting.record',  'Record money steps and expenses on the ledger',     'Money', true),
  ('accounting.capital', 'Record owner capital put in or taken back',          'Money', true)
on conflict (key) do nothing;

insert into public.admin_role_permissions (role_key, permission_key) values
  ('accountant', 'accounting.view'), ('accountant', 'accounting.record'),
  ('accountant', 'transactions.view'), ('accountant', 'revenue.view'), ('accountant', 'payouts.view'),
  ('accountant', 'withdrawals.view'), ('accountant', 'giftcards.view'), ('accountant', 'referrals.view'),
  ('accountant', 'subscriptions.view'), ('accountant', 'subscriptions.payments.view'),
  ('accountant', 'subscriptions.revenue.view'), ('accountant', 'coordinator_plans.view'),
  ('accountant', 'export.run'),
  ('finance', 'accounting.view')
on conflict do nothing;
-- accounting.capital is held by Super Admin only (Super Admin holds every permission by rule).

-- ---------- 4. helpers --------------------------------------------------------------------------
create or replace function public._acct_kobo(p numeric)
returns bigint language sql immutable as $$ select round(coalesce(p, 0) * 100)::bigint $$;

create or replace function public._acct_naira(p_kobo bigint)
returns text language sql immutable as $$
  select '₦' || to_char(coalesce(p_kobo, 0) / 100.0, 'FM999,999,990.00') $$;

-- ---------- 5. release events: ONE source of truth for "a release code was entered" ------------------
-- Real sources (from the owner's introspect of 2026-11-11, functions job_submit_code and _release_escrow):
--   * A regular job writes wallet_transactions type 'escrow_release' (amount = the tasker share) at the moment of release.
--   * A Local Tasker job writes local_payouts release_key 'final' (amount = the tasker share) at that moment.
--   * A job paid by gift card has NO escrow row, so it must come from these two tables, not from escrow_payments.
-- Commission: regular = platform_fee of the released escrow rows (or booking amount minus tasker share when there is no
-- escrow row, the gift card case); Local = platform_share and coordinator_share of the commission hold (or the whole fee
-- when no coordinator is assigned).
create or replace function public._acct_release_events(p_from timestamptz, p_to timestamptz)
returns table (src_table text, src_id text, booking_ref text, booking_id uuid, kind text, released_at timestamptz,
               tasker_kobo bigint, coord_kobo bigint, platform_kobo bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select * from (
    select 'wallet_transactions'::text as src_table, to_jsonb(w)->>'id' as src_id, left(w.booking_id::text, 8) as booking_ref,
           w.booking_id, 'regular'::text as kind, (to_jsonb(w)->>'created_at')::timestamptz as released_at,
           public._acct_kobo(w.amount) as tasker_kobo, 0::bigint as coord_kobo,
           case when exists (select 1 from public.escrow_payments e where e.booking_id = w.booking_id and e.status = 'released')
                then (select coalesce(sum(public._acct_kobo(e.platform_fee)), 0) from public.escrow_payments e
                       where e.booking_id = w.booking_id and e.status = 'released')
                else public._acct_kobo(greatest(coalesce(b.amount, 0) - w.amount, 0)) end as platform_kobo
      from public.wallet_transactions w
      left join public.bookings b on b.id = w.booking_id
     where w.type = 'escrow_release' and w.booking_id is not null and to_jsonb(w)->>'id' is not null
    union all
    select 'local_payouts', p.id::text, left(p.booking_id::text, 8), p.booking_id, 'local', p.created_at,
           public._acct_kobo(p.amount),
           public._acct_kobo(coalesce(h.coordinator_share, 0)),
           case when h.booking_id is not null then public._acct_kobo(h.platform_share) else public._acct_kobo(p.fee_total) end
      from public.local_payouts p
      left join public.local_booking_commission_holds h on h.booking_id = p.booking_id
     where p.release_key = 'final'
  ) x
  where x.released_at is not null
    and (p_from is null or x.released_at >= p_from) and (p_to is null or x.released_at < p_to)
$$;

-- ---------- 5b. ledger sync: copies the site's own money records into the labelled ledger ------------
-- Idempotent: one ledger line per (source table, source row, label). Safe to run any number of times.
-- Not labelled yet: coordinator plan payments (they arrive as 'other_paystack_payment'), referral rewards (no money),
-- wallet debits and credits other than the ones below.
create or replace function public._acct_sync_ledger()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n_total integer := 0; n integer; v_notes jsonb := '[]'::jsonb;
begin
  -- A. Paystack payments confirmed
  begin
    insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, booking_ref, source_table, source_id, note)
    select i.paid_at,
           case when i.purpose = 'topup' then 'wallet_topup' when i.booking_id is not null then 'customer_payment_job' else 'other_paystack_payment' end,
           public._acct_kobo(i.amount), i.reference, left(coalesce(i.booking_id::text, ''), 8),
           'payment_intents', i.id::text,
           case when i.purpose = 'topup' then 'Wallet top-up'
                when i.booking_id is not null then 'Job payment: tasker share ' || public._acct_naira(public._acct_kobo(i.tasker_amount))
                     || ', platform fee ' || public._acct_naira(public._acct_kobo(i.platform_fee))
                else 'Purpose: ' || coalesce(i.purpose, 'unknown') end
      from public.payment_intents i
     where i.status = 'paid' and i.paid_at is not null
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;
  exception when others then v_notes := v_notes || to_jsonb('payment_intents: ' || sqlerrm);
  end;

  -- B. release by code: tasker earnings owed, coordinator commission, platform commission
  begin
    insert into public.accountant_ledger (entry_at, label, amount_kobo, booking_ref, source_table, source_id, note)
    select ev.released_at, 'escrow_released_tasker', ev.tasker_kobo, ev.booking_ref, ev.src_table, ev.src_id,
           'Release code entered (' || ev.kind || ' job). To be paid out within 24 hours.'
      from public._acct_release_events(null, null) ev
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;

    insert into public.accountant_ledger (entry_at, label, amount_kobo, booking_ref, source_table, source_id, note)
    select ev.released_at, 'platform_commission', ev.platform_kobo, ev.booking_ref, ev.src_table, ev.src_id,
           'Commission on a released ' || ev.kind || ' job.'
      from public._acct_release_events(null, null) ev
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;

    insert into public.accountant_ledger (entry_at, label, amount_kobo, booking_ref, source_table, source_id, note)
    select ev.released_at, 'coordinator_commission', ev.coord_kobo, ev.booking_ref, ev.src_table, ev.src_id,
           'Coordinator share of the fee on a released Local job (held 24 hours, then credited).'
      from public._acct_release_events(null, null) ev
     where ev.coord_kobo > 0
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;
  exception when others then v_notes := v_notes || to_jsonb('release events: ' || sqlerrm);
  end;

  -- C. cancelled escrow
  begin
    insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, booking_ref, source_table, source_id, note)
    select coalesce(nullif(to_jsonb(e)->>'updated_at', '')::timestamptz, e.paid_at, now()),
           'escrow_cancelled', public._acct_kobo(e.amount), e.reference, left(coalesce(e.booking_id::text, ''), 8),
           'escrow_payments', e.id::text, 'Escrow cancelled; any refund is recorded separately.'
      from public.escrow_payments e where e.status = 'cancelled'
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;
  exception when others then v_notes := v_notes || to_jsonb('escrow_payments: ' || sqlerrm);
  end;

  -- D. withdrawals. The site keeps the fee inside the amount: the tasker receives amount minus fee.
  --    Fee tiers (withdrawal_fee): up to 5,000 = 10; under 10,000 = 25; up to 50,000 = 75 (25 + 50 stamp duty); above = 100 (50 + 50).
  begin
    insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, source_table, source_id, note)
    select coalesce(w.settled_at, w.updated_at, w.created_at),
           case when w.status = 'success' then 'tasker_withdrawal_sent' else 'withdrawal_failed' end,
           public._acct_kobo(case when w.status = 'success' then coalesce(w.net_amount, w.amount - coalesce(w.fee, 0)) else w.amount end),
           coalesce(w.paystack_transfer_code, w.reference), 'withdrawals', w.id::text,
           case when w.status = 'success' then 'Withdrawal paid to the tasker bank account (amount after the fee).'
                else 'Failed, no money moved: ' || left(coalesce(w.failure_reason, 'no reason recorded'), 200) end
      from public.withdrawals w where w.status in ('success', 'failed')
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;

    insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, source_table, source_id, note)
    select coalesce(w.settled_at, w.updated_at, w.created_at), 'transfer_fee',
           public._acct_kobo(coalesce(w.fee, 0) - case when coalesce(w.fee, 0) >= 75 then 50 else 0 end),
           coalesce(w.paystack_transfer_code, w.reference), 'withdrawals', w.id::text,
           'Deducted from the tasker. Paystack bills the real transfer fee separately: enter it from the statement.'
      from public.withdrawals w where w.status = 'success' and coalesce(w.fee, 0) > 0
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;

    insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, source_table, source_id, note)
    select coalesce(w.settled_at, w.updated_at, w.created_at), 'stamp_duty_charged', 5000,
           coalesce(w.paystack_transfer_code, w.reference), 'withdrawals', w.id::text,
           'Stamp duty deducted from the tasker on a withdrawal above 10,000.'
      from public.withdrawals w where w.status = 'success' and coalesce(w.fee, 0) >= 75
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;
  exception when others then v_notes := v_notes || to_jsonb('withdrawals: ' || sqlerrm);
  end;

  -- E. Local Tasker payouts sent directly (they do not go through the wallet)
  begin
    insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, booking_ref, source_table, source_id, note)
    select coalesce(p.paid_at, p.sent_at), 'local_payout_sent',
           public._acct_kobo(coalesce(p.send_amount, p.amount - coalesce(p.transfer_fee, 0))),
           coalesce(p.transfer_reference, p.reference), left(p.booking_id::text, 8), 'local_payouts', p.id::text,
           'Local Tasker payout sent to the bank account.'
      from public.local_payouts p where p.paid_at is not null or p.sent_at is not null
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;

    insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, booking_ref, source_table, source_id, note)
    select coalesce(p.paid_at, p.sent_at), 'transfer_fee', public._acct_kobo(p.transfer_fee),
           coalesce(p.transfer_reference, p.reference), left(p.booking_id::text, 8), 'local_payouts', p.id::text,
           'Transfer fee on a Local Tasker payout, as the site recorded it.'
      from public.local_payouts p where (p.paid_at is not null or p.sent_at is not null) and coalesce(p.transfer_fee, 0) > 0
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;
  exception when others then v_notes := v_notes || to_jsonb('local_payouts: ' || sqlerrm);
  end;

  -- F. donations
  begin
    insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, source_table, source_id, note)
    select d.paid_at, 'donation_received', coalesce(d.paid_kobo, d.amount::bigint * 100), d.reference,
           'donations', d.id::text, 'Donation (kept apart: not platform income).'
      from public.donations d where d.status = 'paid' and d.paid_at is not null
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;
  exception when others then v_notes := v_notes || to_jsonb('donations: ' || sqlerrm);
  end;

  -- G. gift cards: sold (customer money), and value used to pay a job
  begin
    insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, source_table, source_id, note)
    select o.paid_at, 'gift_card_sold', o.amount::bigint * 100, o.reference, 'gift_card_orders', o.id::text,
           'Gift card sold. Customer money: not income and not part of the release-code payout.'
      from public.gift_card_orders o where o.paid_at is not null
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;

    insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, booking_ref, source_table, source_id, note)
    select h.created_at, 'gift_card_used_on_job', h.amount::bigint * 100, h.reference, left(coalesce(h.booking_id::text, ''), 8),
           'gift_card_holds', h.id::text, 'Gift card value used to pay a job. The tasker is paid when the release code is entered.'
      from public.gift_card_holds h where h.status = 'captured'
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;
  exception when others then v_notes := v_notes || to_jsonb('gift cards: ' || sqlerrm);
  end;

  -- H. subscription payments (platform income)
  begin
    insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, source_table, source_id, note)
    select r.paid_at, 'subscription_income', r.amount_kobo, r.reference, 'subscription_receipts', r.id::text,
           'Plan: ' || coalesce(r.plan_name, r.plan, 'unknown') || ' (' || coalesce(r.kind, 'payment') || ')'
      from public.subscription_receipts r where r.paid_at is not null
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;
  exception when others then v_notes := v_notes || to_jsonb('subscription_receipts: ' || sqlerrm);
  end;

  -- I. refunds recorded by support
  begin
    insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, source_table, source_id, note)
    select f.created_at, 'refund_paid', public._acct_kobo(f.amount), f.paystack_ref, 'job_refunds', f.id::text,
           'Refund recorded after a dispute. ' || left(coalesce(f.note, ''), 150)
      from public.job_refunds f
    on conflict do nothing;
    get diagnostics n = row_count; n_total := n_total + n;
  exception when others then v_notes := v_notes || to_jsonb('job_refunds: ' || sqlerrm);
  end;

  return jsonb_build_object('added', n_total, 'problems', v_notes);
end $$;

-- ---------- 6. build one day's report ------------------------------------------------------------
-- Counts every release code entered inside the window (see _acct_release_events). A report already marked
-- 'sent' is never rewritten. A report not yet sent is refreshed if built again.
create or replace function public._acct_build_report(p_end timestamptz)
returns public.accountant_daily_reports language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_start timestamptz := p_end - interval '24 hours';
  v_date date := (p_end at time zone 'Africa/Lagos')::date;
  r public.accountant_daily_reports;
  v_n integer; v_tasker bigint; v_reg bigint; v_loc bigint; v_coord bigint; v_plat bigint; v_lines jsonb;
begin
  select * into r from public.accountant_daily_reports where report_date = v_date;
  if found and r.status = 'sent' then return r; end if;

  select count(*), coalesce(sum(tasker_kobo), 0),
         coalesce(sum(tasker_kobo) filter (where kind = 'regular'), 0),
         coalesce(sum(tasker_kobo) filter (where kind = 'local'), 0),
         coalesce(sum(coord_kobo), 0), coalesce(sum(platform_kobo), 0),
         coalesce(jsonb_agg(jsonb_build_object('job', booking_ref, 'kind', kind, 'released_at', released_at,
                  'tasker_kobo', tasker_kobo, 'coord_kobo', coord_kobo, 'platform_kobo', platform_kobo) order by released_at), '[]'::jsonb)
    into v_n, v_tasker, v_reg, v_loc, v_coord, v_plat, v_lines
    from public._acct_release_events(v_start, p_end);

  insert into public.accountant_daily_reports as t
    (report_date, window_start, window_end, jobs_released, tasker_kobo, regular_kobo, local_kobo,
     coordinator_kobo, platform_kobo, customer_kobo, lines, status, built_at)
  values (v_date, v_start, p_end, v_n, v_tasker, v_reg, v_loc, v_coord, v_plat, v_tasker + v_coord + v_plat, v_lines,
          case when v_n = 0 then 'no_release' else 'to_send' end, now())
  on conflict (report_date) do update
    set window_start = excluded.window_start, window_end = excluded.window_end, jobs_released = excluded.jobs_released,
        tasker_kobo = excluded.tasker_kobo, regular_kobo = excluded.regular_kobo, local_kobo = excluded.local_kobo,
        coordinator_kobo = excluded.coordinator_kobo, platform_kobo = excluded.platform_kobo,
        customer_kobo = excluded.customer_kobo, lines = excluded.lines, status = excluded.status, built_at = now()
   where t.status <> 'sent'
  returning * into r;
  return r;
end $$;

-- ---------- 7. the 9 pm job: build, then email -----------------------------------------------------
-- Every row in `notifications` is already emailed by the site's existing mechanism (04-ACCOUNTANT-ADMIN.md
-- section 5). Recipients: every ACTIVE admin who holds accounting.view (the Accountant, Finance and every
-- Super Admin). The email is sent EVERY day, including a day with no release code.
create or replace function public.accountant_close_day()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_end timestamptz; r public.accountant_daily_reports; v_sync jsonb; v_title text; v_body text; v_sent integer := 0;
  u record; v_list text := ''; j jsonb; v_i integer := 0;
begin
  v_end := (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') + interval '20 hours';
  if v_end > now() then v_end := v_end - interval '1 day'; end if;

  v_sync := public._acct_sync_ledger();
  r := public._acct_build_report(v_end);

  if r.status = 'sent' then
    return jsonb_build_object('ok', true, 'skipped', 'already marked sent', 'report_date', r.report_date);
  end if;

  if r.jobs_released = 0 then
    v_title := 'No revenue to pay out today';
    v_body  := 'No release code was entered between 9:00 pm yesterday and 9:00 pm today (' || to_char(r.report_date, 'DD Mon YYYY')
               || ', Nigeria time). Nothing needs to be sent to Paystack for this day.';
  else
    for j in select value from jsonb_array_elements(r.lines) loop
      v_i := v_i + 1;
      exit when v_i > 20;
      v_list := v_list || E'\n' || '• Job ' || (j->>'job') || ' (' || (j->>'kind') || '): '
                || public._acct_naira((j->>'tasker_kobo')::bigint);
    end loop;
    if r.jobs_released > 20 then v_list := v_list || E'\n' || '… and ' || (r.jobs_released - 20) || ' more in the report.'; end if;
    v_title := 'Pay out ' || public._acct_naira(r.tasker_kobo) || ' to Paystack today';
    v_body  := r.jobs_released || ' job(s) were released by release code for ' || to_char(r.report_date, 'DD Mon YYYY')
               || '. Amount to put in Paystack for taskers within 24 hours: ' || public._acct_naira(r.tasker_kobo)
               || ' (regular ' || public._acct_naira(r.regular_kobo) || ', Local Taskers ' || public._acct_naira(r.local_kobo) || ').'
               || case when r.coordinator_kobo is null then ' Coordinator commission: not available.'
                       else ' Coordinator commission on these jobs: ' || public._acct_naira(r.coordinator_kobo) || ' (shown apart).' end
               || ' Platform commission earned: ' || public._acct_naira(r.platform_kobo) || ' (not sent to anyone).'
               || v_list || E'\n' || 'Top up Paystack, then record it on the Accountant page.';
  end if;

  for u in
    select distinct au.user_id
      from public.admin_users au
      join public.admin_user_roles ur on ur.user_id = au.user_id
     where au.status = 'active' and au.removed_at is null
       and (ur.role_key = 'super_admin'
            or exists (select 1 from public.admin_role_permissions rp
                        where rp.role_key = ur.role_key and rp.permission_key = 'accounting.view'))
  loop
    begin
      perform public._notify(u.user_id, 'accountant_daily', v_title, v_body,
                             jsonb_build_object('report_date', r.report_date, 'to_send_kobo', r.tasker_kobo, 'jobs', r.jobs_released));
      v_sent := v_sent + 1;
    exception when others then null;   -- one failed notification never blocks the others
    end;
  end loop;

  update public.accountant_daily_reports set emailed_at = now() where report_date = r.report_date;
  return jsonb_build_object('ok', true, 'report_date', r.report_date, 'jobs', r.jobs_released,
                            'to_send_kobo', r.tasker_kobo, 'notified', v_sent, 'sync', v_sync);
end $$;

revoke all on function public._acct_release_events(timestamptz, timestamptz), public._acct_sync_ledger(), public._acct_build_report(timestamptz), public.accountant_close_day(),
  public._acct_kobo(numeric), public._acct_naira(bigint), public._acct_ledger_guard() from public, anon, authenticated;

-- ---------- 8. browser functions (each checks the permission itself) --------------------------------
create or replace function public.admin_accountant_reports(p_limit integer default 31)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.admin_require('accounting.view');
  return jsonb_build_object('ok', true, 'generated_at', now(), 'reports', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.report_date desc) from (
      select report_date, window_start, window_end, jobs_released, tasker_kobo, regular_kobo, local_kobo,
             coordinator_kobo, platform_kobo, customer_kobo, status, emailed_at, sent_kobo, sent_at
        from public.accountant_daily_reports order by report_date desc limit least(greatest(coalesce(p_limit, 31), 1), 366)) x), '[]'::jsonb));
end $$;

create or replace function public.admin_accountant_report(p_date date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.accountant_daily_reports;
begin
  perform public.admin_require('accounting.view');
  select * into r from public.accountant_daily_reports where report_date = p_date;
  if not found then return jsonb_build_object('ok', false, 'error', 'There is no report for that date.'); end if;
  return jsonb_build_object('ok', true, 'report', to_jsonb(r));
end $$;

-- The accountant records that he SENT the money to Paystack. Records only: moves nothing.
create or replace function public.admin_accountant_mark_sent(p_date date, p_amount_kobo bigint, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.accountant_daily_reports; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.admin_guard('accounting.record', 'accountant.mark_sent') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  select * into r from public.accountant_daily_reports where report_date = p_date for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'There is no report for that date.'); end if;
  if r.status = 'sent' then return jsonb_build_object('ok', false, 'error', 'This day is already marked as sent.'); end if;
  if r.status = 'no_release' then return jsonb_build_object('ok', false, 'error', 'Nothing was due on this day.'); end if;
  if p_amount_kobo is null or p_amount_kobo <= 0 then return jsonb_build_object('ok', false, 'error', 'Enter the amount you sent, above zero.'); end if;
  if p_amount_kobo <> r.tasker_kobo and (v_note is null or length(v_note) < 10) then
    return jsonb_build_object('ok', false, 'error', 'The amount differs from the report. Write a reason of at least 10 characters.');
  end if;

  update public.accountant_daily_reports
     set status = 'sent', sent_kobo = p_amount_kobo, sent_note = v_note, sent_by = auth.uid(), sent_at = now()
   where report_date = p_date;
  insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, source_table, source_id, auto, note, recorded_by)
  values (now(), 'paystack_topup', p_amount_kobo, 'report ' || p_date::text, 'accountant_daily_reports', p_date::text, false,
          coalesce(v_note, 'Sent to Paystack for the release-code jobs of ' || p_date::text), auth.uid());
  perform public.admin_log('accountant.mark_sent', 'accountant_daily_report', p_date::text, null,
                           jsonb_build_object('due_kobo', r.tasker_kobo, 'sent_kobo', p_amount_kobo), v_note);
  return jsonb_build_object('ok', true, 'report_date', p_date, 'sent_kobo', p_amount_kobo);
end $$;

create or replace function public.admin_accountant_ledger(
  p_from timestamptz default null, p_to timestamptz default null, p_label text default null,
  p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_lim integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  perform public.admin_require('accounting.view');
  return jsonb_build_object('ok', true, 'generated_at', now(),
    'totals', (select coalesce(jsonb_agg(jsonb_build_object('label', t.label, 'title', t.title, 'group', t.group_name,
                 'direction', t.direction, 'entries', t.n, 'amount_kobo', t.s) order by t.sort_order), '[]'::jsonb)
                 from (select l.label, a.title, a.group_name, a.direction, a.sort_order, count(*) n, sum(l.amount_kobo) s
                         from public.accountant_ledger l join public.accountant_labels a on a.key = l.label
                        where (p_from is null or l.entry_at >= p_from) and (p_to is null or l.entry_at < p_to)
                          and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id)
                          and l.label <> 'reversal'
                        group by l.label, a.title, a.group_name, a.direction, a.sort_order) t),
    'entries', (select coalesce(jsonb_agg(to_jsonb(e) order by e.entry_at desc, e.id desc), '[]'::jsonb)
                  from (select l.id, l.entry_at, l.label, a.title, a.group_name, a.direction, l.amount_kobo, l.reference,
                               l.booking_ref, l.auto, l.note, l.recorded_at, l.reverses,
                               exists (select 1 from public.accountant_ledger z where z.reverses = l.id) as reversed
                          from public.accountant_ledger l join public.accountant_labels a on a.key = l.label
                         where (p_from is null or l.entry_at >= p_from) and (p_to is null or l.entry_at < p_to)
                           and (p_label is null or l.label = p_label)
                         order by l.entry_at desc, l.id desc limit v_lim offset greatest(coalesce(p_offset, 0), 0)) e));
end $$;

-- Typed entries: fees from the statement, expenses, settlements, top-ups, capital in or out.
create or replace function public.admin_accountant_record(
  p_label text, p_amount_kobo bigint, p_date date, p_note text, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_l public.accountant_labels; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_id bigint;
begin
  select * into v_l from public.accountant_labels where key = p_label and manual and key <> 'reversal';
  if not found then return jsonb_build_object('ok', false, 'error', 'That label cannot be typed in.'); end if;
  if p_label in ('capital_in', 'capital_repaid') then
    if not public.admin_guard('accounting.capital', 'accountant.record_capital') then
      return jsonb_build_object('ok', false, 'error', 'Only a Super Admin can record owner capital.'); end if;
  else
    if not public.admin_guard('accounting.record', 'accountant.record') then
      return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.'); end if;
  end if;
  if p_amount_kobo is null or p_amount_kobo <= 0 then return jsonb_build_object('ok', false, 'error', 'Enter an amount above zero.'); end if;
  if p_date is null or p_date > (now() at time zone 'Africa/Lagos')::date then
    return jsonb_build_object('ok', false, 'error', 'Enter the date it happened (not in the future).'); end if;
  if v_note is null or length(v_note) < 5 then return jsonb_build_object('ok', false, 'error', 'Write a short note saying what this is (5 or more characters).'); end if;
  if p_label = 'expense_other' and length(v_note) < 10 then
    return jsonb_build_object('ok', false, 'error', 'For "Other expense" the note must say what it was (10 or more characters).'); end if;

  insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, auto, note, recorded_by)
  values (((p_date::text || ' 12:00')::timestamp at time zone 'Africa/Lagos'), p_label, p_amount_kobo,
          nullif(btrim(coalesce(p_reference, '')), ''), false, v_note, auth.uid())
  returning id into v_id;
  perform public.admin_log('accountant.record', 'accountant_ledger', v_id::text, null,
                           jsonb_build_object('label', p_label, 'amount_kobo', p_amount_kobo, 'date', p_date), v_note);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.admin_accountant_reverse(p_entry bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.accountant_ledger; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_id bigint;
begin
  if not public.admin_guard('accounting.record', 'accountant.reverse') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.'); end if;
  select * into e from public.accountant_ledger where id = p_entry;
  if not found then return jsonb_build_object('ok', false, 'error', 'That entry does not exist.'); end if;
  if e.auto then return jsonb_build_object('ok', false, 'error', 'Entries copied from the site records cannot be reversed here. Fix the cause in the site.'); end if;
  if e.label = 'reversal' then return jsonb_build_object('ok', false, 'error', 'A reversal cannot be reversed. Record a new entry instead.'); end if;
  if e.label in ('capital_in', 'capital_repaid') and not public.admin_guard('accounting.capital', 'accountant.reverse_capital') then
    return jsonb_build_object('ok', false, 'error', 'Only a Super Admin can reverse owner capital.'); end if;
  if v_reason is null or length(v_reason) < 10 then return jsonb_build_object('ok', false, 'error', 'Write a reason of at least 10 characters.'); end if;
  if exists (select 1 from public.accountant_ledger z where z.reverses = e.id) then
    return jsonb_build_object('ok', false, 'error', 'This entry was already reversed.'); end if;

  insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, auto, note, recorded_by, reverses)
  values (now(), 'reversal', e.amount_kobo, e.reference, false, 'Reverses entry ' || e.id || ' (' || e.label || '): ' || v_reason, auth.uid(), e.id)
  returning id into v_id;
  perform public.admin_log('accountant.reverse', 'accountant_ledger', e.id::text, null,
                           jsonb_build_object('reversal_id', v_id), v_reason);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- PROFIT. Income = commission on released jobs + subscription payments + the transfer fee and stamp duty deducted from
-- taskers. Costs = everything the accountant typed under "Fees and costs". Profit = income minus costs.
-- Never counted as income: gift cards sold, donations, wallet top-ups, customer or tasker money, owner capital.
-- Not counted yet: coordinator plan payments (they sit under 'other_paystack_payment' until their purpose is confirmed).
-- "complete" is false while any main cost category has no entry in the range, so the page must say the profit is not final.
create or replace function public.admin_accountant_profit(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_income bigint; v_cost bigint; v_missing jsonb;
begin
  perform public.admin_require('accounting.view');
  select coalesce(sum(l.amount_kobo), 0) into v_income
    from public.accountant_ledger l
   where l.label in ('platform_commission', 'subscription_income', 'transfer_fee', 'stamp_duty_charged')
     and (p_from is null or l.entry_at >= p_from) and (p_to is null or l.entry_at < p_to)
     and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id);
  select coalesce(sum(l.amount_kobo), 0) into v_cost
    from public.accountant_ledger l join public.accountant_labels a on a.key = l.label
   where a.group_name = 'Fees and costs' and a.direction = 'out'
     and (p_from is null or l.entry_at >= p_from) and (p_to is null or l.entry_at < p_to)
     and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id);
  select coalesce(jsonb_agg(a.title order by a.sort_order), '[]'::jsonb) into v_missing
    from public.accountant_labels a
   where a.key in ('paystack_fee_collection', 'paystack_fee_transfer', 'expense_hosting', 'expense_email', 'expense_id_verification', 'expense_domain')
     and not exists (select 1 from public.accountant_ledger l
                      where l.label = a.key and (p_from is null or l.entry_at >= p_from) and (p_to is null or l.entry_at < p_to)
                        and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id));
  return jsonb_build_object('ok', true, 'generated_at', now(),
    'income', (select coalesce(jsonb_agg(jsonb_build_object('label', t.label, 'title', t.title, 'amount_kobo', t.s) order by t.sort_order), '[]'::jsonb)
                 from (select l.label, a.title, a.sort_order, sum(l.amount_kobo) s
                         from public.accountant_ledger l join public.accountant_labels a on a.key = l.label
                        where l.label in ('platform_commission', 'subscription_income', 'transfer_fee', 'stamp_duty_charged')
                          and (p_from is null or l.entry_at >= p_from) and (p_to is null or l.entry_at < p_to)
                          and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id)
                        group by l.label, a.title, a.sort_order) t),
    'costs', (select coalesce(jsonb_agg(jsonb_build_object('label', t.label, 'title', t.title, 'amount_kobo', t.s) order by t.sort_order), '[]'::jsonb)
                from (select l.label, a.title, a.sort_order, sum(l.amount_kobo) s
                        from public.accountant_ledger l join public.accountant_labels a on a.key = l.label
                       where a.group_name = 'Fees and costs' and a.direction = 'out'
                         and (p_from is null or l.entry_at >= p_from) and (p_to is null or l.entry_at < p_to)
                         and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id)
                       group by l.label, a.title, a.sort_order) t),
    'income_kobo', v_income, 'costs_kobo', v_cost, 'profit_kobo', v_income - v_cost,
    'complete', jsonb_array_length(v_missing) = 0, 'missing_cost_entries', v_missing);
end $$;

revoke all on function public.admin_accountant_reports(integer), public.admin_accountant_report(date), public.admin_accountant_profit(timestamptz, timestamptz),
  public.admin_accountant_mark_sent(date, bigint, text),
  public.admin_accountant_ledger(timestamptz, timestamptz, text, integer, integer),
  public.admin_accountant_record(text, bigint, date, text, text), public.admin_accountant_reverse(bigint, text)
  from public, anon;
grant execute on function public.admin_accountant_reports(integer), public.admin_accountant_report(date), public.admin_accountant_profit(timestamptz, timestamptz),
  public.admin_accountant_mark_sent(date, bigint, text),
  public.admin_accountant_ledger(timestamptz, timestamptz, text, integer, integer),
  public.admin_accountant_record(text, bigint, date, text, text), public.admin_accountant_reverse(bigint, text)
  to authenticated;

-- ---------- 9. the 9 pm WAT schedule (20:00 UTC) ----------------------------------------------------
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'st-accountant-daily';
    perform cron.schedule('st-accountant-daily', '0 20 * * *', 'select public.accountant_close_day();');
  end if;
exception when others then
  raise notice 'Cron job not created (%). Create it by hand: select cron.schedule(''st-accountant-daily'', ''0 20 * * *'', ''select public.accountant_close_day();'');', sqlerrm;
end $cron$;

-- ---------- 10. checks (read only): one row, every value should be true -------------------------------
select
  (select count(*) = 3 from information_schema.tables where table_schema = 'public' and table_name in ('accountant_labels', 'accountant_ledger', 'accountant_daily_reports')) as tables_ok,
  (select count(*) >= 30 from public.accountant_labels) as labels_ok,
  (select count(*) = 3 from public.admin_permissions where key in ('accounting.view', 'accounting.record', 'accounting.capital')) as permissions_ok,
  exists (select 1 from public.admin_roles where key = 'accountant') as role_ok,
  (select count(*) = 7 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'admin\_accountant\_%') as functions_ok,
  exists (select 1 from pg_extension where extname = 'pg_cron') as pg_cron_installed;

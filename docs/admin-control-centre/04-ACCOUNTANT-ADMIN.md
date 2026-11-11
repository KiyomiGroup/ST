# Accountant admin

## DECISION OF 2026-11-11 (WINS over everything below it, including sections 1 to 8 and 10)

1. **What the accountant sends to Paystack each day = the tasker money of jobs whose release code was entered that day.** Window: 9:00 pm WAT yesterday to 9:00 pm WAT today (20:00 to 20:00 UTC). Source: `escrow_payments` rows with `status = 'released'` and `released_at` inside the window. The 24 hour clearing gives 24 hours to put the money in Paystack.
2. **At 9:00 pm WAT the site builds the report and emails every active admin with `accounting.view`** (Accountant, Finance, every Super Admin) through the existing `notifications` emailing. **Every day**, including a day with no release code: then the email says "No revenue to pay out today".
3. **Gift card sales are not part of the payout** (a sale is not a release). This removes the old gift card problem (D-A20). A gift card used to pay a job is counted when that job is released, like any other job.
4. **Capital is not a fixed ₦200,000.** It is any amount the owner puts in, recorded as `capital_in` (a loan, not income) and `capital_repaid`. Only a Super Admin (`accounting.capital`) records either. **No second-admin approval** (owner decision 2026-11-11).
5. **Every transaction is labelled** in `accountant_ledger` (labels in `accountant_labels`), including the transfer fee on each withdrawal, Paystack fees, stamp duty, expenses, settlements, top-ups and capital. The ledger is append only; a mistake is fixed by a `reversal` entry.
6. **Website:** the promise of same-day withdrawal after 4 weeks was removed from `payments.html` (4.4, 6.1), `terms.html` (11.10A deleted, 11.12), `messages.html` and `js/wallet-data.js`. The 24 hour clearing applies to every tasker permanently.
7. The Accountant page has a **Profit** block (`admin_accountant_profit`): income minus typed costs, marked "not final" while a cost category has no entry.
8. Built in `sql/admin/a15b-accountant.sql` (not run). The page `admin/accountant.html` is the next stage (A15b-2). The old `admin_topup_batches` design is dropped.

---

## (Older text, superseded where it conflicts with the decision above) Accountant admin: money dashboard, daily top-up, ledger

Written 2026-11-10 from the owner's chat decisions. **Nothing in this file has been built.** It is the spec for stages A15b-1, A15b-2 and A15b-3 and a short outline of stage M1 (the website change it depends on). Sections 1 to 10 below were written first and describe the daily top-up; section 0 is the newer and wider decision and wins where they differ.

## 0. The Accountant admin (owner decision, 2026-11-10)

**Who.** A new admin role called **Accountant** (key `accountant`). It handles money only. It cannot see or change customers, taskers, bookings, verification or content. The existing `finance` role stays read only and unchanged (D-A26).

**Capital.** The business starts with **₦200,000** of the owner's own money as the payout float. The owner expects that **₦200,000 to be paid back to her** once settlements fund the float. So the capital is a recorded loan, not income and not a cost. The page shows: capital put in, capital repaid, **outstanding (starts at ₦200,000)**, and progress. A repayment is only a record, and **needs a Super Admin approval** (other than the requester) through the existing approvals system (D-A23). The page warns when "cash held minus total owed" is smaller than the repayment.

**Permissions (new).** `accounting.view` (see the dashboard), `accounting.record` (record top-ups, settlements received and expenses), `accounting.capital.request` (ask to repay capital). The Accountant role also gets the existing read permissions: `transactions.view`, `revenue.view`, `payouts.view`, `withdrawals.view`, `giftcards.view`, `referrals.view`, `subscriptions.view`, `subscriptions.payments.view`, `subscriptions.revenue.view`, `coordinator_plans.view`, `export.run`. Super Admin has everything. Customer and tasker names and contacts are masked (D-A12).

**What "settle" means for the Accountant.** He does the human money steps and records them: tops up the Paystack Balance, records each Paystack settlement that reaches the bank, records every spending, and records capital in and out. **He never moves money through the site, and no admin function calls Paystack (rule 7).**

### 0.1 Every money flow, and where it shows

Colour and wording on the dashboard follow this table. "Site" means taken from the site's own records. "Accountant" means typed in by him and shown as such.

| # | Flow | Whose money | Source |
|---|---|---|---|
| **Customer money in** | | | |
| 1 | Job payments by card or bank (Paystack) | Split into tasker share and platform commission | Site (`payment_intents`) |
| 2 | Job payments from gift card balance (no cash arrives) | Taskers' and platform's, paid from stored value | Site (gift card holds and transactions) |
| 3 | Job Room extra payments (deposit, full, remaining, extras) | Same split as 1 | Site (`payment_requests`) |
| 4 | Urgent task fees | Platform | Site, labelled "unverified" (D-A17) |
| **Platform's own income** | | | |
| 5 | Commission on regular Tasker jobs (rate from `platform_fee_rate_for_booking`) | Platform | Site |
| 6 | Local Tasker jobs: tasker payout, coordinator share, platform share, each shown apart | As recorded | Site |
| 7 | Subscription payments (Tasker plans) | Platform | Site (`subscription_receipts`) |
| 8 | Coordinator plan payments (`tier_upgrade`) | Platform | Site |
| **Held for other people** | | | |
| 9 | Tasker earnings in escrow or still in the 24 hour clearing | Taskers | Site |
| 10 | **Payouts due before the next cutoff** (drives the top-up) | Taskers, Local Taskers, coordinators | Site |
| 11 | Local Taskers' payouts waiting out the 24 hours | Local Taskers | Site (`release_after`) |
| 12 | Coordinator commissions held for 24 hours | Coordinators | Site |
| 13 | **Gift cards**: sold today, redeemed today, balance outstanding | Customers | Site |
| 14 | Money held in open disputes | Pending decision | Site |
| 15 | Refunds pending | Customers | Site |
| **Money out to other people** | | | |
| 16 | Regular Tasker payouts sent | Taskers | Site (withdrawal and payout rows) |
| 17 | Local Tasker payouts sent | Local Taskers | Site |
| 18 | Coordinator commissions paid | Coordinators | Site |
| 19 | Customer refunds paid | Customers | Site (`job_refunds`) |
| 20 | Referral rewards paid | Referrers | Site (`referral_rewards`) |
| **Costs paid by the business** | | | |
| 21 | Paystack fees: collection fees, transfer fees, stamp duty | Platform cost | Accountant (from the Paystack statement) |
| 22 | Hosting, database, email, ID verification, domain and other services | Platform cost | Accountant |
| 23 | Marketing, tax, other | Platform cost | Accountant (categories in D-A24) |
| **Donations** | | | |
| 24 | Donations received for Local Taskers, and what was passed on | Kept apart | Site (`donations`) and Accountant |
| **Owner's capital** | | | |
| 25 | Capital put in (opening ₦200,000) | Owner's loan | Accountant |
| 26 | Capital repaid | Owner | Accountant, with approval |
| **Movements between accounts (neither income nor cost)** | | | |
| 27 | Paystack settlement paid into the bank | Same money moving | Accountant (amount, date, reference) |
| 28 | Top-up from bank to Paystack Balance | Same money moving | Accountant |
| 29 | Platform commission moved from the client money account to the operating account | Same money moving | Accountant |

Rule: customer and tasker money (rows 9 to 15) is never counted as income. Money is called the platform's income only for rows 5 to 8 and 4.

### 0.2 The dashboard (screen S14b, `admin/accountant.html`)

Top to bottom, each block with its own heading, the definition printed under every number, and a note saying "from site records" or "entered by the accountant":
1. **Top up needed now** (next cutoff, section 5): suggested amount, income total beside it, "Paystack Balance now" field, "I topped up" button.
2. **Cash position** (typed by him, with the date): client money bank account, operating bank account, Paystack Balance.
3. **Money in**: by rows 1 to 8, for today, this week, this month, a date range.
4. **Owed to others**: rows 9 to 15, with the total, and gift card balance outstanding as its own number.
5. **Paid out**: rows 16 to 20.
6. **Platform income and costs**: rows 4 to 8 minus rows 21 to 23. The result is called **Platform profit** and shows "Not available" for any month where a cost category has no entries yet.
7. **Local Taskers and coordinators**: a section that shows rows 6, 11, 12, 17 and 18 together.
8. **Settlements**: expected versus received (section 0.3).
9. **Capital**: ₦200,000 in, repaid, outstanding, "safe to take back" line (section 5).
10. **Ledger**: every entry he recorded, filter and export (`export.run`, logged).

### 0.3 The ledger and settlements

- One table `admin_money_ledger` for everything the Accountant records (settlement received, top-up, expense, capital in, capital repaid, commission moved, donation passed on). Columns: id, entry date, kind, category, direction, amount kobo, account (`bank_client`, `bank_operating`, `paystack_balance`, `owner`), source (`personal`, `settlement`), reference, note, recorded by, recorded at, approval id (capital repayments only). **Entries are never edited or deleted.** A mistake is fixed by a new reversing entry that points to the first.
- Settlements: he records each Paystack settlement (date, amount, Paystack reference). The page compares it with what the site expects (confirmed payments in that settlement window minus Paystack fees) and shows "matched", "difference" or "not yet received". The expected amount is an estimate and is labelled so.
- The opening ₦200,000 is the first ledger entry (`capital_in`, source `personal`), recorded by the Accountant and visible to Super Admins.
- Expense categories (default, D-A24): Paystack fees, Hosting and database, Email, ID verification, Domain, Marketing, Tax, Other. Each entry needs an amount, a date and a note; a receipt reference is optional.

### 0.4 Stage split (one stage per session)

- **A15b-1: Accountant role and read-only money dashboard.** Role and permissions (SQL insert, safe to run twice; assigned through the Team page and its approval), `a15b-introspect.sql` first (read-only, owner runs it and sends results), read functions over the existing money tables, `admin/accountant.html`. Shows rows 1 to 20 from site records. No new tables.
- **A15b-2: Daily batch and top-up.** `admin_topup_batches`, the 9 pm WAT close, the top-up recording, reminders by `notifications` (sections 1 to 10 below).
- **A15b-3: Ledger, settlements, expenses and capital.** `admin_money_ledger`, settlement matching, expense entry, capital in and repayment with approval, rows 21 to 29, profit.
- A15 (Transactions), A16 (Revenue), A17 (Payouts) and A21 (Gift cards) stay as read screens; the Accountant dashboard reuses their read functions instead of copying their queries.

### 0.5 Security and honesty rules for this role

- The Accountant cannot approve his own request, cannot repay capital without a different Super Admin's approval, and cannot edit a ledger entry.
- Every record function writes one ledger or batch row and one audit entry, and touches no wallet, escrow, payout or payment status.
- Nothing on the page says money moved unless a record says so. Typed balances show who typed them and when.
- Standard security tests for every function (`00-PLAN.md` section 7), plus the tests in section 7 and 7b below, plus: Accountant cannot open any non-money admin page; a user with only `accounting.view` cannot record; a capital repayment above the outstanding capital is refused; a repayment without an approved request is refused.


## 1. Why this exists (read first)

Customer payments settle from Paystack to the owner's bank the next business day. Paystack transfers (withdrawals and automatic payouts) do NOT draw from those payments. They draw from the **Paystack Balance**, which the owner tops up herself from her bank. If the balance is short, a payout fails or has to wait.

Rule already in the site: a payout only becomes due after the **24 hour clearing**. So the amount owed to taskers for the next 24 hours is known a day ahead. The owner decided (2026-11-10):

- Every day at **9:00 pm Nigeria time (WAT, UTC+1, no daylight saving; that is 20:00 UTC)** the site closes the day's batch of customer money.
- The batch total is shown on an admin page and emailed to the admin.
- The admin then **tops up the Paystack Balance by hand** (bank transfer or dashboard top-up) and records on the admin page that it was done.
- A payment confirmed after 9:00 pm belongs to the next day's batch.
- The same applies to gift card money.

This keeps rule 7 of `00-PLAN.md` intact: **no admin function calls Paystack.** The admin page only *shows* numbers and *records* what the human did.

## 2. What the owner proposed, and two corrections the build must apply

The owner's rule: top up the day's total customer income. That is a good habit and the page shows that number. Two things the page must also show, or it will mislead:

1. **Income is not the same as what is due.** A job paid on Monday may be released on Friday and paid out on Saturday. Tasker payouts that fall due tomorrow come from jobs released a day earlier, and those are already queued with a `release_after` time. So the exact amount the Paystack Balance needs by the next 9 pm is known: it is the sum of payouts whose due time falls before the next cutoff, minus what the balance already holds. Over weeks the two totals match; on a given day they do not. **Default: the suggested top-up is the amount due.** The income total is shown next to it for reconciliation. A setting switches the suggestion to the income total if the owner prefers (decision D-A19).
2. **Gross income includes the platform's own money.** The 12 percent commission, subscriptions and coordinator plan payments are the owner's own revenue and are never part of what taskers are owed. The page splits every day's money into lines (section 4).

## 3. Cutoff and batch rules

- Batch day: from 21:00 WAT yesterday (20:00 UTC) up to, not including, 21:00 WAT today. Store `window_start` and `window_end` as timestamptz. Never compute with local dates.
- A payment belongs to the batch that contains the moment the **server confirmed it paid** (the `payment_finalize` or webhook time), not the time the customer pressed Pay. A webhook that arrives after 9 pm moves the payment to the next batch.
- A closed batch never changes. Corrections (a refund after close, a late confirmation) appear as their own line in the next batch.
- Closing runs once a day from a scheduled job (owner step, SQL editor; same pattern as `apply_due_subscription_changes`). Closing twice is harmless (unique per batch day).
- Amounts are integer kobo everywhere. Show naira only on screen.

## 4. Lines in each batch

| Line | Meaning | Counts toward top-up? |
|---|---|---|
| Owed to taskers (new) | Tasker share of job payments confirmed in the window (`tasker_amount`) | Shown, see D-A19 |
| Platform money | Commission (`platform_fee`), subscriptions, coordinator plan payments, urgent fee | No: the owner's own revenue |
| Gift card sales | Gift card orders confirmed in the window | Per D-A20 (default: no, shown as "keep in client money account") |
| Donations | `donations` marked paid in the window | No: kept apart (donation handoff rule) |
| Refunds and reversals | Refunds recorded in the window | Reduce the next batch; how Paystack debits a refund is checked at build time |
| **Payouts due before the next cutoff** | Regular tasker earnings, Local Tasker payouts, coordinator commissions whose due time falls before the next cutoff | **Yes: the suggested top-up** |
| Gift-funded jobs | A booking paid by gift card has no new Paystack payment; its payout is still in "payouts due" | Covered by the line above |

## 5. The page (screen S14b) and who sees it

- Permissions: `accounting.view` (see the desk), `accounting.record` (press "I topped up"). Give both to `finance` and `super_admin`. Nobody else.
- Top card: today's open batch (running total, time left to 9 pm) and the last closed batch.
- Closed batch card: the lines above, the **suggested top-up**, a field "Paystack Balance now" (typed by the admin from the Paystack dashboard; nothing reads it automatically), and a field "Amount I topped up". Pressing "I topped up" writes the record. If the amount differs from the suggestion, a reason of at least 10 characters is required.
- A red strip: "Awaiting funds" count (payouts due but not sent because the balance was short). This is empty until stage M1 exists.
- **Source of each top-up (owner decision 2026-11-10):** the first top-ups come from the owner's personal money; later ones come from earlier Paystack settlements held in the client money account. The record form has a required choice `source`: `personal` or `settlement`. Optional note for anything else.
- **Owner-funded float:** a running figure = personal money put in, minus personal money taken back. The page shows it, and shows "safe to take back" as a typed-in line: cash held (client money bank balance + Paystack Balance, both typed by the admin) minus total owed (tasker earnings not yet paid + gift card balances outstanding). Taking personal money back is never done through the site; the admin only records it with a reason of 10+ characters. The page refuses to call anything safe if the owed figure is unavailable.
- A history table: batch date, money in by line, suggested, topped up, difference, who recorded it, when.
- A running position: total recorded top-ups minus total payouts sent, so the owner sees at a glance whether the float is drifting.
- Email and in-app: at 9:05 pm WAT after closing, and again at 8:00 am WAT if the batch is still not recorded, and a third "urgent" at 12:00 noon WAT. Use the existing `notifications` table (every row is already emailed; no new Edge Function), sent to every active admin with `accounting.view`. Wording: the amount, the batch window, and "Top up Paystack, then record it here." Never include a link that moves money.

## 6. Database (proposed names; A15b confirms against `a15b-introspect.sql`)

- Table `admin_topup_batches`: `batch_date date unique`, `window_start`, `window_end`, `closed_at`, per-line kobo totals, `due_kobo`, `suggested_kobo`, `status` (`open`, `closed`, `recorded`, `skipped`), `topped_up_kobo`, `balance_before_kobo`, `balance_after_kobo`, `source` (`personal`, `settlement`), `note`, `recorded_by`, `recorded_at`. RLS on, no grants to `anon` or `authenticated`.
- Functions (security definer, `admin_guard(...)`): `admin_topup_current()`, `admin_topup_list(p_limit, p_offset)`, `admin_topup_record(p_batch, p_amount_kobo, p_balance_after_kobo, p_note)`, internal `_topup_close_batch()` for the scheduled job, internal `_topup_notify(batch)`.
- `admin_topup_takeback(p_amount_kobo, p_reason)` records money the owner takes back (permission `accounting.record`, reason of 10+ characters, never above the owner-funded float). Records only; moves nothing.
- `admin_topup_record` writes one row and one audit entry. It does not touch wallets, escrow, payouts or any payment status.
- Settings (in the existing settings table or a new `admin_topup_settings`): `topup_mode` (`due` or `income`), `topup_include_gift_sales` (true or false), `topup_buffer_kobo` (extra float; default 0), `topup_cutoff_utc_hour` (20).
- Read sources the build must inspect first (the real shapes are not in the files supplied so far): `payment_intents` (purpose, status, `platform_fee`, `tasker_amount`, confirmed time), `gift_card_orders`, `donations`, the Local Tasker payout rows (`release_after`, status), the regular withdrawal clearing functions (`withdrawal_clearing_mine` and friends; their SQL was not in the zip), `job_refunds`. If a source cannot be proven, show "Not available" and say why.

## 7. Tests the stage must run (plus the standard security set in `00-PLAN.md` section 7)

- Cutoff boundary: confirmed at 19:59:59 UTC is in today's batch; at 20:00:00 UTC is in tomorrow's.
- A webhook arriving after the cutoff for a payment made before it lands in the next batch.
- Closing twice produces one batch. A closed batch cannot be edited.
- A gift-funded booking adds nothing to money in and does add to payouts due.
- Platform money never appears in the suggested top-up.
- Refund after close appears in the next batch.
- Recording with a different amount and no reason is refused; a user without `accounting.record` is refused and the refusal is logged.
- Integer kobo math; no rounding drift across a week.

## 7b. Extra tests for the personal-money float

- Recording without a `source` is refused.
- Owner-funded float never goes negative; a take-back above it is refused.
- Settlement-sourced top-ups never change the owner-funded float.
- "Safe to take back" shows nothing when the owed figure cannot be computed.

## 8. Known limits to print on the page

- A Paystack settlement is customer and tasker money until the job is released and cleared. Only the platform commission is the owner's. The page says this next to the "safe to take back" line. Tell the accountant that personal money put in is a loan to the business.
- The page shows what the site's own records say. It cannot see the real Paystack Balance or the bank balance.
- The cash for a day's customer payments reaches the bank the next business day (later over weekends and holidays). The owner needs a standing buffer in the client money account so a 9 pm top-up never waits for settlement.
- The page does not make money safe by itself. It gives the owner a daily routine and an alarm if she forgets.

## 9. Stage M1 (website, NOT admin): earnings and automatic payout

The desk is only half the picture. These are changes to the public site and payment functions, so they need the owner's explicit "go" (rule 9 in `00-PLAN.md` says payment Edge Functions are not edited; M1 is the named exception if she approves).

1. Tasker "wallet" becomes "Earnings". Earnings show amount, job, and the time the 24 hour clearing ends. Nothing is kept on the site after payout.
2. When clearing ends, a sender runs every 5 minutes (as the Local Tasker sender does) and pays the tasker's saved bank account. One idempotent reference per payout, so a repeat never pays twice.
3. **Before each transfer, check the Paystack Balance.** If it is short, mark the payout `awaiting_funds`, tell nobody the payout failed, notify the admins, and retry on the next run. This is what protects taskers if the daily top-up is late or too small.
4. A verified bank account is required before earnings can be paid. Check the account name against the profile name. No bank account: earnings wait with a clear message.
5. Pause a payout while a dispute is open on its job. Pay out nothing twice.
6. Existing wallet balances are paid out first. Coordinator commissions, referral rewards and refunds need their own decision (they use the wallet today).
7. Each transfer has a Paystack fee and stamp duty on larger amounts: decide who bears it, and consider one payout per tasker per day.
8. Gift cards stay customer only (see D-A20 and D-A22): a gift card balance can pay a booking, never be cashed out.

## 10. Order of work

1. Owner answers D-A18 to D-A22 (defaults apply if she says "ok").
2. A15b can be built any time after A15 or earlier if she wants it first; it only reads.
3. M1 after her "go".
4. Both need the owner to run the one-off Paystack test in the chat history (pay a small amount, try a transfer before it settles) and report what the Paystack dashboard shows for settlement destination and balance history. Her answer decides how much protection M1 step 3 needs.

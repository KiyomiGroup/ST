# Local Tasker: decisions log

Source of truth for decisions. Every later stage reads this. Dated 2026-10-22 (Stage 1C). "Owner" answers are the owner's own words in chat; "Default" means the owner did not answer and a safe default is used until they change it.

## Owner answers (Stage 1C)
| Item | Decision | Status |
|---|---|---|
| O1 Paystack Transfers | Treat Transfers as ENABLED. The owner says it is enabled but has pending issues they are fixing separately. Stages 7B/7C build the Local Tasker payout assuming Transfers works, run in Paystack TEST mode only, never enable live payouts without the owner, and document any failure as a blocker rather than faking success. Do not ask O1 again. | Owner answered |
| O2 Staging | There is NO second Supabase project and none will be created. All SQL runs directly on the one project. The owner later confirmed (same day) that there are NO real users yet and that NO backup, test copy or dry-run is needed; do not ask for or suggest them again. SQL is still written additive and re-runnable with a rollback file, and is never described as applied until the owner confirms. | Owner answered |
| O3 Verification storage | Not answered. Default: a coordinator verification record in the private `local_tasker_profiles` row (method, date, coordinator, notes) plus an audit row. NOT the existing `verifications` table (it is owner-writable, requires a user login, stores `id_number` in plain text, and has role CHECK customer/tasker). | Default |
| O4 Badge wording | The badge shows "Local Tasker" and "Phone Assisted". Both labels appear together. Must not imply lower skill. | Owner answered |
| O5 Contact details | The coordinator collects the Local Tasker's phone number when registering them and sees it on the Local Tasker's profile (private table, never public, never shown to customers). For customers, default: the coordinator sees the customer's name and phone only for bookings assigned to them, nothing for others. | Tasker phone: owner answered. Customer contact: Default |

## Settled design S1-S6 checked against the real code
| | Result | Evidence and caveats |
|---|---|---|
| S1 Coordinator is the human bridge | Confirmed, feasible | Needs new coordinator-scoped functions and tables; nothing existing gives a third party access. |
| S2 No login | Confirmed, feasible | `bookings`, `escrow_payments`, `payment_requests`, `notifications`, `wallets` reference `auth.users`; `message_threads`/`messages` reference `public.users`. A placeholder `auth.users` row is required (Stage 2D). Whether Supabase admin API can create an unusable, banned or passwordless user is UNVERIFIED; 2D must prove it. |
| S3 Recorded tasker approval | Confirmed | `job_mark_done`, `job_progress`, `job_work_update`, `price_propose` are tasker-only; coordinator-recorded equivalents are new functions writing a structured confirmation record. |
| S4 Release code via coordinator | Confirmed, needs a new function | Code is stored in `booking_secrets` and readable only by the customer (`get_completion_code`). `job_submit_code` is tasker-only. A new `coordinator_submit_code` must check assignment, consent, dispute freeze and attempts, then call the release. The code is never returned to the coordinator. |
| S5 No wallet, 0% fee, direct payout | **PARTLY SUPERSEDED 2026-11-01 (C1, C2): the 0% fee is cancelled; the Local Tasker still has no wallet and is paid directly.** Original text: Confirmed, but CONFLICTS with current code until branched | `_apply_payment`, `_release_escrow` and `_settle_after_dispute` all create or credit a wallet; `platform_fee_rate()` is a constant 12% without arguments; `gift-card-pay` has its own 12%. Each needs a Local Tasker branch (Stages 7A/7C). |
| S6 Cap of 10 | **SUPERSEDED 2026-11-01 (C4): the cap is now per coordinator and comes from a tier; 10 is only tier 1.** Original: Confirmed, feasible | Trigger that locks the coordinator row; cap read from one settings row. |

## Technical decisions (made by the AI from evidence; owner may overrule)
| ID | Decision | Reason |
|---|---|---|
| D1 | Coordinator authority = a new `coordinators` table checked by a SECURITY DEFINER function. NOT `users.role`, NOT `user_metadata.role`. | Both are writable by the signed-in user (`auth_own_users` ALL policy; metadata is user-editable). `support_staff` + `_is_support()` already prove the pattern. |
| D2 | Local Taskers keep `users.role = 'tasker'`. The Local Tasker classification lives ONLY in `local_tasker_profiles` (and the coordinator assignment). | Existing tasker code and the `services: insert` policy need role `tasker`; no client-writable column may decide the badge or 0% fee. |
| D3 | All private Local Tasker data (phone, consent, verification, notes, payout) lives in new RLS-protected tables, never in `users`, `taskers`, `services` or `profile_details`. | Those tables are readable by anyone with the anon key. |
| D4 | Hide unpublished Local Taskers with RESTRICTIVE SELECT policies on `users`, `taskers`, `services` (and any Local Tasker rows elsewhere), leaving regular taskers unchanged. | Existing permissive `true` policies are OR-ed; they cannot be tightened without breaking regular taskers. |
| D5 | Block Local Taskers from `task_applications` with a BEFORE INSERT trigger. | Three overlapping permissive INSERT policies exist. |
| D6 | Local Tasker booking state lives in a side table keyed by `booking_id` (not new columns on `bookings`), written only by SECURITY DEFINER functions; audit via `job_events`. | `bookings` has many guard triggers and customer/tasker policies; a side table avoids touching them. Server functions bypass the guards by design (`current_user` check). |
| D7 | Coordinator chat access uses NEW membership functions and policies. The existing `is_thread_party`, `_is_thread_member`, `open_thread`, `job_money_snapshot` stay untouched. | They are used by existing RLS; loosening them would change regular chats. |
| D8 | **AMENDED 2026-11-01 (C1): the function stays as the single trusted place, but it now returns 12% for Local Taskers too.** Original: Fee: add a per-tasker/per-booking rate function and call it from `_prepare_intent`, the `_release_escrow` fallback and `gift-card-pay`. `platform_fee_rate()` itself stays 12%. | It is IMMUTABLE with no arguments; regular taskers must stay at 12%. |
| D9 | Local Tasker payout = new tables and a new `local-payout` Edge Function; never `process-withdrawal`. The webhook gets `transfer.*` handling with signature check and idempotency. | `process-withdrawal` has no idempotency and is being reworked; the webhook currently ignores `transfer.*`. |
| D10 | **SUPERSEDED 2026-11-01 (C4): capacity comes from the coordinator's tier (see tier table).** Original: The cap value (10) is stored in one settings row, not hard-coded in several places. | Settled design S6, "one config place". |
| D11 | Nothing about the "1%" is money; wording only. | Owner brief. |

## Stage 2A decisions (2026-10-22)
| ID | Decision | Reason |
|---|---|---|
| D12 | The four Stage 2A tables are created with RLS enabled, NO policies and no anon/authenticated privileges (deny-all) until Stage 2B. | New public tables are otherwise open to anyone with the anon key. Deviates from "no RLS in 2A" on purpose. |
| D13 | A new active assignment is refused unless the coordinator is `active`. | Suspended or deactivated coordinators must not receive Local Taskers. Owner may remove. |
| D14 | Assignment history is append-only (end, never edit or delete); `previous_coordinator_id` records reassignments. | Settled design S6: history is never deleted. |

## Stage 2B decisions (2026-10-22)
| ID | Decision | Reason |
|---|---|---|
| D15 | Client roles get SELECT only on the Local Tasker tables; there is no insert/update/delete policy or grant for anyone but server code. | Coordinators act only through SECURITY DEFINER functions, so every change is validated and audited. |
| D16 | Audit log and consent records are append-only even for the table owner (triggers), consents can be withdrawn once. | History must not be editable, even from the SQL editor. |
| D17 | Helper variants that take a user id are server-only; no-argument variants answer about the caller. | Prevents anyone probing who is a coordinator. |
| D18 | Audit rows are written only by `local_tasker_audit()`, which redacts account numbers, codes, tokens and ID numbers. | Settled safety rule: no raw account numbers or codes in audit JSON. |

## Stage 2C decisions (2026-10-22)
| ID | Decision | Reason |
|---|---|---|
| D19 | One function `local_tasker_row_visible(text)` decides whether a user's row may be shown; three RESTRICTIVE SELECT policies on `users`, `taskers`, `services` call it. Rule: not a Local Tasker => visible (regular rows unchanged); published => visible; unpublished => only the managing active coordinator, admin/support, and a customer who has a booking with that Local Tasker. | Permissive `true` policies are OR-ed and cannot be tightened (D4); one function keeps the rule in one place. |
| D20 | Coordinators get NO direct SELECT on `bookings`, `booking_secrets`, `wallets`, `message_threads`, `messages` in 2C. Booking data for coordinators comes later from SECURITY DEFINER functions that return only safe columns (5A/5B); chat access is 6A (D7). | `bookings` has a `completion_code` column (live schema) and RLS cannot hide a column; the body of trigger `bookings_hide_code` is unverified, so a direct coordinator read could expose the release code (settled design S4). Wallets do not exist for Local Taskers. Owner may overrule. |
| D21 | Coordinator READ-ONLY policies on `escrow_payments` (via `coordinator_manages_booking`), `payment_requests` (via `coordinator_manages_tasker(tasker_id)`) and `job_events` (via `coordinator_manages_booking`). A suspended coordinator sees none. | Coordinators must see money status and the event trail of their own taskers' bookings, nothing else. |
| D22 | Local Taskers are blocked from `task_applications` by a BEFORE INSERT OR UPDATE OF tasker_id trigger (`local_tasker_block_applications`), not a policy. | Three overlapping permissive INSERT policies exist (D5). Trigger also covers service-role inserts. |
| D23 | 2C changes no existing policy and revokes no grant. Existing public exposure is recorded, not fixed (see observations). | Regular tasker/customer behaviour must not change. |

## Stage 2D decisions (2026-10-22)
| ID | Decision | Reason |
|---|---|---|
| D24 | Placeholder identity = Auth admin `createUser` with email `lt-<request_id>@local-tasker.invalid`, NO password, `email_confirm: true`, `ban_duration: 876000h` (about 100 years), `app_metadata`/`user_metadata` = `{local_tasker: true}` and NO `role` in metadata. The Edge Function re-applies the ban with `updateUserById` after create and verifies it. `create_local_tasker` itself REFUSES an identity that is not banned 10+ years or has another email (it does NOT require an empty password hash: first owner run showed the lock check failed on a freshly created user, cause unseen; the ban is what blocks login). | Settled design S2/T2. The database check means even a buggy Edge Function cannot attach a loginable account. `auth.js` trusts `user_metadata.role`, so none is set. UNVERIFIED until the owner runs the sign-in attempts (handoff section 16). |
| D25 | Idempotency = table `local_tasker_create_requests` keyed by a client-generated `request_id` (uuid, one per form, reused on retry), written in the same transaction as the rest. The placeholder email is derived from it, so an identity left by a crash is re-used, not duplicated. | Retry must not create a second identity. |
| D26 | `create_local_tasker`, `local_tasker_find_request`, `local_tasker_identity_email` and the ledger are SERVER ONLY (service_role). Coordinators call only the Edge Function. | D15/D17: no client write path. |
| D27 | A Local Tasker has a PUBLIC name (`users.name`, `taskers.name`, chosen by the coordinator) separate from the private `full_name`. `taskers.available=false` at creation; NO `services` row (4B); `taskers.created_at` is set as an ISO text string (format guessed, column is text). Phone only in `local_tasker_profiles.phone`. | D3; public on publish. |
| D28 | A Local Tasker created by mistake is RETIRED (assignment ended, profile `inactive`, `taskers.available=false`, identity stays banned), never deleted. | Consents and audit are append-only and reference the identity with RESTRICT; later bookings/escrow will too (S6). Procedure in `stage-2d-rollback.sql` Part B. |
| D29 | A consent record (purpose `profile`, method in_person/phone/written) is REQUIRED at creation and written in the same transaction, with 2 audit rows (`local_tasker_created`, `consent_recorded`). Audit JSON holds no phone or full name. | Settled design S2/S3, brief Part 12. |


## OWNER PROCESS CHANGE (2026-11-01). These OVERRIDE the settled designs and decisions above where they conflict.
Source: the owner's message of 2026-11-01. "Owner" = stated by the owner. "Default" = the owner did not say; the AI chose the safest reading and the owner may overrule (listed again in PROCESS-CHANGE-2026-11-01.md, "Questions").

| ID | Decision | Status |
|---|---|---|
| C1 | Local Tasker bookings pay the SAME 12% platform fee as regular bookings. The 0% exemption (S5, D8 as written, Stage 7A as written) is cancelled. The customer's bill does not change: no new fee line for anyone. | Owner |
| C2 | The 12% is split: 5 percentage points of the booking amount go to the managing coordinator's WALLET, 7 percentage points go to the platform. The Local Tasker nets 88%, exactly like a regular tasker. Rounding: coordinator share = round(amount x 0.05, 2 decimals); platform share = fee minus coordinator share, so the parts always add up exactly. Example, a 50,000 naira booking: fee 6,000; coordinator 2,500; platform 3,500; Local Tasker 44,000. | Owner (rounding rule is Default) |
| C3 | Coordinators have a wallet. | Owner |
| C4 | Coordinator TIERS. The tier decides how many ACTIVE Local Taskers a coordinator may have. Tier 1 is free (10 Local Taskers). A coordinator cannot skip a tier: tier N+1 is available only after tier N. No tier is ever skipped, so every coordinator pays every step. See the tier table below. | Owner (schedule as given) |
| C5 | Local Taskers still have NO wallet. They are paid directly by bank transfer to the verified account (Stage 7B stands unchanged). | Default (owner did not change it) |
| C6 | Each upgrade costs the amount listed for THAT step (not a running total). Reaching tier 3 therefore costs 50,000 + 100,000 = 150,000 in total. | Owner accepted the default (2026-11-01) |
| C7 | An upgrade is paid online through Paystack. The tier changes only after the server has verified the payment with Paystack; it is never changed from the browser. It is not paid from the wallet. | Owner accepted the default (2026-11-01) |
| C8 | Capacity counts ACTIVE assignments only (as today), so ending an assignment frees a place. No downgrades, no refunds of upgrade payments. Existing coordinators start at tier 1. A coordinator already over capacity keeps what they have but cannot add more. | Default |
| C9 | The coordinator share is credited at RELEASE of the escrow (not at payment), to the coordinator who manages the booking at the moment of release. A refund before release means no share. A dispute settlement adjusts the share in proportion to the amount actually released. One share per booking, enforced by a unique constraint. The fee base is exactly the same as for regular bookings (whatever the existing release code uses). | Owner accepted the defaults (Q3, Q6) |
| C10 | REPLACED by the owner (2026-11-01): the coordinator uses the EXISTING tasker wallet system, with the same settings as a normal tasker: the `wallets` row (`balance`), `wallet_transactions`, the saved bank accounts with their bank list and automatic Paystack name confirmation (`withdrawal_bank_accounts`, `bank_account_add`), `withdrawal_limits()` (minimum and maximum), `withdrawal_fee()`, `withdrawal_create` and the tasker wallet page. The 5% is ADDED to the coordinator's `wallets.balance` when the escrow is released. No new wallet ledger, no new withdrawal function, no coordinator-specific bank rule. Two facts make this more than a copy (found in the repo): (a) the new withdrawal SQL (`sql/withdrawals/w2b-create.sql`, `w2d-accounts.sql`) refuses anyone who is not in the `taskers` table (errors WD001 and WA001), and the wallet page shows the customer view to anyone whose role is not `tasker`; both need a small, tested change to also accept an ACTIVE coordinator (one helper `is_wallet_owner(uuid)`); a coordinator must NOT be given a `taskers` row because that would put them on the marketplace. (b) the Edge Function `process-withdrawal` in the repo is still the old one with the known flaws; the owner is reworking the withdrawals (W stages). Coordinator withdrawals therefore wait for the owner's W stages to be working in TEST mode, and this project never calls or edits the old function. | Owner |
| C11 | REPLACED by the owner (2026-11-01): Local Taskers are treated like normal taskers; they simply have coordinators. REMOVE the fee wording entirely, replacing it with nothing: (1) `local-taskers.html`: the whole benefit card headed "No platform fees for Local Taskers" (heading, paragraph and the "100% Retained Revenue" link) and the stat card "100% Income Earned, Direct to Taskers"; (2) `coordinator-booking.html`: the sentence "The Local Tasker pays no commission, so there is no fee line."; (3) any 4C-2 note or other page found by a code search for "platform fee", "no commission", "100%", "retained revenue". Check the page layouts at 1440 and 390 after the removal. The card "Equal pay for equal work" mentions "without arbitrary deductions": left as is, but the owner should read it once. | Owner |
| C13 | Administrators can NOT give a coordinator a tier without payment. No such function is built. | Owner (Q5: No) |
| C14 | The owner believes the Stage 7A SQL was already run in the real project (status said "not applied"). Stage 7A-R begins by reading the real state with `sql/local-tasker/stage-7-replan-introspect.sql` and includes the undo. Until that is read, treat 7A as POSSIBLY APPLIED: Local Taskers may currently be charged 0%. | Owner (belief, unverified) |
| C12 | The earlier "1%" wording stays non-monetary (D11). | Unchanged |

### Tier table (C4)
Capacity: tiers 1 to 3 are 10, 20, 30. From tier 4 it is 35 and grows by 5 each tier (capacity = 5 x tier + 15 for tier 4 and above). Upgrade price to reach a tier: 50,000 x (tier - 1) naira. Tier 1 costs nothing.

| Tier | Active Local Taskers allowed | Price to reach it (step) | Total paid so far (C6) |
|---|---|---|---|
| 1 | 10 | free | 0 |
| 2 | 20 | 50,000 | 50,000 |
| 3 | 30 | 100,000 | 150,000 |
| 4 | 35 | 150,000 | 300,000 |
| 5 | 40 | 200,000 | 500,000 |
| 6 | 45 | 250,000 | 750,000 |
| 7 | 50 | 300,000 | 1,050,000 |
| 8 | 55 | 350,000 | 1,400,000 |
The schedule is computed by ONE database function, `coordinator_tier_terms(tier)`, never copied into pages. Amounts are in naira and stored in kobo.

### What these changes break (found in the code, each fixed by a named stage; updated 2026-11-01)
- Stage 7A SQL (`stage-7a-core.sql`, `stage-7a2-core.sql`) returns 0% for Local Taskers. The status said NOT applied, but the owner thinks it was applied (C14). Do NOT apply it again; Stage 7A-R reads the real state first and includes the undo.
- `gift-card-pay` and the customer Bookings page were changed in 7A to use the 0% rate; 7A-R reverts that.
- `js/coordinator-common.js` has `CAP = 10`; `js/coordinator-tasker-new.js` shows a "maximum of 10" message; the Edge Function `local-tasker-create` and the database cap check (Stage 2A trigger, read from one settings row) enforce 10. Stage 7G replaces all of these with the coordinator's tier. The real body of the 2A cap trigger and of `create_local_tasker` are needed by 7G (an introspect query is part of 7G).
- `_release_escrow`, `_settle_after_dispute` (patched in 7A part 2) get the 5% coordinator credit in 7E, and the Local Tasker payout branch in 7C.
- Customer-facing and coordinator-facing wording: removed entirely (C11, in Stage 7A-R).
- The new withdrawal SQL and the wallet page accept only taskers (C10); patched in Stage 7F.

## Observations outside scope (recorded, not acted on)
- `login.html` (line ~256) upserts `email` into `users`, but `users` has no `email` column in the live schema. That call may fail; verify before relying on it. Not part of Local Tasker work.
- `verifications.id_number` holds government ID numbers in plain text; `users` and `taskers` expose dob, whatsapp and phone publicly. Security stage 9A and Stage 2C.
- (Stage 2C, from the live policy/grant dump) `anon` holds full DML grants on `bookings`, `messages`, `message_threads`, `payment_requests`, `services`, `tasks`, `task_applications` (RLS is the only guard), yet has NO select grant on `users` and `taskers` even though anon read policies exist on them. `bookings.completion_code` exists as a column. Nothing was changed; for Stage 9A.
- (Stage 2C) Publishing a Local Tasker makes its `users`, `taskers` and `services` rows readable by everyone, including `taskers.phone`, `taskers.whatsapp`, `users.whatsapp`, `dob`. Stages 2D/4A must leave those columns empty for Local Taskers and keep the real phone only in `local_tasker_profiles` (D3).
- (Stage 2C) Tables NOT inspected, so not covered by 2C: `tasker_profiles`, `reviews`, `verifications`, `job_requests`, `job_attachments`, `notifications`, `subscriptions`, `wallet_transactions`. Stage 2D must not put Local Tasker private data in them; 9A should review them.
- (Stage 2C) A customer can currently INSERT a booking for any tasker uuid (policy `bookings: insert` only checks customer_id), including an unpublished Local Tasker. Stage 5A must block bookings for non-published Local Taskers.

- (Stage 2D) A Local Tasker's `users`/`taskers` rows are created by 2D with `role='tasker'`. Any later UI that lists taskers must keep relying on the 2C restrictive policies to hide drafts.
- (2026-11-01) Saving a withdrawal bank account (W2d `bank_account_add`) stores the name Paystack confirms but does NOT compare it with the person's registered name, so a tasker (and, under C10, a coordinator) can save an account that belongs to someone else. The owner chose to follow the tasker rules for coordinators. Local Tasker PAYOUT accounts (Stage 7B) are stricter by design and stay so. For 9A.
- (Stage 2D) The Edge Function has no rate limit. An active coordinator can create identities only up to the cap of 10 active assignments, but failed attempts are not throttled. For 9A.

## Owner decisions added 2026-11-02 (Stage 7I)
| # | Decision | Source |
|---|---|---|
| D-7I-1 | Paystack keys stay LIVE. `PAYSTACK_SECRET_KEY` is a live key and `js/payments.js` holds the live public key. The first coordinator upgrade payment will charge real money. The earlier "TEST mode only" rule in the 7H and 7I briefs is overruled by the owner for this reason. Nothing was ever tested against Paystack by an AI. | Owner |
| D-7I-2 | There ARE real users now. The earlier O2 ("one Supabase project and no real users, no backup or test copy required") no longer holds. SQL that touches money (`_release_escrow`, payments, wallets: stages 7C, 7E) needs a backup or a test copy first, or at least an explicit owner "go" after reading the SQL. | Owner statement, recorded by the AI |
| D-7I-3 | No reference screens were supplied for `coordinator-plan.html`; the owner asked the AI to build it from the other coordinator screens and the design system. | Owner |

## Decisions made in Stage 7F (2026-11-02), all overrulable by the owner
| # | Decision | Reason |
|---|---|---|
| D-7F-1 | The database patch edits the five functions AS THEY ARE LIVE (reads the definition, replaces only the taskers-only line, all or nothing) instead of re-creating them from `w2b-create.sql` / `w2d-accounts.sql`. | The site already uses a later "clearing" rule (CR-2: `withdrawal_clearing_mine`, `still_clearing`) whose SQL was not supplied; re-creating `withdrawal_create` from the old file could silently drop that rule on a live money path. |
| D-7F-2 | The 7F Edge Function is delivered at `docs/local-tasker/7f/process-withdrawal.index.ts`, NOT over `supabase/functions/process-withdrawal/index.ts`. | The brief forbids editing the old live function; the repo still holds the old one; the W stages (W7b) install the new one. W7b must deploy the 7F file instead of the W7a file. |
| D-7F-3 | The Edge check asks the database helper by name; if the helper does not exist yet (42883 / PGRST202) it falls back to the old taskers-only check; any other error is a generic failure (never an allow). | Deploying the function before the SQL must not lock real taskers out; a coordinator is simply refused until the SQL is run. |
| D-7F-4 | The wallet page asks `is_active_coordinator()` only for people whose role is not `tasker`; only the exact answer `true` counts; errors give the customer view. A coordinator is shown the tasker-style wallet (`data-role="tasker"`, plus `data-wallet-owner="coordinator"`). | Role comes from the session and the database, never the URL (brief). The server re-checks on every bank-account and withdrawal call. |
| D-7F-5 | A coordinator on `wallet.html` gets a "way back" link to `coordinator-dashboard.html` (desktop: a hero button; phone: a text link under the SafePay note). | The main site navbar has no coordinator links. |
| D-7F-6 | The coordinator Overview shows the raw `wallets.balance` (one read of the own row, never creates a wallet); the wallet page shows available vs clearing. | Brief: "an Overview tile showing the balance (read through the existing wallet read)". |
| D-7F-7 | The phone bottom bar (4 icons) is unchanged; Wallet is in the top menu, the drawer and the Overview panel. | Adding a 5th icon would change a layout the owner did not ask to change. |


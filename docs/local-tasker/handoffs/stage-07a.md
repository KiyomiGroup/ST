# Stage 7A handoff: Local Tasker commission exemption (PART 1 WRITTEN, NOT APPLIED; PART 2 BLOCKED on one item)

## OWNER STANDING INSTRUCTIONS (unchanged)
Same rules as `handoffs/stage-06b.md`: SQL editor and dashboard deploys only (no console, no curl); deliver changed files only; never claim a test passed, SQL applied or a payment worked unless it really happened; no secrets in the browser; design system respected.

## 1. Stage number and title
Stage 7A: Local Tasker commission exemption (0% fee for Local Taskers, 12% unchanged for everyone else).

## 2. Objectives
Exempt Local Tasker bookings from the 12% fee in the single trusted place (the database), show the right figure to customers, and leave regular taskers untouched.

## 3. Initial assumptions and relevant existing architecture
- The fee is DECIDED in SQL: `platform_fee_rate()` (`select 0.12::numeric`, per the Stage 1C note) is called by `_prepare_intent` (fee stored on `payment_intents`) and by `_release_escrow` (fallback). `_apply_payment` (real body in `messaging-step15.sql`) copies `platform_fee` and `tasker_amount` from the intent into `escrow_payments`; it does not compute a fee.
- `gift-card-pay` is the one place that computes the fee itself (constant 0.12) and writes `payments` and `escrow_payments` directly.
- **NOT IN THE UPLOAD (so not seen by this session):** `DECISIONS.md`, `00-PROJECT-CONTEXT.md`, `architecture/money-and-chat-map.md`, `payments-core.ts`, and the real bodies of `platform_fee_rate`, `_prepare_intent`, `_release_escrow`, `_settle_after_dispute`, and the gift-card SQL functions (`gift_request_settle` etc.). D8 and the 0.12 fact come from the Stage 1C note inside the stage file, not from source I read.
- Because a `CREATE OR REPLACE FUNCTION` needs the whole body, I did NOT rewrite `_prepare_intent` or `_release_escrow` from memory. That is Part 2.

## 4. Files inspected
`stage-07a.md/07b/07c/07d` stage files, `supabase/functions/gift-card-pay` (the attached source, whole), `js/payments.js`, `js/customer-bookings.js`, `js/bookings.js`, `js/make-offer.js`, `js/tasker-overview.js`, `js/edit-profile-tasker.js`, `dashboard-customer.html` (fee line only), `sql/messaging-step15.sql` (real `_apply_payment`, `job_money_snapshot`), `stage-4c1-core.sql` (how a Local Tasker is identified), `stage-6b-*` (test conventions), `stage-3a-introspect.csv` (columns of `local_tasker_profiles`), `stage-5d3c-introspect.sql` (introspect pattern), `CLAUDE.md`, `IMPLEMENTATION-STATUS.md`, the 6B handoff.

## 5. Files created or modified
NEW: `sql/local-tasker/stage-7a-core.sql`, `stage-7a-rollback.sql`, `stage-7a-tests.sql`, `stage-7a-introspect.sql`; `docs/local-tasker/tests/stage-7a/` (`scratch-scaffold.sql`, `run-scratch.sh`, `test-gift-card-pay.mjs`, `test-customer-bookings-fee.mjs`); this handoff.
MODIFIED: `supabase/functions/gift-card-pay/index.ts` (minimal diff below), `js/customer-bookings.js` (minimal diff below), `docs/local-tasker/IMPLEMENTATION-STATUS.md`.
NOT modified: `platform_fee_rate()`, `_prepare_intent`, `_release_escrow`, `_apply_payment`, `payments.js`, any wallet, escrow, payout or Job Room function, any regular tasker screen.

## 6. Database objects
New functions only (no table, column, policy or trigger changed):
- `is_local_tasker_user(uuid)`: true when a `local_tasker_profiles` row exists for that user (ANY status). Definer. Execute: service_role only.
- `platform_fee_rate_for_tasker(uuid)`: `0` for a Local Tasker, otherwise `platform_fee_rate()`. Null or unknown id gets the normal rate. Definer. Execute: service_role only (the browser cannot ask "is this person a Local Tasker").
- `booking_fee_rates(uuid[])`: returns `(tasker_id, fee_rate)` ONLY for taskers the signed-in customer has a booking with (max 100 ids). Execute: authenticated and service_role, not anon.
Rollback: `stage-7a-rollback.sql` drops the three functions.

## 7. Reused
`local_tasker_profiles`, `platform_fee_rate()`, the 6B test helper pattern (`st_try`, self-rolling-back test), `window.supabase.rpc`, `ST.payments.calculateAmounts` (still the fallback for the display).

## 8. New functionality
- One database answer for the fee rate per tasker (D8).
- `gift-card-pay` asks that answer in `loadBooking`, BEFORE any gift card hold or Paystack check, and refuses with 500 `lookup_failed` (nothing written, no hold) if the answer is missing, null, negative or 1 or more. Payments and escrow rows, and the tasker's notice ("after 12% fee" / "no fee"), use it.
- Customer Bookings page: "Provider Receives" shows 100% of the price for a Local Tasker.
- Customer total is unchanged everywhere: no fee line was added or removed from what the customer pays.

### Diffs (whole story; everything else in both files is unchanged)
`gift-card-pay/index.ts` (CRLF line endings kept): line 13 constant replaced by a comment; `loadBooking` adds the `platform_fee_rate_for_tasker` call and returns `feeRate`; `confirmBooking(…, feeRate)` uses `price * feeRate` and a notice that says "no fee" when the fee is 0; `captureAndConfirm(…, feeRate)`; the `pay` and `finish` branches pass `feeRate` through. 32 changed lines.
`customer-bookings.js`: new `loadFeeRates(ids)`; `payout(amount, rate)` uses a valid server rate, else the old path; `fetchAll` loads rates and stores `feeRate` on each card; `figures()` passes it. 4 touch points.

## 9. Decisions (owner may overrule)
- **D-7A-1:** "Local Tasker" for the fee = has a `local_tasker_profiles` row, any status. D8 said "published or active". A published-only rule would flip a held booking from 0% to 12% if the person were unpublished or retired between payment and release. Regular taskers never get such a row (only `create_local_tasker` makes them). Change `is_local_tasker_user` if you want the narrower rule.
- **D-7A-2:** `gift-card-pay` FAILS CLOSED: if the rate cannot be read it stops before any money moves. Cost: if the function is deployed before `stage-7a-core.sql`, gift card payments fail until the SQL is run (hence the order in section 16).
- **D-7A-3:** the browser cannot call the fee function directly; the Bookings page uses `booking_fee_rates`, limited to taskers the customer booked.
- **D-7A-4:** tasker-side mirrors (`make-offer.js`, `bookings.js`, `tasker-overview.js`, `edit-profile-tasker.js`, `bookings.html` text) left at 12%: Local Taskers cannot sign in, so they never see those screens.

## 10. Tests and ACTUAL results
- SQL on a SCRATCH Postgres 16 (NOT Supabase; stand-in tables, `platform_fee_rate()` stand-in returning 0.12): `stage-7a-tests.sql` 12 PASS, 0 FAIL, 0 SKIP. Core run twice, tests run twice, rollback (functions confirmed gone), reinstall, tests again: ALL PASS each time. Numbers checked: regular N15,000 fee 1,800 / tasker 13,200; regular N18,500 fee 2,220 / 16,280; Local Tasker N15,000 and N18,500 fee 0 / full amount; still 0 after unpublish; unknown or null tasker gets the normal rate; privileges (browser cannot call the fee functions, anon cannot call `booking_fee_rates`); another customer learns nothing; bookings unchanged.
- `gift-card-pay`: the REAL source run against an in-memory fake database and stubbed Paystack (`test-gift-card-pay.mjs`, Node 22): 19 PASS, 0 FAIL. Covers regular and Local Tasker on the card-only path and the card + Paystack ("finish") path, the tasker notice text, an unreadable, null, negative or nonsense rate (refused, no hold, nothing written, Paystack not even checked), and the quote action unchanged.
- `customer-bookings.js` display functions (`test-customer-bookings-fee.mjs`): 10 PASS. Only the two functions were loaded, not the page.
- `node tools/check-design-system.js`: passed (with the changed JS overlaid on the uploaded repo).
- NOT RUN: anything in the real Supabase project; the real `payment_intents`/`escrow_payments`/`payments` column set against this SQL (this part does not touch them); Deno itself (the function was transformed and run by Node); the Bookings page in a browser; any Paystack test transaction; the Job Room payment path (not changed, so not tested).

## 11. Security and compatibility
Only new functions; no existing function, policy or table changed. The fee functions are not executable by anon or signed-in users; `booking_fee_rates` returns nothing for taskers the caller never booked and nothing to anon. No secret added anywhere. Regular taskers: rate comes from the unchanged `platform_fee_rate()` (0.12), same rounding (`Math.round(price * rate)`), same notice text as before. UNVERIFIED in the real project: that `bookings.tasker_id` is the tasker's `users.id` (the existing Bookings page comments say so and 6B tests rely on it); that a throwaway `local_tasker_profiles` row can be inserted by the test with only four columns (if not, the Local Tasker checks print `SKIP`, never PASS).

## 12. Known limitations, unresolved problems, decisions still required
1. **THE MAIN JOB ROOM PAYMENT PATH STILL CHARGES LOCAL TASKERS 12%.** `_prepare_intent` and `_release_escrow` are not patched (bodies not available). Acceptance "Local Tasker booking nets 100% of the service fee" is therefore met only for the gift-card path and the Bookings display, NOT end to end.
2. The gift-card SQL functions used by the Job Room request path (`gift_request_settle` and friends) may also compute a fee. Unknown. `stage-7a-introspect.sql` fetches their bodies too.
3. The 7A stage text asks for `_apply_payment` to stop creating a tasker wallet and adding `pending_balance` for Local Taskers; it is left to 7C-1 as the stage allows. The real current body is in `sql/messaging-step15.sql`.
4. `dashboard-customer.html` line ~1692 (old chat code) writes `fee = paidAmt * 0.12` into a `PAYMENT_CONFIRMED` message. It belongs to the old messaging path, not the Job Room. Not changed (out of scope); revisit in Part 2 once the Job Room result shape is known.
5. The "Fee (12%)" text on `bookings.html`/`bookings.js` is the tasker's page; Local Taskers never see it.
6. `DECISIONS.md` and `00-PROJECT-CONTEXT.md` were not in the upload; D8 and "0.12" were taken from the stage file's Stage 1C note.

## 13. Configuration or migration requirements
`stage-7a-core.sql` (NOT applied). `gift-card-pay` redeploy (NOT done). Site file upload `js/customer-bookings.js` (NOT done). No new secret. Test with Paystack TEST keys only.

## 14. Next steps
1. Owner does section 16, including the introspect CSV.
2. Part 2 (small): `stage-7a-part2-core.sql` patching `_prepare_intent` and `_release_escrow` (and any gift-card function the CSV shows) to call `platform_fee_rate_for_tasker`, with tests that run a Local Tasker intent and a release. Then 7B (needs reference screens for the payout form).

## 15. Dependencies the next stage must preserve
`platform_fee_rate_for_tasker(uuid)` is THE fee rate for any tasker; regular path stays `platform_fee_rate()`; fee 0 for Local Taskers must also hold when 7C queues a payout (no wallet credit, no fee); `gift-card-pay` keeps asking the database before moving money; the customer total never gets a new fee line.

## 16. Manual actions for the project owner (Supabase SQL editor and dashboard only, in this order)
1. Paste all of `sql/local-tasker/stage-7a-core.sql`, Run. Expect "Success. No rows returned".
2. Paste all of `sql/local-tasker/stage-7a-tests.sql`, Run. Expected: an error box starting "STAGE 7A TESTS" and ending "RESULT: ALL PASS". A `SKIP:` line is possible (a SKIP is not a pass); send the box only if a FAIL or SKIP appears.
3. Open the `gift-card-pay` function in the dashboard, replace its code with `supabase/functions/gift-card-pay/index.ts`, Deploy. Do this AFTER step 1.
4. Upload `js/customer-bookings.js`.
5. Paste all of `sql/local-tasker/stage-7a-introspect.sql`, Run, then Export > Download CSV and send me the CSV. It only reads; it changes nothing. This unlocks Part 2.

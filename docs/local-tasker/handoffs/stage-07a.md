# Stage 7A handoff: Local Tasker commission exemption (PART 1 and PART 2 WRITTEN, NOT APPLIED; tested on a SCRATCH Postgres with the owner's real function bodies)

## OWNER STANDING INSTRUCTIONS (unchanged)
Same rules as `handoffs/stage-06b.md`: SQL editor and dashboard deploys only (no console, no curl); deliver changed files only; never claim a test passed, SQL applied or a payment worked unless it really happened; no secrets in the browser; design system respected.

## UPDATE (Part 2, after the owner's CSV query 31)
The owner exported the real source. Part 2 patches `_prepare_intent` (ONE line) and `_release_escrow` (three spots) and adds `platform_fee_rate_for_booking(uuid)`. Part 1's `gift-card-pay` now asks that booking-based function, because `_booking_tasker_user` shows `bookings.tasker_id` can be either a user id or a `taskers` row id; asking by booking id cannot miss a Local Tasker either way. `booking_fee_rates` is replaced (same signature) to resolve the same way. Everything below that says "NOT patched" or "BLOCKED" is superseded by sections 5, 6, 10, 12 and 16 as updated. Sections are otherwise as written for part 1.

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
NEW (part 2): `sql/local-tasker/stage-7a2-core.sql`, `stage-7a2-rollback.sql` (the exact original bodies, from the CSV), `stage-7a2-tests.sql`; `tests/stage-7a/scratch-scaffold-part2.sql`, `run-scratch-part2.sh`, `real-apply-payment.sql` (the real `_apply_payment`, copied from `messaging-step15.sql`).
MODIFIED: `supabase/functions/gift-card-pay/index.ts` (minimal diff below; part 2 changes the one rpc call to `platform_fee_rate_for_booking`), `js/customer-bookings.js` (minimal diff below), `docs/local-tasker/IMPLEMENTATION-STATUS.md`.
NOT modified: `platform_fee_rate()`, `_apply_payment`, `_settle_after_dispute`, `support_resolve_dispute`, the `gift_*` SQL functions (they copy a fee already stored on the intent or escrow row), `payments.js`, any wallet, escrow, payout or Job Room function, any regular tasker screen.

## 6. Database objects
New functions only (no table, column, policy or trigger changed):
- `is_local_tasker_user(uuid)`: true when a `local_tasker_profiles` row exists for that user (ANY status). Definer. Execute: service_role only.
- `platform_fee_rate_for_tasker(uuid)`: `0` for a Local Tasker, otherwise `platform_fee_rate()`. Null or unknown id gets the normal rate. Definer. Execute: service_role only (the browser cannot ask "is this person a Local Tasker").
- `booking_fee_rates(uuid[])`: returns `(tasker_id, fee_rate)` ONLY for taskers the signed-in customer has a booking with (max 100 ids). Execute: authenticated and service_role, not anon.
Rollback part 1: `stage-7a-rollback.sql` drops the three functions (run part 2's rollback first).
**Part 2 (replaces functions, no table or policy):**
- `_prepare_intent`: ONE line changed: `v_fee := round(v_amount * public.platform_fee_rate_for_tasker(v_tasker))` (was `platform_fee_rate()`). `v_tasker` is the real tasker user from `_booking_tasker_user`. Top-ups still have no fee.
- `_release_escrow`: the two fallback fee calculations (null escrow fee, and "paid some other way" such as gift cards) use `platform_fee_rate_for_tasker(v_tasker)`; the wallet note reads "(no fee)" at 0% and still exactly "(12% fee deducted)" at 12%. It still credits the WALLET (7C replaces that with a direct payout).
- New `platform_fee_rate_for_booking(uuid)` (service role only). `booking_fee_rates(uuid[])` replaced: resolves through `_booking_tasker_user`, returns the key the page uses (`bookings.tasker_id`).
- Rollback part 2: `stage-7a2-rollback.sql` puts back the exact original bodies and the part 1 `booking_fee_rates`, and drops the new function.

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
- PART 2, SCRATCH Postgres 16 (NOT Supabase): the owner's REAL `_prepare_intent` and `_release_escrow` (from CSV 31) and the REAL `_apply_payment` (from `messaging-step15.sql`) on the 5D-3b scaffold with the real money-table columns (everything else stand-ins). `stage-7a2-tests.sql` 13 PASS, 0 FAIL. BEFORE the patch (original bodies) the same tests FAIL for the Local Tasker (fee 1,800 on N15,000; released 13,200; N20,000 gift fallback released 17,600) and pass for regular taskers, so the tests do detect the problem. Core run twice, tests twice, part 1 tests still pass, rollback restores the failing behaviour, reinstall passes again. Covers: intent split, `_apply_payment` copying it to escrow, `_release_escrow` with escrow rows and with none, wallet note text, `bookings.tasker_id` holding a `taskers` row id, top-up untouched, privileges, a non-customer learning nothing.
- PART 1, SQL on a SCRATCH Postgres 16 (NOT Supabase; stand-in tables, `platform_fee_rate()` stand-in returning 0.12): `stage-7a-tests.sql` 12 PASS, 0 FAIL, 0 SKIP. Core run twice, tests run twice, rollback (functions confirmed gone), reinstall, tests again: ALL PASS each time. Numbers checked: regular N15,000 fee 1,800 / tasker 13,200; regular N18,500 fee 2,220 / 16,280; Local Tasker N15,000 and N18,500 fee 0 / full amount; still 0 after unpublish; unknown or null tasker gets the normal rate; privileges (browser cannot call the fee functions, anon cannot call `booking_fee_rates`); another customer learns nothing; bookings unchanged.
- `gift-card-pay` (after part 2: asks `platform_fee_rate_for_booking` with the booking id): the REAL source run against an in-memory fake database and stubbed Paystack (`test-gift-card-pay.mjs`, Node 22): 19 PASS, 0 FAIL. Covers regular and Local Tasker on the card-only path and the card + Paystack ("finish") path, the tasker notice text, an unreadable, null, negative or nonsense rate (refused, no hold, nothing written, Paystack not even checked), and the quote action unchanged.
- `customer-bookings.js` display functions (`test-customer-bookings-fee.mjs`): 10 PASS. Only the two functions were loaded, not the page.
- `node tools/check-design-system.js`: passed (with the changed JS overlaid on the uploaded repo).
- NOT RUN: anything in the real Supabase project; the real `payment_intents`/`escrow_payments`/`payments` column set against this SQL (this part does not touch them); Deno itself (the function was transformed and run by Node); the Bookings page in a browser; any Paystack test transaction; the Job Room payment path (not changed, so not tested).

## 11. Security and compatibility
Only new functions; no existing function, policy or table changed. The fee functions are not executable by anon or signed-in users; `booking_fee_rates` returns nothing for taskers the caller never booked and nothing to anon. No secret added anywhere. Regular taskers: rate comes from the unchanged `platform_fee_rate()` (0.12), same rounding (`Math.round(price * rate)`), same notice text as before. UNVERIFIED in the real project: that `bookings.tasker_id` is the tasker's `users.id` (the existing Bookings page comments say so and 6B tests rely on it); that a throwaway `local_tasker_profiles` row can be inserted by the test with only four columns (if not, the Local Tasker checks print `SKIP`, never PASS).

## 12. Known limitations, unresolved problems, decisions still required
1. **Until the owner runs `stage-7a2-core.sql`, the Job Room path still charges Local Taskers 12%.** After it, new payments carry fee 0. Money already held before part 2 keeps the fee stored on its escrow row (nothing is rewritten).
2. The CSV shows no other function using `platform_fee_rate()`, 0.12 or 0.88 (the query searched every function body). `gift_request_pay_start` goes through `_prepare_intent` and `gift_request_settle` through `_apply_payment`, so they are covered. `payments-core.ts` (Edge Function code) was NOT seen; it is assumed to call `_prepare_intent`/`_apply_payment` and not compute a fee itself. UNVERIFIED.
2b. `_release_escrow` still credits the placeholder Local Tasker's WALLET. That is the next stage's job (7C), after 7B. Do not let a real Local Tasker booking be completed on the live project before 7C: the money would sit in a wallet nobody can withdraw from.
3. The 7A stage text asks for `_apply_payment` to stop creating a tasker wallet and adding `pending_balance` for Local Taskers; it is left to 7C-1 as the stage allows. The real current body is in `sql/messaging-step15.sql`.
4. `dashboard-customer.html` line ~1692 (old chat code) writes `fee = paidAmt * 0.12` into a `PAYMENT_CONFIRMED` message. It belongs to the old messaging path, not the Job Room. Not changed (out of scope); revisit in Part 2 once the Job Room result shape is known.
5. The "Fee (12%)" text on `bookings.html`/`bookings.js` is the tasker's page; Local Taskers never see it.
6. `DECISIONS.md` and `00-PROJECT-CONTEXT.md` were not in the upload; D8 and "0.12" were taken from the stage file's Stage 1C note.

## 13. Configuration or migration requirements
`stage-7a-core.sql` then `stage-7a2-core.sql` (NOT applied). `gift-card-pay` redeploy (NOT done). Site file upload `js/customer-bookings.js` (NOT done). No new secret. Test with Paystack TEST keys only.

## 14. Next steps
1. Owner does section 16.
2. Then 7B (verified payout destination; needs the payout form reference screens, desktop and mobile).

## 15. Dependencies the next stage must preserve
`platform_fee_rate_for_tasker(uuid)` is THE fee rate for any tasker; regular path stays `platform_fee_rate()`; fee 0 for Local Taskers must also hold when 7C queues a payout (no wallet credit, no fee); `gift-card-pay` keeps asking the database before moving money; the customer total never gets a new fee line.

## 16. Manual actions for the project owner (Supabase SQL editor and dashboard only, in this order)
1. Paste all of `sql/local-tasker/stage-7a-core.sql`, Run. Expect "Success. No rows returned". (Skip if you already ran it.)
2. Paste all of `sql/local-tasker/stage-7a2-core.sql`, Run. Expect "Success. No rows returned". If it stops with a message ending "Nothing was changed.", send me that text.
3. Paste all of `sql/local-tasker/stage-7a-tests.sql`, Run. Expect a box starting "STAGE 7A TESTS" and ending "RESULT: ALL PASS".
4. Paste all of `sql/local-tasker/stage-7a2-tests.sql`, Run. Expect a box starting "STAGE 7A PART 2 TESTS" and ending "RESULT: ALL PASS". It runs your real payment functions on throwaway rows and rolls back. A `SKIP:` line is not a pass; send the box if any FAIL or SKIP appears.
5. Open the `gift-card-pay` function in the dashboard, replace its code with `supabase/functions/gift-card-pay/index.ts`, Deploy (after step 2).
6. Upload `js/customer-bookings.js` (unchanged since the first delivery of this stage; skip if already uploaded).

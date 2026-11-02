# Handoff: Stage 7A-R, Local Tasker fee back to 12% (replaces 7A)

Status: WRITTEN, NOT APPLIED, NOT DEPLOYED. Nothing was run in the real Supabase project. The introspect CSV was not available, so the SQL was written to be correct in BOTH possible states of the database (see section 9).

## OWNER STANDING INSTRUCTIONS (carried forward)
1. Read this handoff, `DECISIONS.md` (OWNER PROCESS CHANGE), `PROCESS-CHANGE-2026-11-01.md` and `IMPLEMENTATION-STATUS.md` first. 2. Ask what a stage needs once, in one short batch, before generating. 3. Deliver only changed or new files as a zip. 4. Never claim a test passed, a migration applied or a payment worked unless it was run and observed. 5. No live payments, no secrets in the browser, no coordinator control over payout destinations. 6. One Supabase project, no real users yet (O2): no backup or dry-run; SQL additive, re-runnable, with a rollback file. 7. Unverified values are flagged.

## 1. Stage number and title
Stage 7A-R: Local Taskers pay the same 12% as everyone (owner change C1); fee wording removed (C11).

## 2. Objectives
One trusted place answers the fee rate and it says 12% for every tasker. No 0% path remains in code. The fee wording for Local Taskers is gone from the public page and the coordinator quote form.

## 3. Initial assumptions and relevant existing architecture
- The owner believes the 7A SQL was applied (C14); the real state is UNKNOWN (no CSV). 7A part 1 defines `is_local_tasker_user`, `platform_fee_rate_for_tasker` (0 for a Local Tasker), `booking_fee_rates`; part 2 makes `_prepare_intent` and `_release_escrow` call `platform_fee_rate_for_tasker(...)` and adds `platform_fee_rate_for_booking`.
- `gift-card-pay` already asks the database for the rate by booking id (`platform_fee_rate_for_booking`).

## 4. Files inspected
`stages/stage-07a-r.md`, `handoffs/stage-07-replan.md`, `PROCESS-CHANGE-2026-11-01.md`, `sql/local-tasker/stage-7a-core.sql`, `stage-7a2-core.sql`, both rollbacks, `stage-7-replan-introspect.sql`, `js/customer-bookings.js`, `supabase/functions/gift-card-pay/index.ts`, `local-taskers.html`, `coordinator-booking.html`, `css/styles.css` (grids), a code search of html/js/ts/css.

## 5. Files created or modified
NEW: `sql/local-tasker/stage-7a-r-core.sql`, `stage-7a-r-rollback.sql`, `stage-7a-r-tests.sql`; `docs/local-tasker/handoffs/stage-07a-r.md`; `docs/local-tasker/tests/stage-7a-r/shots/*.png` (4 screenshots).
MODIFIED: `sql/local-tasker/stage-7a-core.sql`, `stage-7a2-core.sql` (two comment lines at the top: SUPERSEDED, nothing else); `js/customer-bookings.js`; `supabase/functions/gift-card-pay/index.ts`; `local-taskers.html`; `css/styles.css`; `coordinator-booking.html`; `docs/local-tasker/IMPLEMENTATION-STATUS.md`.

## 6. Database objects affected (when the owner runs the SQL)
`platform_fee_rate_for_tasker(uuid)`: replaced (same signature, now `select platform_fee_rate()`). `platform_fee_rate_for_booking(uuid)`: replaced (no longer needs `_booking_tasker_user`; NULL for a missing booking). `booking_fee_rates(uuid[])`: dropped. No table, column, policy, trigger or data changed. `_prepare_intent` and `_release_escrow` are NOT edited.

## 7. Existing components reused
`platform_fee_rate()`, the 7A function names and grants (service role only), the `gift-card-pay` rate lookup, `window.ST.payments.calculateAmounts` (customer Bookings page).

## 8. New functionality
None. Behaviour restored: a Local Tasker booking has fee 12% and tasker net 88%, same as a regular booking.

## 9. Important decisions
- Patch the rate function rather than restore the original bodies of `_prepare_intent` / `_release_escrow`: smaller, testable, and correct in both states (if 7A part 2 was applied the two bodies already call the function; if not, they use `platform_fee_rate()` directly and are already 12%).
- Money already held at 0% keeps the fee stored on its row; only new payments change. The tests print how many `payment_intents` rows have fee 0 (INFO).
- `is_local_tasker_user` is left in place if it exists (Stage 7E may use it).
- The removed benefit card and stat card are removed with no replacement wording (C11). The grids were changed from 3 and 4 columns to 2 and 3 so no empty column is left.

## 10. Tests executed and ACTUAL results
- SQL, scratch Postgres (PGlite) with STAND-IN tables and STAND-IN `_prepare_intent` / `_release_escrow` (NOT the real bodies): fresh state 19 PASS 2 SKIP, then with a Local Tasker and a booking 21 PASS 0 SKIP; 7A-applied state (real `stage-7a-core.sql`, the two helper functions from part 2): BEFORE 7A-R 14 FAIL (Local Tasker fee 0 on 50,000), AFTER 7A-R 21 PASS (fee 6,000, tasker 44,000, same as a regular tasker); core run twice clean; rollback restores 0% and refuses to run when 7A was never applied; reinstall back to 12%.
- Page: `local-taskers.html` rendered at 1440 and 390 in headless Chromium (screenshots in `docs/local-tasker/tests/stage-7a-r/shots/`); no horizontal overflow at either width; I looked at all 4 images.
- `node --check js/customer-bookings.js`: OK.
- `node tools/check-design-system.js`: FAILED, but only for `context-snapshot/verify.html` and `withdrawals-reference/css/tokens.css`, folders this stage did not touch. Not caused by 7A-R; not investigated.
- NOT RUN: the SQL in the real project; the real `_prepare_intent` / `_release_escrow`; the `gift-card-pay` Edge Function (comment and message edits only; not type-checked or deployed); any payment.

## 11. Security and compatibility
Rate functions stay service-role only (test 43 checks anon and authenticated cannot execute them). Removing `booking_fee_rates` removes a customer-callable function. An old cached copy of the Bookings page that still calls it falls back to the normal 12% (try/catch). Regular taskers: unchanged (12%, 88%). No 0% / exemption branch remains in html, js or ts (code search; `is_local_tasker_user` and `booking_fee_rates` now appear only in the superseded 7A SQL files and the new rollback).

## 12. Known limitations, unresolved, decisions still required
- Real state of 7A in the database is still unknown until the introspect CSV is read.
- Code-search hits left on purpose: `post-service.html` "Zero commission on your first 5 completed jobs" (regular promo, not Local Tasker); `js/customer-overview.js:546` customer-side "Platform fee ₦0 (Free)" (customer pays no fee; unchanged); `gift-cards.html` "Issuance & Platform Fee ₦0" (gift-card issuance). Owner to say if any should change.
- `local-taskers.html` still says "without arbitrary deductions" under "Equal pay for equal work". The owner should read it once.
- The old 7A SQL files still contain the exemption (marked SUPERSEDED). Do not run them.
- `_release_escrow` still credits the WALLET for Local Taskers (direct payout is 7C); the 5% / 7% split is 7E.

## 13. Configuration or migration requirements
SQL to run: `stage-7a-r-core.sql` (NOT yet applied, by nobody). Deploy `gift-card-pay` to TEST only (NOT yet deployed). Upload changed site files (NOT yet uploaded).

## 14. Exact next steps
1. Owner applies and tests 7A-R (section 16). 2. Owner runs the introspect query and sends the CSV (needed by 7E, 7G, 7F). 3. Stage 7E (5% / 7% split to the coordinator wallet).

## 15. Dependencies the next stage must preserve
One place decides the rate (`platform_fee_rate_for_tasker`, same for everyone). No 0% path. Regular bookings unchanged. `_release_escrow` is the single release path that 7C and 7E will branch.

## 16. Manual actions for the project owner
1. Supabase SQL editor: run `sql/local-tasker/stage-7a-r-core.sql` (select ALL, Run). Then run `stage-7a-r-tests.sql` (select ALL, Run, read the table; the last row must say ALL PASS). Send me the table if any row says FAIL.
2. Upload the changed files from the zip to the site (same folders).
3. Deploy `supabase/functions/gift-card-pay` to TEST only.
4. Still pending from before: run `stage-7-replan-introspect.sql` and send the CSV; apply and test Stage 7B.

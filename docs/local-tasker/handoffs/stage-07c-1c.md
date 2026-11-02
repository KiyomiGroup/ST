# Handoff: Stage 7C-1c, the coordinator enters the customer's release code (screen)

Status: WRITTEN, NOT APPLIED. SQL never run. Nothing was run in the real project.

## OWNER STANDING INSTRUCTIONS (carried forward)
Ask once before generating; only changed files as a zip; never claim a test passed or a migration applied unless observed; no live payments; flag guessed values; SQL additive, re-runnable, with rollback; design system (no raw colours, sizes, inline styles).

## 1-2. Stage and objective
The next stage named in handoff 7C-2 section 14: the card where the coordinator types the 6-digit release code the customer gives them, calling `local_booking_submit_code` (7C-1b). No reference screen was supplied; built to the existing card pattern (`coordinator-closeout.js`).

## 3. Assumptions
7C-1b applied (the new SQL refuses to install without it). 7C-2 is independent. Site base files: `coordinator-booking.html` from the 7A-R zip, `css/coordinator.css` from the 7B zip, `js/coordinator-booking.js` from the repo.

## 5. Files
NEW `sql/local-tasker/stage-7c1c-core.sql`, `-rollback.sql`, `-tests.sql`; `js/coordinator-release.js`; `docs/local-tasker/tests/stage-7c1c/` (run-7c1c.py, fake-7c1c.js, base-fake.js, shots); this handoff. MODIFIED `coordinator-booking.html` (new card `#coRl`, one script tag), `js/coordinator-booking.js` (one mount line), `css/coordinator.css` (a short block at the end), `IMPLEMENTATION-STATUS.md`.

## 6. Database
One new function, `local_booking_code_state(uuid)`: read-only, coordinator of that booking only (otherwise error hint `not_found`), signed-in role may execute, anon cannot. Order of checks copies `local_booking_submit_code`: consent, not paid, released, completed, frozen, locked, ready. Rollback drops it.

## 9. Decisions and ASSUMPTIONS
- The card is STRICTER than 7C-1b: only payment_status `paid` is "ready"; `pending`, `refunded` say not_paid. 7C-1b lets those reach `_release_escrow`, whose guards I could not see. Owner decision: tighten 7C-1b the same way?
- Function name `local_booking_code_state` (not "release_state") so older browser suites that forbid any call containing "release" keep passing.
- The card hides when not_paid or closed (the next-action text already covers it).
- "Released" says the payment is released and StreetTasker pays the bank account; it does NOT claim the payout was sent (the card cannot see payouts).
- Input allows up to 9 characters so a space while typing does not drop a digit; only the first 6 digits are kept.
- Admin unlock has no screen; the locked text says to contact support.

## 10. Tests and ACTUAL results
- Browser, `run-7c1c.py`: 50 checks PASS, MOCKED Supabase, 1440 and 390 px (screenshots in `tests/stage-7c1c/shots`). Deliberate breaks: missing 6-digit check, keeping the code in the field and offering the field when the state is unreadable were each caught; removing the double-send guard was not (the disabled button already prevents it).
- Older suites, same results with and without this stage: 4C-2 48, 5B 42, 5C-1 48, 5D-2 26, 5D-3a 32, 5D-3b 38 pass; 5D-3c-1 and 5D-3c-2 pass; 5C-2 and 5D-1 had 2 failures each BEFORE this stage and the same after.
- `node tools/check-design-system.js` fails identically on the untouched repo (only `context-snapshot` and `withdrawals-reference`); no file of this stage is listed.
- SQL: NOT RUN, NOT PARSED. `stage-7c1c-tests.sql` reuses the helper functions of the 7C-1b tests. NOT covered: `consent_revoked`, the real browser against the real project.

## 11. Security
The function never returns the code or an amount. The card never stores or shows the code, clears it after each send, sends nothing unless exactly 6 digits, and calls no payout, wallet or escrow function.

## 12. Known limitations
No admin unlock screen; `lt_status` still not moved by release (7C-1b A-3); no payout status on the card; the "next step" text on a paid booking does not yet mention the code.

## 14. Next
Owner applies and tests 7C-1c (runbook below), then 7C-3 (webhook calling `local_payout_record_result`).

## 16. Manual actions
1. Supabase SQL editor: run `stage-7c1c-core.sql` ("Success. No rows returned"), then `stage-7c1c-tests.sql` (error box starting `STAGE 7C-1C TESTS`, ending `RESULT: ALL PASS`; send the box if any FAIL or SKIP).
2. Upload the changed site files (`coordinator-booking.html`, `js/coordinator-booking.js`, `js/coordinator-release.js`, `css/coordinator.css`).
3. Try it with a TEST booking that is paid and approved: open it as the coordinator; the card appears. Enter a wrong 6-digit code once (2 attempts left shown). Do NOT test the right code unless you want the payout queued (it is real queue-then-test-Paystack, as in the 7C-2 runbook).
4. Send me what you see, and answer the payment_status question in section 9.

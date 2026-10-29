# Stage 5D-3c-2 handoff: a price going DOWN (WRITTEN; SQL NOT RUN IN THE REAL PROJECT; tested on a SCRATCH Postgres; card tested in isolation with a MOCKED Supabase)

Second half of 5D-3c. 5D-3c-1 (extra money going up) came first. Needs 5A, 5B, 5C-1, 5C-2, 5D-1, 5D-2, 5D-3a, 5D-3b and 5D-3c-1 applied. This is the LAST part of Stage 5D (exceptions); the next stage is 6A.

## OWNER STANDING INSTRUCTIONS (every AI session must follow these; the owner should never have to repeat them)
1. Read this handoff, `00-PROJECT-CONTEXT.md` and `IMPLEMENTATION-STATUS.md` first. The next stage is the first one not marked Done / Applied.
2. Ask the owner for what the stage needs ONCE, in ONE short batch, BEFORE generating. Ask only for what the stage file lists and what is not already filed. If nothing is needed, generate straight away.
3. Supabase's SQL editor shows at most 100 rows. Prefer one compact aggregated query (one row per section) over many pastes.
4. At the end of every stage, REDO the handoff in `handoffs/` (what was done, what was not, what the next AI must note) and update `IMPLEMENTATION-STATUS.md`.
5. Deliver a zip with ONLY the files created or changed in this stage, in their proper folders, including the handoff and status files. Never the full project. Repeat these instructions in the new handoff.
6. Never claim a test passed, a migration was applied or a payment worked unless it was actually run and observed.
7. Hard safety rules: no production deploys, no live payments, no secrets in the browser, no destructive migrations, no coordinator control over payout destination or payment records. One Supabase project, no staging, no real users yet: NO backup or dry-run is needed; run SQL directly (additive, re-runnable, with a rollback file).
8. ASSUME THE OWNER FOLLOWED YOUR PREVIOUS INSTRUCTIONS CORRECTLY. If the last handoff said "owner runs X", treat X as run and correct (the owner reports only problems).
9. WHEN YOU MUST ASK FOR A FILE OR OUTPUT, ALWAYS SAY EXACTLY HOW TO GET IT: the repo folder path, or a ready-to-run SQL file (one query, one row per section) plus the clicks (run in the Supabase SQL editor, then Export > Download CSV, and upload it).
10. The zips the owner uploads may not include `inputs/`, `sql/` or earlier handoffs. If a file is missing, do not guess: ask once, with how to get it (rule 9).
11. Supabase SQL editor and dashboard function deploy only: NEVER ask the owner to use the browser console, curl or a terminal. Anything not provable with SQL is verified through the real app flow and recorded as UNVERIFIED until then.
12. Follow the existing design system (`DESIGN-SYSTEM.md`, `css/tokens.css`, shared `.btn` / `.form-*` / `.card` / `.co-*` classes). Run `node tools/check-design-system.js` before finishing UI work.

## 1. Stage
5D-3c-2: the Local Tasker agrees to a LOWER price (the job was smaller, part of it was not done). The coordinator records that. Support decides and records any refund.

## 2. Owner decisions this session
Owner answered "use your proposal" to the three open questions of the 5D-3c-1 handoff (section 10). So: (a) before any payment, use the existing send-back and new-quote path; (b) after a payment, a `wrong_amount` problem report through the existing `local_booking_open_problem`, so support decides; (c) the same rule when only the extras were paid. The owner's earlier rule stands: a coordinator never runs, records or triggers a refund.

## 3. Real facts used
- `job_disputes` (owner CSV, 2026-10-29): category accepts `wrong_amount`; reason 10 to 1000 characters; opened_by_role customer or tasker; status open / under_review / resolved / withdrawn; outcome refund_full / refund_partial / release_to_tasker / split / no_action.
- `stage-5d3b-core.sql` (uploaded this session, read in full): `local_booking_open_problem(booking, request_id, category, reason)` opens the report as the Local Tasker, freezes the booking through the real trigger and tells the customer; `local_booking_withdraw_problem(booking, dispute)` works only while the report is `open`; `_local_booking_report_block` allows at most 3 reports per booking in 24 hours; `_local_booking_cancel_block` returns `payment_started` while a request is processing.
- Refunds are recorded only by support (`support_resolve_dispute`, `_record_refund`, `_settle_after_dispute`; see the 5D-3c-1 handoff section 10). Nothing here calls any of them.

## 4. Files created or modified
NEW: `sql/local-tasker/stage-5d3c2-core.sql`, `-rollback.sql`, `-tests.sql`; `js/coordinator-reduction.js`; `docs/local-tasker/tests/stage-5d3c2/run-5d3c2.py`; this handoff.
MODIFIED: `coordinator-booking.html` (new "Lower the price" card, ids `coRd*`, one script tag), `js/coordinator-booking.js` (one mount line), `css/coordinator.css` (one block), `docs/local-tasker/IMPLEMENTATION-STATUS.md`.
**These three site files are the 5D-3c-1 versions plus this stage's additions** (which already include 5D-3b's). Upload them over the current ones.

## 5. Database objects (all in `stage-5d3c2-core.sql`)
- NEW `local_booking_reductions`: immutable (reuses the 5D-3b guard), RLS admin read only, no browser grants. One row per request: amount (whole, 100 to 10,000,000), `paid_total` (what had been paid), why (5-300), `confirmed_how` (phone_call / in_person / message), coordinator, `dispute_id` (unique, the report it opened), request id (unique). Trigger writes one `reduction_requested` booking event and one audit row.
- NEW internal `_local_booking_reduction_paid(booking)`: the sum of `payment_requests` with status `paid` (kind not `refund`) on the booking's Job Room(s), minus reductions already asked for whose report was not withdrawn. This is the most a reduction may ask for.
- NEW internal `_local_booking_reduction_block(booking)`: `not_found`, `booking_closed`, `dispute_open`, `too_many` (all from the 5D-3b report block), `not_approved` (lt_status must be quote_approved), `payment_started`, `not_paid`, `nothing_left`.
- NEW `local_booking_request_reduction(booking, request_id, amount, why, how)` (coordinator): checks, builds a fixed-wording reason ("PRICE REDUCTION asked for by the coordinator for the Local Tasker. Reduce the price by NGN X. Paid so far: NGN Y. The Local Tasker agreed to this <how>. Why: <why>"), calls `local_booking_open_problem(..., 'wrong_amount', reason)`, then records the row. Refusal hints: not_found, bad_input, booking_closed, dispute_open, too_many, not_approved, payment_started, not_paid, over_limit.
- NEW `local_booking_reduction(booking)` (read): can_request, blocked, room, items (id, dispute_id, amount, why, status, outcome, created_at, can_withdraw).
- NOT touched: bookings, lt_status, payment_status, `agreed_price`, `payment_requests`, payment_intents, escrow_payments, wallets, wallet_transactions, job_refunds, release code, `price_propose`, `price_respond`, any earlier function. The report itself writes `job_disputes`, `dispute_events` and a customer notification, exactly as 5D-3b does.

## 6. Tests ACTUALLY run
- **SQL, SCRATCH Postgres 16 (not Supabase):** `stage-5d3c2-tests.sql`: 28 PASS, 0 FAIL, 0 SKIP. Loaded: the 5D-3b scratch scaffold from the owner's zip (real guard triggers and `job_disputes`; stand-ins for the rest), two tiny stubs for objects 5D-3b's pre-flight asks for (5D-3a/5D-2 files were not in the upload), the REAL `stage-5d3b-core.sql`, then `stage-5d3c2-core.sql`. Core file run twice, rollback then reinstall, tests re-run after: all clean. Covered: privileges, other coordinator / customer refused, bad input, not approved, closed, nothing paid (no report, booking not frozen), payment in progress, over the paid amount, success (real `wrong_amount` report as role tasker, reason wording, booking frozen, payment requests / escrow / agreed price unchanged by md5 and counts, no refund row, one event, one audit, one report link), retry harmless, second request while open refused, withdraw gives the booking its status back and the room back, a new request afterwards, records cannot be edited or deleted.
- **Browser, card in ISOLATION, MOCKED Supabase** (`tests/stage-5d3c2/run-5d3c2.py`): 27 PASS. The real card markup, the real `coordinator-reduction.js` and `coordinator.css`, tiny stand-ins for `STCo` / `STCoBk`. Covered: validation with no call, exact call arguments, text not HTML, withdraw, retry keeps the same request id, refusal wording, hidden / guidance / decided states, load failure, 390 width with no sideways scroll and a 44px button, only the three expected rpc names.
- **NOT RUN:** the real Supabase; the full-page regression (5D-3c-1 20, 5D-3b 38, 5D-3a 32, 5D-2 26, 5D-1 23, 5C-2 35: the site zip and the other cards' scripts were not in the upload); `node tools/check-design-system.js` (tools not in the upload; the new CSS uses only `var(--space-*)` and the same `min-height: 44px` as the 5D-3c-1 block); screenshots with the real design tokens (the isolation page has no `tokens.css`, so the screenshots are unstyled and are NOT a design check).

## 7. UNVERIFIED (do not treat as true)
- That the core file installs in the real project (the real 5D-3b is applied and its tests passed, so the pre-flight should pass).
- That the tests' payment fixtures work in the real project: they insert a `full_payment` request and fall back to `additional_cost`; the real `payment_requests_guard` may refuse one. If the tests print `SKIP:`, the success checks did not run (a SKIP is not a pass).
- That `payment_requests.amount` for a paid request is what the customer actually paid. The cap uses it as is. If the customer's amount includes a service charge that is not refundable, support will see the paid total in the reason and decide.
- A booking paid only by gift card or escrow with no `paid` payment request is refused (`not_paid`); this is the safe side.
- The wording of the guidance for "nothing paid yet" ("send the booking back to the Local Tasker for a new answer and a new quote"): the send-back path is described in the 5D-3b handoff, but its sources (5D-1 `_local_booking_transition`, the booking page's steps) were not in this upload, so the exact button name is not quoted.
- How support's own screen shows the `wrong_amount` report and this reason (support-side UI is Stage 8B).

## 8. Known limits
- Before any payment this stage builds nothing new: it refuses and points to the existing path. It does NOT cancel unpaid requests or send a lower quote itself.
- The coordinator is not notified when support decides; the card shows the status and outcome when the page is opened.
- The customer is told only the generic "A problem was reported on your job" (5D-3b text). The reduction amount is not shown to the customer by this stage.
- One report at a time (the booking is frozen), at most 3 per booking per 24 hours (5D-3b).

## 9. Decisions (owner may overrule)
- D104 (a GUESS): a reduction may not exceed what was paid minus reductions already asked for and not withdrawn. Change `_local_booking_reduction_paid` for another rule.
- D105: a reduction is allowed only after the customer approved the quote (lt_status `quote_approved`) and a payment is on record; while a payment is in progress it waits.
- D106: the coordinator ticks a box and records HOW the Local Tasker confirmed it; stored, no second check (same as D102).
- D107: the report wording is fixed in the function, not typed by the coordinator, so support always reads the same facts in the same order.

## 10. Next: Stage 6A (booking-specific coordinator thread)
Stage 5D is complete once the 5D-3c-1 and 5D-3c-2 SQL are run and the site files are uploaded. Next stage per the stage list: 6A. It needs a reference screen (see the stage file). Preserve everything in section 11 of this list: `local_booking_reductions` immutable, written only by `local_booking_request_reduction`; reports opened only through `local_booking_open_problem`; no coordinator code path may write a refund, `job_refunds`, escrow, wallet or payment status.

## 11. Dependencies to preserve
`local_booking_reductions` immutable (guard from 5D-3b); the reason wording prefix "PRICE REDUCTION" (support may search for it); the `wrong_amount` category; `local_booking_open_problem` and `local_booking_withdraw_problem` unchanged; no coordinator control over payment records.

## 12. Manual actions for the owner (Supabase SQL editor and site deploy ONLY)
1. Make sure the 5D-3c-1 core and tests were run (per the earlier handoff). If its tests failed, send me that text first.
2. Paste the whole of `sql/local-tasker/stage-5d3c2-core.sql`, Run. Expect "Success. No rows returned". If it stops with a message ending "Nothing was changed.", or fails with any error, send me that text.
3. Paste the whole of `sql/local-tasker/stage-5d3c2-tests.sql`, Run. Expected: an error box starting "STAGE 5D-3c-2 TESTS" and ending "RESULT: ALL PASS" (it rolls itself back). Send me the box if a FAIL or SKIP appears.
4. Upload this zip's site files (`coordinator-booking.html`, `js/coordinator-reduction.js`, `js/coordinator-booking.js`, `css/coordinator.css`). Also make sure the 5D-3b and 5D-3c-1 site files (`js/coordinator-closeout.js`, `js/coordinator-bookings-common.js`, `js/coordinator-extras.js`) are uploaded.
5. Live check (real test booking, quote approved AND paid in test mode; do not use real money): the card "Lower the price" shows; report a small reduction; the booking shows as frozen / problem reported; withdraw it and check the booking is back to normal. On an approved booking with nothing paid, the card shows the send-back guidance and no form.

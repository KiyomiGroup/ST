# Stage 5D-3c-1 handoff: extra costs after the quote was approved (WRITTEN; SQL NOT RUN ANYWHERE; browser tested with a MOCKED Supabase; NOTHING run in the real project)

Third part of Stage 5D-3 (exceptions), first half. 5D-3c is split by the size guard: **5D-3c-1** (this stage: extra money, going UP) and **5D-3c-2** (a price going DOWN: reduction and refund). Needs 5A, 5B, 5C-1, 5C-2, 5D-1, 5D-2, 5D-3a and 5D-3b applied.

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
5D-3c-1: after the customer approved the quote (and at any later point while the booking is open), the managing coordinator can record that the Local Tasker confirmed an EXTRA cost (extra work, materials or transport) and ask the customer to pay it. The customer pays or declines in the Job Room, the existing way.

## 2. Owner decisions this session
Extra costs after payment or arrival are in scope for v1. A price reduction (refund) must be handled in 5D-3c (moved to 5D-3c-2). Owner chose "reuse the Job Room price_proposal request". **This stage does NOT do that, and the reason is in section 9 (D99). The owner has not yet agreed to the change; if they insist, 3c-1 must be redone.**

## 3. Real facts used (owner CSV, query 29, 2026-10-29)
- `price_propose` (tasker only) refuses once `job_money_snapshot.paidMain > 0`. `price_respond` (customer) sets `message_threads.agreed_price` and `bookings.amount`. The trigger `price_proposal_retires_request` cancels every pending / failed main payment request (kinds payment, full_payment) of the thread, and refuses while one is processing or in flight.
- For a Local Tasker booking the quote's service-fee request (full_payment) already exists (5D-1). A price proposal would cancel it and leave the customer nothing to pay; after the first payment it is refused outright.
- `payment_requests.kind` accepts payment, full_payment, remaining_payment, transport, materials, additional_cost, invoice, refund; status accepts pending, processing, paid, failed, declined, cancelled, refunded. `payment_requests_amount_check`: amount > 0.
- `job_requests.requested_by` must be the customer or the tasker (CHECK), so the coordinator cannot be the requester of any job request.
- The Job Room treats additional_cost / materials / transport as ADD-ONS: the customer pays or declines, no approve step (`js/messages-money.js`).

## 4. Files created or modified
NEW: `sql/local-tasker/stage-5d3c1-core.sql`, `-rollback.sql`, `-tests.sql`, `stage-5d3c-introspect.sql` (read-only; the owner already ran it); `js/coordinator-extras.js`; `docs/local-tasker/tests/stage-5d3c1/` (`fake-coordinator-supabase.js`, `run-5d3c1.py`); this handoff.
MODIFIED: `coordinator-booking.html` (new "Extra costs" card, ids `coXt*`, one script tag), `js/coordinator-booking.js` (one mount line), `css/coordinator.css` (one block), `docs/local-tasker/IMPLEMENTATION-STATUS.md`.
**These three site files are built on top of the 5D-3b versions.** The owner has not uploaded the 5D-3b site files yet (`js/coordinator-closeout.js`, `js/coordinator-bookings-common.js`, and 3b's edits to the same three files). Upload the 5D-3b zip's site files too, or the "Cancel or report a problem" card will 404 its script.

## 5. Database objects (all in `stage-5d3c1-core.sql`)
- NEW `local_booking_extra_costs`: immutable (reuses the 5D-3b guard), RLS admin read only, no browser grants. One row per request: kind (additional_cost / materials / transport), amount (whole, 100 to 10,000,000), title (3-60), details (5-300), `confirmed_how` (phone_call / in_person / message), coordinator, `payment_request_id` (unique), request id (unique, makes a retry harmless). Trigger writes one `extra_requested` booking event and one audit row.
- NEW internal `_local_booking_extra_block(booking)`: reasons `not_found`, `booking_closed`, `dispute_open`, `not_approved` (lt_status must be quote_approved), `one_waiting` (an earlier extra is pending or processing). `_local_booking_extra_room(booking)`: current quote total minus extras asked for and not declined or cancelled.
- NEW `local_booking_request_extra(booking, request_id, kind, amount, title, details, how)` (coordinator): checks, then ONE `payment_requests` row (status pending, tasker = the Local Tasker's user, customer = the booking's customer) plus its chat card (`PAYMENT_REQUEST:<id>:<amount>`, sender = the Local Tasker's user, the same shape 5D-1 uses) plus customer notification, plus the record. Refusal hints: not_found, bad_input, booking_closed, dispute_open, not_approved, one_waiting, over_limit.
- NEW `local_booking_cancel_extra(booking, extra)`: pending -> cancelled on that one request only; harmless twice; `not_pending` once the customer started paying.
- NEW `local_booking_extras(booking)` (read): can_request, blocked, room, items (id, kind, amount, title, status, created_at, can_cancel).
- NOT touched: bookings, lt_status, payment_status, `agreed_price`, payment_intents, escrow_payments, wallets, wallet_transactions, release code, `price_propose`, `price_respond`, any earlier function.

## 6. Tests ACTUALLY run
- Browser, MOCKED Supabase (`tests/stage-5d3c1/run-5d3c1.py`): 20 PASS (form validation with no call, exact call arguments, text not HTML, withdraw, refusal wording, hidden before approval and on a closed booking, load failure, 390 width with no sideways scroll and a 44px button, no payment / escrow / release / wallet / cancel / dispute call). Regression on a merged tree (site zip 100 + 5D-3b zip + this stage): 5D-3b 38, 5D-3a 32, 5D-2 26, 5D-1 23, 5C-2 35, all PASS. `node tools/check-design-system.js` passes. Screenshots at 1440 and 390 viewed.
- **SQL: NOT RUN.** No Postgres was available in this session, so `stage-5d3c1-core.sql` and `stage-5d3c1-tests.sql` have never been executed anywhere, not even on a scratch database. Expect to fix something on the first run in Supabase. The tests file seeds a quote through `local_booking_confirmations` with guessed column values; if that fails it prints SKIP and skips the success checks (a SKIP is not a pass).

## 7. UNVERIFIED (do not treat as true)
- That the core file installs. Its pre-flight stops with "Nothing was changed" if a helper or the payment_requests kinds are missing.
- That `payment_requests` accepts the insert (title, reason, status) without a column or trigger side effect not in the CSV (`payment_requests_guard`, `payment_requests_events`, `trg_set_invoice_number` bodies were not supplied). If an insert is refused, the real error text is what to send.
- That the Job Room pays this request: the card shape is copied from 5D-1, but a real extra-cost card for a Local Tasker booking was never opened.
- How the payment engine splits an add-on of kind additional_cost: service charge (12% fee, held until the customer confirms) or reimbursable. The owner's money rule says transport and materials are reimbursable and released to the tasker (on "Arrived" / on receipt upload), and that the 12% fee applies only to the service charge. This stage only creates the request; the engine decides. Check with a real payment before relying on it.
- That `_local_booking_log` accepts the new event kinds `extra_requested` / `extra_withdrawn` (3b's kinds worked in the real project, so probably no CHECK).
- How a declined extra request looks to the coordinator: the status comes straight from `payment_requests.status`.

## 8. Known limits
- No notification to the coordinator when the customer pays or declines (the card shows the status when the page is opened).
- A Local Tasker's customer page (`customer-quote.js`) is unchanged; the extra cost appears in the customer's Job Room only.
- One waiting extra at a time (D101).

## 9. Decisions (owner may overrule)
- **D99 (changes the owner's choice): not `price_proposal`.** Reason in section 3. Extra money uses add-on payment requests; `price_proposal` stays for a price change BEFORE the first payment on a regular Job Room (and is NOT used for Local Tasker bookings, where the 5D-1 send-back path already covers it).
- D100 (a GUESS, the owner must confirm): extra costs on a booking may not add up to more than the current quote total. Change `_local_booking_extra_room` to use another rule.
- D101: only one extra request may wait at a time.
- D102: the coordinator records HOW the Local Tasker confirmed the cost and ticks a box; this is stored but there is no second check.
- D103: the request is refused before the customer approved the quote ("change the quote instead").

## 10. Next: 5D-3c-2 (a price going DOWN: reduction and refund)
Real facts for it: refunds are recorded by SUPPORT after a problem report is resolved with `refund_full`, `refund_partial` or `split`: `support_resolve_dispute` needs the amount and the Paystack refund reference (the refund is made by hand in the Paystack dashboard first), `_record_refund` writes `job_refunds` (capped by `_refund_headroom`), `_sync_refunded_status` marks fully refunded requests `refunded`, and `_settle_after_dispute` shrinks the held escrow by the same ratio and releases the rest. A coordinator must never run any of this (owner rule 7).
Proposed design (ask the owner, do not choose silently): a coordinator "price reduction" that (a) before any payment cancels the unpaid quote requests and asks the customer to approve a lower quote through the existing 5C/5D-1 path, or (b) after a payment opens a problem report with category `wrong_amount` through the existing `local_booking_open_problem`, with the reduction amount and the Local Tasker's confirmation in a structured reason, so support decides and records the refund. Ask the owner: (1) is (b) acceptable, or must the coordinator trigger the refund request some other way; (2) what happens when the customer already paid the extras only.

## 11. Manual actions for the owner (Supabase SQL editor and site deploy ONLY)
1. Make sure 5A, 5B, 5C-1, 5C-2, 5D-1, 5D-2, 5D-3a and 5D-3b SQL are applied (they are, per the owner).
2. Paste the whole of `sql/local-tasker/stage-5d3c1-core.sql`, Run. Expect "Success. No rows returned". If it stops with a message ending "Nothing was changed.", or fails with any error, send me that text.
3. Paste the whole of `sql/local-tasker/stage-5d3c1-tests.sql`, Run. Expected: an error box starting "STAGE 5D-3c-1 TESTS" and ending "RESULT: ALL PASS" (it rolls itself back). Send me the box if a FAIL or SKIP appears, or any other error. This file has never been run, so a first-run fix is likely.
4. Upload the site files: this zip's changed files AND the 5D-3b site files (section 4).
5. Live check (real booking, quote approved): open the booking as the coordinator, add an extra cost; the customer's Job Room shows a payment card for it. Withdraw it before paying and check the card shows cancelled. Do not pay with real money.

# Stage 5D-1 handoff: customer approves or declines the Local Tasker quote (WRITTEN; SQL tested on a SCRATCH Postgres with stand-ins for 5A and the payment engine; browser tested with a MOCKED Supabase; NOTHING run in the real project)

First half of Stage 5D (5D-1 approval and payment requests, 5D-2 milestones and exceptions). Needs 5A, 5B, 5C-1, 5C-2 applied, and the Job Room money SQL (`messaging-step6.sql`, `messaging-step7.sql`; the owner uploaded both this time).

## OWNER STANDING INSTRUCTIONS (every AI session must follow these; the owner should never have to repeat them)
1. Read this handoff, `00-PROJECT-CONTEXT.md` and `IMPLEMENTATION-STATUS.md` first. The next stage is the first one not marked Done / Applied (see section 12).
2. Ask the owner for what the stage needs ONCE, in ONE short batch, BEFORE generating. Ask only for what the stage file lists and what is not already filed. If nothing is needed, generate straight away.
3. Supabase's SQL editor shows at most 100 rows. Prefer one compact aggregated query (one row per section) over many pastes.
4. At the end of every stage, REDO the handoff in `handoffs/` (what was done, what was not, what the next AI must note) and update `IMPLEMENTATION-STATUS.md`.
5. Deliver a zip with ONLY the files created or changed in this stage, in their proper folders, including the handoff and status files. Never the full project. Repeat these instructions in the new handoff.
6. Never claim a test passed, a migration was applied or a payment worked unless it was actually run and observed.
7. Hard safety rules: no production deploys, no live payments, no secrets in the browser, no destructive migrations, no coordinator control over payout destination or payment records. One Supabase project, no staging, no real users yet: NO backup, test copy or dry-run is needed; run SQL directly (additive, re-runnable, with a rollback file).
8. ASSUME THE OWNER FOLLOWED YOUR PREVIOUS INSTRUCTIONS CORRECTLY. If the last handoff said "owner runs X", treat X as run and correct (the owner reports only problems). Do not ask the owner to confirm or re-paste a past stage's results unless you genuinely need that output to proceed.
9. WHEN YOU MUST ASK FOR A FILE OR OUTPUT, ALWAYS SAY EXACTLY HOW TO GET IT: the repo folder path, or a ready-to-run SQL file (one query, one row per section) plus the clicks (run in the Supabase SQL editor, then Export > Download CSV, and upload it). Never just name a file.
10. The zips the owner uploads may not include `inputs/`, `sql/` or earlier handoffs. If a file is missing, do not guess: ask once, with how to get it (rule 9).
11. If the owner uploads the introspect CSV or schema again, regenerate `architecture/schema-2a-2b-2c.md` from it. A scratch Postgres can be built to RUN SQL before handing it over: see section 9 item 6.
12. OWNER PREFERENCE (2026-10-26): NEVER ask the owner to use the browser console, curl, a terminal, or any developer tooling. The owner is a designer who only uses the Supabase SQL editor and dashboard function deploy. Optional tests are left out; anything that cannot be proven with SQL or a dashboard deploy is verified later through the real app flow (the stage that builds the UI) and recorded as UNVERIFIED until then.
13. OWNER INSTRUCTION (2026-10-26): follow the existing website design system and tokens (`DESIGN-SYSTEM.md`, `css/tokens.css`, `css/styles.css`, shared `.btn` / `.form-*` / `.card` classes) and stay consistent with the screens already built (coordinator pages, `css/coordinator.css`), irrespective of any reference screen. Run `node tools/check-design-system.js` before finishing UI work.

## 1. Stage number and title
5D-1: Customer quote approval.

## 2. Objectives
Customer sees the coordinator's quote, approves or declines it. Approval creates the payments through the EXISTING Job Room path (payment_requests + chat cards); no parallel money model, no payment collected here.

## 3. Initial assumptions and relevant existing architecture
5C-2 quote tables and functions; 5A state machine (handoff 5C-2 says the customer may go quote_sent -> quote_approved/quote_declined: the core SQL checks this first and stops with nothing changed if not). Step 7 rules: no approve step, requests go pending -> processing -> paid; the customer can pay transport/add-ons before the main amount; guard `payment_requests_guard` lets SECURITY DEFINER code insert (current_user is not authenticated/anon). The step 6 `kind` check only allows payment, full_payment, remaining_payment, transport, additional_cost (`materials` and `invoice` come from a later SQL not uploaded).

## 4. Files inspected
Handoff 5C-2, IMPLEMENTATION-STATUS, `stage-5c1/5c2-core.sql`, `stage-5c2-tests.sql`, `messaging-step6.sql`, `messaging-step7.sql`, `js/messages-money.js`, `js/messages.js`, `js/customer-bookings.js`, `css/customer-bookings.css`, `css/bookings.css`, `js/coordinator-quote.js`, 5C-2 browser harness.
NOT available (asked for in section 12): the stage 5C/5D stage files, 00-PROJECT-CONTEXT.md, DECISIONS.md, `stage-5a1-core.sql`, `stage-5a2-core.sql`, the real `message_threads`, `messages`, `bookings`, `payment_requests` base definitions and `messaging-step6a.sql`. Scope was taken from section 14 of the 5C-2 handoff.

## 5. Files created or modified
NEW: `sql/local-tasker/stage-5d1-core.sql`, `stage-5d1-rollback.sql`, `stage-5d1-tests.sql`; `js/customer-quote.js`; `docs/local-tasker/tests/stage-5d1/` (`scratch-scaffold.sql`, `fake-customer-supabase.js`, `fake-coordinator-supabase.js`, `run-5d1.py`); this handoff.
MODIFIED: `customer-bookings.html` (one script tag), `js/customer-bookings.js` (loads quotes, badge, hint, card, sidebar count, binds the card), `css/customer-bookings.css` (quote section), `js/coordinator-quote.js` (shows the customer's reason and approval note), `coordinator-booking.html` (note label now "Note for the customer (optional)": that note IS shown to the customer), `docs/local-tasker/IMPLEMENTATION-STATUS.md`.

## 6. Database objects
- NEW `local_booking_quote_decisions` (one row per answered quote, unique on quote and on request id, immutable, admin read only, no browser grants).
- NEW `local_booking_quote_requests` (quote line -> payment_requests row; no browser grants).
- NEW `local_booking_customer_quotes(p_booking default null)` (customer, read only): own Local Tasker bookings at quote_sent / quote_approved / quote_declined, lines, total, note, decision, payment status per line. No coordinator, confirmation, call, second-check or request ids.
- NEW `local_booking_decide_quote(p_booking, p_version, p_request_id, p_decision, p_reason)` (customer). Checks: caller is the booking's customer; request id retry returns the earlier result; state is quote_sent; the version is the CURRENT one the customer saw (else hint `quote_changed`). Approve: transition to quote_approved (customer role) + `_local_booking_create_requests`. Decline: transition to quote_declined, reason kept.
- NEW internal (service_role only): `_local_booking_create_requests`, `_local_booking_thread`, `_local_booking_request_kind`.
- NEW trigger `lbq_cancel_requests`: a replaced quote cancels its still-unpaid requests (pending/failed).
- REPLACED (same signatures): `_local_booking_transition` (one added refusal, hint `payment_started`: going back to the Local Tasker is refused while a payment for the current quote is processing or paid), `local_booking_quote` (adds `decision` to `current`).
- Refusals on approve (hint `already_paid`): booking already has a payment status other than unpaid/pending; the Job Room already has an open or paid main request.
- Not touched: bookings columns, payment_intents, escrow, wallets, release code, the Edge Functions, `payment_requests_guard`.

## 7. Existing components reused
Job Room `payment_requests` (+ chat card message shape `PAYMENT_REQUEST:<id>:<amount>`, type `payment_request`), the Job Room payment path (`_prepare_intent` / `_apply_payment`, unchanged), `_local_booking_quote_lines` (kind mapping), `_local_booking_transition`, `.bk-*` classes and `.bk-pay-sum` of the customer Bookings page.

## 8. New functionality
Quote card inside the booking card: lines, total, coordinator note, Approve (with a confirm step stating the total, "nothing is charged") or Decline (optional reason). After approval: line-by-line payment state and "Pay in Job Room" (opens the existing chat). Declined: shows the reason and that a revised quote is coming. Badge ("Quote to Review", "Payment Needed", "Quote Declined"), hint and sidebar count follow it. Retry-safe (same request id until success). The coordinator sees the customer's reason and can revise.

## 9. Decisions (owner may overrule)
- D78: the quote note is shown to the customer (the label now says so).
- D79: one payment request per quote line, all created at approval: service fee = `full_payment` (sets price and code on payment, per step 7), transport = `transport`, other = `additional_cost`, materials = `materials` ONLY if the table's kind check accepts it, otherwise `additional_cost` with reason "Materials ..." (detected in the database, one function `_local_booking_request_kind`).
- D80: approval is all-or-nothing: if the chat card cannot be posted the approval fails (a request without a card cannot be paid).
- D81: a booking cannot go back for a new price once a payment for the quote started or is held (money is never stranded); unpaid requests are cancelled when the quote is replaced.
- D82: approval is refused if the booking already has a payment on record.
- The confirm step on Approve is a UI choice (no money moves), easy to remove.

## 10. Tests ACTUALLY run
- SQL on a scratch Postgres 16 (NOT Supabase). Real files loaded: `messaging-step6.sql`, `messaging-step7.sql`, `stage-5c1-core.sql`, `stage-5c2-core.sql`, `stage-5d1-core.sql`. STAND-INS: the 5A tables and functions (the state machine is written from the 5C handoffs), `create_local_tasker` / service / publish, the booking-insert assignment, `payment_intents`, `_apply_payment`, `_prepare_intent` (replaced by the real step 7 bodies), base `message_threads` / `messages` / `payment_requests` / `bookings`. Core loaded twice with no error. `stage-5d1-tests.sql`: ALL PASS, run twice, once with `message_threads.context_id` as text and once as uuid. Covers: privileges; customer read content and no leaking; other customer / coordinator / visitor refused; five bad inputs and a stale version refused with nothing left; decline (decision, events, audit, no money object); retry; coordinator sees reason; revised quote v2; approve (4 requests, kinds, amounts, one thread, 4 chat cards, links, booking row md5 unchanged, no payment_intents); retry; the customer can decline an add-on through the existing Job Room guard and cannot edit an amount; payment_started refusals (processing and paid add-on); going back cancels unpaid requests; immutability; cascade delete; closed booking, open dispute (SKIP if stand-in differs), already-paid booking, existing main request; all-or-nothing with a blocking trigger; existing Job Room reused; `materials` kind used only when allowed; no quote shown before quote_sent.
- `stage-5d1-rollback.sql` run twice with no error; core reloads and tests pass again.
- Browser, mocked Supabase (`tests/stage-5d1/run-5d1.py`): 23 PASS, 0 FAIL (card content, text not markup, badge, hint, sidebar, confirm step with no call, exact arguments, refresh after approve, per-line payment states, all-paid state, declined state, Pay in Job Room, decline with reason, server error plain text and same request id on retry, quote_changed, quotes failing to load, 390 width, 44px buttons, coordinator sees the reason as text). Regression: 5C-2 35, 5C-1 48, 5B 42 PASS. `node tools/check-design-system.js` passed. Screenshots viewed at 390.
- NOT RUN: anything in the real Supabase project; a real sign-in; a real payment; the real Job Room opening the approved requests.

## 11. Security and backward compatibility
Authority from `auth.uid()` and booking ownership only; the customer has no table access to the new tables; no function returns coordinator, confirmation, call or request ids; coordinators cannot answer for customers. Ordinary bookings never appear in the customer read. Existing Job Room behaviour is unchanged; the new rows look like tasker-created requests.

## 12. Known limitations / UNVERIFIED in the real project / needed from the owner
- UNVERIFIED: real `message_threads` / `messages` / `payment_requests` columns and triggers (a messages or payment_requests trigger that rejects a row inserted without the tasker's login would make approval fail visibly with a plain message and change nothing); that `payment_requests.kind` rejects `materials` (handled automatically); that the Job Room opens a thread the way `_local_booking_thread` creates it; that the 5A machine allows customer approve/decline from `quote_sent` (checked by the core SQL's first block).
- Not known without `stage-5a1/5a2-core.sql`: whether 5A lets a booking go quote_approved -> awaiting_tasker_confirmation. The new payment_started guard applies either way.
- After the main payment is made, nothing yet moves `lt_status` on (that is 5D-2 / 6 / 7). Booking-card money figures (`Provider Receives`, 12%) are the ordinary ones: Local Tasker 0% is stage 7A.
- No notification is sent to the coordinator on approve/decline (they see it on the booking page).
- Missing files, ask once if needed: stage files 5C/5D, `00-PROJECT-CONTEXT.md`, `DECISIONS.md`. To get any of them: they live in the project's `docs/local-tasker/` folder; upload the zip that contains them.

## 13. Configuration
`stage-5d1-core.sql` WRITTEN, NOT applied. No Edge Function, no secret. Site files must be uploaded.

## 14. Exact next steps (5D-2: milestones and exceptions)
Read the 5D stage file first (not available to this session). Preserve the rules in section 15. Decide what moves the booking after the main payment is confirmed (`_apply_payment` sets the booking to confirmed/paid; `lt_status` is separate).

## 15. Dependencies to preserve
Quote, confirmation and decision tables immutable; `_local_booking_transition` the only writer of `lt_status`; payment_requests are only created by `_local_booking_create_requests` for Local Tasker quotes and never by a coordinator; the quote lines map to kinds in `_local_booking_quote_lines` / `_local_booking_request_kind`; customer read never returns internal ids.

## 16. Manual actions for the owner (Supabase SQL editor and site deploy ONLY)
1. Make sure 5A, 5B, 5C-1, 5C-2 and the two Job Room files are applied. Run `stage-5c2-tests.sql` NOW (after step 2 use `stage-5d1-tests.sql` instead).
2. Paste the whole of `sql/local-tasker/stage-5d1-core.sql`, Run. Expect "Success. No rows returned". If it stops with a message starting "Run ..." or "The Stage 5A state machine ...", send me that text; nothing was changed. Safe twice.
3. Paste the whole of `sql/local-tasker/stage-5d1-tests.sql`, Run. Expected: an error box starting "STAGE 5D-1 TESTS" and ending "RESULT: ALL PASS" (it rolls itself back). A "SKIP:" line is normal. If a FAIL appears, send the text.
4. Upload the new and changed site files (section 5).
The live check is a real booking: coordinator sends a quote, then as the customer open Bookings, approve, and pay in the job room.

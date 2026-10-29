# Stage 5D-3a handoff: customer unreachable, tasker no-show, going-back rule (WRITTEN; SQL tested on a SCRATCH Postgres; browser tested with a MOCKED Supabase; NOTHING run in the real project)

First part of Stage 5D-3 (exceptions). The owner chose this split on 2026-10-29: **5D-3a** (this stage: customer unreachable, tasker no-show, going-back rule) and **5D-3b** (cancellation, dispute, scope or price change). Needs 5A, 5B, 5C-1, 5C-2, 5D-1 and 5D-2 applied.

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
5D-3a: record "customer could not be reached" and "Local Tasker did not come", and stop the booking being sent back to the Local Tasker once "arrived" is recorded.

## 2. Objectives
From the 5D-2 handoff section 14: exceptions that never write payment states. 5D-3a covers the two that are pure records plus the going-back rule. Cancellation, dispute and scope or price change are 5D-3b.

## 3. Owner decisions taken this session (2026-10-29)
- Split 5D-3 into 3a and 3b as above.
- Coordinator cancellation (3b): a NEW coordinator-only function that cancels only when nothing is paid or held, with the same effects as `job_cancel`. NOT built here.
- Going back: refused once "arrived" is recorded (use a dispute or a recorded exception instead). Built here.

## 4. Files inspected
`stage-05d-2.md`, `IMPLEMENTATION-STATUS.md`, `stage-5d2-core.sql`, `stage-5d1-core.sql` (`_local_booking_transition`), `stage-5c2-core.sql` (quote table), the 5D-2 UI and test harness, and the real function bodies in the owner's CSV: `job_cancel`, `open_job_dispute`, `withdraw_job_dispute`, `job_booking_frozen`. The CSV also holds `_release_escrow`, `_settle_after_dispute`, `support_resolve_dispute`, `job_custom_request` (read for 5D-3b, not used here).
NOT available: stage files 5A to 5D, `00-PROJECT-CONTEXT.md`, `DECISIONS.md`, the real 5A SQL. The stage file's own wording for 5D was not seen; the list of exceptions comes from the 5D-2 handoff section 14.

## 5. Files created or modified
NEW: `sql/local-tasker/stage-5d3a-core.sql`, `stage-5d3a-rollback.sql`, `stage-5d3a-tests.sql`; `js/coordinator-exceptions.js`; `docs/local-tasker/tests/stage-5d3a/` (`scratch-scaffold.sql`, `fake-coordinator-supabase.js`, `fake-customer-supabase.js`, `run-5d3a.py`); this handoff.
MODIFIED: `coordinator-booking.html` (the "When something goes wrong" card and one script tag), `js/coordinator-booking.js` (one mount line), `js/coordinator-milestones.js` (no-show message), `js/coordinator-confirmation.js` (messages for the new refusals on "send back"), `js/coordinator-bookings-common.js` (history label), `css/coordinator.css`, `js/customer-quote.js` (loads and shows exceptions in "Progress on the day"), `css/customer-bookings.css`, `docs/local-tasker/tests/stage-5d1/run-5d1.py` (one check now also allows the new read-only exceptions call), `docs/local-tasker/IMPLEMENTATION-STATUS.md`.

## 6. Database objects
- NEW table `local_booking_exceptions` (booking_id, kind, request_id unique, happened_at, recorded_at, coordinator_id, note <= 300). Kinds: `customer_unreachable`, `tasker_no_show`. Immutable (trigger; only the booking cascade may delete). RLS on, admin read only, NO browser grants.
- NEW trigger `lbx_audit`: one `local_booking_events` row (`kind = 'exception'`, `to_status` = the kind) and one `local_tasker_audit` row (`local_booking_exception`) per record.
- NEW `local_booking_record_exception(p_booking, p_request_id, p_kind, p_happened_at, p_note)`. Order of refusals: not the active managing coordinator (`not_found`); unknown kind or missing request id or long note (`bad_input`); retry returns the earlier result; closed (`booking_closed`); open problem report (`dispute_open`); then per kind:
  - `customer_unreachable`: only at `quote_sent` or `quote_approved` (`wrong_step`); at most 5 per booking (`limit_reached`).
  - `tasker_no_show`: only at `quote_approved` (`wrong_step`); not once arrived/started/finished is recorded (`already_arrived`); once per current quote (`already_recorded`).
  - time within the last 3 days, not in the future (`bad_time`).
- NEW reads: `local_booking_exceptions(p_booking)` (coordinator: items, `can_unreachable`/`unreachable_blocked`, `can_no_show`/`no_show_blocked`, `no_show_standing`, `can_go_back`) and `local_booking_customer_exceptions(p_booking default null)` (customer, own bookings only: kind and time, no ids, no notes).
- NEW internal `_local_booking_no_show_standing(p_booking)` (service_role only): a no-show "stands" while it was recorded at or after the creation of the CURRENT quote (or when the booking has no current quote). Sending the booking back replaces the quote (5C-2), so the old no-show then stops standing.
- REPLACED (5D-2 objects, same signatures): `_local_booking_milestone_block` (returns `no_show` while one stands, after the `not_approved` check) and `local_booking_record_milestone` (identical to 5D-2 plus the refusal hint `no_show_standing`). `stage-5d2-tests.sql` still passes afterwards (45 PASS).
- NEW trigger `lbs_going_back_guard` (BEFORE UPDATE OF lt_status on `local_booking_state`): refuses a move to `awaiting_tasker_confirmation` when arrived, started or finished is recorded (hint `work_started`). It raises inside the same transaction, so the superseding of the confirmation and quote that `_local_booking_transition` does just before is rolled back with it. `_local_booking_transition` itself is NOT replaced.
- NOT touched: `lt_status` (no new status), bookings, payment_requests, payment_intents, escrow, wallets, release code, `job_cancel`, `open_job_dispute`, Edge Functions.

## 7. Existing components reused
`_local_booking_log`, `local_tasker_audit`, `job_booking_frozen`, `_local_booking_is_open`, `is_active_coordinator`, the 5D-2 immutability and cascade pattern, `.co-card` / `.co-form` / `.co-check` / `.co-bk-event`, `.bk-ms-*` on the customer page.

## 8. New functionality
Coordinator booking page: a "When something goes wrong" card (only at quote sent or approved, or when something is already recorded): two choices, a time (defaults to now) and an optional note; an unavailable choice is greyed out with the reason. The "On the day" card says why steps are blocked while a no-show stands. "Send back to the Local Tasker" now gives a plain message when it is refused after arrival or after payment started. Customer Bookings page: "Progress on the day" also lists "We tried to reach you and could not" and "The Local Tasker did not arrive as agreed", with a line that it changes no payment. The booking history names both exceptions.

## 9. Decisions (owner may overrule)
- D88: exceptions are RECORDS of what the coordinator learned; they never move `lt_status`, the booking or any money. A no-show does not cancel anything: until 5D-3b the coordinator can only send the booking back to the Local Tasker (which lets the day-of steps start again after a new quote) or leave it.
- D89 (DEFAULT): "unreachable" is repeatable up to 5 times per booking and only while the customer is being waited on (quote sent or approved). The limit of 5 is a guess for the owner to adjust (one line in `local_booking_record_exception` and `local_booking_exceptions`).
- D90 (DEFAULT): a no-show can be recorded once per current quote, only after approval, and never after "arrived".
- D91: going back is refused after "arrived" (owner decision). "Address confirmed" alone does not stop it.
- D92: the customer sees the kind and time of an exception, never the coordinator's note.

## 10. Tests ACTUALLY run
- SQL on a scratch Postgres (pgserver, NOT Supabase): `stage-5d2-core.sql`, `stage-5d3a-core.sql` (loaded twice, no error), `stage-5d3a-tests.sql`: 47 PASS, 0 FAIL, 0 SKIP, run twice. Then `stage-5d2-tests.sql` with 5D-3a installed: 45 PASS. Then rollback twice, `stage-5d2-core.sql`, `stage-5d2-tests.sql` (45 PASS), core and tests again: PASS. Covers: privileges; who may call; bad input; wrong step; retry and request-id reuse; bad times; limit of five; booking row (md5) unchanged, no payment rows, `lt_status` unchanged; a standing no-show blocks day-of steps and stops standing after the quote is replaced; arrived blocks a no-show and blocks going back; going back before arrival and other status moves still work; customer read has no ids or notes; audit rows; immutability; closed booking; open problem report; cascade delete.
- STAND-INS on the scratch database: auth, users, coordinators, bookings, payment tables, `job_booking_frozen`, `job_disputes`, and a minimal `local_booking_quotes` (booking_id, superseded_at, created_at only). REAL: the 5A state and events tables and `_local_booking_log` (as in 5D-2). The real `_local_booking_transition` was NOT loaded, so the going-back trigger was tested by updating `local_booking_state` directly.
- Browser, mocked Supabase (`tests/stage-5d3a/run-5d3a.py`): 32 PASS, 0 FAIL (card states, exact call arguments, note shown as text, choices disabled with reasons, retry with the same request id, server refusal text, load failure, 390 width, 44px button, no payment or cancel function called, history labels, customer block, load failure never breaks the page). One real bug was found by these tests and fixed (clearing the time field refilled it). Regression on the new tree: 5D-2 26, 5D-1 23 (one check changed, see section 5), 5C-2 35, 5C-1 48, 5B 42, all PASS. `node tools/check-design-system.js` passed. Screenshots viewed at 1440 (coordinator); 390 and customer shots were produced and checked only by the width/height tests.
- NOT RUN: anything in the real Supabase project; a real sign-in; the real `_local_booking_transition` with the new trigger; a real payment.

## 11. Security and backward compatibility
Authority from `auth.uid()` and the booking's recorded coordinator only; nothing writable from the browser except through the one function; customers cannot record; coordinators cannot touch payment objects (checked by md5 and counts). Ordinary bookings are not involved. The only change to an existing path is the new refusal on moving to `awaiting_tasker_confirmation` after arrival, and the no-show refusal inside `local_booking_record_milestone`.

## 12. Known limitations / UNVERIFIED / decisions required
- UNVERIFIED in the real project: that `stage-5d3a-tests.sql` runs there. Two blocks self-skip if the real tables differ: the "quote replaced" test (the real `local_booking_quotes` has NOT NULL columns, so inserting a stand-in row will likely fail and print `SKIP:`; the rule is then UNVERIFIED until a real re-quote is done through the app) and the open-problem-report test (real `job_disputes` is keyed by thread).
- UNVERIFIED: whether the real `local_booking_state` already has other BEFORE UPDATE triggers that interact with `lbs_going_back_guard`. If the core file errors, send the text; nothing else is affected.
- A no-show does not notify anyone and does not start any refund or cancellation. The customer sees it on Bookings only.
- The 5-attempt limit and the 3-day window are defaults (D89).
- The customer view refreshes on page load, not live.
- Reference screens for the exception controls were never supplied; built to the design system (standing instruction 13).

## 13. Configuration or migration requirements
`stage-5d3a-core.sql` WRITTEN, NOT applied. No Edge Function, no secret. Site files must be uploaded.

## 14. Exact next steps (5D-3b: cancellation, dispute, scope or price change)
Ask the owner for what 3b needs in one batch first (rule 2). Facts already read from the real functions (CSV, 2026-10-29):
- `job_cancel(p_thread, p_reason, p_note)` needs `auth.uid()` to be the customer or the tasker of the thread, so a coordinator cannot call it. It refuses when anything is paid or held, then: sets unpaid/failed `payment_requests` to `cancelled`, expires pending `job_requests`, sets `bookings.status = 'cancelled'`, writes `_job_event`. The new coordinator function must reproduce these effects. DECIDE with the owner: cancelling unpaid `payment_requests` IS a write to a payment state, which conflicts with the rule "no exception function writes payment states". Options: (a) allow only that one write and say so in the handoff, (b) call a service-role helper that does it, (c) leave the unpaid requests and let them expire. Do not choose silently.
- `open_job_dispute(p_thread, ...)` needs the customer or tasker of the thread (a Local Tasker cannot log in), categories `not_done, poor_quality, no_show, wrong_amount, payment_issue, other`, reason 10 to 1000 characters, max 3 per 24 hours, one open per thread. 3b needs a coordinator "open on behalf of the Local Tasker" path, with `opened_by_role` and the `job_disputes` columns checked against the real table (UNVERIFIED: only the function body was seen).
- `job_booking_frozen` is true while a dispute is `open` or `under_review`; every 5D function already respects it.
- Scope or price change after approval needs a new recorded Local Tasker confirmation and a new customer approval before any extra money is collected. The going-back rule here means that is only possible before "arrived"; after arrival it must go through a dispute or a recorded exception.
- Ask for the real `job_disputes` columns and `dispute_events` columns (a one-row-per-section introspect query, with the Supabase clicks, rule 9).

## 15. Dependencies to preserve
`local_booking_exceptions` immutable and written only by `local_booking_record_exception`; exceptions never write `lt_status`, bookings, payment_requests, payment_intents, escrow or wallets; the customer read never returns internal ids or the coordinator's note; `_local_booking_transition` stays the only writer of `lt_status`; the going-back trigger stays; all 5C/5D rules in the 5D-1 and 5D-2 handoffs.

## 16. Manual actions for the owner (Supabase SQL editor and site deploy ONLY)
1. Make sure 5A, 5B, 5C-1, 5C-2, 5D-1 and 5D-2 are applied.
2. Paste the whole of `sql/local-tasker/stage-5d3a-core.sql`, Run. Expect "Success. No rows returned". If it stops with a message starting "Run ..." or "A Stage 5A / 5C / 2B function is missing", send me that text; nothing was changed. Safe twice.
3. Paste the whole of `sql/local-tasker/stage-5d3a-tests.sql`, Run. Expected: an error box starting "STAGE 5D-3a TESTS" and ending "RESULT: ALL PASS" (it rolls itself back). A "SKIP:" line is normal. If a FAIL appears, send the text.
4. Upload the new and changed site files (section 5).
The live check is a real booking: as the coordinator open an approved booking, record "I couldn't reach the customer" and then the customer's Bookings page shows it under "Progress on the day".

# Stage 5D-2 handoff: milestones on the day of the job (WRITTEN; SQL tested on a SCRATCH Postgres; browser tested with a MOCKED Supabase; NOTHING run in the real project)

Second part of Stage 5D (5D-1 approval, **5D-2 milestones**, 5D-3 exceptions: the stage file's own split rule). Needs 5A, 5B, 5C-1, 5C-2 and 5D-1 applied.

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
5D-2: Coordinator milestone recording (address confirmed, arrived, started, finished) and the customer's read-only progress view.

## 2. Objectives
Stage file 5D: "Coordinator milestone recording (tasker confirmed address, arrived, started, finished) that cannot create or alter payment events." Acceptance: "Milestone recording does not touch payment tables (verified by query)." Exceptions (customer unreachable, scope change, no-show, cancellation, dispute) are 5D-3, NOT done here.

## 3. Initial assumptions and relevant existing architecture
The real 5A SQL was supplied this time (`stage-5a1-core.sql`, `stage-5a2-core.sql`): `lt_status` lives in `local_booking_state`; events in `local_booking_events` (no CHECK on `kind`); `_local_booking_log`, `_local_booking_is_open`, `job_booking_frozen`, `local_tasker_audit`. After `quote_approved` the machine (as replaced by 5C-1/5C-2/5D-1) only lets the coordinator go back to `awaiting_tasker_confirmation`. Milestones do NOT use `lt_status` (it stays `quote_approved`): they are their own table, so the only writer of `lt_status` is still `_local_booking_transition`.

## 4. Files inspected
Stage files 5A, 5B, 5C, 5D; `00-PROJECT-CONTEXT.md`; `DECISIONS.md`; handoff 5D-1; IMPLEMENTATION-STATUS; `stage-5a1/5a2-core.sql`; `stage-5c2-core.sql`, `stage-5d1-core.sql` (patterns); `coordinator-booking.html`, `js/coordinator-booking.js`, `js/coordinator-quote.js`, `js/coordinator-bookings-common.js`, `js/customer-quote.js`, `css/coordinator.css`, `css/customer-bookings.css`, the 5D-1 test harness.
NOT available and not needed: `messaging-step6/7.sql` (milestones never touch the payment path), `01-MASTER-BRIEF.md`. The owner gave NO reference screen for the milestone controls: built to the design system and the existing coordinator cards (standing instruction 13).

## 5. Files created or modified
NEW: `sql/local-tasker/stage-5d2-core.sql`, `stage-5d2-rollback.sql`, `stage-5d2-tests.sql`; `js/coordinator-milestones.js`; `docs/local-tasker/tests/stage-5d2/` (`scratch-scaffold.sql`, `fake-coordinator-supabase.js`, `fake-customer-supabase.js`, `run-5d2.py`); this handoff.
MODIFIED: `coordinator-booking.html` (the "On the day" card and one script tag), `js/coordinator-booking.js` (one mount line), `js/coordinator-bookings-common.js` (history label for a milestone event), `css/coordinator.css` (card spacing), `js/customer-quote.js` (loads and shows the progress block), `css/customer-bookings.css` (progress list), `docs/local-tasker/tests/stage-5d1/run-5d1.py` (one check now also allows the new read-only milestones call), `docs/local-tasker/IMPLEMENTATION-STATUS.md`.

## 6. Database objects
- NEW table `local_booking_milestones` (booking_id, kind, request_id unique, happened_at, recorded_at, coordinator_id, note <= 300). Unique per (booking, kind). Immutable (trigger; only the booking cascade may delete). RLS on, admin read only, NO browser grants.
- NEW trigger `lbm_audit`: every row writes one `local_booking_events` row (`kind = 'milestone'`, `to_status` = the milestone) and one `local_tasker_audit` row (`local_booking_milestone`).
- NEW `local_booking_record_milestone(p_booking, p_request_id, p_kind, p_happened_at, p_note)` (coordinator rpc). Rules in order: active coordinator who manages the booking (else `not_found`); known kind and request id (`bad_input`); retry returns the earlier result; booking open (`booking_closed`); no open problem report (`dispute_open`); `lt_status = quote_approved` (`not_approved`); not already recorded (`already_recorded`); in order address_confirmed, arrived, started, finished (`out_of_order`); `started` needs `bookings.payment_status` not null/unpaid/pending (`payment_needed`); time within the last 3 days, not in the future (+5 min), not earlier than the previous step (`bad_time`).
- NEW `local_booking_milestones(p_booking)` (coordinator read: items, next_kind, can_record, blocked_reason) and `local_booking_customer_milestones(p_booking default null)` (customer read of their OWN bookings: kind and happened_at only; no coordinator id, note, request id or recording time).
- NEW internal (service_role only): `_local_booking_milestone_order`, `_local_booking_milestone_block`.
- NOT touched: `_local_booking_transition`, `lt_status`, bookings (read only), payment_requests, payment_intents, escrow, wallets, release code, Edge Functions.

## 7. Existing components reused
`_local_booking_log`, `local_tasker_audit`, `job_booking_frozen`, `_local_booking_is_open`, `is_active_coordinator`, the 5D-1 immutability and cascade pattern, `.co-card` / `.co-form` / `.co-bk-event` / `.btn`, `.bk-q` / `.bk-q-title` on the customer page.

## 8. New functionality
Coordinator booking page: an "On the day" card (only once the quote is approved) shows what is recorded, asks for the next step with one button ("Record: address confirmed", etc.), a time field (defaults to now) and an optional note. Blocked states say why (not approved, payment needed, problem report, closed, all recorded). Retry-safe (same request id until success). Customer Bookings page: a read-only "Progress on the day" list under the quote card. A milestone event shows by name in the booking history.

## 9. Decisions (owner may overrule)
- D83: milestones are a record of what the Local Tasker SAID by phone; they never move `lt_status`, the booking status or any payment. "Finished" does NOT mark the job done or ask for the release code (stages 6 and 7).
- D84 (DEFAULT): "started" needs the main payment on record (`payment_status` not unpaid/pending). The set of values is taken from 5D-1's own wording; the real column's other values are UNVERIFIED. Remove the one line in `_local_booking_milestone_block` if the owner wants work to be recordable before payment.
- D85: the four steps are strictly ordered and each is recorded once; a mistake cannot be edited or deleted (same rule as every record in this project). A wrong entry is handled in 5D-3 / support, not by editing.
- D86: the time is the time of the event as told to the coordinator, limited to the last 3 days and never in the future.
- D87: the customer sees the steps and times but never the coordinator's note.

## 10. Tests ACTUALLY run
- SQL on a scratch Postgres 16 (NOT Supabase): `stage-5d2-core.sql` loaded twice with no error; `stage-5d2-tests.sql`: 45 PASS, 0 FAIL, 0 SKIP, run twice; rollback run twice, then core and tests again: PASS. Covers: privileges; before approval; other coordinator, customer, visitor, suspended coordinator, regular booking all refused; bad inputs leave nothing; order; retry and request-id reuse; duplicates; three bad times; payment gate (unpaid and pending refused, paid accepted); the booking row (md5) unchanged, no payment_requests or payment_intents created, `lt_status` unchanged; coordinator and customer reads; no leaking in the customer read; one event and one audit row per step; immutability; closed booking; open problem report; cascade delete.
- STAND-INS: auth, users, coordinators, `bookings`, payment tables, `job_booking_frozen`, `local_tasker_audit`, `job_disputes`, and the 5D-1 objects the pre-flight looks for. REAL: the 5A state and events tables and `_local_booking_log` (copied from `stage-5a1-core.sql`). The scratch run does NOT load the real 5C/5D payment path.
- Browser, mocked Supabase (`tests/stage-5d2/run-5d2.py`): 26 PASS, 0 FAIL (card states, exact call arguments, note shown as text, order of buttons, payment-blocked state, all-recorded state, no card at the wrong steps, history label, time validation, failed save and same-request-id retry, server refusal text, load failure, 390 width, 44px button, customer progress block, no buttons there, load failure never breaks the page, no payment function called). Regression: 5D-1 23, 5C-2 35, 5C-1 48, 5B 42 PASS (the 5D-1 harness had one check changed, see section 5). `node tools/check-design-system.js` passed. Screenshots viewed at 390 (coordinator and customer).
- NOT RUN: anything in the real Supabase project; a real sign-in; a real payment.

## 11. Security and backward compatibility
Authority from `auth.uid()` and the booking's recorded coordinator only; nothing writable from the browser except through the one function; no function returns the release code or contact details; customers cannot record; coordinators cannot touch payment objects (checked by md5 and counts). Ordinary bookings are not involved. `lt_status` and every earlier function are unchanged.

## 12. Known limitations / UNVERIFIED / decisions required
- UNVERIFIED in the real project: the real `bookings.payment_status` values and `status` values; that direct inserts as the database owner in the tests file are accepted by the real bookings triggers (if the tests file stops at the setup with an error, send me the text: nothing else is affected); the real `job_disputes` shape (that test self-skips if it differs).
- Going back to the Local Tasker (`quote_approved -> awaiting_tasker_confirmation`, a scope or price change) is still allowed after milestones exist. Recorded milestones stay on the booking. 5D-1 already refuses it once a payment has started. Whether to also refuse it after "arrived" or "started" belongs to 5D-3 (exceptions); it was left out to keep this stage small.
- No notification is sent to the customer when a step is recorded (they see it on Bookings).
- The customer progress block updates when the page loads or refreshes, not live.
- 5D-3 (customer unreachable, scope change, no-show, cancellation, dispute) is NOT started. Reference screens for the exception controls were never supplied.

## 13. Configuration or migration requirements
`stage-5d2-core.sql` WRITTEN, NOT applied. No Edge Function, no secret. Site files must be uploaded.

## 14. Exact next steps (5D-3: exceptions)
Read stage file 5D. Build: customer unreachable, tasker no-show, cancellation (reuse `job_cancel`), dispute (reuse `open_job_dispute`), and scope or price change after approval (needs a new recorded tasker confirmation and a new customer approval before extra money is collected). Decide the rule for going back after a milestone (section 12). Do not let any exception function write payment states.

## 15. Dependencies to preserve
`local_booking_milestones` immutable and written only by `local_booking_record_milestone`; milestones never write `lt_status`, bookings, payment_requests, payment_intents, escrow or wallets; `_local_booking_transition` stays the only writer of `lt_status`; the customer read never returns internal ids or the coordinator's note; all earlier 5C/5D rules in the 5D-1 handoff section 15.

## 16. Manual actions for the owner (Supabase SQL editor and site deploy ONLY)
1. Make sure 5A, 5B, 5C-1, 5C-2 and 5D-1 are applied (5D-2 replaces no 5D-1 function, so `stage-5d1-tests.sql` still passes afterwards).
2. Paste the whole of `sql/local-tasker/stage-5d2-core.sql`, Run. Expect "Success. No rows returned". If it stops with a message starting "Run ..." or "A Stage 5A / 2B function is missing", send me that text; nothing was changed. Safe twice.
3. Paste the whole of `sql/local-tasker/stage-5d2-tests.sql`, Run. Expected: an error box starting "STAGE 5D-2 TESTS" and ending "RESULT: ALL PASS" (it rolls itself back). A "SKIP:" line is normal. If a FAIL appears, send the text.
4. Upload the new and changed site files (section 5).
The live check is a real booking: after the customer approves and pays, open the booking as the coordinator, go to "On the day", record the steps; as the customer, open Bookings and see "Progress on the day".

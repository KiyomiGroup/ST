# Stage 5C-2 handoff: itemised quote (WRITTEN; SQL tested on a SCRATCH Postgres; browser tested with a MOCKED Supabase; NOTHING run in the real project)

Second half of Stage 5C (split rule: 5C-1 tasker confirmation, 5C-2 quote builder). Needs 5A, 5B and 5C-1 applied first.

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
5C-2: Quote builder.

## 2. Objectives
Build the itemised quote (service fee, transport, materials, other agreed costs, total). The service fee comes from the tasker-confirmed price and the coordinator cannot change it, only request a new tasker confirmation. Reuse the Job Room money kinds; no parallel money model; no payment collection.

## 3. Initial assumptions and relevant existing architecture
5C-1 `local_booking_confirmations` (the recorded price and the tasker's stated transport and materials), 5A state machine, 5B booking page. Job Room money rules read from `js/messages-money.js`: kinds `full_payment`/`payment` (main price, escrow), add-ons `transport`, `materials`, `additional_cost`; minimum request ₦100, maximum ₦10,000,000. The `payment_requests` table definition and its guard trigger were NOT in the uploaded files (`sql/messaging-step6.sql` and `-step7.sql` missing), so nothing here writes to that table. No reference screen supplied: standing instruction 13 applies.

## 4. Files inspected
Stage 5C and 5D stage files, 00-PROJECT-CONTEXT.md, DECISIONS.md (S5), IMPLEMENTATION-STATUS.md, handoffs 5B and 5C-1, `js/messages-money.js`, `js/messages-requests.js` (limits), 5C-1 SQL/JS/tests, `coordinator-booking.html` and its JS, `css/coordinator.css`.

## 5. Files created or modified
NEW: `sql/local-tasker/stage-5c2-core.sql`, `stage-5c2-rollback.sql`, `stage-5c2-tests.sql`; `js/coordinator-quote.js`; `docs/local-tasker/tests/stage-5c2/fake-bookings-supabase.js`, `run-5c2.py`; this handoff.
MODIFIED: `coordinator-booking.html` (quote card, one script tag), `js/coordinator-booking.js` (mounts the card), `js/coordinator-confirmation.js` (next-step note text only), `css/coordinator.css` (5C-2 section appended), `docs/local-tasker/tests/stage-5c1/fake-bookings-supabase.js` and `run-5c1.py` (one expected text; the fake now also knows the quote calls), `docs/local-tasker/IMPLEMENTATION-STATUS.md`.

## 6. Database tables, columns, relationships, policies, migrations, functions affected
- NEW table `local_booking_quotes`: one row per version (`booking_id`, `confirmation_id` FK to the confirmation the fee came from, `version`, `service_fee`, `transport_amount`, `materials_amount`, `other_amount`, `other_label`, `other_note`, `total`, `note`, `superseded_at`). CHECKs: total = sum of the lines; each add-on 0 or at least 100; total at most 10,000,000; other cost needs a label and cannot exceed the service fee. One current quote per booking (partial unique index). RLS on, one administrator read policy, no browser insert/update/delete. Triggers: `lbq_guard` (immutable except `superseded_at`, no delete except the booking cascade) and `lbq_audit` (event row and `local_tasker_audit` row on every quote and supersede).
- NEW functions: `local_booking_send_quote(p_booking, p_request_id, p_transport, p_materials, p_other, p_other_label, p_other_note, p_note)`, `local_booking_quote(p_booking)` (read), internal `_local_booking_quote_lines`. The send function has NO parameter for the service fee.
- REPLACED (same signatures): `_local_booking_transition` (quote_sent now also needs a current quote built from the CURRENT confirmation and the quote function's transaction flag `st.lt_quote`; going back to the tasker retires the current quote too) and `local_booking_step` (refuses quote_sent with hint `use_quote`).
- Nothing touched: `bookings`, `payment_requests`, escrow, wallets, release code.

## 7. Existing components and functions reused
5C-1 confirmation record and its second-check gate, `_local_booking_transition`, `_local_booking_log`, `local_tasker_audit`, `is_active_coordinator`, `job_booking_frozen`; Job Room kind names and limits (mapping in `_local_booking_quote_lines`: service fee `full_payment` (held in escrow), transport `transport`, materials `materials`, other `additional_cost`); coordinator page components and shared form classes.

## 8. New functionality implemented
"The quote" card on `coordinator-booking.html`: shows the service fee as fixed text with a note that it is the tasker's price; transport and materials prefilled with what the tasker said (the ceiling; lower or 0 only; disabled with an explanation when the tasker named none); optional labelled other cost; note; live total preview; "Send the quote". After sending: a read-only summary with the lines and total, the waiting message and earlier versions. After a customer decline (5D will set it) the form reopens prefilled for a revised quote. No form during a pending or failed second check or an open problem report. Retry-safe (same request id until a send succeeds).

## 9. Important technical decisions and reasons
- D72: the fee is never an input anywhere; the database copies it from the confirmed record, so "coordinator cannot change it" holds by construction (tested: no fee-like parameter exists).
- D73: transport and materials can only be lowered from what the tasker confirmed. A coordinator who learns a higher cost must record a new tasker answer (S3). This is stricter than the stage text and easy to relax.
- D74 (DEFAULT, owner may change): "other agreed costs" are allowed with a label and capped at the service fee, because the stage lists the field but no source for the amount exists. They appear as their own line for the customer to approve in 5D. Remove or tighten if the owner prefers.
- D75: no commission or platform-fee line (Local Taskers pay 0%, S5). Whether the customer pays any StreetTasker fee on top is NOT decided here (7A).
- D76: the quote is stored in its own table and mapped to Job Room kinds by name; the `payment_requests` rows are created only after the customer approves (5D) and by the existing payment path, never by a coordinator.
- D77: sending a quote records it and moves the booking to `quote_sent`; the customer cannot see it until 5D builds the approval card. The page says so.

## 10. Tests executed and their ACTUAL results
- SQL, scratch Postgres 16 (NOT Supabase; reconstructed schema with the real 5A functions): `stage-5c2-core.sql` loaded twice with no error on top of 5C-1; `stage-5c2-tests.sql` 79 PASS, 0 FAIL, "RESULT: ALL PASS". It repeats the 5C-1 checks (sending quotes the new way) and adds: no browser access; no fee parameter; raw step and internal transition to quote_sent refused; direct insert refused; six refused quotes (transport/materials above the tasker's figure, transport under 100, other cost without label, other above fee, negative) leave nothing; quote v1 (fee 20000 copied, transport lowered 2000 to 1500, other 1000, total 27500); audit rows; booking row unchanged (md5); retry adds no row; four edits and a delete rejected even for the owner; read function (four lines mapped to Job Room kinds, only the service fee in escrow, ceilings, no commission, no internal ids); other coordinator and customer refused; customer decline then revised v2 retires v1; going back to the tasker retires the quote; no quote while waiting; next quote follows a NEW price (v3, 22000); total above 10,000,000 refused; cascade delete.
- `stage-5c2-rollback.sql` run twice with no error; it restores the 5C-1 functions; `stage-5c1-tests.sql` then passes again; core reloads and tests pass again. `stage-5b-tests.sql` passes with 5C-2 installed.
- Browser, mocked Supabase (`tests/stage-5c2/run-5c2.py`): 35 PASS, 0 FAIL (builder, ceilings, validation without a call, live total, exact arguments with no fee argument, summary after send, five error kinds with no raw database text, same request id on retry, summary, declined revise prefilled, approved, hidden while waiting, second check pending, closed, problem report, no transport/materials, load failure, label shown as text, 390 width, 44px button). Regression: 5C-1 `run-5c1.py` 48, 5B `run-5b.py` 42, `stage-3a/run.py` 307, `run-4c1.py` 57, all PASS. `node tools/check-design-system.js`: passed. Screenshots viewed at 1440 and 390.
- NOT RUN: anything in the real Supabase project; any real sign-in; the administrator function against the real `is_local_tasker_admin()`; `run-4c2.py`.

## 11. Security and backward-compatibility checks
Authority from `auth.uid()` and the state row only. The coordinator has no table access, so a quote or fee cannot be written, edited or deleted outside the send function. No payment, escrow, wallet, release-code or `payment_requests` object is read or written. Regular bookings untouched. `stage-5c1-tests.sql` is NOT valid once 5C-2 is installed (it steps straight to quote_sent): run it BEFORE 5C-2; afterwards `stage-5c2-tests.sql` is the state machine test.

## 12. Known limitations, unresolved problems, decisions still required
- UNVERIFIED in the real project: all items listed in the 5C-1 handoff; that `payment_requests` kinds `full_payment`, `transport`, `materials`, `additional_cost` exist exactly as `messages-money.js` names them (mapping is by name only, nothing is inserted).
- Decisions the owner may overrule: D73 (lower only), D74 (other costs and the cap), D75 (no customer-side fee decided).
- The customer cannot yet see or approve a quote (5D-1). The administrator second-check screen is not built (8B). Admins are still not notified of `needs_reassignment` (5A).
- Observed earlier, for 9A: `anon` DML grants on `bookings`.

## 13. Configuration or migration requirements
`stage-5c2-core.sql` WRITTEN, NOT applied. No Edge Function, no secret. Site files must be uploaded (section 5).

## 14. Exact next steps for the next stage (5D-1: customer approval of the quote)
Add a customer-side read of the current quote for the customer's own booking and the customer decision through `_local_booking_transition(..., 'quote_approved' | 'quote_declined', customer, 'customer')` (already allowed in the machine for the customer role only). On approval, create the payment through the EXISTING flow using the quote lines and `_local_booking_quote_lines` (service fee as the main escrow payment, add-ons as `transport` / `materials` / `additional_cost` requests), never by writing payment states. Read `js/customer-bookings.js`, `js/messages-cards.js`, `js/messages-flow.js`, `js/messages-money.js` and the real `payment_requests` definition first. If the owner does not supply a reference screen, build to the design system and the existing customer booking cards. A scope or price change after approval needs a new tasker confirmation (5C-1) and a new customer approval.

## 15. Dependencies the next stage must preserve
The quote and confirmation tables stay immutable; `_local_booking_transition` is the only writer of `lt_status`; `st.lt_quote` and `st.lt_capture` are set only inside their own functions; the quote service fee always equals the current confirmation's price; the coordinator read functions never return `request_id`, internal ids or the release code.

## 16. Manual actions required from the project owner (Supabase SQL editor and site deploy ONLY)
1. Make sure 5A, 5B and 5C-1 are applied. Run `stage-5c1-tests.sql` NOW, before step 2 (after step 2 it is replaced by `stage-5c2-tests.sql`).
2. Paste the whole of `sql/local-tasker/stage-5c2-core.sql`, Run. Expect "Success. No rows returned". Safe twice.
3. Paste the whole of `sql/local-tasker/stage-5c2-tests.sql`, Run. Expected: an error box starting "STAGE 5C-2 TESTS" and ending "RESULT: ALL PASS" (it rolls itself back). If a FAIL appears, send the text. A line "SKIP: administrator function not testable here" is normal.
4. Upload the new and changed site files (section 5).
The live check is a real booking: record the call, then build and send the quote under Bookings.

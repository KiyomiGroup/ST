# Stage 5C-1 handoff: Local Tasker confirmation recording (WRITTEN; SQL tested on a SCRATCH Postgres; browser tested with a MOCKED Supabase; NOTHING run in the real project)

Split as the stage file's SPLIT RULE says: 5C-1 (this: tasker confirmation) and 5C-2 (quote builder, NOT started). Needs `stage-5a1-core.sql`, `stage-5a2-core.sql` and `stage-5b-core.sql` applied first.

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
5C-1: Tasker confirmation recording (settled design S3).

## 2. Objectives
The coordinator phones the Local Tasker and records, in a structured and audited way, who was called, the number, the time and what was agreed (available, can do it, the tasker's own price, duration, transport, materials, limits). The tasker's price is writable only through this record. A booking cannot reach `quote_sent` without a valid current record. Optional admin call-back field, off by default. No paid SMS or voice service.

## 3. Initial assumptions and relevant existing architecture
5A `local_booking_state`, `local_booking_events`, `_local_booking_transition`, `local_booking_step`; 5B detail page and `STCoBk`. The owner supplied no reference screen; standing instruction 13 applies (design system and existing coordinator pages), so the UI is NOT marked blocked.

## 4. Files inspected
Stage 5C file, 00-PROJECT-CONTEXT.md, IMPLEMENTATION-STATUS.md, handoffs 5A and 5B, `stage-5a1-core.sql`, `stage-5a2-core.sql`, `stage-5a-tests.sql`, 5A and 5B scratch scaffolds, `stage-5b-core.sql`, `coordinator-booking.html`, `js/coordinator-booking.js`, `js/coordinator-bookings-common.js`, `css/coordinator.css`, `coordinator-service-edit.html` and its JS (form conventions), `tools/check-design-system.js`.

## 5. Files created or modified
NEW: `sql/local-tasker/stage-5c1-core.sql`, `stage-5c1-rollback.sql`, `stage-5c1-tests.sql`; `js/coordinator-confirmation.js`; `docs/local-tasker/tests/stage-5c1/fake-bookings-supabase.js`, `run-5c1.py`; this handoff.
MODIFIED: `coordinator-booking.html` (new card, one script tag), `js/coordinator-booking.js` (mounts the card), `js/coordinator-bookings-common.js` (history labels only), `css/coordinator.css` (5C-1 section appended, tokens only), `docs/local-tasker/IMPLEMENTATION-STATUS.md`.

## 6. Database tables, columns, relationships, policies, migrations, functions affected
- NEW table `local_booking_confirmations` (one row per call; FK to `bookings` on delete cascade; `request_id` unique; one CURRENT confirmed/declined row per booking via partial unique index; CHECKs: confirmed needs available, can do, price > 0, duration and read-back; amounts 0..10,000,000). RLS on, one policy (administrators read), `authenticated` has SELECT only through that policy, no insert/update/delete for anyone but `service_role`. Triggers: `lbc_guard` (every column except `superseded_at` and the second-check fields is frozen, even for the table owner; no delete except the booking cascade) and `lbc_audit` (event row in `local_booking_events` and a `local_tasker_audit` row on insert, supersede and second-check change).
- NEW functions (browser, `authenticated`): `local_booking_record_confirmation(...17 args)`, `local_booking_confirmations(uuid)` (read), `local_booking_second_check(uuid, boolean, text)` (admin only, `is_local_tasker_admin()`).
- REPLACED 5A functions, same signatures: `_local_booking_transition` (adds: quote_sent needs a current confirmed record for this tasker and a second check of `off` or `passed`; `tasker_confirmed`/`tasker_declined` only when the record function sets the transaction-local flag `st.lt_capture`; going back to `awaiting_tasker_confirmation` marks the current record superseded) and `local_booking_step` (refuses `tasker_confirmed`/`tasker_declined` with hint `use_confirmation`).
- No column of `bookings` touched. No payment, escrow, wallet or release-code object touched.

## 7. Existing components and functions reused
`_local_booking_transition`, `_local_booking_log`, `_local_booking_is_open`, `job_booking_frozen`, `is_active_coordinator`, `is_local_tasker_admin`, `local_tasker_audit`, `local_tasker_profiles.phone/full_name`; 5B detail page, `STCo`, `STCoBk`, `.co-card`, `.co-form`, `.co-facts`, `.co-check`, `.co-bk-history`, shared `.form-*` and `.btn`.

## 8. New functionality implemented
- Card "The Local Tasker's answer" on `coordinator-booking.html`: form while the booking is new or waiting (name and number prefilled from the profile, time of call, outcome: can do / can't do / no answer; for "can do": available, can do, price, duration, transport, materials, limits, read-back tick, optional second-check tick); summary once recorded; calls listed; "Record a new answer" (two-step) sends the booking back to the tasker and retires the old record.
- Retry-safe saves (same request id until a save succeeds). A "no answer" call is logged and changes nothing except moving a new booking to "waiting".
- Quote gate and second check as described in section 6.

## 9. Important technical decisions and reasons
- D66: price is stored ONLY in the confirmation table and the table is immutable; "coordinator price edit rejected" is enforced as no grant + trigger, not as a check inside a function. A new price means a new call (new row, old one kept).
- D67: acceptance is a by-product of the record function (transaction-local flag), not a status the coordinator can pick.
- D68: second check is a field on the record, off unless the coordinator ticks it; blocks `quote_sent` until an administrator records "passed". The admin screen is not built (8B); the function is.
- D69: `number_matches_profile` is stored and shown as a warning, not a block (the tasker may use another phone).
- D70: transport and materials amounts are STORED here as what the tasker said; they are not money yet. 5C-2 turns them into quote lines using the Job Room `payment_requests` kinds. Nothing in 5C-1 touches `payment_requests`.
- D71: the 5B next-step wording was left unchanged so the 5B browser tests stay valid; the card carries the instruction.

## 10. Tests executed and their ACTUAL results
- SQL, scratch Postgres 16 (NOT Supabase; reconstructed schema with the real 5A functions): `stage-5c1-core.sql` loaded twice with no error; `stage-5c1-tests.sql` 50 PASS, 0 FAIL, "RESULT: ALL PASS" (run several times). Also run with the administrator stand-in switched off (the two administrator steps then show SKIP and the result is written directly): ALL PASS. Covers: privileges; no direct insert/update (42501); step to tasker_confirmed/declined refused, also internally; 9 invalid records refused and leave nothing; other coordinator / customer / no user get not_found; no-answer; confirmed record stored in full, second check off by default, number match, events and audit row, booking row unchanged (md5); retry adds no row; five kinds of edit and a delete rejected even for the owner; quote_sent allowed with a record; new price refused behind a sent quote; going back retires the old record; second check requested / passed / failed gates the quote; declined has no price and cannot reach quote_sent; quote_sent refused with no record even if the state were forced; closed booking refused; read function shape; foreign coordinator and customer refused; 5B detail still works; cascade delete.
- `stage-5c1-rollback.sql` run twice with no error; it restores the two 5A functions and removed every 5C-1 object; `stage-5a-tests.sql` passes again after it. `stage-5a-tests.sql` and `stage-5b-tests.sql` both pass BEFORE 5C-1 (5B also after).
- Browser, mocked Supabase (`tests/stage-5c1/run-5c1.py`, Chromium): 48 PASS, 0 FAIL (form prefill, validation without a call, exact rpc arguments, no payment fields, summary after save, errors never show raw database text, same request id on retry, declined, no answer, redo flow, quote-sent warning, second check, hidden for closed / problem / needs-coordinator, load failure, XSS text, 390 width no sideways scroll, 44px buttons). Regression: 5B `run-5b.py` 42, `stage-3a/run.py` 307, `run-4c1.py` 57, all PASS. `node tools/check-design-system.js`: passed. The test run caught one real bug (a `hidden` attribute overridden by `.co-form-actions`), fixed.
- Screenshots viewed at 1440 and 390 (form, summary).
- NOT RUN: anything in the real Supabase project; any real sign-in; the administrator function against the real `is_local_tasker_admin()`; `run-4c2.py`.

## 11. Security and backward-compatibility checks
Authority comes from `auth.uid()` and the state row. The coordinator has no table grant, so the tasker's price cannot be written, edited or deleted by any route except the record function, and never changed in place. The coordinator cannot approve a quote or mark acceptance without a call record. Regular bookings are untouched. `stage-5a-tests.sql` is NOT valid once 5C-1 is installed (it steps straight to `tasker_confirmed`, which 5C-1 forbids on purpose): run it before 5C-1; afterwards `stage-5c1-tests.sql` is the state machine test. Until 5C-2, a coordinator can still call `local_booking_step(..., 'quote_sent')` with a valid record; 5C-2 must replace that with the quote builder.

## 12. Known limitations, unresolved problems, decisions still required
- UNVERIFIED in the real project: `local_tasker_audit(text,text,text,jsonb,jsonb,uuid)` (signature taken from 4A-3 use), `local_tasker_profiles.phone` and `full_name`, `is_local_tasker_admin()`; `bookings.created_at` (used to reject a call time before the booking); that supabase-js passes the error `hint` to the page (the page falls back to a generic sentence if it does not, so a validation message would then not show).
- Administrator second-check screen is not built (8B). Until then an administrator would call the function from the SQL editor, which the owner prefers to avoid; the option stays OFF by default.
- The stage file's price rule "service fee comes from the tasker-confirmed price" is for 5C-2.
- Customers and tasker never see the record (5D / 7A). Admins are still not notified of `needs_reassignment` (5A limitation). Observed earlier, for 9A: `anon` DML grants on `bookings`.

## 13. Configuration or migration requirements
`stage-5c1-core.sql` WRITTEN, NOT applied. No Edge Function, no secret, no new bucket. Site files must be uploaded (section 5).

## 14. Exact next steps for the next stage (5C-2: quote builder)
Build `local_booking_quotes` (or similar) from the CURRENT confirmed record only: service fee = `proposed_price` (not editable), transport = `transport_amount`, materials = `materials_amount`, other agreed costs (coordinator-entered, capped, audited), total. Reuse the Job Room `payment_requests` kinds and reimbursable rules; read `js/messages-money.js` and `js/make-offer.js` and the money map first. The quote must be the only route to `quote_sent`: replace the raw step to `quote_sent` (section 11). A coordinator who wants a different service fee must use "Record a new answer". Add the quote builder card on `coordinator-booking.html` (it shows "Building the quote arrives in the next update" now). No payment collection (5D).

## 15. Dependencies the next stage must preserve
The confirmation table stays immutable; `_local_booking_transition` remains the only writer of `lt_status`; `st.lt_capture` is set only inside `local_booking_record_confirmation`; the read function never returns `request_id` or internal ids; the 5B functions never return the release code.

## 16. Manual actions required from the project owner (Supabase SQL editor and site deploy ONLY)
1. If you have not yet: run 5A and 5B (`handoffs/stage-05a.md` and `stage-05b.md` section 16). Run `stage-5a-tests.sql` NOW, before step 2 (after step 2 it is replaced by `stage-5c1-tests.sql`).
2. Paste the whole of `sql/local-tasker/stage-5c1-core.sql`, Run. Expect "Success. No rows returned". Safe twice.
3. Paste the whole of `sql/local-tasker/stage-5c1-tests.sql`, Run. Expected: an error box starting "STAGE 5C-1 TESTS" and ending "RESULT: ALL PASS" (it rolls itself back). If a FAIL appears, send the text. A line "SKIP: administrator function not testable here" is normal.
4. Upload the new and changed site files (section 5) with your normal site deploy.
The live check is a real booking for a published Local Tasker: open it under Bookings > Needs action and record a call.

# Stage 5B handoff: coordinator booking list and booking detail (WRITTEN; SQL tested on a SCRATCH Postgres; browser tested with a MOCKED Supabase; NOTHING run in the real project)

Read-only stage. No payment, state-machine or booking change. Needs `stage-5a1-core.sql` and `stage-5a2-core.sql` applied first.

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
5B: Coordinator booking list and booking detail.

## 2. Objectives
Coordinators see only the bookings of the Local Taskers they manage, grouped by what they must do next, and open one booking to see state, job, customer (as allowed), payment (read only) and history. No actions yet (5C/5D). Never show the release code.

## 3. Initial assumptions and relevant existing architecture
5A tables `local_booking_state` / `local_booking_events` and helpers `_local_booking_is_open`, `_local_booking_allowed_next`, `job_booking_frozen`, `is_active_coordinator`. Coordinator shell: `js/coordinator.js` guard (fires `coordinator:ready`), `js/coordinator-common.js`, `css/coordinator.css`, `components/coordinator-nav.html`. Contact rule O5 (default): customer name for bookings the coordinator manages; phone only while the booking is open. Customer phone is read from `verifications.phone` (as `js/db.js` already does); job details from `tasks` / `services`.
The owner supplied no reference screen. Standing instruction 13 says to follow the design system and the existing coordinator pages, so the UI was built that way and is NOT marked blocked. If the owner has a different layout in mind, it is a styling change only.

## 4. Files inspected
`stage-05b.md` (stage file), `stage-05a.md`, 5A SQL and scratch scaffold, `coordinator-taskers.html`, `coordinator-tasker.html`, `js/coordinator-taskers.js`, `js/coordinator-common.js`, `js/coordinator.js`, `components/coordinator-nav.html`, `css/coordinator.css`, `js/customer-bookings.js`, `js/db.js` (contact lookups), `DESIGN-SYSTEM.md`/`CLAUDE.md` rules, `tools/check-design-system.js`.

## 5. Files created or modified
NEW: `sql/local-tasker/stage-5b-core.sql`, `stage-5b-rollback.sql`, `stage-5b-tests.sql`; `coordinator-bookings.html`, `coordinator-booking.html`; `js/coordinator-bookings-common.js`, `js/coordinator-bookings.js`, `js/coordinator-booking.js`; `docs/local-tasker/tests/stage-5b/scratch-scaffold.sql`, `fake-bookings-supabase.js`, `run-5b.py`; this handoff.
MODIFIED: `css/coordinator.css` (appended a 5B section, tokens only), `components/coordinator-nav.html` (Bookings is now a link in the header, drawer and bottom bar), `docs/local-tasker/IMPLEMENTATION-STATUS.md`.

## 6. Database tables, columns, relationships, policies, migrations, functions affected
Two new read-only SECURITY DEFINER functions, no tables, no policies, no grants other than execute:
- `local_booking_list(p_limit integer default 100)` returns a JSON array (limit clamped 1..200, newest first) of the coordinator's bookings: booking id, tasker id and private full name, customer name, title (task title, else service name, else first 60 chars of notes, else "Booking"), `lt_status`, booking status, work stage, payment status, amount, scheduled time, created/updated time, `frozen`, `open`.
- `local_booking_detail(p_booking uuid)` adds notes, task and service details, customer phone (only while open), `original_coordinator_is_me`, `allowed_next`, and up to 50 history events (kind, from/to, actor role, note, time; no ids).
Both: execute for `authenticated` and `service_role` only; refuse (hint `not_found`) unless the caller is an ACTIVE coordinator and, for detail, the state row's `coordinator_id` is the caller. Another coordinator's booking, a regular tasker's booking and an unknown id all give the same `not_found`. Job, phone and tasker lookups sit in guarded blocks: if a column is not as assumed that one detail is null and the call still works.
Never returned: `completion_code`, `booking_secrets`, `code_attempts`, `payment_ref`, `dispute_reason`, `customer_id`, `tasker_id`, escrow or wallet data. Nothing is written.

## 7. Existing components and functions reused
`is_active_coordinator(uuid)`, `job_booking_frozen`, `_local_booking_is_open`, `_local_booking_allowed_next`, 5A tables; `window.STCo` helpers, the `coordinator:ready` guard, nav component, `.co-hero`, `.co-card`, `.co-facts`, `.co-filter`, `.co-search`, `.co-status`, `.co-banner`, `.co-empty`, `.co-back`. `local_booking_status` (5A) stays for 5C.

## 8. New functionality implemented
- `coordinator-bookings.html`: four tabs with counts (Needs action, Waiting, Problems, Closed), opens on the first tab that has bookings, search across all tabs by job, customer, Local Tasker or reference, empty, error and retry states. Each card: reference, step label, job, Local Tasker, customer, time, amount and ONE next action sentence.
- `coordinator-booking.html?id=`: hero, Next step card, The job, Customer (tel link while open), Local Tasker (link to profile), Payment (read only), History. Bad or foreign id shows "Booking not found" (a bad id makes no call).
- Next action mapping lives in `js/coordinator-bookings-common.js` (`nextAction`): closed bookings go to Closed; frozen or disputed go to Problems; then by `lt_status`; `quote_approved` waits for payment while unpaid.
- All user-entered text is set with `textContent` (tested with markup in title, name and notes).

## 9. Important technical decisions and reasons
- D61: two purpose-built functions instead of letting the browser read `bookings`: coordinators have no RLS access to `bookings` and must not get any (release code lives next to it).
- D62: next action and tab are computed in the browser from fields the function returns, so wording can change without SQL.
- D63: customer phone only while open (O5 default narrowed for data minimisation). Easy to change: remove the `if v_open` in the detail function.
- D64: a booking whose assignment ended leaves the old coordinator's list (the state row has no coordinator); the new coordinator sees it once 5A reassigns it.
- D65: `to_jsonb(row) ->> 'col'` for `tasks`/`services` so a missing column cannot break the call.
- Reference screen: not requested, see section 3.

## 10. Tests executed and their ACTUAL results
- SQL on a scratch Postgres 16 (NOT Supabase; reconstructed schema, the 5A scaffold plus `tests/stage-5b/scratch-scaffold.sql`): `stage-5b-core.sql` loaded twice with no error; `stage-5b-tests.sql` 24 PASS, 0 FAIL, "RESULT: ALL PASS". Covers: privileges; coordinator A sees exactly one row; B sees none; customer, regular tasker, unknown user, no user id and anonymous refused; no secret keys or release code in either result; detail fields, history without ids; another coordinator, customer, random id, regular booking and no user id get `not_found`; closed booking hides phone; reading changes no booking, state or event row; limit clamping; open problem report shows `frozen`; ended assignment removes the row from the old coordinator's list. The customer-phone check passed on the scratch (it shows SKIP in the real project if `verifications` rejects a plain insert).
- Extra, scratch only (not shipped): a `tasks` row with title/location/category/description/budget showed up in list title and detail `task` (PASS).
- Browser, mocked Supabase (`tests/stage-5b/run-5b.py`, Playwright Chromium): 42 PASS, 0 FAIL (counts per tab 5/3/2/1, search, empty/error/retry, XSS text, not-found for foreign/malformed/missing id, closed booking, no inputs or buttons that change anything, no sideways scroll at 390). Regression: `stage-3a/run.py` 307 PASS, `run-4c1.py` 57 PASS. `node tools/check-design-system.js`: passed.
- Screenshots viewed at 1440 and 390 (list and detail).
- NOT RUN: anything in the real Supabase project; any real sign-in; `run-4c2.py`; the real `tasks`/`services`/`verifications` shapes.

## 11. Security and backward-compatibility checks
Authority comes from `auth.uid()` and the state row only. No write path. Regular bookings are untouched (no 5B object touches them; they are not returned). Existing pages only changed in the nav (one link made live). Acceptance criterion "changing the booking id in the URL for another coordinator's booking returns nothing": PASS in SQL (not_found) and in the page ("Booking not found").

## 12. Known limitations, unresolved problems, decisions still required
- UNVERIFIED on the real project: that `tasks` has `title, description, location, category, budget`; that `services` has `service_name, category, price, rate_unit, location`; that `verifications` has `user_id, phone`; that `users.name` is filled for customers; that `is_active_coordinator(uuid)` behaves as in the stand-in. Wrong guesses show as an empty job detail or phone, not an error.
- The coordinator cannot yet record any step (5C) or act on exceptions (5D). The detail page says so.
- Admins are still not notified of `needs_reassignment` (5A limitation).
- The list loads up to 200 bookings at once, with no paging.
- A customer can still book a published Local Tasker; do not publish a real person before 5C and 7A/7C (see 5A handoff).
- Observed earlier, for 9A: `anon` DML grants on `bookings`.

## 13. Configuration or migration requirements
`stage-5b-core.sql` WRITTEN, NOT applied. No Edge Function, no secrets, no deploy beyond uploading the changed site files.

## 14. Exact next steps for the next stage (5C: tasker confirmation recording and quote breakdown)
Use `local_booking_step` for the buttons, add the buttons to the Next step card on `coordinator-booking.html`, reuse `STCoBk.nextAction`. The quote breakdown needs new SQL (store itemised quote; nothing may touch payment fields). Ask the owner for the 5C screen only if they want a layout different from the design system.

## 15. Dependencies the next stage must preserve
The two functions never return the release code or internal ids; foreign bookings give `not_found`; `nextAction` is the one place that decides the tab and next action text; Local Tasker booking states change only through `_local_booking_transition`.

## 16. Manual actions required from the project owner (Supabase SQL editor ONLY)
1. Make sure the 5A SQL has been run (`stage-5a1-core.sql`, then `stage-5a2-core.sql`).
2. Paste the whole of `sql/local-tasker/stage-5b-core.sql`, Run. Expect "Success. No rows returned". Safe twice.
3. Paste the whole of `sql/local-tasker/stage-5b-tests.sql`, Run. Expected: an error box starting "STAGE 5B TESTS" and ending "RESULT: ALL PASS" (it rolls itself back). If a FAIL appears, send the text.
4. Upload the new and changed site files (list in section 5) with your normal site deploy.
Nothing else. Real data (a booking made through the app for a published Local Tasker) is the live check; it appears under Bookings > Needs action.

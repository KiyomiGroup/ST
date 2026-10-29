# Stage 6A handoff: booking-specific coordinator thread, SQL and customer-side logic (WRITTEN; SQL NOT RUN IN THE REAL PROJECT; tested on a SCRATCH Postgres; UI BLOCKED)

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

## 1. Stage number and title
Stage 6A: booking-specific coordinator thread (SQL and customer side).

## 2. Objectives
The customer talks to the assigned coordinator about one specific Local Tasker booking, by extending the existing thread model. Coordinator access through RLS; on reassignment the new coordinator gains access and the old coordinator keeps read-only history; history is never deleted; the customer side names the coordinator as the contact; admin reads a conversation only through an audited function. No second chat system. No coordinator UI (6B).

## 3. Initial assumptions and relevant existing architecture
- A Local Tasker booking ALREADY has one Job Room thread: customer + the Local Tasker's placeholder identity, `context_type = 'booking'`, `context_id` = the booking (created by 5D-1 `_local_booking_thread`). The Local Tasker cannot log in, so the thread's tasker side is spoken for by the coordinator. 6A therefore adds coordinator ACCESS to that one thread; it does not create a second thread or chat (decision D7).
- 5D-3c-1 and 5D-3c-2 were treated as applied and correct (standing rule 8).
- UNVERIFIED (not in this session's upload): the real bodies of `is_thread_party`, `_is_thread_member`, `open_thread`, the real RLS policies and guard triggers (`messages_guard`) on `message_threads` / `messages`, `messaging-step6/7.sql`, `money-and-chat-map.md`, `stage-05a-*.md`, the 5A SQL. The stage file said they are in the repo docs and `inputs/`; the uploaded zips did not contain them. The design needs none of them to be changed: it only ADDS permissive SELECT policies and new functions, and reads `local_booking_state` / `local_booking_events` columns known from the 5B/5D-3b scaffold (`coordinator_id`, `original_coordinator_id`, `previous_coordinator_id`). The scratch tests used stand-in party policies.

## 4. Files inspected
`stages/stage-06a.md` (uploaded), `00-PROJECT-CONTEXT.md`, `DECISIONS.md`, handoffs 5D-3c-2, 5B, 5D-1, 5D-3b, 4A-3, 3A/3B (by search), `sql/local-tasker/stage-5b-core.sql`, `stage-5d1-core.sql`, `stage-5d3b-core.sql`, `stage-5d3c2-core.sql` and tests, `docs/local-tasker/tests/stage-5d3b/scratch-scaffold.sql`, `js/messages.js`, `js/messages-list.js`, `js/messages-room.js`, `js/messages-thread.js` (name rendering only). The uploaded `IMPLEMENTATION-STATUS.md` was the OLD Stage 1C copy; the one from the 5D-3c-2 zip was used and updated.

## 5. Files created or modified
NEW: `sql/local-tasker/stage-6a-core.sql`, `stage-6a-rollback.sql`, `stage-6a-tests.sql`; `js/messages-local.js`; `docs/local-tasker/tests/stage-6a/scratch-extra.sql`, `run-scratch.sh`, `run-6a-js.js`; this handoff.
MODIFIED: `docs/local-tasker/IMPLEMENTATION-STATUS.md`.
NOT modified: any HTML, CSS, `messages*.js`, `open_thread`, any existing policy or function.

## 6. Database tables, columns, relationships, policies, migrations, functions affected
No new table, no new column. NEW functions (all in `stage-6a-core.sql`):
- `_local_thread_booking(thread)` internal (service_role only): the booking behind a booking thread, only if it has a `local_booking_state` row.
- `local_thread_access(thread)` (signed-in users): `'coordinator'` (current, active), `'former_coordinator'` (active coordinator who is `original_coordinator_id` or appears in `local_booking_events.coordinator_id / previous_coordinator_id`, and is not current), else null. Reads only `auth.uid()`.
- `open_local_thread(booking)`: customer or current coordinator opens or creates the thread (via `_local_booking_thread`); a former coordinator only gets an existing thread, `read_only: true`; anyone else, or a regular booking: `not_found`. Returns `{thread_id, role, read_only, created}`. Writes one `local_booking_events` row (`thread_opened`) only when it creates the thread. Handles two simultaneous opens.
- `local_thread_labels(thread ids[])`: the CALLER'S OWN Local Tasker threads only; returns `thread_id`, `coordinator_assigned`, `coordinator_name` (the coordinator's `display_name`, only while that coordinator is active). No ids of people.
- `local_thread_admin_read(thread, reason, limit)`: administrator (`is_local_tasker_admin()`) only; reason 10 to 300 characters; the audit row (`thread_admin_read`, entity `message_thread`, reason, booking, limit) is written BEFORE anything is returned; at most 200 newest messages (id, sender_id, type, body, created_at).
NEW policies (permissive, SELECT only): `lt_thread_coord_select` on `message_threads`, `lt_msg_coord_select` on `messages`, both `using (local_thread_access(...) is not null)`. No insert/update/delete policy, no admin policy.
Pre-flight stops with "Nothing was changed." if a helper is missing or RLS is off on the two tables.

## 7. Existing components and functions reused
`_local_booking_thread` (5D-1), `_local_booking_log` (5A), `is_active_coordinator(uuid)`, `is_local_tasker_admin()`, `local_tasker_audit(...)`, `local_booking_state`, `local_booking_events`, `coordinators.display_name` (read through `to_jsonb`, so a missing column gives null rather than an error).

## 8. New functionality implemented
Coordinator thread access (read), reassignment behaviour, customer contact-name logic (`js/messages-local.js`: `JRLocal.load / isLocal / contactName / contactRole`, text only, to be inserted with `textContent`), audited admin read.

## 9. Important technical decisions and reasons
- D108: the booking thread IS the coordinator thread (the existing Job Room, customer + placeholder). A second thread would split the conversation and break `payment_requests.thread_id` links and the customer's inbox.
- D109: coordinators get read access by NEW SELECT policies only. Writing from the browser is not allowed here: a message needs `sender_id` / `receiver_id` that are real `public.users` ids and passes `messages_guard` (unseen), so 6B must send through a SECURITY DEFINER function.
- D110: "former coordinator" is derived from `original_coordinator_id` and the booking events (no new table). If 5A reassignment does not write an event carrying the old coordinator, only the original coordinator would count as former: 6B/8A must keep writing `previous_coordinator_id` on reassignment (5D-3b scaffold shows the column exists).
- D111: a deactivated coordinator has no access at all, current or former (the same rule as every other coordinator read).
- D112: the admin never gets a table policy; the audited function is the only way, with a mandatory reason and audit-first order.
- D113: the label function returns the coordinator's display name only (never a user id), and only for the customer's own threads.

## 10. Tests executed and their ACTUAL results
- **SQL, SCRATCH Postgres 16 (not Supabase):** `stage-6a-tests.sql`: 46 PASS, 0 FAIL, 0 SKIP, plus one NOTE line. Core file run twice, rollback, reinstall, tests re-run: ALL PASS each time. Loaded: the 5D-3b scratch scaffold (stand-in `message_threads`, `messages`, `users`, `coordinators`, audit, `local_booking_state/events` copied from 5A), `scratch-extra.sql` (RLS on, stand-in party policies), then the 6A core. Covered: privileges; who can open the thread (other coordinator, other customer, placeholder tasker, signed out, regular booking all `not_found`); creation and re-open give the SAME single thread, one `thread_opened` event; coordinator A reads both messages; **coordinator B cannot read A's thread (acceptance)**; no read of another coordinator's or a regular thread; customer's own access and the regular thread unchanged; coordinator cannot insert, edit or delete; **reassignment: new coordinator reads all, old coordinator still reads, marked read only (acceptance)**; third coordinator nothing; no coordinator assigned: former coordinators still read; customer label follows the reassignment, regular thread absent, no ids; no name while unassigned; other customer and coordinators get no labels; suspended coordinators (current or former) nothing; admin read: coordinator and customer refused, short reason refused, regular thread refused, refused calls write no audit, success writes exactly one audit row with the reason and respects the limit, administrator has no direct table access; regular thread and booking/payment status untouched.
- **JS, Node, MOCKED Supabase:** `docs/local-tasker/tests/stage-6a/run-6a-js.js`: 8 PASS (one rpc, booking threads only, no duplicates; plain-text name; regular thread keeps normal name; generic wording when unassigned; role label; failing call and rpc error leave threads unchanged; empty list makes no call).
- **NOT RUN:** the real Supabase (nothing); the real messaging RLS, `messages_guard` and `open_thread`; `node tools/check-design-system.js` (no UI changed, tools not uploaded); any browser or screenshot test; full-page regression of earlier stages; the administrator success checks in the real project will print `SKIP:` unless the signed-in editor is a real administrator (the stand-in flag only works in scratch).

## 11. Security and backward-compatibility checks
Only permissive SELECT policies were added, so no existing access is removed or changed (a permissive policy can only widen access, and only to coordinators of that exact booking). `open_thread`, `is_thread_party`, `_is_thread_member`, `job_money_snapshot` untouched (decision D7). No money table, `lt_status`, booking field or payment record is touched. `anon` has no execute right on any new function. Authority comes from `auth.uid()` in the database. Admin reads are audited before data leaves. Coordinators cannot write messages from the browser. UNVERIFIED in the real project: that a coordinator's Realtime subscription respects the new policies (it follows RLS) and that the payment-request cards inside the thread (their `payment_requests` rows are not readable by coordinators) render acceptably for a coordinator; that is for 6B.

## 12. Known limitations, unresolved problems, decisions still required
- **UI BLOCKED.** The stage requires the customer-side thread header reference screens (desktop AND mobile); none were supplied. `js/messages-local.js` is NOT loaded by `messages.html` and no header shows the coordinator yet. To finish: add `<script src="js/messages-local.js">` after `messages-list.js`; after `JRList`'s `fetchThreads` call `JRLocal.load(threads)` for the customer role; in `buildRow` (list) and the room header use `JRLocal.contactName(t, normalName)` with `textContent`, and `JRLocal.contactRole(t)` for a small "Coordinator" label. The layout and styling need the reference screens.
- Until the header is wired, the customer's list and header still show the placeholder Local Tasker's public name, not the coordinator (the thread itself works).
- A coordinator cannot send messages yet (6B). A coordinator who will send needs a `public.users` row; the tests print a NOTE with the count of coordinators lacking one (0 in scratch; the real count is shown when the owner runs the tests).
- Former coordinator detection depends on events carrying the old coordinator (D110).
- The coordinator is not notified of new customer messages (6B).
- The customer is not told when the coordinator changes beyond the contact name changing.
- Admin read returns message text as stored (including system lines); there is no admin screen (8B).

## 13. Configuration or migration requirements (and whether applied)
`stage-6a-core.sql` must be run in the Supabase SQL editor. NOT applied yet (written only). No Edge Function, no secret, no storage change.

## 14. Exact next steps for the next stage
1. If the owner supplies the customer thread-header reference screens (desktop and mobile): wire `messages-local.js` as in section 12, screenshots at 1440 and 390, run `node tools/check-design-system.js`, then mark 6A Done. Otherwise leave the UI marked BLOCKED.
2. Stage 6B (coordinator chat and internal notes): send through a new SECURITY DEFINER function (never an INSERT policy), using `open_local_thread` for the thread, with `sender_id` = a real `public.users` id and `receiver_id` = the customer; check `messages_guard` first (ask for the real trigger body once, with the SQL-editor query to export it); refuse sending for `former_coordinator`; internal notes in a separate coordinator-only table, never in `messages`.

## 15. Dependencies the next stage must preserve
`local_thread_access` / `open_local_thread` semantics (current vs former, read only); the two SELECT-only policies (no write policy for coordinators); the single thread per booking; `local_thread_admin_read` audit-first with a mandatory reason; no admin table policy; `previous_coordinator_id` written on every reassignment; no coordinator code path touches money tables, `payment_requests` status, refunds or release.

## 16. Manual actions required from the project owner (Supabase SQL editor ONLY)
1. Paste the whole of `sql/local-tasker/stage-6a-core.sql`, Run. Expect "Success. No rows returned". If it stops with a message ending "Nothing was changed.", or fails with any error, send me that text.
2. Paste the whole of `sql/local-tasker/stage-6a-tests.sql`, Run. Expected: an error box starting "STAGE 6A TESTS" and ending "RESULT: ALL PASS" (it rolls itself back). A `SKIP:` line about the administrator check is expected in the real project. Send me the box if a FAIL appears, and tell me the number on the `NOTE:` line.
3. Send the customer thread-header reference screens (desktop and mobile) when you want the label shown on the page.

# Stage 6B handoff: coordinator chat and internal notes (WRITTEN; SQL NOT RUN IN THE REAL PROJECT; tested on a SCRATCH Postgres; page tested with a MOCKED Supabase)

## OWNER STANDING INSTRUCTIONS (unchanged, every AI session must follow them)
Same 12 rules as `handoffs/stage-06a.md` (read the latest handoff, `00-PROJECT-CONTEXT.md`, `IMPLEMENTATION-STATUS.md` first; ask once in one batch; SQL editor and dashboard only, never console or curl; redo the handoff and status at the end; deliver a zip of changed files only; never claim a test passed, SQL was applied or a payment worked unless it really happened; no secrets in the browser; one Supabase project, no backup or dry-run; assume the owner ran the previous steps correctly; say exactly how to get any file you ask for; follow the design system and run `node tools/check-design-system.js`).

## 1. Stage number and title
Stage 6B: coordinator chat and internal notes.

## 2. Objectives
A coordinator inbox and conversation page for authorised bookings, with internal notes kept strictly apart from customer-visible messages. A customer can never read a note by any query.

## 3. Initial assumptions and relevant existing architecture
- The booking thread is the single Job Room thread (customer + the Local Tasker's placeholder identity) from 5D-1/6A. No second chat.
- 6A SQL and 5D-3c-1/2 were treated as applied and correct (standing rule 8).
- Reference screens supplied: coordinator chat desktop (3 columns: Bookings Chat | thread | Booking Context) and mobile (thread + booking sheet). They were treated as a direction; the build follows `DESIGN-SYSTEM.md`, tokens, and the existing Messages page components. The reference's simulation toolbar (Normal / Internal note / Warning modal / Empty / Offline) is a design-review control, not built; its STATES are built for real.
- UNVERIFIED (not in the upload): real `messages_guard` and the real messaging RLS. The send function inserts exactly the same message shape as 5D-1 and 5D-3c-1 (definer code, sender = Local Tasker identity, receiver = customer, type `text`), which already worked in the real project.

## 4. Files inspected
`DESIGN-SYSTEM.md`, `CLAUDE.md`, `css/tokens.css` (tone and `--co-*` tokens), `css/messages.css`, `messages.html`, `js/messages.js`, `js/messages-thread.js` (bubble builders), `css/coordinator.css`, `coordinator-dashboard.html`, `coordinator-booking.html`, `js/coordinator.js`, `js/coordinator-common.js`, `js/coordinator-bookings-common.js`, `components/coordinator-nav.html`, `sql/local-tasker/stage-5b-core.sql`, `stage-5d1-core.sql`, `stage-6a-*`, the 6A handoff, 5D-3b scaffold.

## 5. Files created or modified
NEW: `sql/local-tasker/stage-6b-core.sql`, `stage-6b-rollback.sql`, `stage-6b-tests.sql`; `coordinator-chat.html`; `css/coordinator-chat.css`; `js/coordinator-chat.js`; `docs/local-tasker/tests/stage-6b/` (`run-scratch.sh`, `scratch-extra.sql`, `fake-chat-supabase.js`, `run-6b.py`, `screenshots/`); this handoff.
MODIFIED: `components/coordinator-nav.html` (Messages is a link in header, drawer and bottom bar), `coordinator-booking.html` + `js/coordinator-booking.js` (one "Open the conversation" link), `css/coordinator.css` (one rule for that link), `docs/local-tasker/IMPLEMENTATION-STATUS.md`.
NOT modified: any 6A object, `open_thread`, `is_thread_party`, any existing policy, `messages*.js/css`, money tables.

## 6. Database objects
New tables (RLS on): `coordinator_internal_notes` (booking_id, author_id, request_id unique, body 1..2000, created_at; immutable by trigger), `coordinator_message_authors` (message_id as text, booking_id, coordinator_id, request_id unique; immutable), `coordinator_thread_reads` (per coordinator read mark; no browser access).
Policies: `lt_notes_coord_select`, `lt_authors_coord_select` (SELECT only, `local_chat_access(booking_id) is not null`). No administrator policy, no write policy.
New functions (all signed-in only, none for anon): `local_chat_access(booking)`, `coordinator_chat_list`, `coordinator_chat_thread`, `coordinator_send_message`, `coordinator_add_note`, `coordinator_chat_mark_read`, `coordinator_chat_admin_read`; internal `_lt_contains_contact`, `_lt_6b_immutable`.

## 7. Reused
6A `open_local_thread` (creates the thread on first send), `local_thread_access` semantics, `_local_booking_log`, `local_tasker_audit`, `is_active_coordinator`, `is_local_tasker_admin`, `job_booking_frozen`, 5B `local_booking_detail`, `STCoBk` helpers, the coordinator guard/nav, and the Job Room CSS components (list item, bubble, system chip, sheet, composer, warn, toast, tabs, chips).

## 8. New functionality
Inbox (search, All / Unread / Needs action / Read only, unread badges, per coordinator); conversation with date dividers, author names, payment-request lines as neutral chips; composer with a Customer message / Internal note switch (separate drafts, amber note mode); contact-detail refusal with the Job Room warning; retry-safe sends; offline banner; read-only view for former coordinators; booking context column (wide) and bottom sheet (phones, tablets); live updates (Realtime if available, plus 20 s polling); deep link `?booking=`.

## 9. Decisions (owner may overrule)
- D114: a coordinator's message is stored as the Local Tasker's identity (a real `public.users` row), receiver = customer; the coordinator is recorded in `coordinator_message_authors`. This answers the 6A NOTE about coordinators without a `public.users` row: they do not need one.
- D115: notes are keyed by BOOKING (not thread), so writing a note never creates a customer-visible empty thread.
- D116: admin reads messages (with author names) and notes ONLY through `coordinator_chat_admin_read` (reason 10..300 chars, audit row first). The stage said "RLS (coordinator and admin only)"; I applied the 6A rule D112 (no administrator table policy) instead of an admin SELECT policy. Easy to add one if you prefer.
- D117: a former coordinator (still active) reads messages and notes read-only; deactivated coordinators read nothing.
- D118: contact details (phones, emails, chat links) are refused in messages to the customer using the same patterns as the Job Room, plus emails. Notes are exempt. The refusal is server-side only; the page shows the warning.
- D119: unread is computed from per-coordinator read marks (`coordinator_thread_reads`), not from `message_threads.tasker_unread`, because that counter's trigger is unverified and belongs to the placeholder identity.
- D120: internal notes use the amber warning tone with a lock and the words "not visible to the customer" (not red: red is for errors in the design system). Nothing from the reference that the database cannot supply was invented (no ratings, past-booking counts, gate codes, contract PDF, "voice relay", "cryptographic hash", delivery ticks, platform fee line).
- D121: notes write one audit row with the note id and length, never the text. Messages are recorded by the authors table, not one audit row each.
- D122: sending is allowed on any booking state while the coordinator is current and active (including closed or frozen); only the UI notes it.

## 10. Tests and ACTUAL results
- SQL on SCRATCH Postgres 16 (not Supabase; scaffold from 5D-3b, 6A stand-in policies, 6A core, 6B core): `stage-6b-tests.sql` 108 PASS, 0 FAIL, 0 SKIP (the administrator checks ran against the stand-in admin flag). Core run twice, tests run twice, rollback, reinstall, tests again: ALL PASS each time; `stage-6a-tests.sql` still ALL PASS. Covers privileges and grants, RLS on, who can read/send/write, refusals create nothing, contact-detail refusals, idempotent retries, unread per coordinator, no user ids in answers, **customer query against the notes table returns nothing (acceptance)** (also: another customer, the placeholder identity, an unrelated coordinator, anonymous, an administrator directly), notes never in messages/preview/unread, audit without text, immutability even for the owner role, **reassignment: new coordinator reads everything, old one read only (acceptance)**, deactivated coordinators, admin audited read, cascade, regular thread and booking untouched.
- Browser, MOCKED Supabase (Playwright): `docs/local-tasker/tests/stage-6b/run-6b.py` 46 PASS at 1440 and 390 (script text not executed, note as text and separate block, request payloads, retry uses the same request id, contact refusal, drafts, filters, read-only, offline, empty/failed inbox, no money function ever called, phone has no horizontal overflow). Screenshots in `tests/stage-6b/screenshots/`.
- `node tools/check-design-system.js`: passed.
- NOT RUN: the real Supabase (nothing), the real `messages_guard`/RLS, Realtime subscriptions, real phones, other browsers than Chromium, full regression of earlier pages.

### 10a. Owner's run of the 6B tests in the REAL project (2026-10-29) and the fix (6B revision 2)
The owner ran `stage-6b-tests.sql` in the real project: most checks PASSED (including the acceptance checks: customer cannot read notes by any query; old coordinator read-only), 7 FAILED. It rolled itself back, so nothing was left behind. Cause, from the output: the real project differs from the scratch database in two ways: (1) it already has a trigger on `messages` that raises the customer's unread count (my function raised it a second time: 2 instead of 1, a real bug, a customer would have seen double); (2) opening a thread posts a payment-request card into it (so a thread had one more message than the tests expected; a test assumption, not a bug). Also, messages inserted in one transaction share a timestamp, so their order was arbitrary in the tests.
Fix in `stage-6b-core.sql`: the send function reads the unread count before and after the insert and raises it by exactly one whichever way the project works; each message gets `clock_timestamp()` as `created_at`. Tests no longer assume a clean thread (they count what the project posts itself). New `scratch-realistic.sql` imitates both real behaviours in the scratch database.
Re-run on scratch after the fix: 6B tests ALL PASS (twice), rollback + reinstall ALL PASS, 6A tests ALL PASS, and with the imitation of the real project added, 6B tests ALL PASS twice. NOT yet re-run in the real project: the owner must run core then tests again (section 16, unchanged). The `â‚¦` in the owner's output is only how the pasted text was displayed; it does not affect the checks.

## 11. Security and compatibility
Only new objects and two additive SELECT policies; no existing function or policy changed. Authority comes from `auth.uid()` in the database. Notes: select-only grant behind RLS, immutable, no admin policy, unreachable from any customer-facing function (tested). Coordinators still cannot write `messages` directly. No money, `lt_status`, payment or payout object is touched; the page calls no payment function. UNVERIFIED in the real project: that the real messages guard accepts the definer insert (same shape as 5D-1, so expected), that Realtime delivers rows under the 6A policy (polling covers it), and that `message_threads.last_message*` / `customer_unread` columns behave as in 5D-1 (same columns used there).

## 12. Known limitations
- The customer is not notified of a coordinator message beyond the unread count (no push or email); existing notification wiring for chat is unverified.
- The 6A customer-side header label (`messages-local.js`) is STILL not wired: the screens supplied this time were the coordinator ones. Needs the customer thread header (desktop and mobile).
- No attachments, no delivery or read receipts, no "reply to note".
- Payment-request cards are shown to coordinators as a plain line (they cannot read `payment_requests`).
- Preview text uses `message_threads.last_message`; it is whatever existing code wrote.
- Size guard: about 1,250 production lines across SQL, HTML, CSS and JS (limit about 1,200), one concern. Tests and docs are extra.

## 13. Configuration or migration requirements
`stage-6b-core.sql` must be run in the Supabase SQL editor (NOT applied yet). Deploy the site files. No Edge Function, secret or storage change. If Realtime is wanted, `messages` and `coordinator_internal_notes` must be in the `supabase_realtime` publication (optional; the page polls every 20 s anyway).

## 14. Next steps
1. Owner runs core and tests (section 16). 2. Wire the 6A customer label when the customer header screens exist. 3. Stage 7A (commission exemption). A `public.users` row for coordinators is not needed (D114).

## 15. Dependencies the next stage must preserve
Single thread per booking; notes only in `coordinator_internal_notes`; `coordinator_send_message` as the only coordinator write path; no coordinator INSERT policy on `messages`; no admin table policy (audited function only); `previous_coordinator_id` written on every reassignment; immutability triggers; no coordinator code path touches money tables.

## 16. Manual actions for the project owner (Supabase SQL editor only)
1. Paste all of `sql/local-tasker/stage-6b-core.sql`, Run. Expect "Success. No rows returned". If it stops with a message ending "Nothing was changed." or any error, send me that text.
2. Paste all of `sql/local-tasker/stage-6b-tests.sql`, Run. Expected: an error box starting "STAGE 6B TESTS" and ending "RESULT: ALL PASS" (it rolls itself back). A `SKIP:` line about the administrator is expected. Send the box only if a FAIL appears.
3. Upload the site files, sign in as a coordinator, open Messages and check one real conversation end to end (send a message, write a note, confirm the customer account sees the message and not the note).

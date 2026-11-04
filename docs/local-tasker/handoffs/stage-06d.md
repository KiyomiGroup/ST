# Stage 6D handoff: coordinator chat parity with the tasker chat. 6D-1 and 6D-2 DONE (6D-1 SQL tests: ALL PASS in the owner's real Supabase, 2026-11-04). 6D-3 WRITTEN (SQL NOT YET RUN in the real project; page tested with a MOCKED Supabase only). 6D-4 and 6D-5 NOT BUILT.

## OWNER STANDING INSTRUCTIONS (unchanged)
Same rules as `handoffs/stage-06b.md` (SQL editor only, never console or curl; deliver changed files only; never claim a test passed, SQL applied or a payment worked unless it really happened; no secrets in the browser; follow the design system).

## 1. Why
Stage 6C left four gaps between `coordinator-chat.html` and the tasker Job Room (`messages.html`). Owner: "build all of these".

## 2. Real state (from the owner's export, query 68, 2026-11-04) , this CORRECTS the 6C handoff
- Coordinators ALREADY have SELECT on `payment_requests` (`lt_payreq_coordinator_read`, via `coordinator_manages_tasker(tasker_id)`) and on `job_events` (`lt_job_events_coordinator_read`). The 6C note "coordinators can't read payment_requests" is out of date. Whether the first policy really matches the Local Tasker placeholder id is UNVERIFIED; 6D-1 does not depend on it (it uses a function).
- No coordinator access on `job_requests`, `payment_receipts`, `job_attachments`, `evidence_removals`, or the `job-evidence` bucket (insert and select are for thread members only: `_is_thread_member(foldername[1])`).
- `job-evidence`: private, 50 MB, JPEG/PNG/WebP, MP4/WebM/MOV, PDF, Word, Excel, TXT, CSV. `job_attachments_guard`: photo (JPEG/PNG/WebP, 10 MB), video (50 MB), receipt (image or PDF, 10 MB), file (not image/video, 10 MB); the file must already be in storage under `<thread_id>/...`; rows are immutable. `messages_attachment_check` requires the message `payload` to carry `attachment_id` and `path`, and the uploader to be the message sender.
- Tasker-only functions (all check `auth.uid() = message_threads.tasker_id`, so a coordinator cannot call them): `price_propose`, `job_custom_request`, `job_work_update`; `job_reschedule_propose` accepts customer or tasker only. `price_respond` is customer only and sets `message_threads.agreed_price` and `bookings.amount` (refused after the first payment). `messages_guard` blocks type `system` and `payment_confirmed` from browser roles.

## 3. 6D-1 (and 6D-2): DONE, read only
Files: NEW `sql/local-tasker/stage-6d1-core.sql`, `-rollback.sql`, `-tests.sql`; NEW `js/coordinator-cards.js`; MODIFIED `js/coordinator-chat.js`, `coordinator-chat.html` (one script tag). Tests: `docs/local-tasker/tests/stage-6d1/` (`run-scratch.sh`, `scratch-extra.sql`, `run-6d1.py`, `fake-base.js`, `chat-rpc.js`, `screenshots/`).
- `coordinator_chat_cards(booking)`: payment requests, job requests and receipts of the booking's thread. `coordinator_chat_activity(booking, limit)`: `job_events`, newest first, max 100, payload not returned. Current AND former coordinator, nobody else. No user id in either answer: who asked is `customer` / `local_tasker` / `staff` / `system`.
- Page: payment cards (kind, status pill, amount, invoice title/number/due date, lines, escrow or released) and request cards (price proposal, reschedule, custom, update, arrival, proof, invoice and receipt requests) inside the thread, read only (no Pay, Decline or Cancel). Right-hand column and phone sheet: Payment history (paid total, waiting total, additional-charge tag, receipt number) and Activity (first 6, Show all). If the cards cannot load: plain lines (never the raw code) and a clear message.
- Not done in 6D-1: "View receipt" opens nothing (only the receipt number is shown); the Evidence and Receipts sub-views of the tasker Job Details panel; the problem-report timeline.
- Tests actually run: scratch Postgres 16 (not Supabase), `stage-6d1-tests.sql` 19 PASS twice, core twice, rollback, reinstall; browser with MOCKED Supabase 26 PASS (1440 and 390). `check-design-system.js`: nothing for these files; known failures on `context-snapshot/verify.html` and `withdrawals-reference/css/tokens.css`. NOT RUN: real Supabase (the scratch tables are stand-ins; `payment_receipts` columns copied from the export), Realtime, real phones, other browsers.
- UNVERIFIED: the scratch stand-ins for `local_booking_state`, `coordinators` and the 6A/6B objects are older than the real project; run the tests file in Supabase to confirm.

## 3b. 6D-3 (attachments): WRITTEN, not yet run in the real project
Real source read from the owner's export (query 69, 2026-11-04): `job_attachments_guard`, `messages_attachment_check`, `_is_thread_member`, `open_local_thread`, the `job_attachments` and `job-evidence` policies, columns of `job_attachments` and `messages`.
Files: NEW `sql/local-tasker/stage-6d3-core.sql`, `-rollback.sql`, `-tests.sql`; NEW `js/coordinator-attach.js`; MODIFIED `js/coordinator-chat.js`, `coordinator-chat.html`. Tests: `docs/local-tasker/tests/stage-6d3/` (`run-6d3.py`, `attach-rpc.js`, `fake-base.js`, `chat-rpc.js`, `screenshots/`).
- Storage: two ADDITIVE policies on `job-evidence` (`job_evidence_coord_insert` for the CURRENT coordinator of the booking behind the thread; `job_evidence_coord_select` for a current or former coordinator, support-removed files hidden). The original policies are untouched. Helper `_lt_coord_thread_ok(thread text, write boolean)`.
- `coordinator_send_attachment(booking, request_id, kind photo|video|file, path, name, caption)`: inserts `job_attachments` with `uploader_id` = the Local Tasker identity (the real `messages_attachment_check` needs uploader = message sender), then the message (type image/video/file, payload attachment_id/path/name/size/mime/caption), records the coordinator in `coordinator_message_authors`, bumps the thread preview and the customer's unread count. Retry-safe by request id; one transaction. The REAL guard still decides type, size (photo 10 MB, video 50 MB, file 10 MB) and that the object exists; its 22023 errors come back as hint `bad_file` with the guard's own text. Caption: max 500 characters, contact details refused (`contact_info`).
- `coordinator_send_location(booking, request_id, lat, lng, label)`: location message (payload lat, lng, label), same author record.
- `coordinator_chat_thread` REPLACED (same as 6B plus `payload` on image/video/file/location, only the keys attachment_id, path, name, size, mime, caption, lat, lng, label).
- Page: "+" menu in the customer-message composer (Photo or video, Camera, File, Location; hidden for internal notes and for read-only coordinators); preview chip; photos re-encoded in the browser (EXIF/GPS stripped, longest side 1600 px); upload to `<thread_id>/...`; then the database call. A retry after a failed database call does not upload again. Customer and coordinator attachments are drawn in the thread (signed links, 1 hour, page memory only).
- Owner decisions used: coordinator MAY upload (never compulsory); same types and limits as taskers; location included; photos re-encoded ("defaults").
- Tests actually run: browser with MOCKED Supabase, 28 PASS (1440 and 390 wide). NOT RUN: `stage-6d3-tests.sql` (no Postgres was available to the assistant: it has never been executed anywhere), the real storage upload, the real guard, signed links, a real phone camera, real geolocation.
- UNVERIFIED: creating policies on `storage.objects` from the SQL editor (the original two were created that way); that no other trigger on `job_attachments` or `messages` in the real project objects to a definer insert (the export listed only the guard and the two message triggers); the exact wording of `_lt_contains_contact` on the caption.
- Location semantics: the position shared is the COORDINATOR's device, not the Local Tasker's. The preview says so.

## 3c. Owner steps for 6D-3 (after 6D-1 is applied)
1. Supabase SQL editor: paste all of `stage-6d3-core.sql`, Run (expect "Success. No rows returned"; if it stops with a message ending "Nothing was changed." send it to me).
2. Paste all of `stage-6d3-tests.sql`, Run. Expected: an error box starting "STAGE 6D-3 TESTS" and ending "RESULT: ALL PASS". Send the whole box if any FAIL appears.
3. Upload the changed site files, sign in as a coordinator, open Messages on a booking, send a photo, a PDF and a location; then sign in as the customer and check they arrive.

## 3d. Remaining after 6D-3
6D-4 (send update, reschedule, proof of work: proof reuses the 6D-3 upload) and 6D-5 (price in chat after the Local Tasker's agreement, custom request, invoice), plus the separate clearing-money-rule stage. Still not done: "View receipt" opens nothing; Evidence and Receipts sub-views; the problem-report timeline. Open question from the owner's answers: "6. yes" matched no question (still unanswered).

## 4. Owner answers recorded (2026-11-04)
1. Proof of work: the coordinator MAY upload the Local Tasker's photos; never compulsory.
2. Price in chat: the customer proposes in chat; the coordinator phones the Local Tasker; only if the Tasker agrees can the coordinator accept. (Design needed: `price_respond` is customer-only, so this is a new coordinator function, built on the 5C-1 confirmation record and the 5C-2 quote. Decision for 6D-5.)
3. Invoice and custom request: add-ons paid like the tasker version. NEW MONEY RULE from the owner: all money accumulates and 12% is taken from all of it; on a dispute the service money can go back to the customer but the tasker keeps transport, materials and inspection money; same for regular taskers; split stays 5% coordinator / 7% platform. THIS IS A SEPARATE STAGE (it changes `_release_escrow` / `_settle_after_dispute` for everyone) and needs their real bodies. Until then 6D-5 invoice/custom request reuse whatever the live release function does.
4. Reschedule: the customer approves (`job_reschedule_respond` already does).
5. Attachments: same types and limits as taskers (the bucket and guard above).
6. An answer "6. yes" had no matching question (only five were asked). OPEN: what was it?

## 5. Remaining parts (one per session)
- (6D-3 Attachments is now written, see 3b.) Original plan:  coordinator upload (photo, camera, file, location) as the Local Tasker identity: new storage insert/select rule on `job-evidence` for the booking's current coordinator, a definer function that writes `job_attachments` (guard needs `uploader_id`) and the message with `payload.attachment_id/path`, authorship in `coordinator_message_authors`, `coordinator_chat_thread` must return `payload` for attachment messages.
- 6D-4 Send update (`job_event` via a coordinator wrapper, no tasker check), reschedule (wrapper around the same insert as `job_reschedule_propose`, requested_by = Local Tasker, customer answers), proof of work (uses 6D-3).
- 6D-5 Propose price, custom request, send invoice (coordinator wrappers; price acceptance only after the Local Tasker's agreement is recorded).
- Separate stage: the clearing money rule.

## 6. Owner steps for 6D-1 (tests fixed 2026-11-04: they now compare with the rows the real project's triggers create, e.g. 3 payment requests instead of 2)
1. Supabase SQL editor: paste all of `stage-6d1-core.sql`, Run (expect "Success. No rows returned"; if it stops with a message ending "Nothing was changed." send it to me).
2. Paste all of `stage-6d1-tests.sql`, Run. Expected: an error box starting "STAGE 6D-1 TESTS" and ending "RESULT: ALL PASS". Send the box only if a FAIL appears.
3. Upload the three site files, sign in as a coordinator, open Messages on a booking that has a payment request and check the cards and the right-hand column.

# Handoff: stage B1 done (new-booking intake). Not yet run on the real project. (2026-11-08)

Read first: `00-PLAN.md`, `handoff-T1.md`, `AGENTS.md`, `DESIGN-SYSTEM.md`.

## Built
SQL `sql/coordinator-flow/b1-new-booking-intake.sql` (undo: `b1-rollback.sql`). Built from the exact function text the owner pasted from `b1-introspect.sql` (only marked B1 lines added).
1. New table `local_booking_customer_chats`: one row per booking = coordinator chatted with the customer and confirmed date, price, place, details (4 ticks + note up to 500). Row level security on, no policies, no direct access from the browser.
2. New function `local_booking_record_customer_chat(booking, request_id, date_ok, price_ok, place_ok, details_ok, note)`. Coordinator's own, open, not frozen bookings only; allowed at assigned / awaiting / tasker_confirmed / tasker_declined / quote_declined. A retry or a second record returns the existing one (no overwrite).
3. Quote blocked until the row exists: hint `customer_chat_required`, checked in `local_booking_send_quote` AND `_local_booking_transition` (quote_sent branch).
4. `local_booking_detail` also returns `customer_chat_recorded` + `customer_chat {note, recorded_at}`; `local_booking_list` returns `customer_chat_recorded`.
5. One-time backfill: bookings already at quote_sent / quote_approved / quote_declined get a row "Recorded before this step existed (not checked)." so an old booking whose quote is declined is not stuck. Bookings at assigned / awaiting / tasker_confirmed must record the chat before quoting.
Not changed on purpose: recording the Local Tasker's answer is NOT blocked by the chat record (the plan says to phone the Local Tasker while chatting). No timeline event is written (the allowed `local_booking_events.kind` values were not in the introspect output, so a new kind could be refused by a check).

Pages: new `js/coordinator-newbooking.js` (card "New booking": 5 ordered steps, the booking's When/Place/Price/Details to check, 4 ticks + "What did you agree?", summary once recorded). On `coordinator-booking.html` and as a "New booking" action in the chat sheet (`coordinator-chat.html` + `js/coordinator-chat.js`). `js/coordinator-bookings-common.js` (next-step texts follow the new order), `js/coordinator-confirmation.js` (note text), `js/coordinator-quote.js` (locked message, new error hint), `css/coordinator.css` (`.is-now` step).
If the SQL has not been run, the detail has no `customer_chat_recorded` flag: the card stays hidden and every page behaves as before.

## Owner order
1. Run `b1-new-booking-intake.sql` in the SQL editor (it runs in one transaction). 2. Push the changed files.
3. Check: open a New booking (see the 5 steps), try Quote on a Local Tasker-confirmed booking (locked), tick 4 boxes + note > Save (steps 2-3 done, quote unlocks), reload (summary stays).
Before running, if you want to know who gets blocked: bookings at `tasker_confirmed` with no record yet.

## Tested
- Scratch Postgres 16 with stand-in tables and the REAL original function text: baseline (original lets a quote go without a chat), apply, backfill hit only quote_* rows, quote blocked in both places, 3 ticks / short / long note / other coordinator / closed booking all refused with the right hint, retry and second record return the existing row, quote unlocks after recording, list and detail flags, browser role cannot select/insert/update/delete the table, anon cannot call the function, rollback restores the 4 functions byte-for-byte, re-apply works.
- Headless Chromium on `coordinator-booking.html` at 390px with a stubbed Supabase and the real modules: 9 scenarios pass (card, steps, validation, save + args sent, server error, quote locked / unlocked, SQL-not-run fallback, closed booking). No sideways scroll.
## NOT verified
- The real Supabase: the SQL has not been run on your project; stand-ins replace `_local_booking_allowed_next`, `_local_booking_log`, `is_active_coordinator`, `job_booking_frozen`, `_local_booking_is_open` (not in the introspect output).
- The chat page (`coordinator-chat.html`) was not opened in a browser: only JS syntax was checked. The booking page is the tested one.
- `node tools/check-design-system.js` lists none of the edited files (it still fails on older files).

## Next stage: B2 (quote and money loop), see `00-PLAN.md`. Its introspect is `b1-introspect.sql` (Blocks 3-4 results were pasted: payment functions, tasks status); still needed for B2: the `payment_requests` / `messages` columns and the full text of `price_respond`, `job_cancel`, `job_progress` (pasted, in the owner's CSV).

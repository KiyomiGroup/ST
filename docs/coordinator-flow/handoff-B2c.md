# Handoff: stage B2c done (the customer will not accept: the coordinator closes the booking). Not yet run on the real project. (2026-11-09)

Read first: `00-PLAN.md`, `handoff-B2b.md`, `AGENTS.md`, `DESIGN-SYSTEM.md`. Built from the owner's `b2c-introspect.sql` results (exact function text and trigger list).

## What the introspect showed (drives the design)
- `local_booking_cancel` (coordinator cancel) already works at "quote declined": no money is held then. It cancels pending payment requests, expires pending job requests, sets the booking `cancelled`, writes the cancellation row (audit, timeline) and the Job Room line.
- The Job Room chat closes by itself: trigger `chat_close_on_booking` (`_chat_close_for_booking`) sets `message_threads.closed_at` when a booking becomes cancelled.
- A cancelled booking RE-OPENS the task: trigger `offer_cancel_on_booking` (`_offer_cancel_on_booking`) sets the accepted application to cancelled and the task from `in_progress` back to `open`. The plan says the task must stay closed, so B2c closes it again (see below).
- No notification to the customer exists for a cancel (Block 7 returned no rows).
- The allowed cancel reasons (`lbc_reason_check`) have no "price not accepted", so the reason stored is `other` with a fixed note. Not changed.
- `tasks.status` allows open / in_progress / completed / cancelled / draft: "closed, not re-opened" = `cancelled`.

## Built
SQL `sql/coordinator-flow/b2c-close-declined.sql` (undo: `b2c-rollback.sql`). ONE new function `local_booking_close_declined(p_booking, p_request_id, p_note)`. Nothing existing is changed.
1. Coordinator's own booking only; only at `quote_declined` or `tasker_declined` (hint `invalid_transition` otherwise); note up to 250 characters.
2. Calls `local_booking_cancel(..., 'other', 'Customer will not accept the price: <note>')`. All its checks and hints stay (booking_closed, dispute_open, money_held, payment_started, retry safety). A retry of the same request id returns the first answer and does nothing more.
3. Right after the cancel: the booking's task is set to `cancelled` (only if open or in progress; a failure is a warning and never blocks the close).
4. The customer gets a bell item (`_notify`, type `job_update`, the same type the price answer uses) saying the booking was closed and nothing was charged (and that the task is closed, post it again). Returns the cancel result plus `task_closed`.
The Job Room chat closes through the existing trigger.
Other cancels (the customer's `job_cancel`, the plain coordinator "Cancel this job") still re-open the task: NOT changed on purpose.

Pages: the "Quote declined" card (`coordinator-booking.html`, `js/coordinator-declined.js`) gets "If the customer will not accept" with a button "Customer will not accept: close booking" > confirm panel (what happens, optional note, "Yes, close the booking" / "Keep it open"). Shown at quote declined and Local Tasker declined only. `js/coordinator-booking.js` passes `reload`. `css/coordinator.css`: one rule so `hidden` wins inside this card.
Order: run the SQL first, then push the files. If the files go first, the button shows "This step is not switched on yet" and nothing changes.

## Owner order
1. Run `b2c-close-declined.sql` in the SQL editor (one transaction). 2. Run the check query at its end (one row).
3. Push the changed files.
4. Test on a booking the customer has declined (a test booking, not a real customer): open it as the coordinator > "Quote declined" card > "Customer will not accept" > Yes, close. Check: the booking shows closed; the task is `cancelled` (not open); the Job Room chat is closed; the customer's bell shows "Your booking was closed". Try the button on a booking where the customer paid: it must be refused with the "Cancel or report a problem" message.

## Tested
- Headless Chromium at 390px, stubbed Supabase, the real module and the card markup: 40 checks pass in total (22 from B2b plus 18 for closing): button only at quote declined / Local Tasker declined; confirm panel opens and closes; the rpc gets booking id, a request id and the trimmed note (null when empty); reload after success; money_held message; retry reuses the same request id; "SQL not run" message; no sideways scroll. (This run found and fixed a CSS bug: `hidden` was overridden by `display:flex`.)
- JS syntax of all scripts. `node tools/check-design-system.js`: same 19 old violations, none in edited files.
## NOT verified
- THE SQL HAS NOT BEEN RUN ANYWHERE. No Postgres in the sandbox, no parser either. It was written by hand from the pasted function text. If the SQL editor reports an error, paste it back.
- `_notify` argument order (user, type, title, message, data) is copied from the B2a and `price_respond` code; the customer bell/phone/email delivery for `job_update` was not tested.
- Whether `local_booking_cancel` can be called from inside another security-definer function (it reads `auth.uid()`, which stays the coordinator). Expected to work.
- The page was not opened against the real Supabase.

## Next stage: B2d (needs `b2d-introspect.sql`, which I write first, read-only): the quote appears as a card in the chat.

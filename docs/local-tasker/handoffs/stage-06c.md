# Stage 6C handoff: Actions (Request) sheet in the coordinator chat

## 1. Why
The coordinator chat (coordinator-chat.html) had no Request/Actions section, so a coordinator could not arrange price or payment from the conversation. The tasker Job Room has an "Actions" button and sheet. Stage 6C adds the coordinator equivalent.

## 2. What was added (no new SQL, no new database function)
- "Actions" button in the composer (customer-message mode only, current coordinator only; hidden for internal notes and for read-only access). A dot shows when the booking needs the coordinator.
- Next-step row above the conversation (same text as the Booking context column) with an "Open actions" button, on every screen size.
- Problem bar (same `jr-dispute-bar` as the Job Room) while a problem report is open; "View" opens Cancel or report a problem.
- Actions sheet (same `jr-sheet` as the Job Room), grouped like the tasker sheet:
  - Price and payment: Record the Local Tasker's answer, Send or change the quote, Request an extra cost, Lower the price
  - On the day: Record progress, Release the payment
  - Problems: Write down something that went wrong, Cancel or report a problem
  Unavailable actions are greyed with a reason. Each action opens the SAME card, with the same checks and the same database function, as coordinator-booking.html (the js/coordinator-*.js modules mount into the sheet; nothing was copied or rewritten).
- After any action saves, the page reloads the booking details, the cards, the conversation and the inbox.

## 3. Files
MODIFIED: `coordinator-chat.html`, `css/coordinator-chat.css`, `js/coordinator-chat.js`.
NEW: this handoff, `docs/local-tasker/tests/stage-6c/` (`run-6c.py`, `fake-base.js`, `chat-rpc.js`).
NOT modified: any other page, any js/coordinator-*.js card module, any SQL, `messages*.js/css`.

## 4. Tests actually run
Playwright (Chromium) with a MOCKED Supabase: 28 PASS, 0 FAIL (1440 and 390 wide). Covers the button/bar/dot, menu groups and greyed reasons, the quote form sending exactly the booking-page arguments, the extra-cost request, the sheet refreshing after a save, Escape and Back, note mode hiding the button, the problem bar, read-only access, no horizontal overflow on a phone, no duplicate ids, and that no payment, release, cancel or dispute function is called by the page itself.
`node tools/check-design-system.js`: nothing reported for the three files changed here. It still fails on `context-snapshot/verify.html` and `withdrawals-reference/css/tokens.css`, which are reference folders already in the upload and were not touched.
NOT RUN: the real Supabase, Realtime, real phones, other browsers.

## 5. Still different from the tasker chat (needs backend work, not built)
1. Payment and request cards inside the conversation. Coordinators cannot read `payment_requests` or `job_requests`, so payment requests still show as a plain line. Needs a read-only coordinator function.
2. Attachments (photo, camera, file, location). The upload bucket and its rules are for the two thread parties; a coordinator would need a new function and storage rule.
3. Job Details panel parts: payment history and the activity timeline.
4. Tasker-only actions that have no coordinator function today: propose a price in chat, reschedule, custom request, send update, submit proof of work, send invoice. For a Local Tasker the price is agreed on the phone and recorded through "Record the Local Tasker's answer" and the quote.

# Handoff: stage B2d done (the quote appears as a card in the chat: coordinator chat page, read). Not yet run on the real project. (2026-11-09)

Read first: `00-PLAN.md`, `handoff-B2c.md`, `AGENTS.md`, `DESIGN-SYSTEM.md`. Built from the owner's `b2d-introspect.sql` results (exact function text).

## What the introspect showed (drives the design)
- A quote is only a row in `local_booking_quotes` plus a state change; `local_booking_send_quote` writes nothing to the chat. So no chat line exists today.
- Chat cards work by a message that points at a row (`PAYMENT_REQUEST:<id>`, `JOB_REQUEST:<id>`), and `coordinator_chat_cards` returns the rows. The quote follows the same idea.
- `messages_guard` blocks `system` / `payment_confirmed` only for the signed-in roles; a security-definer function passes (that is how `_job_event` writes its lines). `messages_room_gate` lets every type other than the person-written ones through, so the line also works in a closed room. `local_chat_notify_coordinator` ignores non-person types, so the line does not alert the coordinator about their own quote.
- `coordinator_chat_thread` passes `payload` only for image / video / file / location. That is why the card needed a change there.
- Block 2b (check constraints on `messages.type`) was not pasted. To stay safe, no new message type is used.

## Built
SQL `sql/coordinator-flow/b2d-quote-card.sql` (undo: `b2d-rollback.sql`, which restores both functions to the exact pasted text). One transaction.
1. New function `_local_booking_quote_chat_line()` and trigger `lbq_chat_line` (AFTER INSERT on `local_booking_quotes`): writes ONE Job Room line when a quote is sent: type `system`, sender the Local Tasker's user (like `coordinator_send_message`), receiver the customer, body "Quote sent: <naira>" ("New quote sent: ..." from version 2), payload `{card:'quote', quote_id, version}`. Moves the thread preview and adds 1 to the customer's unread count. Uses `_local_booking_thread` (the existing thread, or creates it once). Any error is swallowed with a warning: a chat line never blocks a quote. The naira sign is written as `chr(8358)` so the editor cannot garble it.
2. `coordinator_chat_cards`: adds `quotes` (every quote of the booking: id, version, total, note, lines from `_local_booking_quote_lines`, status sent / approved / declined / replaced, the customer's reason and proposed price). Everything else in the function is the pasted text.
3. `coordinator_chat_thread`: for a `system` line whose payload says card = quote, passes only `{card, quote_id, version}`.
Not changed: `local_booking_send_quote`, quote tables, state machine, payments, notifications, the messages table and its triggers, `coordinator_send_message`.
Quotes sent BEFORE the SQL runs get no chat line (no back-fill).

Page: `js/coordinator-cards.js` only. A system line with that payload is drawn as a read-only quote card (title Quote / Quote 2, total, lines, note, status badge; when declined, the price asked for and the reason). Text only (`textContent`), existing classes, no new CSS. If the quote data is missing the old plain line ("Quote sent: ...") is shown. `coordinator-chat.js` is unchanged: it already reloads the cards on every refresh, so the badge changes when the customer answers.
Order: run the SQL first, then push the file. (The file alone is harmless: no line has a payload yet.)

## Owner order
1. Run `b2d-quote-card.sql` in the SQL editor (one transaction). 2. Run the check query at its end: one row, three `true`.
3. Push `js/coordinator-cards.js`.
4. Test on a TEST booking: as the coordinator send a quote (or a new quote after a decline). Open the coordinator chat for that booking: a Quote card appears with the total and lines and "Waiting for the customer to answer". As the customer approve or decline: the badge changes (Approved / Declined, with the price asked and the reason). Send a second quote: the first shows "A newer quote was sent" and the new one is "Quote 2".
5. As the customer, the Job Room shows a plain line "Quote sent: ..." (the card there is B2e).

## Tested
- jsdom, stubbed Supabase, the real `coordinator-cards.js`: 19 checks pass: card built for sent / approved / declined / replaced and version 2; totals and lines; read only (no buttons); a reason with HTML stays text; a normal system line and a text message with a fake payload are not cards; the signature changes when the status changes; no `quotes` key (old server) does not crash; the payment card is unchanged.
- SQL: both files parsed with a real Postgres parser (pglast): all statements, and all 3 (forward) and 2 (rollback) plpgsql function bodies, parse.
- JS syntax of all scripts. `node tools/check-design-system.js`: it reports violations in other files (`css/legal.css`, `css/local-tasker-public.css`, new-page shell warnings); none in `coordinator-cards.js`. Those were not touched.
## NOT verified
- THE SQL HAS NOT BEEN RUN ANYWHERE (no Postgres in the sandbox, the parser only checks syntax). If the editor shows an error, paste it back.
- The trigger was not exercised: whether the `messages` insert succeeds (foreign keys, any constraint on `type` or `payload` that Block 2b would have shown) is unproven. If it failed, the quote would still be sent and Postgres would log a warning; no card would appear.
- The page was not opened against the real Supabase or in a real browser.
- Whether `local_booking_quote_decisions` has at most one row per quote (assumed, as `local_booking_customer_quotes` does).

## Finding (not changed)
In the pasted source of `local_booking_send_quote` the error message "Each cost must be 0 or at least ₦100" is stored with garbled characters (a mojibake of the naira sign). It only shows when a coordinator types an amount between 1 and 99. Fix separately if wanted.

## Next stage: B2e (front end only, no database): the same quote card in the customer's Job Room (`js/messages-thread.js` `buildSystem`) with Approve / Decline, using the existing answer function (B2a) and the proposed-price field.

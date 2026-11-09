# Handoff: stage B2e done (the quote as a card in the customer's Job Room, with Approve / Decline). Not yet pushed. (2026-11-09)

Read first: `00-PLAN.md`, `handoff-B2d.md`, `handoff-B2a.md`, `AGENTS.md`, `DESIGN-SYSTEM.md`. Front end only: NO new SQL.

## Built
- NEW `js/messages-quote.js` (`window.JRQuote`). The B2d chat line (type `system`, payload card = quote) is drawn as a quote card for the customer: from the Local Tasker, each line and the total, the coordinator's note, and a status pill.
  - Quote waiting: buttons Approve quote / Decline. Approve opens a confirm panel ("You are approving ... Nothing is charged") > Yes, approve / Back. Decline opens a panel with an optional reason (300 characters) and an optional service price, showing the current service fee; the price is checked in the browser (whole number, at least 100, lower than the fee) and again by the database.
  - Answer: the same call as the Bookings page, `local_booking_decide_quote(p_booking, p_version, p_request_id, p_decision, p_reason, p_counter)`. The same request id is reused until it succeeds, so a retry never answers twice. Error hints (quote_changed, invalid_transition, booking_closed, dispute_open, already_paid, bad_input) show the same words as the Bookings page.
  - After an answer the chat is reloaded, so the payment cards that an approval creates appear. Approved: green badge "You approved this quote. Pay each item in the payment cards in this chat." Declined: shows the price asked for and the reason, "You have not been charged".
  - An older quote (a newer version exists) shows the plain line with "Replaced by a newer quote" and no buttons. A quote line that arrives live and is newer than the loaded data triggers one refresh, then draws.
  - Only the customer gets the card. Any other role, or any load error, shows the plain line "Quote sent: ..." exactly as before.
- `js/messages-thread.js`: two small changes: a system line with the quote payload is built by `JRQuote.build` (all other system lines unchanged); `loadQuote()` runs next to the other loads when a conversation opens and can never block it.
- `messages.html`: one script tag after `messages-thread.js`.
- `css/messages.css`: 5 small rules at the end (`.jr-quote-*`), tokens only. The rest reuses existing Job Room classes.
Nothing else changed. `js/customer-quote.js` (Bookings page) is untouched: the two screens keep working side by side, and either one can answer.

## Owner order
1. B2d's SQL must already be run (the card needs the chat line and `local_booking_customer_quotes`, which already exists).
2. Push `js/messages-quote.js`, `js/messages-thread.js`, `messages.html`, `css/messages.css`. Pushing before the B2d SQL is harmless: customers just see the plain line.
3. Test with a TEST booking, as the customer: the coordinator sends a quote; open the Job Room: the Quote card shows with Approve / Decline. Decline with a price of 8000 (below the fee): the card shows what you asked for; as the coordinator the card in the coordinator chat says Declined. Send a new quote: the old card says replaced, the new one is Quote 2. Approve it: the payment cards appear in the chat and the Bookings page agrees. Try a price above the fee: refused with a clear message.

## Tested
- jsdom, stubbed Supabase, the real `messages-quote.js`: 25 checks pass: load by the thread's booking id; figures, note, sender; approve and decline flows and Back; rpc arguments (approved: no price or reason; declined: 8000 and the trimmed reason; empty fields send null); "abc", 50, the fee, above the fee refused with no call and the typed text kept; network failure message and the same request id on retry; `quote_changed` message and refresh; chat reloaded after success; approved and declined views; old version shows replaced; version 2 is live; Local Tasker role gets the plain line and no call; load error gives the plain line; database text stays text; a live newer quote refreshes then draws.
- The real `messages-thread.js` in jsdom: without the module a quote line is the old plain line; with it, a card; ordinary system lines are unchanged.
- JS syntax of all scripts. `node tools/check-design-system.js`: same failures as before in other files (`css/legal.css`, `css/local-tasker-public.css`, new-page shell warnings); none in the files edited here.
## NOT verified
- NOT opened in a real browser and NOT run against the real Supabase. The look of the card at 390px was not checked; it reuses the payment card classes. Please look at it on a phone.
- It depends on `local_booking_customer_quotes(p_booking)` returning the current quote of that booking for the customer (read from its pasted source, not called).
- `JRThread.reload()` is used after an answer (it is exported by `messages-thread.js` and used by the other Job Room modules); the Job Room status banner (`JRRoom`) is not refreshed explicitly.
- B2d's trigger has not been run either, so no quote line exists until it is.

## Next stage: B3 (job day). Needs `b1-introspect.sql` results for the job-day functions (see the plan table). I will say what is missing before building.

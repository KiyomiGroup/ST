# Handoff: stage B2b done (coordinator steps after a declined quote). No database. Not yet pushed. (2026-11-09)

Read first: `00-PLAN.md`, `handoff-B2a.md`, `AGENTS.md`, `DESIGN-SYSTEM.md`.

## Built (front end only, no SQL)
New card "Quote declined" on `coordinator-booking.html`, between "New booking" and "The Local Tasker's answer". It shows when the booking is in a decline round and says what to do, in order:
1. Phone the Local Tasker and tell them the customer's price (and the quote's service fee).
2. Record their new answer ("The Local Tasker's answer" > "Record a new answer").
3. Send the new quote ("The quote").
The first step not done is highlighted (same look as the B1 card). Steps 1 and 2 turn done when a new answer is recorded after the decline. The card also shows the customer's price, the quote's service fee and the customer's reason.
- If the customer proposed no price: step 1 is "read the reason / ask in the chat", step 2 (new Local Tasker answer) is advice only, step 3 send the quote.
- If the Local Tasker then declines (`tasker_declined`): lead text only ("tell the customer"). Closing the booking is B2c.
- The card hides when the booking is closed or frozen, when the quote was sent again, or when there was no decline.

Files: new `js/coordinator-declined.js` (`STCoDeclined.mount(detail)`); `coordinator-booking.html` (card + script tag); `js/coordinator-booking.js` (one mount line); `js/coordinator-bookings-common.js` (next-step text for `quote_declined`); `js/coordinator-confirmation.js` (note under "Next step" points to the new card); `css/coordinator.css` (one rule, tokens only).
Reads: `local_booking_detail` (already loaded) for the timeline; at `quote_declined` also `local_booking_quote` for the customer's price and reason (B2a field `decision.counter_amount`). Writes: nothing. The customer's price is kept in `sessionStorage` (this tab) so steps 2 and 3 can still show it once the old quote is replaced; without storage the price is just left out.
Order of deploy: no SQL. B2a SQL must already be run, or no price shows (steps still show).

## Owner order
1. Push the 6 files (needs B2a SQL run first, see `handoff-B2a.md`).
2. As a customer, decline a quote with a price (B2a). As the coordinator open the booking: the "Quote declined" card shows the price, the fee, the reason and 3 steps; the "Next step" text at the top matches.
3. Press "Record a new answer" and save an answer: steps 1 and 2 tick, step 3 is highlighted, "The quote" card lets you send.

## Tested
- Headless Chromium at 390px, stubbed Supabase, the real `coordinator-common.js`, `coordinator-bookings-common.js`, `coordinator-declined.js` and the card markup copied from the real page: 22 checks pass (price steps; price from storage with no extra call; step progress after a new answer; no-price variant; tasker_declined lead; hidden when quote re-sent, no decline, frozen, closed; quote read failing still shows steps; reason with HTML shown as plain text; no sideways scroll).
- JS syntax check of all 4 edited scripts. `node tools/check-design-system.js`: same 19 old violations as before, none in the edited files.
## NOT verified
- The whole page `coordinator-booking.html` was not opened against a real Supabase (the page waits for sign-in). Only the card was tested in a harness.
- That `local_booking_detail` events for a decline have `kind = status_changed` with `to_status = quote_declined`, and that a new answer shows as `kind = confirmation_recorded` (taken from the existing label code). If they differ, the card still shows at `quote_declined`, but at the later steps it would hide.
- Whether `local_booking_quote` still returns the declined quote as `current` after a new answer is recorded (it may not); that is why the price is kept in sessionStorage.
- The chat page sheet (`coordinator-chat.html`) does NOT get this card (plan says booking page).

## Next stage: B2c (needs `b2c-introspect.sql`, which I write first, read-only): the coordinator closes the booking if the customer will not accept.

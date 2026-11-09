# Handoff: stage B2a done (customer proposes a price when declining a quote). Not yet run on the real project. (2026-11-08)

Read first: `00-PLAN.md` (B2 is now split into B2a to B2e), `handoff-B1.md`, `AGENTS.md`, `DESIGN-SYSTEM.md`.

## Built
SQL `sql/coordinator-flow/b2a-counter-price.sql` (undo: `b2a-rollback.sql`). Built from the exact function text pasted from `b2-introspect.sql` (only marked B2a lines added). One transaction.
1. `local_booking_quote_decisions` gets a nullable column `counter_amount` (check: only with a decline, whole naira, 100 to 10,000,000). The table stays immutable (its guard blocks only UPDATE and DELETE).
2. `local_booking_decide_quote` gets an optional 6th argument `p_counter`. The old 5-argument version is dropped first (two versions with a default would make the call ambiguous). Existing calls with 5 arguments still work. Rules: only with `declined`; whole number, at least 100; lower than the quote's service fee (hint `bad_input`, message names the fee). A repeat of the same request id still returns the first answer (nothing changes).
3. A decline tells the coordinator: `_notify(coordinator_id, 'coordinator_quote_declined', ...)` with data `{booking_id, url, counter_amount}`. The text says to phone the Local Tasker, tell them the price, record the answer, then send a new quote (a different text when no price was proposed, mentioning that the booking can be closed if the customer will not accept: that closing is B2c).
4. The timeline note and the audit row include the proposed price. `local_booking_customer_quotes` and `local_booking_quote` return `counter_amount` inside `decision`.
Not changed: the state machine (`_local_booking_allowed_next`: quote_declined can already go to quote_sent or back to awaiting_tasker_confirmation), payments, escrow, who may answer, the quote itself.

Pages: `js/customer-quote.js` (decline panel gets an optional "service price" field showing the current service fee; declined view and hint show the price asked for; checks the number before sending), `js/coordinator-quote.js` (the quote card's lead text shows the customer's price and says the service fee is the Local Tasker's own price, so go back to the Local Tasker), `css/customer-bookings.css` (`.bk-q-money`, tokens only; 16px on phones).
Order matters: the customer page now always sends `p_counter` (null when empty). If the files are pushed BEFORE the SQL, declining a quote fails (the database rejects the unknown argument). So run the SQL first, then push the files.

## Owner order
1. Run `b2a-counter-price.sql` in the SQL editor. 2. Run the two check queries at its end (one row with `p_counter`; one row `counter_amount`). 3. Push the changed files.
4. Check as a customer on a booking at "Quote to Review": Decline > type 8000 (below the service fee) > Decline quote: the card says you asked for ₦8,000. Try a price above the fee: it is refused with a clear message. Decline once with the box empty: works as before.
5. As the coordinator: the bell shows "Customer declined the quote", and the quote card lead shows the price.

## Tested
- Headless DOM test (jsdom, stubbed Supabase, the real `customer-quote.js`): 16 checks pass: field and fee text shown; "abc", 50, the fee itself and a price above it refused in the browser with no call sent; typed value survives a refused attempt; `₦8,000` is sent as 8000 with the reason; empty box sends null; approve never sends a price; declined view and hint with and without a price; a server `bad_input` message is shown.
- SQL: both files were run through a real Postgres parser (pglast): all statements and the 3 plpgsql bodies parse.
## NOT verified
- The SQL has NOT been executed on any database (no Postgres could be installed in the sandbox). Not run on your project.
- `coordinator-quote.js` was only syntax-checked, not opened in a browser. The page `customer-bookings.html` was not opened in a real browser.
- Whether the coordinator's phone push or email is sent for the new type `coordinator_quote_declined`: delivery code for push/email was never pasted and may filter by `type` (see `handoff-N1.md`). The bell item should appear; `_notify` swallows errors, so if the notifications table refuses the type, nothing shows and the decline still works. The booking page itself is the fallback until B2b.
- `node tools/check-design-system.js` was not run (not part of this sandbox check).

## Findings useful later
- `b2-introspect` Block 3b returned NO check constraint for `local_booking_events` or `local_booking_quotes`: the timeline `kind` is free text, so B1's worry about a refused new kind does not apply.
- Statuses seen: `payment_requests.status` pending/processing/paid/failed/declined/cancelled/refunded; `job_requests.status` pending/fulfilled/declined/cancelled/expired; `tasks.status` open/in_progress/completed/cancelled/draft.
- Still not pasted (needed by B2c/B2d): `_local_booking_cancel_block`, `_local_booking_create_requests`, `coordinator_send_message`, `coordinator_chat_thread`, `coordinator_chat_cards`, `price_respond`, `job_cancel`.

## Next stage: B2b (no database). Coordinator guided steps after a decline. Then B2c (needs `b2c-introspect.sql`, which I will write first).

# Handoff: stage B4 built (payout 24 hour wait, countdown card, "payout paid" notice). Task visibility NOT done. Not yet run / pushed. (2026-11-09)

Read first: `00-PLAN.md`, `handoff-B3.md`, `AGENTS.md`. Built from the owner's `b4-introspect.sql` results (exact text of `_release_escrow`, `local_payout_claim`, `local_payout_record_result`).

## What the introspect showed
- `local_booking_submit_code` > `_release_escrow` does everything at once: sets the booking `completed` + `released`, credits the coordinator commission to their wallet, and inserts the `local_payouts` row (status `queued`, or `review` when there is no verified account). So the chat and the task already close at the moment of the code, and the chat-close trigger from B3 is now only a safety net.
- Nothing waited: no delay column existed on `local_payouts`.
- `local_payout_claim` is what a sender calls to take queued payouts. NO sender is in the repo (no edge function calls it) and there is NO cron for it. `local_payouts` had 0 rows. The Paystack webhook only handles the result (`local_payout_apply_event`).
- `_co_notify` exists (N1). Statuses of `local_payouts`: queued, processing, paid, failed, review, reversed.
- Block 10 (views on tasks) returned no rows: the site lists tasks with plain queries on `tasks.status = 'open'`.

## Built
1. SQL `sql/coordinator-flow/b4-payout-countdown.sql` (undo `b4-rollback.sql`, restores `local_payout_claim` to the exact pasted text and drops the column). One transaction.
   - `local_payouts.release_after` + trigger `lp_set_release_after` (BEFORE INSERT): a new `final` payout gets `now() + 24 hours`. `_release_escrow` is NOT changed.
   - `local_payout_claim`: pasted text plus one condition: only rows with `release_after` null or past. Nothing can send a payout early.
   - Trigger `lp_notify_coordinator` (AFTER UPDATE OF status): when a payout becomes `paid` (Paystack confirmed), the coordinator of the booking gets ONE notification (`coordinator_payout_sent`, once per payout), via `_co_notify`, linking to the booking. Errors are swallowed with a warning.
   - `local_booking_payout_state(p_booking)`: coordinator of that booking only (same guard as `local_booking_code_state`); returns phase waiting / due / processing / paid / failed / review / reversed, amount, `seconds_left` (worked out by the database).
2. Page: new card "Payout to the Local Tasker" on `coordinator-booking.html`, `js/coordinator-payout-status.js` (new), one mount line in `js/coordinator-booking.js`. It shows only once the booking is released and a payout row exists. Countdown "Time left: 23 hours 58 minutes", refreshed every 30 seconds from the server's seconds; then plain text for due / processing / paid / failed / review (no internal reasons shown). Text only (`textContent`), existing classes, no new CSS, nothing written.

## Owner order
1. Run `b4-payout-countdown.sql`; run the check at its end (one row, four `true`).
2. Push `js/coordinator-payout-status.js`, `js/coordinator-booking.js`, `coordinator-booking.html`.
3. Test on a TEST booking: release with the code. The card shows the countdown (about 24 hours). To test the end without waiting, in the SQL editor: `update public.local_payouts set release_after = now() where booking_id = '<id>'` (card shows "wait is over"), and `update public.local_payouts set status = 'paid', paid_at = now() where booking_id = '<id>'` (card shows paid and the coordinator bell gets "Payout sent to the Local Tasker").

## Tested
- jsdom, the real `coordinator-payout-status.js`, stubbed Supabase: 12 checks pass (hidden before release / no row / rpc error; countdown text; amount; under a minute; due; paid; review with and without account, internal reason not shown; no HTML from the database).
- SQL and every plpgsql body parsed with pglast. JS syntax. `node tools/check-design-system.js`: nothing reported for the edited files.
## NOT verified
- THE SQL HAS NOT BEEN RUN. The page was not opened against the real Supabase or in a browser (mobile layout at 390px unchecked; it reuses `co-card` classes).
- The 24 hour wait only matters once a sender exists. With no sender and no cron, a `queued` payout never leaves the database today, before or after B4.

## Open decisions / not done
1. SENDER: nothing calls `local_payout_claim` and then Paystack. A new edge function (claim > transfer > `local_payout_record_result`) plus a cron is a separate stage ("no live activation without approval").
2. TASK LEAVES THE SITE ONLY WHEN CLOSED: not changed. `accept_application` (source not pasted) sets the task `in_progress`, which hides it from the open lists; release then sets it `completed` through `_task_close_on_release`. Making it stay visible while booked would let a second tasker be accepted, so it needs the owner's decision first, and `accept_application` source (one more introspect block).
3. The coordinator's commission is still credited at the moment of the code, not after 24 hours (change on request).
4. Failed / review payouts notify no one yet (support sees them in admin).

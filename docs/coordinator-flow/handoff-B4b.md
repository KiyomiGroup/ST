# Handoff: stage B4b built (the coordinator's commission also waits 24 hours). Not yet run / pushed. (2026-11-09)

Read first: `00-PLAN.md`, `handoff-B4.md`, `AGENTS.md`. Owner decision (2026-11-09): "it should be 24 hours" for the commission, same as the Local Tasker's payout. RUN B4 FIRST.

## What changed (and what did not)
- `_release_escrow` is rewritten from the exact text the owner pasted. ONLY the coordinator-commission block changed (marked "Stage B4b" in the file): instead of crediting the wallet at once it inserts a row in the new table `local_booking_commission_holds` (booking, coordinator, amounts worked out exactly as before, `credit_after = now() + 24 hours`) and writes an audit line `commission_held`. The release, the escrow, the payout queue, the booking `completed`/`released`, the customer notice are untouched. I checked by diff that nothing else in the function differs.
- New `_lt_credit_due_commissions()` (cron `lt-commission-credit`, every 5 minutes, same method as the job reminders): credits held commissions whose time is up: same wallet update, same `wallet_transactions` row (type `coordinator_commission`, reference `lt-comm-<booking>`), same `local_booking_commissions` row, same audit `commission_credited` as the old inline code. Once only (checks the commission row, marks the hold credited). A booking with an open problem report (`job_booking_frozen`) is skipped until clear. A failed credit rolls back alone, the error is kept in `last_error`, and it is retried on the next run.
- `local_booking_payout_state` now also returns `commission` (`pending` / `credited` + amount). The booking-page card (`js/coordinator-payout-status.js`, one new paragraph `coPoComm` in `coordinator-booking.html`) says "Your commission of ... is added to your wallet 24 hours after the release code, at the same time as the payout", then "has been added" once credited.
- Not affected: commissions already credited before this runs; bookings that are not Local Tasker bookings; no coordinator (still the `commission_no_coordinator` audit at release).

## Files
`sql/coordinator-flow/b4b-commission-hold.sql` (undo `b4b-rollback.sql`: restores the exact pasted `_release_escrow` and the B4 card function; it REFUSES to run while any commission is still held, so none can be lost), `js/coordinator-payout-status.js`, `coordinator-booking.html`, this note, `00-PLAN.md`.

## Owner order
1. Run `b4-payout-countdown.sql` first if not yet run. 2. Run `b4b-commission-hold.sql`, then its check (one row, four `true`). 3. Push `js/coordinator-payout-status.js` and `coordinator-booking.html`.
4. Test on a TEST booking: release with the code. The coordinator wallet must NOT show the commission yet; the card shows the payout countdown and the commission line (pending). Then in the SQL editor: `update public.local_booking_commission_holds set credit_after = now() where booking_id = '<id>';` and wait up to 5 minutes (or run `select public._lt_credit_due_commissions();`): the wallet shows one `coordinator_commission` row and the card says "has been added". Run the select again: nothing is credited twice.

## Tested
- jsdom, the real card, stubbed Supabase: 16 checks pass (the 12 from B4 plus commission pending, credited, null, and an older server with no `commission` key).
- SQL and all three function bodies (patched `_release_escrow` included) parsed with pglast; the rollback holds the pasted original text exactly (checked by string match). `node tools/check-design-system.js`: nothing reported for the edited files.
## NOT verified
- THE SQL HAS NOT BEEN RUN, so: the cron job, `job_booking_frozen(uuid)` returning a boolean as used here (it is used the same way in `local_booking_submit_code`), and the patched `_release_escrow` against real data are untested. Not opened in a browser.
- The coordinator wallet page lists only credited rows: during the 24 hours the commission is visible only on the booking card.
- If pg_cron were missing the file skips scheduling quietly (it exists here: 4 jobs); then call `_lt_credit_due_commissions()` by hand.

## Still open from B4
1. The payout SENDER (nothing calls `local_payout_claim`). 2. "Task leaves the site only when closed": needs the owner's decision and the `accept_application` source.

# Handoff: stage B3 done (job day: location, steps, satisfaction, release code, chat closes). Not yet run / pushed. (2026-11-09)

Read first: `00-PLAN.md`, `handoff-B2d.md`, `AGENTS.md`. Built from the owner's `b3-introspect.sql` results.

## What the introspect showed
- Milestones (`local_booking_record_milestone`, `local_booking_milestones`) already give the order and `next_kind`. Release is `local_booking_submit_code` > `_release_escrow` (source NOT pasted). The code state, 3 tries and lock already exist.
- The chat closes when `bookings.status` becomes completed or cancelled (`chat_close_on_booking`). Nothing in the pasted text proves that a release sets `completed`. Also `_task_close_on_release` expects completed + released together, which suggests it does.
- `coordinator_send_location` shares where the COORDINATOR is. The customer's location arrives as a normal `location` message (payload lat, lng, label), which the coordinator chat already receives.
- `local_booking_state` had 2 bookings at quote_approved and 2 at tasker_confirmed (no job has run end to end yet).

## Built
1. SQL `sql/coordinator-flow/b3-close-on-release.sql` (undo `b3-rollback.sql`): function `_lt_close_chat_on_release` + trigger `lt_close_chat_on_release` (AFTER UPDATE OF payment_status on bookings). When payment becomes `released` on a Local Tasker booking: one closing line ("Payment released. Thank you for using StreetTasker. This chat is now closed.", type system) and `closed_at` set if empty. Errors are swallowed with a warning. Nothing existing changed.
2. `js/coordinator-dock.js` (the docked panel above the message box). When the customer has paid it now follows the job day, using `local_booking_milestones` (`next_kind`):
   - next = address_confirmed: "Get the job location": button asks the customer in the chat (once) to share the exact place. When the customer has shared a location: shows its name, "Open in Maps", "Call the Local Tasker" (if their number is known), and "Record: address confirmed".
   - next = arrived / started / finished: a card telling the coordinator whom to call and what to record, with the button to the Record progress form (and the call button).
   - everything recorded (finished): "The work is finished" with "Ask the customer if they are satisfied" (sends one plain message, once) and, right under it, the release code box (the existing one, unchanged).
   - Each earlier step has "I already have the release code" to jump to the box, so nobody is stuck. If the steps cannot be read, the old release box shows.
   - The panel re-reads the steps whenever the booking reloads (after a step is recorded). Before payment nothing changed.
Not changed: milestones and release functions, the Record progress form, N1d reminders (they still prompt the coordinator at the start time), payments.

## Owner order
1. Run `b3-close-on-release.sql`; run the check at its end (one row, true).
2. Push `js/coordinator-dock.js`.
3. Test on a TEST booking that is quote_approved and paid: the dock shows "Get the job location"; ask the customer; as the customer share a location in the Job Room; the dock shows the place and Maps/Call buttons; record address confirmed > arrived > started > finished in Record progress, watching the panel move on; at the end ask for satisfaction and enter the customer's release code. Check the customer's Job Room: closing line shown and the chat is read only.

## Tested
- jsdom, the real `coordinator-dock.js`, stubbed Supabase and chat: 22 checks pass: each step card; location asked once with no digits in the text; customer location shown, a coordinator location ignored; Maps link built from numbers; call button only with a phone; code box absent until all steps are recorded, present with the satisfaction card afterwards; force; steps unavailable falls back; the panel follows after a reload; unpaid state unchanged and no milestone call.
- SQL parsed with pglast (all statements and the plpgsql body). JS syntax. `node tools/check-design-system.js`: nothing reported for the edited file (other files still fail as before).
## NOT verified
- THE SQL HAS NOT BEEN RUN. The page was not opened against the real Supabase or in a browser (dock layout at 390px unchecked; it reuses the existing dock classes).
- Whether `_release_escrow` already sets the booking to completed (then the chat closes twice-safely; the new trigger only adds the closing line).
- That a customer's shared location reaches the coordinator thread with `payload.lat/lng` (read from `coordinator_chat_thread`; two such messages exist in the data).
- The satisfaction message uses the normal coordinator message path (contact-detail filter applies).

## Open decisions (defaults used)
Release code as a modal pop-up instead of the docked panel; a platform channel to the Local Tasker for the location (today: the coordinator relays by phone).

## Next stage: B4 (payout countdown 24 hours after the release code, notification to the coordinator when the payout is sent, task leaves the site only when closed). Needs `_release_escrow` and the payout functions: I will write `b4-introspect.sql` first.

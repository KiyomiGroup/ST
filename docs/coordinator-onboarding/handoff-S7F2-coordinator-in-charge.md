# Stage F-2 handoff: Local Tasker identity gate + coordinator in charge (2026-11-07)
Owner rules: SQL editor + dashboard function deploys only; no console/curl/terminal steps; stage zip = changed files only.
Owner decisions (2026-11-07): (1) a LOCAL TASKER cannot be published until THEIR identity is verified (an earlier reading, "the coordinator must be verified", was wrong: coordinators already cannot use their pages until verified, E-1); (2) the administrator only coordinates the coordinators; coordinators are completely in charge of their Local Taskers, so the administrator call-back (second check) is removed. NOTE: the owner had NOT applied the earlier zip; this zip holds every file changed in F-2 against the original upload.

## Done (browser only, nothing run on real Supabase)
- js/coordinator-publish.js: reads idv_local_status(p_tasker); if the Local Tasker is not VERIFIED (or the status cannot be read) a blocking item "Their identity check is verified" is added (link coordinator-tasker-verify.html?id=), Publish and Update are disabled, and publish() refuses with a plain message.
- Call-back removed from coordinator-booking.html and coordinator-chat.html (checkbox and note), js/coordinator-confirmation.js (always sends p_second_check=false), js/coordinator-quote.js (a quote is never held for a call-back). Old history labels kept in coordinator-bookings-common.js.

## F1 results received (2026-11-07) and what they showed
- publish_local_tasker / local_tasker_publish_status / idv_can_publish: Local Taskers were 'not_gated_here'; nothing checked identity on publish.
- Call-back lived in local_booking_record_confirmation (p_second_check -> 'requested'), local_booking_send_quote and _local_booking_transition (raise second_check_pending), local_booking_second_check (admin only, uses is_local_tasker_admin()), audit trigger local_booking_confirmations_audit. Two confirmations were 'requested'.
- Owner answers: identity-before-test order: leave as is. Already-live Local Taskers: leave live (the existing live one was published by the owner's own coordinator account).

## Written, NOT yet run: sql/coordinator-onboarding/f2-identity-gate-and-no-callback.sql (owner runs it once in the SQL editor)
- A. _local_tasker_identity_ok(); local_tasker_publish_status adds a blocking check key 'identity'; publish_local_tasker refuses a FIRST publish with hint identity_not_verified unless identity is VERIFIED or the account is on the idv_is_exempt list. Live listings can still be refreshed.
- B. BEFORE INSERT trigger forces second_check_status='off' on every new confirmation; the 2 open requests are set to 'off' quietly (session_replication_role replica inside the transaction, so no administrator timeline row is written; if the editor refuses that setting, the whole script rolls back, tell the next AI); local_booking_second_check is dropped. The dead second_check_pending branches in _local_booking_transition and local_booking_send_quote were left untouched on purpose.
- Browser: js/coordinator-publish.js reads the new 'identity' check from the server (label + link to coordinator-tasker-verify.html?id=); before the SQL is run it falls back to idv_local_status. Not tested against real Supabase.

## NEXT (stage F-3): center coordinator
Owner (2026-11-07): their own coordinator account (it published the existing live Local Taskers) becomes the "center coordinator" for now: top plan ("infinity" tier) without paying, and an administrator must be able to take Local Taskers from it and assign them to another coordinator. Needs sql/coordinator-onboarding/f3-introspect.sql results first (plan/tier functions, assignment tables, any existing reassign function, who published what). Plan: a small table (e.g. coordinator_center, RLS on, no policies) naming the center coordinator; my_coordinator_plan returns the highest tier/unlimited capacity for it; admin function admin_reassign_local_tasker(p_tasker, p_to_coordinator, p_reason) (allowed for is_local_tasker_admin() or service role/SQL editor; moves the assignment AND the Local Tasker's open bookings, writes audit + timeline, notifies both coordinators); the Local Tasker's identity/publish state is untouched. Admin screen is out of scope (the admin page is built last).

## Left as administrator on purpose
Problem reports/disputes, unlocking a booking after three wrong release codes, assigning/reassigning Local Taskers (needs_reassignment), "ask an administrator" text on empty states.

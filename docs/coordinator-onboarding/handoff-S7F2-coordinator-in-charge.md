# Stage F-2 handoff: Local Tasker identity gate + coordinator in charge (2026-11-07)
Owner rules: SQL editor + dashboard function deploys only; no console/curl/terminal steps; stage zip = changed files only.
Owner decisions (2026-11-07): (1) a LOCAL TASKER cannot be published until THEIR identity is verified (an earlier reading, "the coordinator must be verified", was wrong: coordinators already cannot use their pages until verified, E-1); (2) the administrator only coordinates the coordinators; coordinators are completely in charge of their Local Taskers, so the administrator call-back (second check) is removed. NOTE: the owner had NOT applied the earlier zip; this zip holds every file changed in F-2 against the original upload.

## Done (browser only, nothing run on real Supabase)
- js/coordinator-publish.js: reads idv_local_status(p_tasker); if the Local Tasker is not VERIFIED (or the status cannot be read) a blocking item "Their identity check is verified" is added (link coordinator-tasker-verify.html?id=), Publish and Update are disabled, and publish() refuses with a plain message.
- Call-back removed from coordinator-booking.html and coordinator-chat.html (checkbox and note), js/coordinator-confirmation.js (always sends p_second_check=false), js/coordinator-quote.js (a quote is never held for a call-back). Old history labels kept in coordinator-bookings-common.js.

## NOT done: needs the owner's SQL results first
- The database may still allow publishing an unverified Local Tasker (E-1 made idv_can_publish 'not_gated_here' for Local Taskers). Also already-published unverified Local Taskers stay live unless decided otherwise (ask owner).
- The database still honours a requested call-back (second_check_pending on quote send).
- Owner runs sql/coordinator-onboarding/f1-introspect.sql (read-only) and sends ALL results. Next stage F-3 writes SQL: publish_local_tasker and local_tasker_publish_status require a VERIFIED Local Tasker (hint identity_not_verified), call-back ignored and open requests cleared.

## Open question for owner
"Before they take the test they must verify identity": today the order is test -> coordinator sign-up -> identity check, and a new coordinator can use no page until verified. Moving identity BEFORE the test needs sign-in before the test; ask if that is wanted.

## Left as administrator on purpose
Problem reports/disputes, unlocking a booking after three wrong release codes, assigning a Local Tasker to a coordinator, "ask an administrator" text on empty states.

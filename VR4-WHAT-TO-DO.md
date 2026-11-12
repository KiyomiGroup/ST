# VR4: the old "verify first" rules are switched off

After this, nobody verifies up front. Taskers post and get found, customers book, coordinators start, all without verifying.
The rules that remain: a first withdrawal needs verification and a matching bank name (VR2), and a customer's payments over 10,000 naira need
verification (VR3). Do this ONLY after VR2 and VR3 pass on your test accounts. The SQL refuses to run if VR2 or VR3 is not installed.

## Do, in this order
1. SQL editor: run `sql/verification-rework/vr4-open-gates.sql` (whole file, safe to run twice). It prints a notice with how many tasks, services,
   tasker listings and coordinators it switched on, and a last row: `gate_customers = f`, `still_held = 0`, `booking_guard_left = 0`.
2. Upload `js/tasker-profile.js` and `coordinator-signup.html` (whole files, from your latest repo).
3. Then run the test below on live.

Undo: `vr4-rollback.sql` puts every changed object back exactly (copied to table `vr4_backup` first). Rows that were already published stay published.

## What it does
- Any signed-in person can publish tasks, services and listings. Held drafts ("until verified") go live now.
- Customers can book without verifying (the booking guard is removed). The street address is still released only after payment (not touched).
- Nobody is sent to the verify page by the old re-verify rule.
- Becoming unverified, or a re-verify round, no longer hides anyone's listings. A manual admin takedown still works.
- New coordinators are active straight away. Coordinators who were "pending" (waiting for the identity check) are switched on.
- Everyone already VERIFIED stays verified.

## Test on live (use a brand new account, not an exempt one)
1. Unverified customer: post a task (goes live), open a tasker and book a service (works, no verify dialog).
2. The tasker still cannot see the street address before the customer pays.
3. Unverified tasker: post a service (live).
4. Unverified tasker: tries to withdraw: asked to verify first (VR2). Unverified customer: a payment over 10,000 asks to verify (VR3).
5. New coordinator signs up: no verify step, can sign in and start.

## Caveats
- "Pending" coordinators: I treated every one as waiting for the identity check (the code comments say so). If some were pending for another reason, such as awaiting approval, set them back by hand. The notice tells you the count.
- I could not see the sources of the room and listing "gate" triggers (services_listing_gate, task_applications_gate, messages_room_gate and similar). My search of your function sources found no verification check in them, but test steps 1 and 3 will confirm it.
- The old re-verify campaign function (`idv_reverify_run`) is not changed. If it is scheduled, tell me and I will switch it off in VR5.
- Wording on coordinator-signup.html is mine, not approved by you. All other prompts and banners are left for VR5.
- `idv_lockdown_guard` is untouched, as planned.

# Stage F handoff: coordinator bug fixes (2026-11-07)

Owner rules: SQL editor + dashboard function deploys only (no console/curl/terminal steps), one stage per session, stage zip holds only changed files.

## 1. Notification opened the customer account (FIXED in code)
Cause: coordinator pages reuse the shared panel js/notifications-panel.js. Its target() routes by type and by localStorage st_role; a coordinator has no tasker role, so "offer/application" types went to customer-applications.html, a page a coordinator account is locked out of (Stage A separation).
Fix (js/notifications-panel.js only): on any page with body.co-page the panel uses coordinatorTarget(): a data.url is trusted only if it is a coordinator-*.html page; otherwise booking_id -> coordinator-booking.html?id=, thread/message types -> coordinator-chat.html, payout/wallet/payment/withdrawal -> coordinator-wallet.html, offer/application/quote/booking/task/dispute -> coordinator-bookings.html, verification/consent/tasker -> coordinator-taskers.html, anything else -> coordinator-dashboard.html. Customer and tasker pages are unchanged.
Tested: syntax check and the routing function on 7 sample notifications in Node. NOT tested in a browser on real Supabase.
Known gaps: (a) the e-mail link and phone push open data.url exactly as the database wrote it (sw.js notificationclick, send-notification-email). If the SQL that writes the withdrawn-offer notification for a coordinator sets a customer URL, that link is still wrong; the function body (withdraw_offer and the local-tasker offer notify code) was not in the zip. (b) The exact type/data of the coordinator's withdrawn-offer row is unknown; the owner can send `select type, data from notifications where user_id = '<coordinator id>' order by created_at desc limit 5;` from the SQL editor.

## 2. "Payouts are not switched on yet" / live_not_approved (NO CODE CHANGE: owner switch)
Cause: supabase/functions/local-payout-account/index.ts (rule O1) refuses a Paystack sk_live_ key unless the function secret PAYOUT_LIVE_APPROVED equals exactly `yes`. The deployed PAYSTACK_SECRET_KEY is a live key and the approval secret is not set. The function only verifies the bank account and creates a transfer recipient; it never moves money.
Owner step (dashboard): Supabase > Edge Functions > Secrets > add PAYOUT_LIVE_APPROVED = yes (lower case), save; no redeploy should be needed for a new secret, but if the error persists redeploy local-payout-account once. Alternative that keeps the gate: set PAYSTACK_SECRET_KEY to the sk_test_ key (account names will then not resolve for real banks).
This approval is the owner's decision; the gate was left in place.

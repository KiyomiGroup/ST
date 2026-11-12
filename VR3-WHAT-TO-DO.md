# VR3: a customer verifies once their payments pass 10,000 naira

Rule: someone who is not verified can pay while (paid so far + this payment) is 10,000 or less. Over that, the payment is refused
before anything is created, and the chat shows "Verification needed" with a Verify now button. After verifying they come back to the same chat.
Verified customers and your exempt test accounts are never asked. The limit is a row in a settings table, not in the code.

## Deploy, in this order
1. Supabase > Edge Functions > `payment-init`: paste `supabase/deploy/payment-init/index.ts` and deploy.
2. Edge Function `gift-card-pay`: deploy `supabase/functions/gift-card-pay/index.ts`.
3. SQL editor: run `sql/verification-rework/vr3a-payment-gate.sql` (whole file, safe to run twice). It stops with "NOT DONE" and changes nothing if `_prepare_intent` is not the version you sent.
4. `vr3a-tests.sql` is for a scratch database only (it uses made-up rows). Do NOT run it on live. I ran it on a scratch PostgreSQL with your real `_prepare_intent`: 23 of 23 pass.
5. Upload `js/payments.js`, `js/messages-money.js`, `js/verify.js`.
Undo: run `vr3a-rollback.sql` (restores `_prepare_intent` exactly as you sent it).

## Test on the test customer (not an exempt account)
1. A request of 9,000: pays normally.
2. A request of 12,000: "Verification needed" appears when you tap Pay, before anything is charged. Verify now opens the verify page with the pay line, then returns to the chat.
3. After verifying, the same 12,000 goes through.
4. Two requests of 6,000 from a fresh unverified customer: the second shows the dialog once the first is paid.
To change the limit later: `update verification_rules set int_value = 20000 where key = 'customer_payment_limit';`

## Caveats
- Counted: paid `payment_intents` (requests and bookings), not paid from the wallet. Not counted: pending/failed/expired attempts, subscriptions, coordinator tier payments.
- Refunds are NOT subtracted: a refunded payment still counts. I do not have the `job_refunds` columns. Send them if you want refunds to free up room.
- Gift card PURCHASES are not gated yet (the order table was not in what you sent, and a buyer may not be logged in). Tell me if you want it.
- I did not see `payment_prepare` (the wrapper payment-init calls). The gate sits one level below it, in `_prepare_intent`, so it should apply; the edited `payment-init` also recognises the refusal by its message. Confirm with test 2 above.
- A payment already started before you deploy can still finish; the check happens only when a payment is started.
- The dialog wording is mine, not owner-approved. The 10,000 text on the dialog says nothing about fees.
- Two payments started at the same moment could both pass; the next one is then caught.

# Payments hardening (step 6a): runbook

Read this before deploying. It changes who is allowed to move money, and the order of deployment matters.

## What was wrong, and how it is fixed now

| # | Problem | Fix |
|---|---------|-----|
| 1 | The browser decided a payment succeeded (Paystack callback wrote "paid" straight to the database). | Only the server confirms. `payment-verify` asks Paystack whether the charge is real and the amount matches, then calls the database function `payment_finalize`. `paystack-webhook` does the same if the customer closes the tab. The browser can no longer write payment status, escrow or booking money fields (triggers + revoked privileges). |
| 2 | The browser chose the amount charged. | `payment-init` calls `payment_prepare`, which takes the amount from the database (the payment request, or the booking / task price). The page just opens Paystack with the reference and amount the server returns. |
| 3 | A user could edit their own wallet balance and insert fake wallet transactions. | `wallets`, `wallet_transactions`, `escrow_payments`, `payments`: old policies removed, write privileges revoked, read-only for the owner. Money moves only inside `SECURITY DEFINER` functions. |
| 4 | The tasker could read the customer's completion code. | Codes live in `booking_secrets` (no policies, nobody can read it directly). The customer gets theirs via `get_completion_code()`. The tasker's code check runs inside `job_submit_code()` (3 attempts, counted on the server). A trigger keeps `bookings.completion_code` empty even if another function writes to it. Old codes were moved and scrubbed from old messages and notifications. |
| 5 | The 12% fee was calculated in the browser. | `platform_fee_rate()` in SQL. Fee and tasker share are stored per payment; release pays out the stored amounts. |

Also: clients can no longer insert a booking that is already "paid", change a booking's amount/owner, jump a booking to
"completed", or cancel a paid booking. Payment requests can only be created by the tasker of that conversation, and only
move along sensible steps (customer approves/declines extra costs, tasker cancels; "accepted" and "paid" are server-only).

## What I tested, and what I could not

Tested (throwaway local Postgres that imitates Supabase, plus fake Paystack): 80 SQL checks and 30 Edge Function checks
(`tests/payments/`), including the attacks (editing wallets, forging bookings, reading codes as the tasker, calling the
server-only functions from the browser, short payments, forged webhooks, other people's references) and the normal flows
(first payment, extra payments, wallet payment, release, wrong codes, dispute).

NOT tested, because I cannot reach them: your real database and its existing policies, the real Paystack, the Supabase
Edge runtime itself, and two things I could not see: the `process-withdrawal` and gift-card Edge Functions.
**Test everything below in Paystack TEST mode first, ideally on a copy (staging) of the project.**

## Before you start
1. Take a backup (Supabase > Database > Backups, or `pg_dump` of `wallets`, `wallet_transactions`, `escrow_payments`,
   `bookings`, `payment_requests`, `messages`, `notifications`).
2. Use Paystack **test** keys for the first run: `pk_test_...` in `js/payments.js` (`PAYSTACK_PUBLIC_KEY`, currently the
   LIVE key) and the matching `sk_test_...` as the function secret. Switch both to live together.
3. Pick a quiet time: between steps 3 and 4 below, payments from the old front end fail for a minute or two.

## Deploy, in this order
1. **Secret.** Supabase dashboard > Edge Functions > Secrets > add `PAYSTACK_SECRET_KEY` (your `sk_test_...` for the
   first run). Use the same name your gift-card functions use if one already exists. (`SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.) CLI alternative: `supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx`
2. **Functions** (harmless until the SQL runs). Each function is ONE self-contained file, so you can paste it straight
   into the dashboard: Edge Functions > **Deploy a new function** > **Via Editor** > name it EXACTLY as below, delete the
   template code, paste the whole file, **Deploy**.
   - `payment-init`      <- `supabase/functions/payment-init/index.ts`
   - `payment-verify`    <- `supabase/functions/payment-verify/index.ts`
   - `paystack-webhook`  <- `supabase/functions/paystack-webhook/index.ts`, then open it and turn **OFF**
     "Enforce JWT verification" (Paystack does not send a login token; the function checks Paystack's signature instead).
     Leave JWT verification ON for the other two.
   CLI alternative: `supabase functions deploy payment-init payment-verify` and
   `supabase functions deploy paystack-webhook --no-verify-jwt`.
   (The files are generated from `supabase/functions-src/` by `node supabase/functions-src/build.mjs`. Edit the sources
   there, not the generated files.)
3. **SQL**, in the SQL Editor, in this order: `messaging-step5.sql`, `messaging-step6.sql`, `messaging-step6a.sql`.
   Read the NOTICE lines at the bottom. If it stops with "expects uuid ids" or "Missing tables", nothing was changed:
   send me the message.
4. **Front end**, straight after step 3: `js/payments.js`, `js/messages.js`, `js/messages-money.js`,
   `js/messages-thread.js` (+ the earlier step files if not yet deployed).
5. **Paystack dashboard** > Settings > API Keys & Webhooks > Webhook URL:
   `https://<your-project-ref>.supabase.co/functions/v1/paystack-webhook`
   Paystack allows ONE webhook URL per mode. If you already use one (for gift cards?), tell me: the handler ignores
   references that are not ours, so the two can be merged.

## Test checklist (test mode)
Attacks. Run in the browser console while logged in. Every one of these must FAIL:
- `await supabase.from('wallets').update({balance: 999999}).eq('user_id', '<your id>')`
- `await supabase.from('wallet_transactions').insert({user_id:'<your id>', type:'topup', amount:5000})`
- `await supabase.from('bookings').update({payment_status:'paid'}).eq('id','<your booking>')`
- `await supabase.from('booking_secrets').select('*')`
- `await supabase.rpc('payment_finalize', {p_reference:'x', p_paid_kobo:1, p_currency:'NGN'})`
- As a TASKER: `await supabase.from('bookings').select('completion_code')` returns empty codes; `rpc('get_completion_code')`
  on a customer's booking fails.

Flows. Each must work:
- Wallet top-up of 100 (Paystack test card), balance goes up only after payment.
- Pay a booking from the wallet; pay a payment request with Paystack; the card turns "Paid".
- Close the Paystack tab right after paying: the webhook should still finish it within a minute.
- Extra cost: request > approve > pay. Booking total goes up, the completion code stays the same.
- Customer sees the code in the chat. Tasker types a wrong code (counted), then the right one (released, wallet credited).
- Dispute blocks release. Withdrawal still works. Gift-card payment still works.
- Wallet page and dashboards still load.

## If something breaks in production
Do not restore the old wallet policies (they let users edit their own balance). Instead find the cause. If bookings or
requests must be unblocked urgently, you can turn off just the two guard triggers for a short time:
`alter table public.bookings disable trigger bookings_guard;`
`alter table public.payment_requests disable trigger payment_requests_guard;`
(re-enable with `enable trigger` when done). Payments still go through the server functions either way.

## Things to check that I could not see
- `process-withdrawal` must change wallets with the service role and re-check the balance on the server. If it uses the
  user's own login to update `wallets`, it will now be refused: test a withdrawal right after deploying.
- Gift-card functions: they should keep working (service role bypasses the new rules, and any code they write to
  `bookings.completion_code` is moved to `booking_secrets` by a trigger). Test one end to end.
- Other policies on `bookings` and `payment_requests`: the triggers protect the money fields whatever the policies say,
  but check customers and taskers can still do the normal updates (status, notes, schedule).
- Admin screens outside this repo that read the money tables as a normal user will lose access (all old policies on the
  money tables were replaced). Give admins a service-side route or an explicit read policy.
- `bookings.tasker_id` may hold a user id or a `taskers` row id: `_booking_tasker_user()` handles both. If a payment says
  "tasker account could not be found", that helper is the place to look.

## Known limits (by design, for now)
- Transport / extra costs can only be paid after the main amount (they are top-ups on the same escrow). The mockup's
  "disbursed instantly to wallet" transport payment is not supported.
- A booking with no price and no task budget cannot be paid from the dashboard: the tasker sends a payment request in
  Messages (that is the trusted price).
- Disputes freeze the money; there is no admin tool yet to refund or release a disputed booking (needs a support-only SQL
  function).
- The legacy `payments` table is no longer written; `payment_intents` is the record now.
- Sharing the code with the tasker is still a human step: a customer who tells a dishonest tasker the code early loses the protection.

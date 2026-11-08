# Stage 1c handoff: real donations with Paystack and emailed receipts (2026-11-08)
Replaces the earlier stage1b zip. No terminal needed: everything is pasted into the Supabase dashboard.

## What it does
- Visitor picks an amount (or types one, minimum N500), enters an email, presses "Give by card or bank with Paystack".
- `donate-checkout` (new function) saves a "pending" row in a new `donations` table and returns a Paystack checkout link. The amount is re-checked on the server and sent to Paystack in kobo.
- Paystack calls the SAME webhook the gift cards already use. The patched `paystack-webhook` sees `metadata.kind = donation`, verifies the payment with Paystack, checks amount and currency match the saved row (a mismatch is marked `flagged`, no receipt), marks it `paid`, then emails:
  1. the donor a receipt, 2. contact@streettasker.com a "Donation received" notice (this is also your proof that mailbox is being watched).
- Receipts and notices are sent once only (claim columns + Resend idempotency keys), even if Paystack repeats the webhook. If an email fails the webhook returns an error so Paystack retries.
- Email sender: the website's existing Resend setup and domain (gifts@contact.streettasker.com, same as gift card receipts and coordinator mail). Replies go to contact@streettasker.com.
- Bank transfer (Moniepoint 7088448530, Street Taskers Ventures) stays under "Prefer a direct bank transfer?". Add those by hand to the same table (example at the bottom of the SQL file) so there is one record of every donation.

## Owner steps (dashboard only), in this order
1. SQL editor: paste and run `sql/donations.sql`.
2. Edge Functions > New function named exactly `donate-checkout` > paste `supabase/deploy/donate-checkout/index.ts` > Deploy. Leave "Verify JWT" ON (the page sends the public anon key, as the gift card page does).
3. Edge Functions > `paystack-webhook` > replace ALL its code with `supabase/functions/paystack-webhook/index.ts` from this zip > Deploy. Gift card behaviour is unchanged; one new branch was added.
4. Secrets: nothing new is required (PAYSTACK_SECRET_KEY, RESEND_API_KEY, SUPABASE_* already exist). Optional: DONATION_EMAIL_FROM, DONATION_REPLY_TO, DONATION_NOTIFY_TO (defaults: StreetTasker <gifts@contact.streettasker.com>, contact@, contact@).
5. Upload the site files: `local-taskers.html`, `css/local-tasker-public.css`, `js/local-tasker-donate.js`.
6. Test: give N500 yourself with your own email. Expect: redirect to Paystack, back to the page with a thank-you note, a receipt in your inbox, a "Donation received" mail in contact@, and a `paid` row in `donations`. Also run one gift card test to confirm gift cards still work.

## Check before promoting
- Which bank account does Paystack settle into? Card donations land there, not in Moniepoint. Confirm it is the account you want, and reconcile monthly: donations table vs Paystack settlements vs Moniepoint credits.
- contact@streettasker.com must really receive mail. The admin notice goes there.
- The receipt says "Donation to Local Taskers" and "run by Street Taskers Ventures". It makes no tax-deductible or charity claim. Ask an accountant before adding one.
- Keep donations separate from customer escrow and Local Taskers' payouts.

## Tested here
Webhook logic with a mocked database and Paystack (receipt and admin mail sent once, replay sends nothing, wrong amount is flagged, bad signature rejected), checkout validation and the kobo conversion, form validation and layout at 390 px with the site stylesheet. NOT tested: real Paystack, real Resend delivery, live Supabase.

## Not found
I could not find a separate "tasker confirmation" mailer in the code. Sign-up confirmation links come from Supabase Auth (its sender is set in the dashboard, not in the repo). The only transactional sender in the repo is the Resend one above, so donations use that.

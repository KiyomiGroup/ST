-- StreetTasker: find the test payments (READ ONLY, changes nothing).
-- Run in the Supabase SQL editor and send me the result. It lists the 60 newest money records across every payment table, newest first,
-- so you can point at the ones that were your tests. Nothing is deleted or changed by this file.
select * from (
  select 'payment_intents' as src, id::text, reference, purpose as detail, status, amount as naira, user_id::text as who, booking_id::text as booking, coalesce(paid_at, created_at) as at from public.payment_intents
  union all select 'escrow_payments', id::text, reference, null, status, amount, customer_id::text, booking_id::text, coalesce(paid_at, created_at) from public.escrow_payments
  union all select 'payments', id::text, coalesce(reference, payment_reference), null, status, amount, customer_id::text, booking_id::text, coalesce(paid_at, created_at) from public.payments
  union all select 'payment_receipts', id::text, receipt_number, kind, null, amount, customer_id::text, booking_id::text, coalesce(paid_at, created_at) from public.payment_receipts
  union all select 'subscription_receipts', id::text, reference, plan, null, amount_kobo / 100.0, user_id::text, null, coalesce(paid_at, created_at) from public.subscription_receipts
  union all select 'gift_card_orders', id::text, reference, category, status, amount, buyer_user_id::text, null, coalesce(paid_at, created_at) from public.gift_card_orders
  union all select 'donations', id::text, reference, source, status, amount, null, null, coalesce(paid_at, created_at) from public.donations
  union all select 'job_refunds', id::text, paystack_ref, null, 'recorded', amount, null, null, created_at from public.job_refunds
) t order by at desc nulls last limit 60;

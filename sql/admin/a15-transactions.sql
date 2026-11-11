-- StreetTasker Admin Control Centre, stage A15: Transactions and donations (READ ONLY).
-- Run the WHOLE file once in the Supabase SQL editor. Safe to run twice. Rollback: a15-rollback.sql. The last line says DONE or NOT DONE.
--
-- Adds (SECURITY DEFINER, execute for authenticated only, each checks its permission itself):
--   admin_transactions_overview()                        counts and paid totals by kind, plus what needs a look
--   admin_transaction_list(kind, status, offset)         one table of every money record, 25 per page
--   admin_donation_list(filter, offset)                  donations, donor email masked (permission donations.view)
-- and one internal helper _a15_rows() that nobody can call from the browser.
--
-- Writes nothing. No table, policy or existing function is changed. No money moves, Paystack is never called.
-- Kinds: job (payment_intents purpose booking), job_room (purpose request: deposits, extras, remaining), subscription, coordinator_plan (tier_upgrade),
--        urgent_fee (reference starts URG-: paid in the browser and NOT verified by the server), gift_card (gift_card_orders), refund (job_refunds), other (topup).
-- payment_requests are NOT listed: their card payments already appear as payment_intents (purpose request); listing both would count the money twice.
-- Amounts: payment_intents, gift_card_orders and job_refunds hold NAIRA; this file converts to kobo.
-- "Reconciliation" here is only the site's own agreement with itself (a paid job has an escrow row, a paid subscription has a receipt, a paid time is set,
-- the amount matched). It is NOT a check against Paystack. matched / needs_review / unverified (urgent fee, refunds recorded by hand) / open (not paid yet).
-- Checked against the real columns (introspect, 2026-11-11): payer = payment_intents.user_id, gift card buyer = gift_card_orders.buyer_user_id,
-- job_refunds has NO booking_id (a refund is tied to a booking through payment_request_id -> payment_intents.request_id -> booking_id).
-- created_at is still read through to_jsonb(row), so a missing column gives an empty cell, not an error. test_archive_* tables are never read.
-- Never returned: emails, phones (donor email is masked), client_ip, recipient codes.

do $pre$
begin
  if to_regprocedure('public.admin_has(text)') is null then
    raise exception 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
  end if;
  if to_regclass('public.payment_intents') is null then
    raise exception 'NOT DONE: payment_intents does not exist. Nothing was changed.';
  end if;
end
$pre$;

create or replace function public._a15_rows()
returns table (src text, row_id text, reference text, kind text, amount_kobo bigint, status text, occurred_at timestamptz, booking_ref text,
               party_id uuid, recon text, review_reason text, refund_note text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query
  select 'payment_intents'::text, i.id::text, i.reference::text,
         (case when i.reference like 'URG-%' then 'urgent_fee' when i.purpose = 'subscription' then 'subscription' when i.purpose = 'tier_upgrade' then 'coordinator_plan'
               when i.purpose = 'topup' then 'other' when i.purpose = 'request' then 'job_room' else 'job' end)::text,
         round(coalesce(i.amount, 0) * 100)::bigint, i.status::text,
         coalesce(i.paid_at, nullif(to_jsonb(i)->>'created_at', '')::timestamptz),
         left(coalesce(i.booking_id::text, ''), 8),
         i.user_id,
         (case when x.reason is not null then 'needs_review' when i.reference like 'URG-%' then 'unverified' when i.status = 'paid' then 'matched' else 'open' end)::text,
         x.reason::text,
         (case when i.booking_id is not null and exists (select 1 from public.job_refunds f join public.payment_intents p2 on p2.request_id = f.payment_request_id where p2.booking_id = i.booking_id) then 'Refund recorded for this booking' end)::text
    from public.payment_intents i
    left join lateral (select (case
        when i.status = 'amount_mismatch' then 'The amount paid did not match the amount asked.'
        when i.status = 'pending' and coalesce(nullif(to_jsonb(i)->>'created_at', '')::timestamptz, now()) < now() - interval '1 day' then 'Still pending after a day.'
        when i.status = 'paid' and i.paid_at is null then 'Marked paid but no paid time is stored.'
        when i.status = 'paid' and i.purpose = 'booking' and i.reference not like 'URG-%' and i.booking_id is not null
             and not exists (select 1 from public.escrow_payments e where e.booking_id = i.booking_id) then 'Paid job payment with no escrow row.'
        when i.status = 'paid' and i.purpose = 'subscription' and to_regclass('public.subscription_receipts') is not null
             and not exists (select 1 from public.subscription_receipts r where r.reference = i.reference) then 'Paid subscription with no receipt.'
      end) as reason) x on true;

  return query
  select 'gift_card_orders'::text, o.id::text, o.reference::text, 'gift_card'::text, (o.amount::bigint * 100), o.status::text,
         coalesce(o.paid_at, nullif(to_jsonb(o)->>'created_at', '')::timestamptz), ''::text,
         o.buyer_user_id,
         (case when x.reason is not null then 'needs_review' when o.status = 'paid' then 'matched' else 'open' end)::text, x.reason::text, null::text
    from public.gift_card_orders o
    left join lateral (select (case
        when o.status = 'paid' and o.paid_at is null then 'Marked paid but no paid time is stored.'
        when o.status = 'pending' and coalesce(nullif(to_jsonb(o)->>'created_at', '')::timestamptz, now()) < now() - interval '1 day' then 'Still pending after a day.'
      end) as reason) x on true;

  return query
  select 'job_refunds'::text, f.id::text, f.paystack_ref::text, 'refund'::text, round(coalesce(f.amount, 0) * 100)::bigint, 'recorded'::text, f.created_at,
         left(coalesce((select p2.booking_id::text from public.payment_intents p2 where p2.request_id = f.payment_request_id and p2.booking_id is not null limit 1), ''), 8), null::uuid, 'unverified'::text, null::text,
         'Recorded by support after a dispute. The refund itself is made in Paystack by a person.'::text
    from public.job_refunds f;
end $$;

create or replace function public.admin_transactions_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if not public.admin_has('transactions.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  select jsonb_build_object('ok', true, 'generated_at', now(),
    'total', (select count(*) from public._a15_rows()),
    'kinds', (select coalesce(jsonb_object_agg(k.kind, jsonb_build_object('rows', k.n, 'paid_rows', k.p, 'paid_kobo', k.s)), '{}'::jsonb)
                from (select kind, count(*) n, count(*) filter (where status in ('paid', 'recorded')) p,
                             coalesce(sum(amount_kobo) filter (where status in ('paid', 'recorded')), 0) s from public._a15_rows() group by kind) k),
    'needs_review', (select count(*) from public._a15_rows() where recon = 'needs_review'),
    'unverified_urgent', (select count(*) from public._a15_rows() where kind = 'urgent_fee' and status = 'paid'),
    'pending_rows', (select count(*) from public._a15_rows() where status in ('pending', 'processing')),
    'failed_rows', (select count(*) from public._a15_rows() where status in ('failed', 'expired', 'amount_mismatch', 'cancelled', 'declined'))
  ) into v;
  return v;
end $$;

create or replace function public.admin_transaction_list(p_kind text default 'all', p_status text default 'all', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_k text := lower(coalesce(p_kind, 'all')); v_s text := lower(coalesce(p_status, 'all')); v_off integer := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  if not public.admin_has('transactions.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_k not in ('all', 'job', 'job_room', 'subscription', 'coordinator_plan', 'gift_card', 'urgent_fee', 'refund', 'other') then v_k := 'all'; end if;
  if v_s not in ('all', 'paid', 'pending', 'failed', 'review') then v_s := 'all'; end if;
  with f as (
    select r.* from public._a15_rows() r
     where (v_k = 'all' or r.kind = v_k)
       and (v_s = 'all'
         or (v_s = 'paid' and r.status in ('paid', 'recorded'))
         or (v_s = 'pending' and r.status in ('pending', 'processing'))
         or (v_s = 'failed' and r.status in ('failed', 'expired', 'amount_mismatch', 'cancelled', 'declined'))
         or (v_s = 'review' and r.recon = 'needs_review'))
  )
  select jsonb_build_object('ok', true, 'kind', v_k, 'status', v_s, 'offset', v_off, 'page_size', 25, 'total', (select count(*) from f),
    'total_kobo', (select coalesce(sum(amount_kobo), 0) from f),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('source', t.src, 'id', t.row_id, 'reference', t.reference, 'kind', t.kind, 'amount_kobo', t.amount_kobo,
        'status', t.status, 'occurred_at', t.occurred_at, 'booking_ref', nullif(t.booking_ref, ''), 'recon', t.recon, 'review_reason', t.review_reason,
        'refund_note', t.refund_note, 'party_id', t.party_id,
        'party_name', (select nullif(btrim(u.name), '') from public.users u where u.id = t.party_id)) order by t.occurred_at desc nulls last, t.row_id), '[]'::jsonb)
      from (select * from f order by occurred_at desc nulls last, row_id offset v_off limit 25) t)) into v_out;
  return v_out;
end $$;

create or replace function public._a15_mask_email(p text) returns text language sql immutable as $$
  select case when p is null or position('@' in p) < 2 then null else left(p, 1) || '***' || substr(p, position('@' in p)) end $$;

create or replace function public.admin_donation_list(p_filter text default 'all', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_f text := lower(coalesce(p_filter, 'all')); v_off integer := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  if not public.admin_has('donations.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if to_regclass('public.donations') is null then return jsonb_build_object('ok', false, 'error', 'The donations table is not installed.'); end if;
  if v_f not in ('all', 'paid', 'pending', 'flagged', 'stuck', 'no_receipt') then v_f := 'all'; end if;
  with f as (
    select d.* from public.donations d
     where v_f = 'all' or (v_f = 'paid' and d.status = 'paid') or (v_f = 'pending' and d.status = 'pending') or (v_f = 'flagged' and d.status = 'flagged')
        or (v_f = 'stuck' and d.status = 'pending' and d.created_at < now() - interval '1 day')
        or (v_f = 'no_receipt' and d.status = 'paid' and d.receipt_sent_at is null)
  )
  select jsonb_build_object('ok', true, 'filter', v_f, 'offset', v_off, 'page_size', 25, 'total', (select count(*) from f),
    'counts', jsonb_build_object('paid', (select count(*) from public.donations where status = 'paid'),
       'paid_kobo', (select coalesce(sum(coalesce(paid_kobo, amount::bigint * 100)), 0) from public.donations where status = 'paid'),
       'flagged', (select count(*) from public.donations where status = 'flagged'),
       'stuck', (select count(*) from public.donations where status = 'pending' and created_at < now() - interval '1 day'),
       'no_receipt', (select count(*) from public.donations where status = 'paid' and receipt_sent_at is null)),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'reference', t.reference, 'source', t.source, 'status', t.status,
        'amount_kobo', coalesce(t.paid_kobo, t.amount::bigint * 100), 'donor_name', nullif(btrim(t.donor_name), ''), 'donor_email', public._a15_mask_email(t.donor_email),
        'channel', t.channel, 'flag_reason', left(t.flag_reason, 300), 'paid_at', t.paid_at, 'created_at', t.created_at,
        'receipt_sent', t.receipt_sent_at is not null,
        'stuck', t.status = 'pending' and t.created_at < now() - interval '1 day',
        'no_receipt', t.status = 'paid' and t.receipt_sent_at is null) order by t.created_at desc, t.id), '[]'::jsonb)
      from (select * from f order by created_at desc, id offset v_off limit 25) t)) into v_out;
  return v_out;
end $$;

revoke all on function public._a15_rows(), public._a15_mask_email(text), public.admin_transactions_overview(), public.admin_transaction_list(text, text, integer), public.admin_donation_list(text, integer) from public, anon, authenticated;
grant execute on function public.admin_transactions_overview(), public.admin_transaction_list(text, text, integer), public.admin_donation_list(text, integer) to authenticated;

select case
  when to_regprocedure('public.admin_transactions_overview()') is not null
   and to_regprocedure('public.admin_transaction_list(text,text,integer)') is not null
   and to_regprocedure('public.admin_donation_list(text,integer)') is not null
   and (select count(*) >= 0 from public._a15_rows())
  then 'DONE: A15 installed.'
  else 'NOT DONE: see the messages above.'
end as a15_result;

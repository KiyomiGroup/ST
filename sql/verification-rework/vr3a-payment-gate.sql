-- StreetTasker verification rework, stage VR3a: a customer must verify once their payments go over the limit (10,000 naira).
-- Run once, whole file, in the Supabase SQL editor (live project). Safe to run again. Undo with vr3a-rollback.sql.
-- Needs the VR0/VR2 idv_* functions already live (idv_is_exempt). Written against your payment sources of 2026-11-11.
-- What it changes:
--   NEW   table verification_rules (key, int_value)            customer_payment_limit = 10000. Change the number here, nothing is hard-coded.
--   NEW   idv_customer_payment_limit(), idv_customer_payment_message(), idv_customer_payment_gate(user, amount)
--         the rule: NULL = allowed, or 'verification_required'
--   NEW   customer_payment_gate_mine(amount)                    for the pay buttons: limit, my total so far, whether THIS amount needs verification
--   EDIT  _prepare_intent   ONE block added, after the amount is worked out and BEFORE any payment row is created. Nothing else changed.
--         Every customer payment goes through it: payment-init (Paystack), pay_with_wallet, gift_request_pay_start.
-- The rule: someone who is not VERIFIED may pay while (paid so far + this payment) is 10,000 or less. Over that: refused, nothing is created.
-- Counted as "paid so far": this person's payment_intents with status 'paid' and purpose 'request' or 'booking', not paid from the wallet.
-- NOT counted: pending, expired, failed or amount_mismatch attempts; wallet payments; subscriptions and coordinator tier payments (those are not customer payments).
-- Refunds: NOT subtracted (a refunded payment still counts). Gift card PURCHASES are not in this stage (see VR3a-WHAT-TO-DO.md).
-- Not changed: payment_finalize, the Paystack webhook, fees, escrow, withdrawals, the exempt accounts (they are never asked).

do $$ begin
  if to_regprocedure('public.idv_is_exempt(uuid)') is null then
    raise exception 'NOT DONE: idv_is_exempt is missing. Nothing was changed.';
  end if;
  if (select position('step13-pay-in-chat' in prosrc) from pg_proc where oid = 'public._prepare_intent(uuid,text,uuid,uuid,numeric)'::regprocedure) = 0
     or (select position('Unknown payment purpose' in prosrc) from pg_proc where oid = 'public._prepare_intent(uuid,text,uuid,uuid,numeric)'::regprocedure) = 0 then
    raise exception 'NOT DONE: _prepare_intent is not the version this file expects. Send me its current source. Nothing was changed.';
  end if;
end $$;

-- 1. The limit lives in a small settings table. Nobody can read or write it from the browser.
create table if not exists public.verification_rules (
  key        text primary key,
  int_value  integer not null,
  updated_at timestamptz not null default now()
);
alter table public.verification_rules enable row level security;
revoke all on public.verification_rules from anon, authenticated;
insert into public.verification_rules (key, int_value) values ('customer_payment_limit', 10000) on conflict (key) do nothing;

create or replace function public.idv_customer_payment_limit()
returns integer language sql stable security definer set search_path = public, pg_temp
as $fn$ select coalesce((select int_value from public.verification_rules where key = 'customer_payment_limit'), 10000) $fn$;

create or replace function public.idv_customer_payment_message()
returns text language sql stable security definer set search_path = public, pg_temp
as $fn$ select 'Payments above ₦' || to_char(public.idv_customer_payment_limit(), 'FM999,999,999') || ' need identity verification.' $fn$;

-- 2. Total this person has paid so far (the server's own records only).
create or replace function public._idv_customer_paid_total(p_user uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp
as $fn$
  select coalesce(sum(amount), 0) from public.payment_intents
   where user_id = p_user and status = 'paid' and purpose in ('request', 'booking') and coalesce(provider_ref, '') <> 'WALLET'
$fn$;

-- 3. The one rule. NULL = allowed, 'verification_required' = must verify first.
create or replace function public.idv_customer_payment_gate(p_user uuid, p_amount numeric)
returns text
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
begin
  if p_user is null then return 'verification_required'; end if;
  if public.idv_is_exempt(p_user) then return null; end if;
  if exists (select 1 from public.identity_verifications where user_id = p_user and status = 'VERIFIED') then return null; end if;
  if public._idv_customer_paid_total(p_user) + coalesce(p_amount, 0) > public.idv_customer_payment_limit() then
    return 'verification_required';
  end if;
  return null;
end $fn$;

-- 4. For the pay buttons (VR3b): "does THIS amount need verification, and what is the limit?"
create or replace function public.customer_payment_gate_mine(p_amount numeric default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Please log in.' using errcode = '28000'; end if;
  return jsonb_build_object(
    'limit', public.idv_customer_payment_limit(),
    'verified', public.idv_is_exempt(v_user) or exists (select 1 from public.identity_verifications where user_id = v_user and status = 'VERIFIED'),
    'needs_verify', public.idv_customer_payment_gate(v_user, coalesce(p_amount, 0)) is not null);
end $fn$;

revoke all on function public._idv_customer_paid_total(uuid) from public, anon, authenticated;
revoke all on function public.idv_customer_payment_gate(uuid, numeric) from public, anon, authenticated;
revoke all on function public.idv_customer_payment_limit() from public, anon, authenticated;
revoke all on function public.idv_customer_payment_message() from public, anon, authenticated;
revoke all on function public.customer_payment_gate_mine(numeric) from public, anon;
grant execute on function public.customer_payment_gate_mine(numeric) to authenticated;
grant execute on function public.idv_customer_payment_gate(uuid, numeric) to service_role;

-- 5. _prepare_intent: the live function, plus the one VR3a block (search for "VR3a").
CREATE OR REPLACE FUNCTION public._prepare_intent(p_user uuid, p_purpose text, p_request uuid, p_booking uuid, p_amount numeric)
 RETURNS payment_intents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_req public.payment_requests; v_thr public.message_threads; v_b public.bookings;
  v_amount numeric; v_kind text; v_tasker uuid; v_fee numeric := 0; v_split numeric := 0;
  v_booking_id uuid; v_intent public.payment_intents; v_budget numeric;
begin
  if p_user is null then raise exception 'Please log in to make a payment.'; end if;

  if p_purpose = 'topup' then
    v_amount := round(coalesce(p_amount, 0));
    if v_amount < 100 then raise exception 'Minimum top-up is ₦100.'; end if;
    if v_amount > 5000000 then raise exception 'Maximum top-up is ₦5,000,000.'; end if;

  elsif p_purpose in ('request', 'booking') then if p_purpose = 'booking' then raise exception '%', 'Payments are made in the chat. Open the job room and tap Pay on the payment request.' using errcode = 'P0001', hint = 'pay_in_chat'; end if; -- step13-pay-in-chat
    if p_purpose = 'request' then
      select * into v_req from public.payment_requests where id = p_request for update;
      if not found then raise exception 'Payment request not found.'; end if;
      select * into v_thr from public.message_threads where id = v_req.thread_id;
      if not found or v_thr.customer_id <> p_user then raise exception 'This payment request is not yours to pay.'; end if;
      v_kind := coalesce(v_req.kind, 'payment');
      if v_req.status = 'paid' then raise exception 'This has already been paid.'; end if;
      if v_req.status in ('declined', 'cancelled') then raise exception 'This request is no longer active.'; end if;
      if v_req.status not in ('pending', 'processing', 'failed') then
        raise exception 'This request cannot be paid right now.';
      end if;
      if v_thr.context_type is distinct from 'booking' or v_thr.context_id is null then
        perform public._link_thread_booking(v_thr.id); select * into v_thr from public.message_threads where id = v_thr.id; if v_thr.context_type is distinct from 'booking' or v_thr.context_id is null then raise exception 'This job has no accepted booking yet, so it cannot be paid here. Accept the tasker first.'; end if; -- step13b-link-on-pay
      end if;
      v_booking_id := v_thr.context_id::text::uuid;
      v_amount := v_req.amount;
    else
      v_booking_id := p_booking;
      v_kind := 'booking';
    end if;

    select * into v_b from public.bookings where id = v_booking_id for update;
    if not found then raise exception 'Booking not found.'; end if;
    if v_b.customer_id <> p_user then raise exception 'This booking is not yours to pay.'; end if;
    -- Stage 12: 'disputed' by a NEW-STYLE open report still lets the customer pay a request that is already open;
    -- 'disputed' from the legacy button (no open report) stays closed, as before
    if v_b.status in ('completed', 'cancelled', 'rejected', 'declined')
       or (v_b.status = 'disputed' and not public.job_booking_frozen(v_b.id))
       or v_b.payment_status = 'released' then
      raise exception 'This booking is closed (%).', coalesce(v_b.status, 'released');
    end if;

    if p_purpose = 'booking' and public.job_booking_frozen(v_b.id) then
      raise exception 'A problem report is open on this job. A new booking payment cannot be started until support has decided it.' using errcode = 'P0001', hint = 'dispute_open';
    end if;
    v_tasker := public._booking_tasker_user(v_b);
    if v_tasker is null then raise exception 'The tasker account for this booking could not be found.'; end if;
    if p_purpose = 'request' and v_tasker <> v_thr.tasker_id then
      raise exception 'This conversation does not match the booking. Please contact support.';
    end if;

    if p_purpose = 'booking' then
      if v_b.payment_status = 'paid' then raise exception 'This booking is already paid.'; end if;
      v_amount := nullif(v_b.amount, 0);
      if v_amount is null and v_b.task_id is not null then
        select nullif((to_jsonb(t) ->> 'budget')::numeric, 0) into v_budget from public.tasks t where t.id = v_b.task_id;
        v_amount := v_budget;
      end if;
      if v_amount is null then
        raise exception 'No price has been set for this booking yet. Ask the tasker to send a payment request in Messages.';
      end if;
    elsif v_kind = 'remaining_payment' and v_b.payment_status is distinct from 'paid' then
      -- transport and additional cost MAY be paid first (owner decision, Stage 7); the remaining payment may not
      raise exception 'Pay the main job amount first, then this can be paid.';
    end if;

    if v_amount < 100 or v_amount > 10000000 then raise exception 'This amount cannot be paid online.'; end if;
    v_fee   := round(v_amount * public.platform_fee_rate_for_kind(v_tasker, v_kind));   -- Stage 7C-fee: 12% on the service charge, 2% on transport and materials
    v_split := v_amount - v_fee;
  else
    raise exception 'Unknown payment purpose.';
  end if;

  -- VR3a: a customer who is not verified may pay up to the limit in total; this payment would pass it.
  -- Runs before any payment row exists and before anything is changed. The browser never sees or sends the total.
  if p_purpose in ('request', 'booking') and public.idv_customer_payment_gate(p_user, v_amount) is not null then
    raise exception '%', public.idv_customer_payment_message() using errcode = 'P0001', hint = 'verification_required';
  end if;

  -- older unfinished attempts for the same thing are retired (they can still be finalised if Paystack confirms them)
  update public.payment_intents set status = 'expired'
   where user_id = p_user and status = 'pending' and purpose = p_purpose
     and request_id is not distinct from p_request and booking_id is not distinct from v_booking_id;

  insert into public.payment_intents
    (reference, user_id, purpose, request_id, booking_id, amount, platform_fee, tasker_amount, tasker_user_id)
  values
    ('ST-' || replace(gen_random_uuid()::text, '-', ''), p_user, p_purpose,
     case when p_purpose = 'request' then p_request end, v_booking_id, v_amount, v_fee, v_split, v_tasker)
  returning * into v_intent;

  -- the payment has started (not confirmed): "processing". A failed attempt can be tried again.
  if p_purpose = 'request' and v_req.status in ('pending', 'failed') then
    update public.payment_requests set status = 'processing' where id = p_request and status in ('pending', 'failed');
  end if;
  return v_intent;
end $function$;

-- VR3a rollback: puts _prepare_intent back to the version you sent on 2026-11-11 and removes the VR3a objects.
-- The verification_rules table is dropped too. Run once, whole file.
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

drop function if exists public.customer_payment_gate_mine(numeric);
drop function if exists public.idv_customer_payment_gate(uuid, numeric);
drop function if exists public._idv_customer_paid_total(uuid);
drop function if exists public.idv_customer_payment_message();
drop function if exists public.idv_customer_payment_limit();
drop table if exists public.verification_rules;

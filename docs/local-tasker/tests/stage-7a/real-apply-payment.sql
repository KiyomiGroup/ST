CREATE OR REPLACE FUNCTION public._apply_payment(p_intent_id uuid, p_provider_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  i public.payment_intents; b public.bookings; v_top boolean := false; v_early boolean := false;
  v_code text; v_res jsonb; v_thread uuid; v_kind text; v_label text; v_preview text;
begin
  select * into i from public.payment_intents where id = p_intent_id for update;
  if i.status = 'paid' then return coalesce(i.result, '{}'::jsonb); end if;

  if i.purpose = 'topup' then
    perform public._ensure_wallet(i.user_id);
    update public.wallets set balance = balance + i.amount, updated_at = now() where user_id = i.user_id;
    insert into public.wallet_transactions (user_id, type, amount, reference, status, note)
    values (i.user_id, 'topup', i.amount, i.reference, 'completed', 'Wallet top-up via Paystack');
    v_res := jsonb_build_object('ok', true, 'purpose', 'topup', 'amount', i.amount);
  else
    select * into b from public.bookings where id = i.booking_id for update;
    -- NULL-safe: a booking with no payment_status yet is NOT paid (step 6a treated NULL as "paid":
    -- `not NULL` is NULL, so the first payment fell into the top-up branch: no code, no price, no "paid")
    v_top := coalesce(b.payment_status = 'paid', false);
    if i.request_id is not null then
      select coalesce(kind, 'payment') into v_kind from public.payment_requests where id = i.request_id;
    end if;
    v_early := (not v_top) and v_kind in ('transport', 'additional_cost', 'materials', 'invoice');

    insert into public.escrow_payments
      (booking_id, payment_id, customer_id, tasker_id, amount, tasker_amount, platform_fee, reference, status, paid_at)
    values (i.booking_id, i.id, i.user_id, i.tasker_user_id, i.amount, i.tasker_amount, i.platform_fee, i.reference, 'held', now());

    perform public._ensure_wallet(i.tasker_user_id);
    update public.wallets set pending_balance = pending_balance + i.tasker_amount, updated_at = now()
     where user_id = i.tasker_user_id;

    insert into public.wallet_transactions (user_id, type, amount, reference, booking_id, status, note)
    values (i.user_id, 'escrow_hold', i.amount, i.reference, i.booking_id, 'completed',
            case when v_early then 'Add-on payment held in escrow, before the main payment'
                 when v_top then 'Extra payment held in escrow for booking'
                 else 'Payment held in escrow for booking' end);

    if v_early then
      null;   -- booking untouched: still unpaid, no code, no agreed price
    elsif not v_top then
      v_code := lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 900000 + 100000)::text, 6, '0');
      update public.bookings
         set payment_status = 'paid', amount = i.amount, code_attempts = 0,
             status = case when status is null or status in ('pending', 'confirmed') then 'confirmed' else status end
       where id = i.booking_id;
      insert into public.booking_secrets (booking_id, completion_code, updated_at)
      values (i.booking_id, v_code, now())
      on conflict (booking_id) do update set completion_code = excluded.completion_code, updated_at = now();
    else
      update public.bookings set amount = coalesce(amount, 0) + i.amount where id = i.booking_id;
    end if;

    if i.request_id is not null then
      update public.payment_requests
         set status = 'paid', paid_at = now(), settlement = 'held'
       where id = i.request_id
      returning thread_id, coalesce(kind, 'payment') into v_thread, v_kind;

      -- the agreed price is set by the first MAIN payment only, and by the server
      if not v_top and not v_early and v_thread is not null then
        update public.message_threads set agreed_price = i.amount where id = v_thread and coalesce(agreed_price, 0) = 0;
      end if;

      -- the conversation shows the payment even if the customer closed the tab (webhook path).
      -- The confirmation NEVER contains the completion code.
      if v_thread is not null then
        v_label := case v_kind when 'transport' then 'Transport' when 'additional_cost' then 'Additional cost' when 'materials' then 'Materials' when 'invoice' then 'Invoice'
                               when 'remaining_payment' then 'Remaining payment' else 'Payment' end;
        v_preview := case when v_top or v_early then v_label || ' paid: ₦' || to_char(i.amount, 'FM999,999,999')
                          else 'Payment confirmed: ₦' || to_char(i.amount, 'FM999,999,999') end;
        begin
          insert into public.messages (thread_id, sender_id, receiver_id, body, type, flagged)
          values (v_thread, i.user_id, i.tasker_user_id,
                  case when v_top or v_early then v_preview
                       else 'PAYMENT_CONFIRMED::' || i.amount::bigint || ':' || i.tasker_amount::bigint || ':' || i.platform_fee::bigint end,
                  case when v_top or v_early then 'system' else 'payment_confirmed' end, false);
          update public.message_threads
             set last_message = v_preview, last_message_at = now(), tasker_unread = coalesce(tasker_unread, 0) + 1
           where id = v_thread;
        exception when others then
          null;   -- the chat message is a convenience: never let it block the money
        end;
      end if;
    end if;

    perform public._notify(i.tasker_user_id, 'payment_received',
      case when v_early then '💰 Payment Received' else '💰 Payment Received — Job Secured' end,
      'The customer has paid ₦' || to_char(i.amount, 'FM999,999,999') || '. The money is held safely and is released when you complete the job.',
      jsonb_build_object('booking_id', i.booking_id, 'payment_intent_id', i.id));

    v_res := jsonb_build_object('ok', true, 'purpose', i.purpose, 'amount', i.amount,
      'platform_fee', i.platform_fee, 'tasker_amount', i.tasker_amount,
      'booking_id', i.booking_id, 'request_id', i.request_id,
      'top_up', v_top or v_early, 'first_payment', (not v_top) and (not v_early), 'early_addon', v_early);
  end if;

  update public.payment_intents
     set status = 'paid', paid_at = now(), provider_ref = p_provider_ref, result = v_res
   where id = i.id;
  return v_res;
end $function$;

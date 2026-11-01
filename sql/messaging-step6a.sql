-- ============================================================
-- StreetTasker Job Room, step 6a: PAYMENTS HARDENING
-- File:    sql/messaging-step6a.sql
-- Run in:  Supabase dashboard > SQL Editor.  READ IT FIRST.
-- Order:   after sql/messaging-step5.sql and sql/messaging-step6.sql.
-- Safe to run more than once (idempotent).
--
-- DO NOT run this alone. Deploy together, in this order:
--   1. This SQL           2. The 3 Edge Functions (supabase/functions/)
--   3. The new front-end files (js/payments.js and friends)
-- See PAYMENTS-HARDENING.md for the full runbook and the test checklist.
--
-- What it fixes
--   #1 Payment success was decided by the browser.
--        -> Only the server confirms a payment (Edge Function checks Paystack, then
--           calls payment_finalize). The browser can no longer mark anything paid.
--   #2 The charged amount was chosen by the browser.
--        -> payment_prepare decides the amount from the database (payment request,
--           booking or task budget). The browser only gets a reference + amount to show.
--   #3 Wallet balances could be edited by their owner.
--        -> wallets, wallet_transactions, escrow_payments, payments: read-only for users
--           (RLS policies replaced, write privileges revoked). Money moves only inside
--           the SECURITY DEFINER functions below.
--   #4 The tasker could read the customer's completion code.
--        -> Codes live in booking_secrets (no policies: nobody can read it directly).
--           The customer gets theirs through get_completion_code(); the tasker's code
--           check happens inside job_submit_code(). bookings.completion_code is kept
--           empty by a trigger, even for service-role writers (gift-card functions).
--   #5 The 12% fee was computed in the browser.
--        -> platform_fee_rate() below; fee and tasker share are stored per payment.
--
-- Also: triggers stop clients changing booking money fields / forging paid bookings,
-- and restrict payment_requests to the sensible transitions.
-- ============================================================

-- 0. Pre-flight --------------------------------------------------
do $$
declare missing text; bad text;
begin
  select string_agg(t, ', ') into missing
  from unnest(array['bookings','message_threads','payment_requests','notifications','taskers']) as t
  where to_regclass('public.' || t) is null;
  if missing is not null then
    raise exception 'Missing tables: %. Nothing was changed.', missing;
  end if;

  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='payment_requests' and column_name='kind') then
    raise exception 'Run sql/messaging-step6.sql first (payment_requests.kind is missing).';
  end if;

  select string_agg(format('%s.%s is %s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod)), '; ')
    into bad
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid and c.relnamespace = 'public'::regnamespace
  where not a.attisdropped and a.atttypid <> 'uuid'::regtype
    and ((c.relname = 'bookings' and a.attname in ('id', 'customer_id'))
      or (c.relname = 'message_threads' and a.attname in ('id', 'customer_id', 'tasker_id'))
      or (c.relname = 'payment_requests' and a.attname = 'id'));
  if bad is not null then
    raise exception 'Step 6a expects uuid ids, found: %. Tell the developer before continuing.', bad;
  end if;
end $$;

-- 1. Columns / tables used by the money flow ----------------------
alter table public.bookings add column if not exists payment_status text;
alter table public.bookings add column if not exists amount         numeric;
alter table public.bookings add column if not exists completion_code text;
alter table public.bookings add column if not exists code_attempts  int not null default 0;
alter table public.bookings add column if not exists completed_at   timestamptz;
alter table public.bookings add column if not exists dispute_reason text;

create table if not exists public.wallets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  balance         numeric not null default 0,
  pending_balance numeric not null default 0,
  updated_at      timestamptz not null default now()
);
alter table public.wallets add column if not exists user_id         uuid;
alter table public.wallets add column if not exists balance         numeric not null default 0;
alter table public.wallets add column if not exists pending_balance numeric not null default 0;
alter table public.wallets add column if not exists updated_at      timestamptz not null default now();
do $$ begin
  create unique index if not exists wallets_user_id_key on public.wallets (user_id);
exception when others then
  raise notice 'Could not add a unique index on wallets.user_id (duplicates?): %. Fix duplicate wallet rows.', sqlerrm;
end $$;

create table if not exists public.wallet_transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  type       text not null,
  amount     numeric not null,
  reference  text,
  booking_id uuid,
  status     text not null default 'completed',
  note       text,
  created_at timestamptz not null default now()
);
alter table public.wallet_transactions add column if not exists user_id    uuid;
alter table public.wallet_transactions add column if not exists type       text;
alter table public.wallet_transactions add column if not exists amount     numeric;
alter table public.wallet_transactions add column if not exists booking_id uuid;
alter table public.wallet_transactions add column if not exists reference  text;
alter table public.wallet_transactions add column if not exists status      text default 'completed';
alter table public.wallet_transactions add column if not exists note       text;
alter table public.wallet_transactions add column if not exists created_at timestamptz default now();

create table if not exists public.escrow_payments (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid,
  payment_id    uuid,
  customer_id   uuid,
  tasker_id     uuid,
  amount        numeric not null,
  tasker_amount numeric,
  platform_fee  numeric,
  reference     text,
  status        text not null default 'held',
  paid_at       timestamptz,
  released_at   timestamptz,
  created_at    timestamptz not null default now()
);
-- Your existing tables may have been created with fewer columns: make sure every column we write exists
alter table public.escrow_payments add column if not exists booking_id    uuid;
alter table public.escrow_payments add column if not exists payment_id    uuid;
alter table public.escrow_payments add column if not exists customer_id   uuid;
alter table public.escrow_payments add column if not exists tasker_id     uuid;
alter table public.escrow_payments add column if not exists amount        numeric;
alter table public.escrow_payments add column if not exists tasker_amount numeric;
alter table public.escrow_payments add column if not exists platform_fee  numeric;
alter table public.escrow_payments add column if not exists reference     text;
alter table public.escrow_payments add column if not exists status        text default 'held';
alter table public.escrow_payments add column if not exists paid_at       timestamptz;
alter table public.escrow_payments add column if not exists released_at   timestamptz;
alter table public.escrow_payments add column if not exists created_at    timestamptz default now();

-- The server's record of every payment attempt (the browser never writes here)
create table if not exists public.payment_intents (
  id            uuid primary key default gen_random_uuid(),
  reference     text not null unique,
  user_id       uuid not null,
  purpose       text not null check (purpose in ('request', 'booking', 'topup')),
  request_id    uuid,
  booking_id    uuid,
  amount        numeric not null check (amount > 0),
  platform_fee  numeric not null default 0,
  tasker_amount numeric not null default 0,
  tasker_user_id uuid,
  status        text not null default 'pending'
                check (status in ('pending', 'paid', 'expired', 'failed', 'amount_mismatch')),
  provider_ref  text,
  result        jsonb,
  created_at    timestamptz not null default now(),
  paid_at       timestamptz
);
create index if not exists payment_intents_user_idx on public.payment_intents (user_id, created_at desc);
create index if not exists payment_intents_request_idx on public.payment_intents (request_id) where request_id is not null;

-- Completion codes: no policies at all, so only the functions below can touch it
create table if not exists public.booking_secrets (
  booking_id      uuid primary key references public.bookings(id) on delete cascade,
  completion_code text not null,
  updated_at      timestamptz not null default now()
);
alter table public.booking_secrets enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='booking_secrets' loop
    execute format('drop policy %I on public.booking_secrets', p.policyname);
  end loop;
end $$;
revoke all on public.booking_secrets from anon, authenticated;

-- 2. Helpers --------------------------------------------------------
create or replace function public.platform_fee_rate() returns numeric
language sql immutable as $$ select 0.12::numeric $$;

-- Which USER owns this booking's tasker side? (tasker_id may be a user id or a taskers row id)
create or replace function public._booking_tasker_user(b public.bookings) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select case when t.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 then t.user_id::text::uuid end
       from public.taskers t where t.id::text = b.tasker_id::text limit 1),
    case when b.tasker_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then b.tasker_id::text::uuid end
  )
$$;

create or replace function public._ensure_wallet(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('wallet:' || p_user::text));
  insert into public.wallets (user_id, balance, pending_balance)
  select p_user, 0, 0
  where not exists (select 1 from public.wallets w where w.user_id = p_user);
end $$;

create or replace function public._notify(p_user uuid, p_type text, p_title text, p_msg text, p_data jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (user_id, type, title, message, data, is_read)
  values (p_user, p_type, p_title, p_msg, p_data, false);
exception when others then
  null;   -- a notification problem must never block money movement
end $$;

-- Keep codes out of bookings.completion_code, whoever writes it (incl. other Edge Functions)
create or replace function public.bookings_hide_code() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if NEW.completion_code is not null and NEW.completion_code <> '' then
    insert into public.booking_secrets (booking_id, completion_code, updated_at)
    values (NEW.id, NEW.completion_code, now())
    on conflict (booking_id) do update set completion_code = excluded.completion_code, updated_at = now();
    NEW.completion_code := null;
  end if;
  return NEW;
end $$;
drop trigger if exists bookings_hide_code on public.bookings;
create trigger bookings_hide_code before insert or update on public.bookings
  for each row execute function public.bookings_hide_code();

-- Move existing codes out of bookings, and scrub them from old messages / notifications
insert into public.booking_secrets (booking_id, completion_code)
select id, completion_code from public.bookings where completion_code is not null and completion_code <> ''
on conflict (booking_id) do nothing;
update public.bookings set completion_code = null where completion_code is not null;

do $$ begin
  update public.messages
     set body = regexp_replace(body, '^PAYMENT_CONFIRMED:[0-9]*:', 'PAYMENT_CONFIRMED::')
   where type::text = 'payment_confirmed' and body ~ '^PAYMENT_CONFIRMED:[0-9]+:';
exception when others then raise notice 'Could not scrub old payment_confirmed messages: %', sqlerrm;
end $$;
do $$ begin
  update public.notifications set data = (to_jsonb(data) - 'completion_code')
   where to_jsonb(data) ? 'completion_code';
exception when others then raise notice 'Could not scrub notification data: %', sqlerrm;
end $$;

-- 3. Row level security on money tables: read-only for users ----------
do $$
declare t text; p record;
begin
  foreach t in array array['wallets', 'wallet_transactions', 'escrow_payments', 'payments', 'payment_intents'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Explicit read grants (RLS decides which rows): do not rely on default privileges
do $$
declare t text;
begin
  foreach t in array array['wallets', 'wallet_transactions', 'escrow_payments', 'payments', 'payment_intents'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('grant select on public.%I to authenticated', t);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant select on public.%I to service_role', t);
    end if;
  end loop;
end $$;

create policy wallets_select_own on public.wallets
  for select to authenticated using (user_id = auth.uid());
create policy wallet_tx_select_own on public.wallet_transactions
  for select to authenticated using (user_id = auth.uid());
create policy escrow_select_parties on public.escrow_payments
  for select to authenticated using (auth.uid() in (customer_id, tasker_id));
create policy intents_select_own on public.payment_intents
  for select to authenticated using (user_id = auth.uid());
do $$ begin
  if to_regclass('public.payments') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='customer_id') then
    execute 'create policy payments_select_own on public.payments for select to authenticated using (customer_id = auth.uid())';
  end if;
end $$;

-- 4. Triggers: what the browser may NOT change on bookings -------------
create or replace function public.bookings_guard() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return NEW;                    -- server code (service role / our functions / SQL editor)
  end if;

  if TG_OP = 'INSERT' then
    NEW.amount          := null;   -- the price is decided server-side, never by the booking customer
    NEW.completion_code := null;
    NEW.code_attempts   := 0;
    NEW.completed_at    := null;
    NEW.dispute_reason  := null;
    if NEW.payment_status is not null and NEW.payment_status not in ('unpaid', 'pending') then
      NEW.payment_status := 'unpaid';
    end if;
    NEW.status := 'pending';
    return NEW;
  end if;

  if NEW.payment_status  is distinct from OLD.payment_status
  or NEW.amount          is distinct from OLD.amount
  or NEW.completion_code is distinct from OLD.completion_code
  or NEW.code_attempts   is distinct from OLD.code_attempts
  or NEW.completed_at    is distinct from OLD.completed_at
  or NEW.dispute_reason  is distinct from OLD.dispute_reason
  or NEW.customer_id     is distinct from OLD.customer_id
  or NEW.tasker_id       is distinct from OLD.tasker_id then
    raise exception 'Payment and booking-owner fields can only be changed by the payment system.';
  end if;

  if NEW.status is distinct from OLD.status then
    if NEW.status in ('completed', 'awaiting_confirmation', 'disputed') then
      raise exception 'Use the Mark done / Confirm / Dispute buttons to move a booking to "%".', NEW.status;
    end if;
    if OLD.status in ('completed', 'awaiting_confirmation', 'disputed') then
      raise exception 'This booking is "%" and can no longer be changed here.', OLD.status;
    end if;
    if NEW.status = 'cancelled' and OLD.payment_status in ('paid', 'released') then
      raise exception 'A paid booking cannot be cancelled here. Raise a dispute so the money is handled safely.';
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists bookings_guard on public.bookings;
create trigger bookings_guard before insert or update on public.bookings
  for each row execute function public.bookings_guard();

-- payment_requests: the tasker creates, the customer approves/declines add-ons,
-- the tasker cancels. "accepted" and "paid" are set only by the payment system.
create or replace function public.payment_requests_guard() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare t public.message_threads; k text;
begin
  if current_user not in ('authenticated', 'anon') then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    select * into t from public.message_threads where id = NEW.thread_id;
    if not found or t.tasker_id is distinct from auth.uid() then
      raise exception 'Only the tasker in this conversation can request a payment.';
    end if;
    if NEW.amount is null or NEW.amount < 100 or NEW.amount > 10000000 then
      raise exception 'Amount must be between 100 and 10,000,000.';
    end if;
    NEW.tasker_id   := t.tasker_id;
    NEW.customer_id := t.customer_id;
    NEW.status      := 'pending';
    return NEW;
  end if;

  if NEW.thread_id   is distinct from OLD.thread_id
  or NEW.amount      is distinct from OLD.amount
  or NEW.kind        is distinct from OLD.kind
  or NEW.reason      is distinct from OLD.reason
  or NEW.breakdown   is distinct from OLD.breakdown
  or NEW.tasker_id   is distinct from OLD.tasker_id
  or NEW.customer_id is distinct from OLD.customer_id then
    raise exception 'A payment request cannot be edited. Cancel it and send a new one.';
  end if;

  if NEW.status is distinct from OLD.status then
    k := coalesce(OLD.kind, 'payment');
    if auth.uid() = OLD.customer_id and NEW.status in ('approved', 'declined')
       and OLD.status = 'pending' and k in ('transport', 'additional_cost') then
      return NEW;
    elsif auth.uid() = OLD.tasker_id and NEW.status = 'cancelled' and OLD.status in ('pending', 'approved') then
      return NEW;
    end if;
    raise exception 'That change to a payment request is not allowed.';
  end if;
  return NEW;
end $$;
drop trigger if exists payment_requests_guard on public.payment_requests;
create trigger payment_requests_guard before insert or update on public.payment_requests
  for each row execute function public.payment_requests_guard();

-- 5. The payment engine -------------------------------------------------
-- 5a. Decide what a payment is for and how much it costs (never from the browser)
create or replace function public._prepare_intent(
  p_user uuid, p_purpose text, p_request uuid, p_booking uuid, p_amount numeric
) returns public.payment_intents
language plpgsql security definer set search_path = public, pg_temp as $$
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

  elsif p_purpose in ('request', 'booking') then
    if p_purpose = 'request' then
      select * into v_req from public.payment_requests where id = p_request;
      if not found then raise exception 'Payment request not found.'; end if;
      select * into v_thr from public.message_threads where id = v_req.thread_id;
      if not found or v_thr.customer_id <> p_user then raise exception 'This payment request is not yours to pay.'; end if;
      v_kind := coalesce(v_req.kind, 'payment');
      if v_req.status = 'paid' then raise exception 'This has already been paid.'; end if;
      if v_req.status in ('declined', 'cancelled') then raise exception 'This request is no longer active.'; end if;
      if v_kind in ('transport', 'additional_cost') then
        if v_req.status <> 'approved' then raise exception 'Approve this request before paying.'; end if;
      elsif v_req.status not in ('pending', 'accepted') then
        raise exception 'This request cannot be paid right now.';
      end if;
      if v_thr.context_type is distinct from 'booking' or v_thr.context_id is null then
        raise exception 'This conversation is not linked to a booking yet, so it cannot be paid here.';
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
    if v_b.status in ('completed', 'cancelled', 'disputed', 'rejected', 'declined')
       or v_b.payment_status = 'released' then
      raise exception 'This booking is closed (%).', coalesce(v_b.status, 'released');
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
    elsif v_kind in ('transport', 'additional_cost', 'remaining_payment') and v_b.payment_status is distinct from 'paid' then
      raise exception 'Pay the main job amount first, then this can be paid.';
    end if;

    if v_amount < 100 or v_amount > 10000000 then raise exception 'This amount cannot be paid online.'; end if;
    v_fee   := round(v_amount * public.platform_fee_rate());
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

  if p_purpose = 'request' and v_req.status = 'pending' and v_kind not in ('transport', 'additional_cost') then
    update public.payment_requests set status = 'accepted' where id = p_request and status = 'pending';
  end if;
  return v_intent;
end $$;

-- 5b. Apply a confirmed payment (internal; only called after Paystack or the wallet confirmed it)
create or replace function public._apply_payment(p_intent_id uuid, p_provider_ref text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  i public.payment_intents; b public.bookings; v_top boolean := false; v_code text; v_res jsonb;
  v_thread uuid; v_kind text; v_label text; v_preview text;
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
    v_top := (b.payment_status = 'paid');

    insert into public.escrow_payments
      (booking_id, payment_id, customer_id, tasker_id, amount, tasker_amount, platform_fee, reference, status, paid_at)
    values (i.booking_id, i.id, i.user_id, i.tasker_user_id, i.amount, i.tasker_amount, i.platform_fee, i.reference, 'held', now());

    perform public._ensure_wallet(i.tasker_user_id);
    update public.wallets set pending_balance = pending_balance + i.tasker_amount, updated_at = now()
     where user_id = i.tasker_user_id;

    insert into public.wallet_transactions (user_id, type, amount, reference, booking_id, status, note)
    values (i.user_id, 'escrow_hold', i.amount, i.reference, i.booking_id, 'completed',
            case when v_top then 'Extra payment held in escrow for booking' else 'Payment held in escrow for booking' end);

    if not v_top then
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
      update public.payment_requests set status = 'paid' where id = i.request_id
      returning thread_id, coalesce(kind, 'payment') into v_thread, v_kind;

      -- the agreed price is set by the first payment only, and by the server
      if not v_top and v_thread is not null then
        update public.message_threads set agreed_price = i.amount where id = v_thread;
      end if;

      -- the conversation shows the payment even if the customer closed the tab (webhook path).
      -- The confirmation NEVER contains the completion code.
      if v_thread is not null then
        v_label := case v_kind when 'transport' then 'Transport' when 'additional_cost' then 'Additional cost'
                               when 'remaining_payment' then 'Remaining payment' else 'Payment' end;
        v_preview := case when v_top then v_label || ' paid: ₦' || to_char(i.amount, 'FM999,999,999')
                          else 'Payment confirmed: ₦' || to_char(i.amount, 'FM999,999,999') end;
        begin
          insert into public.messages (thread_id, sender_id, receiver_id, body, type, flagged)
          values (v_thread, i.user_id, i.tasker_user_id,
                  case when v_top then v_preview
                       else 'PAYMENT_CONFIRMED::' || i.amount::bigint || ':' || i.tasker_amount::bigint || ':' || i.platform_fee::bigint end,
                  case when v_top then 'system' else 'payment_confirmed' end, false);
          update public.message_threads
             set last_message = v_preview, last_message_at = now(), tasker_unread = coalesce(tasker_unread, 0) + 1
           where id = v_thread;
        exception when others then
          null;   -- the chat message is a convenience: never let it block the money
        end;
      end if;
    end if;

    perform public._notify(i.tasker_user_id, 'payment_received',
      '💰 Payment Received — Job Secured',
      'The customer has paid ₦' || to_char(i.amount, 'FM999,999,999') || '. The money is held safely and is released when you complete the job.',
      jsonb_build_object('booking_id', i.booking_id, 'payment_intent_id', i.id));

    v_res := jsonb_build_object('ok', true, 'purpose', i.purpose, 'amount', i.amount,
      'platform_fee', i.platform_fee, 'tasker_amount', i.tasker_amount,
      'booking_id', i.booking_id, 'request_id', i.request_id,
      'top_up', v_top, 'first_payment', not v_top);
  end if;

  update public.payment_intents
     set status = 'paid', paid_at = now(), provider_ref = p_provider_ref, result = v_res
   where id = i.id;
  return v_res;
end $$;

-- 5c. Edge Function entry points (service role only) -------------------------
create or replace function public.payment_prepare(
  p_user uuid, p_purpose text, p_request uuid default null, p_booking uuid default null, p_amount numeric default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.payment_intents;
begin
  i := public._prepare_intent(p_user, p_purpose, p_request, p_booking, p_amount);
  return jsonb_build_object('reference', i.reference, 'amount', i.amount, 'amount_kobo', (i.amount * 100)::bigint,
                            'purpose', i.purpose, 'booking_id', i.booking_id, 'request_id', i.request_id);
end $$;

create or replace function public.payment_finalize(p_reference text, p_paid_kobo bigint, p_currency text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.payment_intents; v_res jsonb;
begin
  select * into i from public.payment_intents where reference = p_reference for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Unknown payment reference.'); end if;
  if i.status = 'paid' then return coalesce(i.result, '{}'::jsonb) || jsonb_build_object('already', true); end if;
  if i.status in ('failed', 'amount_mismatch') then
    return jsonb_build_object('ok', false, 'error', 'This payment needs a manual review. Please contact support.');
  end if;
  if upper(coalesce(p_currency, '')) <> 'NGN' or p_paid_kobo is distinct from (i.amount * 100)::bigint then
    update public.payment_intents set status = 'amount_mismatch',
           result = jsonb_build_object('expected_kobo', (i.amount * 100)::bigint, 'paid_kobo', p_paid_kobo, 'currency', p_currency)
     where id = i.id;
    return jsonb_build_object('ok', false, 'error', 'The amount received does not match this payment. Please contact support.');
  end if;
  v_res := public._apply_payment(i.id, p_reference);
  return v_res;
end $$;

create or replace function public.payment_mark_failed(p_reference text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.payment_intents set status = 'failed' where reference = p_reference and status = 'pending';
$$;

-- 5d. Wallet payment (called by the logged-in customer) ------------------------
create or replace function public.pay_with_wallet(p_request uuid default null, p_booking uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); i public.payment_intents; w public.wallets; v_res jsonb;
begin
  if v_user is null then raise exception 'Please log in to make a payment.'; end if;
  if (p_request is null) = (p_booking is null) then raise exception 'Choose either a payment request or a booking.'; end if;

  perform public._ensure_wallet(v_user);
  select * into w from public.wallets where user_id = v_user for update;

  i := public._prepare_intent(v_user, case when p_request is not null then 'request' else 'booking' end, p_request, p_booking, null);
  if coalesce(w.balance, 0) < i.amount then
    raise exception 'Insufficient wallet balance (₦%). Top up or pay via Paystack.', to_char(coalesce(w.balance, 0), 'FM999,999,999');
  end if;

  update public.wallets set balance = balance - i.amount, updated_at = now() where user_id = v_user;
  update public.payment_intents set reference = 'WLT-' || replace(gen_random_uuid()::text, '-', '') where id = i.id;
  v_res := public._apply_payment(i.id, 'WALLET');
  return v_res;
end $$;

create or replace function public.ensure_my_wallet() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare w public.wallets;
begin
  if auth.uid() is null then raise exception 'Please log in.'; end if;
  perform public._ensure_wallet(auth.uid());
  select * into w from public.wallets where user_id = auth.uid();
  return jsonb_build_object('balance', w.balance, 'pending_balance', w.pending_balance);
end $$;

-- 6. Job lifecycle: done, confirm, code, release, dispute ----------------------
create or replace function public.get_completion_code(p_booking uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_code text;
begin
  select * into b from public.bookings where id = p_booking;
  if not found or b.customer_id is distinct from auth.uid() then
    raise exception 'Only the customer of this booking can see its code.';
  end if;
  if b.payment_status is distinct from 'paid' then raise exception 'Payment not made yet.'; end if;
  select completion_code into v_code from public.booking_secrets where booking_id = p_booking;
  return v_code;
end $$;

create or replace function public.job_mark_done(p_booking uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or public._booking_tasker_user(b) is distinct from auth.uid() then
    raise exception 'Only the tasker on this booking can mark it done.';
  end if;
  if b.status in ('completed', 'cancelled', 'disputed') then raise exception 'This booking is already %.', b.status; end if;
  update public.bookings set status = 'awaiting_confirmation' where id = p_booking;
  perform public._notify(b.customer_id, 'job_done', '✅ Job Marked Complete',
    'The provider says the job is done. If you agree, confirm completion to release payment.',
    jsonb_build_object('booking_id', p_booking));
  return jsonb_build_object('success', true);
end $$;

create or replace function public.job_confirm_complete(p_booking uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_code text;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.customer_id is distinct from auth.uid() then
    raise exception 'Only the customer of this booking can confirm it.';
  end if;
  if b.payment_status is distinct from 'paid' then raise exception 'Payment not made yet.'; end if;
  if b.status = 'completed' then raise exception 'This booking is already completed.'; end if;
  if b.status = 'disputed' then raise exception 'This booking is under dispute.'; end if;
  update public.bookings set status = 'awaiting_confirmation' where id = p_booking;
  select completion_code into v_code from public.booking_secrets where booking_id = p_booking;
  perform public._notify(public._booking_tasker_user(b), 'job_completion', '🎉 Job Confirmed — Enter Your Code!',
    'The customer confirmed the job is done. Enter your 6-digit completion code to receive your payment.',
    jsonb_build_object('booking_id', p_booking));
  return jsonb_build_object('code', v_code);
end $$;

create or replace function public._release_escrow(p_booking uuid) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_tasker uuid; v_sum numeric;
begin
  select * into b from public.bookings where id = p_booking for update;
  v_tasker := public._booking_tasker_user(b);

  select coalesce(sum(coalesce(tasker_amount, amount - coalesce(platform_fee, round(amount * public.platform_fee_rate())))), 0)
    into v_sum from public.escrow_payments where booking_id = p_booking and status = 'held';
  if v_sum = 0 then   -- paid some other way (e.g. gift cards): pay out the booking amount less the fee
    v_sum := coalesce(b.amount, 0) - round(coalesce(b.amount, 0) * public.platform_fee_rate());
  end if;

  perform public._ensure_wallet(v_tasker);
  update public.wallets
     set balance = balance + v_sum, pending_balance = greatest(0, pending_balance - v_sum), updated_at = now()
   where user_id = v_tasker;
  insert into public.wallet_transactions (user_id, type, amount, booking_id, status, note)
  values (v_tasker, 'escrow_release', v_sum, p_booking, 'completed',
          '₦' || to_char(v_sum, 'FM999,999,999') || ' released after job completion (12% fee deducted)');
  update public.escrow_payments set status = 'released', released_at = now()
   where booking_id = p_booking and status = 'held';
  update public.bookings set status = 'completed', payment_status = 'released', completed_at = now() where id = p_booking;
  perform public._notify(b.customer_id, 'job_completed', '✅ Job Completed!',
    'Great news! The job is complete. Please leave a review.', jsonb_build_object('booking_id', p_booking));
  return v_sum;
end $$;

-- Wrong codes must be COUNTED, so this returns a result instead of raising (a raise would undo the count)
create or replace function public.job_submit_code(p_booking uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_code text; v_attempts int; v_paid numeric;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or public._booking_tasker_user(b) is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'Only the tasker on this booking can enter the code.');
  end if;
  if b.payment_status is null or b.payment_status in ('unpaid', 'failed', '') then
    return jsonb_build_object('ok', false, 'error', 'Payment not made for this booking yet.');
  end if;
  if b.payment_status = 'released' then return jsonb_build_object('ok', false, 'error', 'Payment has already been released for this booking.'); end if;
  if b.status = 'completed' then return jsonb_build_object('ok', false, 'error', 'This booking is already completed.'); end if;
  if b.status = 'disputed' then return jsonb_build_object('ok', false, 'error', 'This booking is under dispute.'); end if;

  v_attempts := coalesce(b.code_attempts, 0);
  if v_attempts >= 3 then
    return jsonb_build_object('ok', false, 'error', 'Too many incorrect attempts. Contact support.', 'remaining', 0);
  end if;

  select completion_code into v_code from public.booking_secrets where booking_id = p_booking;
  if v_code is null or btrim(coalesce(p_code, '')) <> v_code then
    v_attempts := v_attempts + 1;
    update public.bookings set code_attempts = v_attempts where id = p_booking;
    return jsonb_build_object('ok', false, 'remaining', greatest(0, 3 - v_attempts),
      'error', 'Incorrect code. ' || case when 3 - v_attempts > 0
        then (3 - v_attempts) || ' attempt' || case when 3 - v_attempts = 1 then '' else 's' end || ' remaining.'
        else 'No attempts left. Contact support.' end);
  end if;

  v_paid := public._release_escrow(p_booking);
  delete from public.booking_secrets where booking_id = p_booking;
  return jsonb_build_object('ok', true, 'released', v_paid);
end $$;

create or replace function public.job_raise_dispute(p_booking uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; v_other uuid; v_tasker uuid;
begin
  select * into b from public.bookings where id = p_booking for update;
  v_tasker := public._booking_tasker_user(b);
  if not found or auth.uid() is null or auth.uid() not in (b.customer_id, v_tasker) then
    raise exception 'Only the customer or tasker on this booking can raise a dispute.';
  end if;
  if b.status = 'completed' then raise exception 'This booking is already completed.'; end if;
  if b.status = 'disputed' then raise exception 'This booking is already under dispute.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Please describe the problem.'; end if;
  update public.bookings set status = 'disputed', dispute_reason = left(btrim(p_reason), 1000) where id = p_booking;
  v_other := case when auth.uid() = b.customer_id then v_tasker else b.customer_id end;
  perform public._notify(v_other, 'dispute_raised', '⚠️ A dispute was raised',
    'A dispute was raised on a booking. Payment stays protected while it is reviewed.',
    jsonb_build_object('booking_id', p_booking));
  return jsonb_build_object('success', true);
end $$;

-- 7. Who may call what ----------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    '_booking_tasker_user(public.bookings)', '_ensure_wallet(uuid)', '_notify(uuid,text,text,text,jsonb)',
    '_prepare_intent(uuid,text,uuid,uuid,numeric)', '_apply_payment(uuid,text)', '_release_escrow(uuid)',
    'payment_prepare(uuid,text,uuid,uuid,numeric)', 'payment_finalize(text,bigint,text)', 'payment_mark_failed(text)',
    'pay_with_wallet(uuid,uuid)', 'ensure_my_wallet()', 'get_completion_code(uuid)', 'job_mark_done(uuid)',
    'job_confirm_complete(uuid)', 'job_submit_code(uuid,text)', 'job_raise_dispute(uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;

  -- logged-in users
  foreach f in array array['pay_with_wallet(uuid,uuid)', 'ensure_my_wallet()', 'get_completion_code(uuid)',
    'job_mark_done(uuid)', 'job_confirm_complete(uuid)', 'job_submit_code(uuid,text)', 'job_raise_dispute(uuid,text)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;

  -- Edge Functions only
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    foreach f in array array['payment_prepare(uuid,text,uuid,uuid,numeric)', 'payment_finalize(text,bigint,text)', 'payment_mark_failed(text)'] loop
      execute format('grant execute on function public.%s to service_role', f);
    end loop;
  end if;
end $$;

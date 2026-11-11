-- ============================================================================
-- StreetTasker Admin Control Centre, stage A15b-3: settlements, cash position, capital guard, coordinator plan income.
-- Run the WHOLE file once in the Supabase SQL editor AFTER a15b-accountant.sql (v2) and a15b-fix-encoding.sql. Safe to run twice.
-- Rollback: a15b3-rollback.sql. The last row says DONE or NOT DONE.
--
-- What A15b-1 and A15b-2 already gave: the append-only ledger, typed expenses and fees, capital in and out, reversals, profit.
-- What this adds (records and reads only; nothing here moves money, calls Paystack, or touches a wallet, escrow row, payout or payment):
--   1. Settlement matching: admin_accountant_settlements(limit). Every settlement the accountant typed (label settlement_received) is
--      compared with an ESTIMATE of what Paystack should have paid: payments confirmed in the window minus the collection fees typed in
--      the same window. Window = from the start (Nigeria time) of the previous settlement's date up to the start of this settlement's date.
--      The first settlement's window starts at the beginning. "matched" = within 50 naira; otherwise "difference". The page also shows the
--      estimate for payments since the last settlement ("not yet received"). Estimate counts these labels as Paystack money:
--      customer_payment_job, wallet_topup, gift_card_sold, donation_received, other_paystack_payment.
--   2. Cash position: table accountant_cash_snapshots (append only; the balance the accountant READ from the bank or Paystack, with its date),
--      admin_accountant_cash_record(), admin_accountant_cash(): latest balance of bank_client, bank_operating, paystack_balance; what the
--      site says is owed to taskers (wallet balance + pending) and to Local Taskers (payouts queued or processing); capital outstanding;
--      "safe to take back" = cash held minus those amounts. It does NOT include gift card balances, so it can be too high. Labelled so.
--   3. Capital guard: a trigger refuses a capital_repaid line larger than the capital outstanding, and refuses reversing a capital_in
--      that was already partly repaid. (The 2026-11-11 owner decision removed the second-admin approval; this keeps the amount rule.)
--   4. Coordinator plan income: payment_intents with purpose tier_upgrade now also write a ledger line labelled coordinator_plan_income
--      (platform income), and admin_accountant_profit counts it. The cash-in line under other_paystack_payment stays.
-- Money is integer KOBO. Never read: names, phones, emails. NOT RUN ANYWHERE: this build environment has no Postgres.
-- NOTE: re-running a15b-accountant.sql replaces _acct_sync_ledger and admin_accountant_profit; run this file again after it.
-- ============================================================================

do $pre$
begin
  if to_regclass('public.accountant_ledger') is null or to_regprocedure('public.admin_accountant_profit(timestamptz,timestamptz)') is null then
    raise exception 'NOT DONE: run a15b-accountant.sql first. Nothing was changed.';
  end if;
end
$pre$;

-- ---------- 1. label ------------------------------------------------------------------------------
insert into public.accountant_labels (key, title, group_name, direction, manual, sort_order) values
  ('coordinator_plan_income', 'Coordinator plan payment received (platform income)', 'Platform income', 'memo', false, 28)
on conflict (key) do update set title = excluded.title, group_name = excluded.group_name, direction = excluded.direction, manual = excluded.manual, sort_order = excluded.sort_order;

-- ---------- 2. cash snapshots (append only) -------------------------------------------------------
create table if not exists public.accountant_cash_snapshots (
  id           bigserial primary key,
  account      text not null check (account in ('bank_client', 'bank_operating', 'paystack_balance')),
  balance_kobo bigint not null check (balance_kobo >= 0),
  as_of        date not null,
  note         text,
  recorded_by  uuid,
  recorded_at  timestamptz not null default now()
);
comment on table public.accountant_cash_snapshots is 'A balance the accountant READ from the bank or the Paystack dashboard on a given date. Typed, never computed. Append only.';
create index if not exists accountant_cash_snapshots_idx on public.accountant_cash_snapshots (account, as_of desc, id desc);
create or replace function public._acct_cash_guard() returns trigger language plpgsql as $$
begin raise exception 'Cash snapshots are append only. Record a new snapshot instead.' using errcode = 'P0001'; end $$;
drop trigger if exists accountant_cash_no_change on public.accountant_cash_snapshots;
create trigger accountant_cash_no_change before update or delete on public.accountant_cash_snapshots for each row execute function public._acct_cash_guard();
drop trigger if exists accountant_cash_no_truncate on public.accountant_cash_snapshots;
create trigger accountant_cash_no_truncate before truncate on public.accountant_cash_snapshots for each statement execute function public._acct_cash_guard();
alter table public.accountant_cash_snapshots enable row level security;
revoke all on public.accountant_cash_snapshots from anon, authenticated;
revoke all on sequence public.accountant_cash_snapshots_id_seq from anon, authenticated;

-- ---------- 3. capital guard ----------------------------------------------------------------------
create or replace function public._acct_capital_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_in bigint; v_out bigint; v_orig public.accountant_ledger;
begin
  if new.label = 'capital_repaid' or (new.label = 'reversal' and new.reverses is not null) then
    perform pg_advisory_xact_lock(hashtext('accountant_capital'));
    select coalesce(sum(l.amount_kobo) filter (where l.label = 'capital_in'), 0), coalesce(sum(l.amount_kobo) filter (where l.label = 'capital_repaid'), 0)
      into v_in, v_out
      from public.accountant_ledger l
     where l.label in ('capital_in', 'capital_repaid') and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id);
    if new.label = 'capital_repaid' and new.amount_kobo > v_in - v_out then
      raise exception 'The repayment is more than the capital still outstanding (%).', public._acct_naira(greatest(v_in - v_out, 0)) using errcode = 'P0001';
    end if;
    if new.label = 'reversal' then
      select * into v_orig from public.accountant_ledger where id = new.reverses;
      if v_orig.label = 'capital_in' and v_in - v_orig.amount_kobo < v_out then
        raise exception 'This capital entry has already been partly repaid. Reverse the repayment first.' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists accountant_capital_guard on public.accountant_ledger;
create trigger accountant_capital_guard before insert on public.accountant_ledger for each row execute function public._acct_capital_guard();

-- ---------- 4. sync wrapper: adds coordinator plan income to the ledger -----------------------------
create or replace function public._acct_sync_extras() returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer := 0; v_notes jsonb := '[]'::jsonb;
begin
  begin
    insert into public.accountant_ledger (entry_at, label, amount_kobo, reference, source_table, source_id, note)
    select i.paid_at, 'coordinator_plan_income', public._acct_kobo(i.amount), i.reference, 'payment_intents', i.id::text, 'Coordinator plan payment (purpose tier_upgrade).'
      from public.payment_intents i where i.status = 'paid' and i.paid_at is not null and i.purpose = 'tier_upgrade'
    on conflict do nothing;
    get diagnostics n = row_count;
  exception when others then v_notes := v_notes || to_jsonb('coordinator plan income: ' || sqlerrm);
  end;
  return jsonb_build_object('inserted', n, 'notes', v_notes);
end $$;

do $wrap$
declare v_src text;
begin
  select prosrc into v_src from pg_proc where oid = to_regprocedure('public._acct_sync_ledger()');
  if v_src is not null and position('_acct_sync_ledger_core' in v_src) = 0 then
    if to_regprocedure('public._acct_sync_ledger_core()') is not null then drop function public._acct_sync_ledger_core(); end if;
    alter function public._acct_sync_ledger() rename to _acct_sync_ledger_core;
    create function public._acct_sync_ledger() returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
    declare a jsonb; b jsonb;
    begin
      a := public._acct_sync_ledger_core();  -- original sync (kept as is)
      b := public._acct_sync_extras();
      return coalesce(a, '{}'::jsonb) || jsonb_build_object('extras', b);
    end $f$;
  end if;
end
$wrap$;
revoke all on function public._acct_sync_ledger_core(), public._acct_sync_extras(), public._acct_sync_ledger() from public, anon, authenticated;

-- ---------- 5. profit now counts coordinator plan income (same function as before, one label added) ---
create or replace function public.admin_accountant_profit(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_income bigint; v_cost bigint; v_missing jsonb;
begin
  perform public.admin_require('accounting.view');
  select coalesce(sum(l.amount_kobo), 0) into v_income
    from public.accountant_ledger l
   where l.label in ('platform_commission', 'subscription_income', 'coordinator_plan_income', 'transfer_fee', 'stamp_duty_charged')
     and (p_from is null or l.entry_at >= p_from) and (p_to is null or l.entry_at < p_to)
     and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id);
  select coalesce(sum(l.amount_kobo), 0) into v_cost
    from public.accountant_ledger l join public.accountant_labels a on a.key = l.label
   where a.group_name = 'Fees and costs' and a.direction = 'out'
     and (p_from is null or l.entry_at >= p_from) and (p_to is null or l.entry_at < p_to)
     and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id);
  select coalesce(jsonb_agg(a.title order by a.sort_order), '[]'::jsonb) into v_missing
    from public.accountant_labels a
   where a.key in ('paystack_fee_collection', 'paystack_fee_transfer', 'expense_hosting', 'expense_email', 'expense_id_verification', 'expense_domain')
     and not exists (select 1 from public.accountant_ledger l
                      where l.label = a.key and (p_from is null or l.entry_at >= p_from) and (p_to is null or l.entry_at < p_to)
                        and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id));
  return jsonb_build_object('ok', true, 'generated_at', now(),
    'income', (select coalesce(jsonb_agg(jsonb_build_object('label', t.label, 'title', t.title, 'amount_kobo', t.s) order by t.sort_order), '[]'::jsonb)
                 from (select l.label, a.title, a.sort_order, sum(l.amount_kobo) s
                         from public.accountant_ledger l join public.accountant_labels a on a.key = l.label
                        where l.label in ('platform_commission', 'subscription_income', 'coordinator_plan_income', 'transfer_fee', 'stamp_duty_charged')
                          and (p_from is null or l.entry_at >= p_from) and (p_to is null or l.entry_at < p_to)
                          and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id)
                        group by l.label, a.title, a.sort_order) t),
    'costs', (select coalesce(jsonb_agg(jsonb_build_object('label', t.label, 'title', t.title, 'amount_kobo', t.s) order by t.sort_order), '[]'::jsonb)
                from (select l.label, a.title, a.sort_order, sum(l.amount_kobo) s
                        from public.accountant_ledger l join public.accountant_labels a on a.key = l.label
                       where a.group_name = 'Fees and costs' and a.direction = 'out'
                         and (p_from is null or l.entry_at >= p_from) and (p_to is null or l.entry_at < p_to)
                         and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id)
                       group by l.label, a.title, a.sort_order) t),
    'income_kobo', v_income, 'costs_kobo', v_cost, 'profit_kobo', v_income - v_cost,
    'complete', jsonb_array_length(v_missing) = 0, 'missing_cost_entries', v_missing);
end $$;

-- ---------- 6. settlements ------------------------------------------------------------------------
create or replace function public.admin_accountant_settlements(p_limit integer default 24)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_lim integer := least(greatest(coalesce(p_limit, 24), 1), 120); v_items jsonb; v_last date; v_from timestamptz; v_in bigint; v_fee bigint;
begin
  perform public.admin_require('accounting.view');
  with s as (
    select l.id, l.entry_at, l.amount_kobo, l.reference, l.note, (l.entry_at at time zone 'Africa/Lagos')::date as d
      from public.accountant_ledger l where l.label = 'settlement_received' and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id)
  ), w as (
    select s.*, lag(s.d) over (order by s.entry_at, s.id) as prev_d from s
  ), c as (
    select w.*, (case when w.prev_d is null then null else (w.prev_d::text || ' 00:00')::timestamp at time zone 'Africa/Lagos' end) as win_from,
           ((w.d::text || ' 00:00')::timestamp at time zone 'Africa/Lagos') as win_to from w
  ), e as (
    select c.*,
      (select coalesce(sum(x.amount_kobo), 0) from public.accountant_ledger x
        where x.label in ('customer_payment_job', 'wallet_topup', 'gift_card_sold', 'donation_received', 'other_paystack_payment')
          and (c.win_from is null or x.entry_at >= c.win_from) and x.entry_at < c.win_to
          and not exists (select 1 from public.accountant_ledger z where z.reverses = x.id)) as exp_in,
      (select coalesce(sum(x.amount_kobo), 0) from public.accountant_ledger x
        where x.label = 'paystack_fee_collection' and (c.win_from is null or x.entry_at >= c.win_from) and x.entry_at < c.win_to
          and not exists (select 1 from public.accountant_ledger z where z.reverses = x.id)) as exp_fee
      from c
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'settled_on', t.d, 'reference', t.reference, 'note', left(t.note, 200),
      'received_kobo', t.amount_kobo, 'payments_kobo', t.exp_in, 'fees_kobo', t.exp_fee, 'expected_kobo', t.exp_in - t.exp_fee,
      'difference_kobo', t.amount_kobo - (t.exp_in - t.exp_fee),
      'window_from', case when t.win_from is null then null else (t.win_from at time zone 'Africa/Lagos')::date end, 'window_to', t.d,
      'status', case when abs(t.amount_kobo - (t.exp_in - t.exp_fee)) <= 5000 then 'matched' else 'difference' end) order by t.entry_at desc, t.id desc), '[]'::jsonb)
    into v_items from (select * from e order by entry_at desc, id desc limit v_lim) t;

  select max((l.entry_at at time zone 'Africa/Lagos')::date) into v_last
    from public.accountant_ledger l where l.label = 'settlement_received' and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id);
  v_from := case when v_last is null then null else (v_last::text || ' 00:00')::timestamp at time zone 'Africa/Lagos' end;
  select coalesce(sum(x.amount_kobo), 0) into v_in from public.accountant_ledger x
   where x.label in ('customer_payment_job', 'wallet_topup', 'gift_card_sold', 'donation_received', 'other_paystack_payment')
     and (v_from is null or x.entry_at >= v_from) and not exists (select 1 from public.accountant_ledger z where z.reverses = x.id);
  select coalesce(sum(x.amount_kobo), 0) into v_fee from public.accountant_ledger x
   where x.label = 'paystack_fee_collection' and (v_from is null or x.entry_at >= v_from) and not exists (select 1 from public.accountant_ledger z where z.reverses = x.id);
  return jsonb_build_object('ok', true, 'generated_at', now(), 'tolerance_kobo', 5000, 'items', v_items,
    'awaiting', jsonb_build_object('since', v_last, 'payments_kobo', v_in, 'fees_kobo', v_fee, 'expected_kobo', v_in - v_fee));
end $$;

-- ---------- 7. cash position ----------------------------------------------------------------------
create or replace function public.admin_accountant_cash_record(p_account text, p_balance_kobo bigint, p_as_of date, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_id bigint;
begin
  if not public.admin_guard('accounting.record', 'accountant.cash_record') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.'); end if;
  if p_account is null or p_account not in ('bank_client', 'bank_operating', 'paystack_balance') then return jsonb_build_object('ok', false, 'error', 'Choose which account this balance is from.'); end if;
  if p_balance_kobo is null or p_balance_kobo < 0 then return jsonb_build_object('ok', false, 'error', 'Enter the balance as a number, zero or more.'); end if;
  if p_as_of is null or p_as_of > (now() at time zone 'Africa/Lagos')::date then return jsonb_build_object('ok', false, 'error', 'Enter the date you read the balance (not in the future).'); end if;
  insert into public.accountant_cash_snapshots (account, balance_kobo, as_of, note, recorded_by) values (p_account, p_balance_kobo, p_as_of, left(v_note, 300), auth.uid()) returning id into v_id;
  perform public.admin_log('accountant.cash_record', 'accountant_cash_snapshots', v_id::text, null, jsonb_build_object('account', p_account, 'balance_kobo', p_balance_kobo, 'as_of', p_as_of), v_note);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.admin_accountant_cash()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_accts jsonb; v_total bigint := 0; v_have integer := 0; v_wallet bigint; v_local bigint; v_cap_in bigint; v_cap_out bigint; v_hist jsonb; v_notes jsonb := '[]'::jsonb; v_owed bigint; v_stale boolean := false;
begin
  perform public.admin_require('accounting.view');
  select coalesce(jsonb_agg(jsonb_build_object('account', a.account, 'balance_kobo', s.balance_kobo, 'as_of', s.as_of, 'recorded_at', s.recorded_at, 'note', left(s.note, 300),
           'stale', s.as_of is not null and s.as_of < (now() at time zone 'Africa/Lagos')::date - 7) order by a.ord), '[]'::jsonb),
         coalesce(sum(s.balance_kobo), 0), count(s.id)::integer, coalesce(bool_or(s.as_of < (now() at time zone 'Africa/Lagos')::date - 7), false)
    into v_accts, v_total, v_have, v_stale
    from (values ('bank_client', 1), ('bank_operating', 2), ('paystack_balance', 3)) as a(account, ord)
    left join lateral (select * from public.accountant_cash_snapshots x where x.account = a.account order by x.as_of desc, x.id desc limit 1) s on true;

  begin select coalesce(sum(public._acct_kobo(coalesce(w.balance, 0) + coalesce(w.pending_balance, 0))), 0) into v_wallet from public.wallets w;
  exception when others then v_wallet := null; v_notes := v_notes || to_jsonb('wallets: ' || sqlerrm); end;
  begin select coalesce(sum(public._acct_kobo(p.amount)), 0) into v_local from public.local_payouts p where p.status in ('queued', 'processing');
  exception when others then v_local := null; v_notes := v_notes || to_jsonb('local_payouts: ' || sqlerrm); end;
  select coalesce(sum(l.amount_kobo) filter (where l.label = 'capital_in'), 0), coalesce(sum(l.amount_kobo) filter (where l.label = 'capital_repaid'), 0) into v_cap_in, v_cap_out
    from public.accountant_ledger l where l.label in ('capital_in', 'capital_repaid') and not exists (select 1 from public.accountant_ledger z where z.reverses = l.id);
  select coalesce(jsonb_agg(jsonb_build_object('account', h.account, 'balance_kobo', h.balance_kobo, 'as_of', h.as_of, 'recorded_at', h.recorded_at, 'note', left(h.note, 300)) order by h.recorded_at desc, h.id desc), '[]'::jsonb)
    into v_hist from (select * from public.accountant_cash_snapshots order by recorded_at desc, id desc limit 20) h;
  v_owed := case when v_wallet is null or v_local is null then null else v_wallet + v_local end;
  return jsonb_build_object('ok', true, 'generated_at', now(), 'accounts', v_accts, 'accounts_recorded', v_have, 'cash_total_kobo', v_total, 'any_stale', v_stale,
    'owed_taskers_kobo', v_wallet, 'owed_local_kobo', v_local, 'owed_total_kobo', v_owed,
    'capital_outstanding_kobo', v_cap_in - v_cap_out,
    'safe_to_take_back_kobo', case when v_owed is null or v_have < 3 then null else v_total - v_owed end,
    'history', v_hist, 'notes', v_notes);
end $$;

revoke all on function public.admin_accountant_settlements(integer), public.admin_accountant_cash_record(text, bigint, date, text), public.admin_accountant_cash(),
  public.admin_accountant_profit(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_accountant_settlements(integer), public.admin_accountant_cash_record(text, bigint, date, text), public.admin_accountant_cash(),
  public.admin_accountant_profit(timestamptz, timestamptz) to authenticated;

-- ---------- 8. fill the new ledger lines now (idempotent) ------------------------------------------
select public._acct_sync_ledger() is not null as synced;

select case
  when to_regprocedure('public.admin_accountant_settlements(integer)') is not null
   and to_regprocedure('public.admin_accountant_cash_record(text,bigint,date,text)') is not null
   and to_regprocedure('public.admin_accountant_cash()') is not null
   and to_regclass('public.accountant_cash_snapshots') is not null
   and exists (select 1 from public.accountant_labels where key = 'coordinator_plan_income')
   and exists (select 1 from pg_trigger where tgname = 'accountant_capital_guard')
   and position('_acct_sync_ledger_core' in (select prosrc from pg_proc where oid = to_regprocedure('public._acct_sync_ledger()'))) > 0
  then 'DONE: A15b-3 installed.'
  else 'NOT DONE: see the messages above.'
end as a15b3_result;

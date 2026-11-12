-- StreetTasker Admin Control Centre, stage A16: Revenue and commissions (READ ONLY).
-- Run the WHOLE file once in the Supabase SQL editor. Safe to run twice. Rollback: a16-rollback.sql. The last row says DONE or NOT DONE.
-- Needs: A1 (admin core) and A15b (accountant: _acct_release_events). Run a15b-accountant.sql first if the pre-check says so.
--
-- Adds (SECURITY DEFINER, execute for authenticated only, each checks permission revenue.view itself):
--   admin_revenue_report(bucket, from, to)             totals and a series per period, one number per stream, never one grand total
--   admin_revenue_list(stream, from, to, offset)       the rows behind a number, 25 per page, so any total can be traced
-- and internal helpers _a16_kobo() and _a16_events() that nobody can call from the browser.
--
-- Writes nothing. No table, policy or existing function is changed. No money moves, Paystack is never called.
--
-- THE STREAMS (each is reported apart; there is no total across streams):
--   regular_commission   platform fee on a job done by a REGULAR Tasker, counted on the day its release code was entered.
--                        Same source as the accountant (_acct_release_events kind 'regular'): the platform_fee stored on the released escrow row.
--   local_commission     platform share of the fee on a LOCAL Tasker job, counted on the day of the final release. Local Tasker earnings are never counted.
--   subscription         paid subscription receipts (plan price as stored, kobo), counted on paid_at. Not job escrow.
--   coordinator_plan     paid coordinator tier upgrades (payment_intents purpose tier_upgrade, status paid), counted on paid_at. Not a subscription.
--   withdrawal_fee       fee kept from a Regular Tasker on a successful withdrawal (withdrawals.fee as stored). Paystack bills its own transfer cost separately
--                        and that cost is NOT subtracted here.
--   coordinator_share    MEMO ONLY. The coordinator's share of a Local job fee. It is not platform income and is shown apart.
--   Held (not earned yet): platform_fee on escrow rows still 'held'. It is not income until the release code is entered.
-- Rates are never recomputed: every number is an amount stored by the site (ARCHITECTURE Part B5 item 1).
-- Gift-card fees: no fee is stored anywhere, so none is counted. Refunds recorded by support are NOT subtracted from any stream.
-- Amounts: stored in naira for escrow, payment_intents, withdrawals; kobo for subscription receipts. This file returns kobo for everything.
-- Days, weeks (Monday start) and months are Africa/Lagos days. Optional columns are read through to_jsonb(row), so a missing column gives no rows, not an error.
-- test_archive_* tables are never read.

do $pre$
begin
  if to_regprocedure('public.admin_has(text)') is null then
    raise exception 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
  end if;
  if to_regprocedure('public._acct_release_events(timestamptz,timestamptz)') is null then
    raise exception 'NOT DONE: run a15b-accountant.sql first (it provides _acct_release_events). Nothing was changed.';
  end if;
  if to_regclass('public.payment_intents') is null or to_regclass('public.escrow_payments') is null then
    raise exception 'NOT DONE: payment_intents or escrow_payments does not exist. Nothing was changed.';
  end if;
end
$pre$;

create or replace function public._a16_kobo(p numeric)
returns bigint language sql immutable as $$ select round(coalesce(p, 0) * 100)::bigint $$;

create or replace function public._a16_events()
returns table (stream text, occurred_at timestamptz, amount_kobo bigint, reference text, booking_ref text, note text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  -- 1 and 2. commission on released jobs (regular and Local) and the coordinator memo
  return query
  select (case when e.kind = 'local' then 'local_commission' else 'regular_commission' end)::text, e.released_at, e.platform_kobo,
         e.src_id::text, e.booking_ref::text,
         (case when e.kind = 'local' then 'Platform share of the fee on a Local job.' else 'Platform fee on a job done by a Regular Tasker.' end)::text
    from public._acct_release_events(null, null) e
   where e.kind in ('regular', 'local') and e.released_at is not null and coalesce(e.platform_kobo, 0) <> 0;

  return query
  select 'coordinator_share'::text, e.released_at, e.coord_kobo, e.src_id::text, e.booking_ref::text,
         'Coordinator share of a Local job fee. Not platform income.'::text
    from public._acct_release_events(null, null) e
   where e.kind = 'local' and e.released_at is not null and coalesce(e.coord_kobo, 0) <> 0;

  -- 3. subscription receipts (kobo already)
  if to_regclass('public.subscription_receipts') is not null then
    return query
    select 'subscription'::text, (to_jsonb(r)->>'paid_at')::timestamptz, (to_jsonb(r)->>'amount_kobo')::bigint,
           (to_jsonb(r)->>'reference')::text, ''::text,
           ('Plan: ' || coalesce(nullif(to_jsonb(r)->>'plan_name', ''), nullif(to_jsonb(r)->>'plan', ''), 'not recorded'))::text
      from public.subscription_receipts r
     where nullif(to_jsonb(r)->>'paid_at', '') is not null and nullif(to_jsonb(r)->>'amount_kobo', '') is not null;
  end if;

  -- 4. coordinator plan payments
  return query
  select 'coordinator_plan'::text, i.paid_at, public._a16_kobo(i.amount), i.reference::text, ''::text,
         'Coordinator tier upgrade (purpose tier_upgrade).'::text
    from public.payment_intents i
   where i.purpose = 'tier_upgrade' and i.status = 'paid' and i.paid_at is not null;

  -- 5. withdrawal fees kept from Regular Taskers
  if to_regclass('public.withdrawals') is not null then
    return query
    select 'withdrawal_fee'::text, coalesce(w.settled_at, w.updated_at, w.created_at), public._a16_kobo(w.fee),
           coalesce(w.paystack_transfer_code, w.reference)::text, ''::text,
           'Fee deducted from the Tasker on a paid withdrawal. Paystack''s own cost is not subtracted.'::text
      from public.withdrawals w
     where w.status = 'success' and coalesce(w.fee, 0) > 0 and coalesce(w.settled_at, w.updated_at, w.created_at) is not null;
  end if;
end $$;

create or replace function public.admin_revenue_report(p_bucket text default 'week', p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_b text := lower(coalesce(p_bucket, 'week'));
  v_to date; v_from date; v_from_ts timestamptz; v_to_ts timestamptz;
  v_streams text[] := array['regular_commission', 'local_commission', 'subscription', 'coordinator_plan', 'withdrawal_fee', 'coordinator_share'];
  v_tot jsonb; v_series jsonb; v_held jsonb;
begin
  if not public.admin_has('revenue.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_b not in ('day', 'week', 'month') then v_b := 'week'; end if;
  v_to := coalesce(p_to, (now() at time zone 'Africa/Lagos')::date);
  v_from := coalesce(p_from, case v_b when 'day' then v_to - 29 when 'week' then v_to - 83 else (date_trunc('month', v_to::timestamp) - interval '11 months')::date end);
  if v_from > v_to then return jsonb_build_object('ok', false, 'error', 'The start date is after the end date.'); end if;
  if v_to - v_from > 400 then return jsonb_build_object('ok', false, 'error', 'Choose a range of 400 days or less.'); end if;
  v_from_ts := v_from::timestamp at time zone 'Africa/Lagos';
  v_to_ts := (v_to + 1)::timestamp at time zone 'Africa/Lagos';

  select coalesce(jsonb_object_agg(s.k, jsonb_build_object('kobo', coalesce(t.kobo, 0), 'rows', coalesce(t.n, 0))), '{}'::jsonb)
    into v_tot
    from unnest(v_streams) as s(k)
    left join (select e.stream, sum(e.amount_kobo)::bigint kobo, count(*) n from public._a16_events() e
                where e.occurred_at >= v_from_ts and e.occurred_at < v_to_ts group by e.stream) t on t.stream = s.k;

  select coalesce(jsonb_agg(jsonb_build_object(
           'period', g.p::date,
           'regular_commission', coalesce(x.reg, 0), 'local_commission', coalesce(x.loc, 0), 'subscription', coalesce(x.sub, 0),
           'coordinator_plan', coalesce(x.cpl, 0), 'withdrawal_fee', coalesce(x.wdf, 0), 'coordinator_share', coalesce(x.csh, 0)) order by g.p), '[]'::jsonb)
    into v_series
    from generate_series(date_trunc(v_b, v_from::timestamp), v_to::timestamp, ('1 ' || v_b)::interval) as g(p)
    left join (select date_trunc(v_b, e.occurred_at at time zone 'Africa/Lagos') as p,
                      sum(e.amount_kobo) filter (where e.stream = 'regular_commission') reg,
                      sum(e.amount_kobo) filter (where e.stream = 'local_commission') loc,
                      sum(e.amount_kobo) filter (where e.stream = 'subscription') sub,
                      sum(e.amount_kobo) filter (where e.stream = 'coordinator_plan') cpl,
                      sum(e.amount_kobo) filter (where e.stream = 'withdrawal_fee') wdf,
                      sum(e.amount_kobo) filter (where e.stream = 'coordinator_share') csh
                 from public._a16_events() e where e.occurred_at >= v_from_ts and e.occurred_at < v_to_ts group by 1) x on x.p = g.p;

  select jsonb_build_object('kobo', coalesce(sum(public._a16_kobo(e.platform_fee)), 0)::bigint, 'rows', count(*))
    into v_held from public.escrow_payments e where e.status = 'held';

  return jsonb_build_object('ok', true, 'generated_at', now(), 'bucket', v_b, 'from', v_from, 'to', v_to,
                            'timezone', 'Africa/Lagos', 'streams', v_tot, 'series', v_series, 'held', v_held);
end $$;

create or replace function public.admin_revenue_list(p_stream text default 'regular_commission', p_from date default null, p_to date default null, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_s text := lower(coalesce(p_stream, 'regular_commission'));
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_to date; v_from date; v_from_ts timestamptz; v_to_ts timestamptz; v_out jsonb;
begin
  if not public.admin_has('revenue.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_s not in ('regular_commission', 'local_commission', 'subscription', 'coordinator_plan', 'withdrawal_fee', 'coordinator_share') then v_s := 'regular_commission'; end if;
  v_to := coalesce(p_to, (now() at time zone 'Africa/Lagos')::date);
  v_from := coalesce(p_from, v_to - 83);
  if v_from > v_to then return jsonb_build_object('ok', false, 'error', 'The start date is after the end date.'); end if;
  if v_to - v_from > 400 then return jsonb_build_object('ok', false, 'error', 'Choose a range of 400 days or less.'); end if;
  v_from_ts := v_from::timestamp at time zone 'Africa/Lagos';
  v_to_ts := (v_to + 1)::timestamp at time zone 'Africa/Lagos';
  with f as (select * from public._a16_events() e where e.stream = v_s and e.occurred_at >= v_from_ts and e.occurred_at < v_to_ts)
  select jsonb_build_object('ok', true, 'stream', v_s, 'from', v_from, 'to', v_to, 'offset', v_off, 'page_size', 25,
           'total', (select count(*) from f), 'total_kobo', (select coalesce(sum(amount_kobo), 0)::bigint from f),
           'items', (select coalesce(jsonb_agg(jsonb_build_object('occurred_at', t.occurred_at, 'amount_kobo', t.amount_kobo, 'reference', t.reference,
                       'booking_ref', nullif(t.booking_ref, ''), 'note', t.note) order by t.occurred_at desc, t.reference), '[]'::jsonb)
                      from (select * from f order by occurred_at desc, reference offset v_off limit 25) t))
    into v_out;
  return v_out;
end $$;

revoke all on function public._a16_kobo(numeric), public._a16_events(), public.admin_revenue_report(text, date, date), public.admin_revenue_list(text, date, date, integer) from public, anon, authenticated;
grant execute on function public.admin_revenue_report(text, date, date), public.admin_revenue_list(text, date, date, integer) to authenticated;

select case
  when to_regprocedure('public.admin_revenue_report(text,date,date)') is not null
   and to_regprocedure('public.admin_revenue_list(text,date,date,integer)') is not null
   and (select count(*) >= 0 from public._a16_events())
  then 'DONE: A16 installed.'
  else 'NOT DONE: see the messages above.'
end as a16_result;

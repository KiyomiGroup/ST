-- StreetTasker Admin Control Centre, stage A18: Subscriptions (READ ONLY).
-- Run the WHOLE file once in the Supabase SQL editor. Safe to run twice. Rollback: a18-rollback.sql. The last row says DONE or NOT DONE.
-- Needs: A1 (admin core) and the existing public.subscriptions table. Everything else is optional and read only if it exists.
--
-- Adds (SECURITY DEFINER, execute for authenticated only, each checks its permission itself):
--   admin_subscriptions_overview()                       subscriptions.view            counts by status and plan, ending soon, needs review, card-authorization row count
--   admin_subscription_plans()                           subscriptions.view            the plans as stored, with how many people are on each
--   admin_subscriber_list(search, status, offset)        subscriptions.view            who is on which plan, 25 per page
--   admin_subscriber_detail(user_id)                     subscriptions.view            one person: plan, timeline, audit; receipts only with subscriptions.payments.view
--   admin_subscription_payments(filter, offset)          subscriptions.payments.view   receipts, payments not completed, and payments needing review
--   admin_subscription_audit(source, offset)             subscriptions.view            subscription_admin_log and subscription_events together, newest first
-- and internal helpers (_a18_*) that nobody can call from the browser.
--
-- Writes nothing. No table, policy, trigger or existing function is changed. No money moves. Paystack is never called.
-- No cancel, downgrade, override, adjustment or credit exists here (those are A19, with approvals). Rule R-C: no saved cards, no automatic renewal.
--
-- DEFINITIONS (printed on the page too):
--   Ended            status cancelled or expired. A person continues a plan by paying again; nothing renews by itself.
--   Ending soon      status active and the period ends within 7 days.
--   Needs review     (a) a subscription payment marked paid with NO receipt carrying its reference (money received, plan maybe not activated), or
--                    (b) a paid receipt for a person who has no subscription row at all.
--   Not completed    a subscription payment (payment_intents purpose subscription) whose status is not paid: pending, failed, amount_mismatch and so on, as stored.
--   Revenue (month)  paid receipts with a paid time this Lagos month, amount_kobo as stored. Only shown with subscriptions.revenue.view.
-- Amounts: subscription_receipts is kobo; payment_intents is naira and is converted here. This file returns kobo for everything.
--
-- COLUMNS THAT WERE NOT PROVEN (the owner's docs/subscription/ was not available when this was written): every column except the few
-- listed in ARCHITECTURE.md B5 is read through to_jsonb(row) with a list of likely names, so a wrong guess gives an empty cell, not an error.
-- Run a18-introspect.sql and send the result; the guesses can then be fixed. Known from ARCHITECTURE and the site's own code:
--   subscriptions: status (active, past_due, cancelled, expired), plan, tier, cancel_at_period_end, pending_plan, current_period_end.
--   subscription_plans: price in kobo, offers_per_month, listing_limit, membership_label, is_active.
--   subscription_receipts: id, receipt_number, reference, plan_name, kind, price_kobo, credit_kobo, amount_kobo, period_start, period_end, paid_at.
--   subscription_admin_log: admin_id, action, target_user_id, target_plan, old_value, new_value, reason, approval_id.
-- NEVER returned: authorization_code or any card detail (subscription_card_authorizations is only counted), email, phone, bank details.

do $pre$
begin
  if to_regprocedure('public.admin_has(text)') is null then
    raise exception 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
  end if;
  if to_regclass('public.subscriptions') is null then
    raise exception 'NOT DONE: the table public.subscriptions does not exist. Nothing was changed.';
  end if;
  if to_regclass('public.users') is null then
    raise exception 'NOT DONE: the table public.users does not exist. Nothing was changed.';
  end if;
end
$pre$;

-- ---------- helpers (internal) ----------
create or replace function public._a18_pick(j jsonb, keys text[]) returns text language sql immutable as $$
  select nullif(btrim(j->>k), '') from unnest(keys) with ordinality as t(k, o)
   where nullif(btrim(j->>k), '') is not null order by o limit 1 $$;

create or replace function public._a18_ts(p text) returns timestamptz language plpgsql stable as $$
begin return nullif(p, '')::timestamptz; exception when others then return null; end $$;

create or replace function public._a18_bigint(p text) returns bigint language plpgsql immutable as $$
begin return round(nullif(p, '')::numeric)::bigint; exception when others then return null; end $$;

create or replace function public._a18_bool(p text) returns boolean language sql immutable as $$
  select lower(coalesce(p, '')) in ('true', 't', '1', 'yes') $$;

create or replace function public._a18_like(p text) returns text language sql immutable as $$
  select '%' || regexp_replace(coalesce(p, ''), '([\\%_])', '\\\1', 'g') || '%' $$;

create or replace function public._a18_subs()
returns table (user_id text, plan text, tier text, status text, period_end timestamptz, cancel_at_end boolean, pending_plan text, started_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select public._a18_pick(x.j, array['user_id']),
         public._a18_pick(x.j, array['plan', 'plan_key', 'plan_id']),
         public._a18_pick(x.j, array['tier']),
         lower(coalesce(public._a18_pick(x.j, array['status']), 'unknown')),
         public._a18_ts(public._a18_pick(x.j, array['current_period_end', 'period_end', 'ends_at'])),
         public._a18_bool(public._a18_pick(x.j, array['cancel_at_period_end'])),
         public._a18_pick(x.j, array['pending_plan']),
         public._a18_ts(public._a18_pick(x.j, array['created_at', 'started_at', 'current_period_start']))
    from public.subscriptions s cross join lateral (select to_jsonb(s) as j) x $$;

create or replace function public._a18_plans()
returns table (plan_key text, idents text[], name text, price_kobo bigint, offers integer, listing_limit integer, membership_label text, is_active boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if to_regclass('public.subscription_plans') is null then return; end if;
  return query
  select public._a18_pick(x.j, array['plan', 'key', 'slug', 'code', 'id', 'name']),
         array_remove(array[public._a18_pick(x.j, array['plan']), public._a18_pick(x.j, array['key']), public._a18_pick(x.j, array['slug']),
                            public._a18_pick(x.j, array['code']), public._a18_pick(x.j, array['id']), public._a18_pick(x.j, array['name'])], null),
         coalesce(public._a18_pick(x.j, array['name', 'label', 'title', 'plan_name', 'display_name']), public._a18_pick(x.j, array['plan', 'key', 'slug', 'code', 'id'])),
         public._a18_bigint(public._a18_pick(x.j, array['price_kobo', 'amount_kobo'])),
         public._a18_bigint(public._a18_pick(x.j, array['offers_per_month', 'offer_allowance', 'monthly_offers']))::integer,
         public._a18_bigint(public._a18_pick(x.j, array['listing_limit', 'listings_limit', 'max_listings']))::integer,
         public._a18_pick(x.j, array['membership_label', 'badge']),
         case when public._a18_pick(x.j, array['is_active', 'active']) is null then null else public._a18_bool(public._a18_pick(x.j, array['is_active', 'active'])) end
    from public.subscription_plans p cross join lateral (select to_jsonb(p) as j) x;
end $$;

create or replace function public._a18_receipts()
returns table (receipt_id text, receipt_number text, reference text, plan_name text, kind text, amount_kobo bigint, paid_at timestamptz, period_start timestamptz, period_end timestamptz, user_id text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if to_regclass('public.subscription_receipts') is null then return; end if;
  return query
  select public._a18_pick(x.j, array['id']), public._a18_pick(x.j, array['receipt_number']), public._a18_pick(x.j, array['reference']),
         coalesce(public._a18_pick(x.j, array['plan_name']), public._a18_pick(x.j, array['plan'])), public._a18_pick(x.j, array['kind']),
         public._a18_bigint(public._a18_pick(x.j, array['amount_kobo'])), public._a18_ts(public._a18_pick(x.j, array['paid_at'])),
         public._a18_ts(public._a18_pick(x.j, array['period_start'])), public._a18_ts(public._a18_pick(x.j, array['period_end'])),
         public._a18_pick(x.j, array['user_id'])
    from public.subscription_receipts r cross join lateral (select to_jsonb(r) as j) x;
end $$;

-- Timeline: subscription_events and subscription_admin_log in one shape. Text is cut to 300 characters. No card or contact data is read.
create or replace function public._a18_events()
returns table (src text, at timestamptz, user_id text, kind text, note text, from_plan text, to_plan text, actor text, has_approval boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if to_regclass('public.subscription_events') is not null then
    return query
    select 'event'::text, public._a18_ts(public._a18_pick(x.j, array['created_at', 'at'])), public._a18_pick(x.j, array['user_id']),
           public._a18_pick(x.j, array['kind', 'event', 'event_type', 'type', 'action']),
           left(public._a18_pick(x.j, array['note', 'reason', 'message', 'detail', 'description']), 300),
           left(public._a18_pick(x.j, array['from_plan', 'old_plan']), 120), left(public._a18_pick(x.j, array['to_plan', 'new_plan', 'plan']), 120),
           left(public._a18_pick(x.j, array['actor_id', 'admin_id']), 8), false
      from public.subscription_events e cross join lateral (select to_jsonb(e) as j) x;
  end if;
  if to_regclass('public.subscription_admin_log') is not null then
    return query
    select 'admin'::text, public._a18_ts(public._a18_pick(x.j, array['created_at', 'at'])), public._a18_pick(x.j, array['target_user_id', 'user_id']),
           public._a18_pick(x.j, array['action']), left(public._a18_pick(x.j, array['reason']), 300),
           left(public._a18_pick(x.j, array['old_value']), 120), left(coalesce(public._a18_pick(x.j, array['target_plan']), public._a18_pick(x.j, array['new_value'])), 120),
           left(public._a18_pick(x.j, array['admin_id']), 8), public._a18_pick(x.j, array['approval_id']) is not null
      from public.subscription_admin_log l cross join lateral (select to_jsonb(l) as j) x;
  end if;
end $$;

-- Payments in three classes: receipts, not_paid, review. See the definitions in the header.
create or replace function public._a18_pay_rows()
returns table (cls text, ref text, receipt_no text, kind text, amount_kobo bigint, status text, at timestamptz, party_id text, plan text, reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query
  select 'receipts'::text, r.reference, r.receipt_number, r.kind, r.amount_kobo, 'paid'::text, r.paid_at, r.user_id, r.plan_name, null::text
    from public._a18_receipts() r where r.paid_at is not null;

  return query
  select 'not_paid'::text, i.reference::text, null::text, null::text, round(coalesce(i.amount, 0) * 100)::bigint, coalesce(i.status, 'unknown')::text,
         coalesce(i.paid_at, public._a18_ts(to_jsonb(i)->>'created_at')), i.user_id::text, public._a18_pick(to_jsonb(i), array['plan', 'plan_key', 'tier']),
         (case when coalesce(i.status, '') = 'pending' and public._a18_ts(to_jsonb(i)->>'created_at') < now() - interval '1 day' then 'Still pending after a day.'
               when coalesce(i.status, '') = 'amount_mismatch' then 'The amount paid did not match the amount asked.' end)::text
    from public.payment_intents i where i.purpose = 'subscription' and coalesce(i.status, '') <> 'paid';

  return query
  select 'review'::text, i.reference::text, null::text, null::text, round(coalesce(i.amount, 0) * 100)::bigint, 'paid'::text,
         coalesce(i.paid_at, public._a18_ts(to_jsonb(i)->>'created_at')), i.user_id::text, public._a18_pick(to_jsonb(i), array['plan', 'plan_key', 'tier']),
         'Paid, but no receipt carries this reference. The plan may not have been activated.'::text
    from public.payment_intents i
   where i.purpose = 'subscription' and i.status = 'paid'
     and not exists (select 1 from public._a18_receipts() r where r.reference = i.reference::text);

  return query
  select 'review'::text, r.reference, r.receipt_number, r.kind, r.amount_kobo, 'paid'::text, r.paid_at, r.user_id, r.plan_name,
         'A paid receipt, but this person has no subscription row.'::text
    from public._a18_receipts() r
   where r.paid_at is not null and r.user_id is not null and not exists (select 1 from public._a18_subs() s where s.user_id = r.user_id);
end $$;

-- ---------- browser functions ----------
create or replace function public.admin_subscriptions_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_total integer; v_soon integer; v_cae integer; v_by jsonb; v_plans jsonb; v_rev jsonb; v_cards jsonb; v_review integer; v_unpaid integer; v_m0 timestamptz; v_n bigint; v_k bigint;
begin
  if not public.admin_has('subscriptions.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;

  select count(*), count(*) filter (where status = 'active' and period_end is not null and period_end >= now() and period_end < now() + interval '7 days'),
         count(*) filter (where status = 'active' and cancel_at_end),
         jsonb_build_object('active', count(*) filter (where status = 'active'), 'past_due', count(*) filter (where status = 'past_due'),
                            'cancelled', count(*) filter (where status = 'cancelled'), 'expired', count(*) filter (where status = 'expired'),
                            'other', count(*) filter (where status not in ('active', 'past_due', 'cancelled', 'expired')))
    into v_total, v_soon, v_cae, v_by from public._a18_subs();

  with pl as (select * from public._a18_plans()),
       s as (select * from public._a18_subs()),
       g as (select s.plan as plan_key,
                    (select p.name from pl p where lower(s.plan) = any (select lower(i) from unnest(p.idents) i) limit 1) as label,
                    count(*) filter (where s.status = 'active') as active, count(*) filter (where s.status = 'past_due') as past_due,
                    count(*) filter (where s.status in ('cancelled', 'expired')) as ended
               from s group by s.plan)
  select coalesce(jsonb_agg(jsonb_build_object('plan', coalesce(g.plan_key, 'not recorded'), 'label', coalesce(g.label, g.plan_key, 'Not recorded'),
                                               'active', g.active, 'past_due', g.past_due, 'ended', g.ended) order by g.active desc, g.plan_key), '[]'::jsonb)
    into v_plans from g;

  if public.admin_has('subscriptions.revenue.view') then
    v_m0 := date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
    select coalesce(sum(r.amount_kobo), 0)::bigint, count(*) into v_k, v_n from public._a18_receipts() r where r.paid_at >= v_m0 and r.amount_kobo is not null;
    v_rev := jsonb_build_object('allowed', true, 'kobo', v_k, 'rows', v_n);
  else
    v_rev := jsonb_build_object('allowed', false);
  end if;

  if public.admin_has('subscriptions.payments.view') then
    select count(*) filter (where cls = 'review'), count(*) filter (where cls = 'not_paid') into v_review, v_unpaid from public._a18_pay_rows();
  end if;

  if to_regclass('public.subscription_card_authorizations') is not null then
    select count(*) into v_n from public.subscription_card_authorizations;   -- COUNT ONLY: the authorization code is never selected
    v_cards := jsonb_build_object('exists', true, 'rows', v_n);
  else
    v_cards := jsonb_build_object('exists', false, 'rows', 0);
  end if;

  return jsonb_build_object('ok', true, 'generated_at', now(), 'timezone', 'Africa/Lagos',
    'subscribers', jsonb_build_object('total', v_total, 'by_status', v_by, 'ending_soon', v_soon, 'cancel_at_period_end', v_cae),
    'by_plan', v_plans, 'revenue_month', v_rev,
    'payments', case when v_review is null then jsonb_build_object('allowed', false)
                     else jsonb_build_object('allowed', true, 'needs_review', v_review, 'not_completed', v_unpaid) end,
    'card_authorizations', v_cards);
end $$;

create or replace function public.admin_subscription_plans()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if not public.admin_has('subscriptions.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if to_regclass('public.subscription_plans') is null then
    return jsonb_build_object('ok', true, 'available', false, 'items', '[]'::jsonb, 'note', 'The plans table was not found.');
  end if;
  with s as (select * from public._a18_subs())
  select coalesce(jsonb_agg(jsonb_build_object('plan', p.plan_key, 'name', p.name, 'price_kobo', p.price_kobo, 'offers_per_month', p.offers,
           'listing_limit', p.listing_limit, 'membership_label', p.membership_label, 'is_active', p.is_active,
           'active', (select count(*) from s where s.status = 'active' and lower(s.plan) = any (select lower(i) from unnest(p.idents) i)),
           'past_due', (select count(*) from s where s.status = 'past_due' and lower(s.plan) = any (select lower(i) from unnest(p.idents) i)),
           'ended', (select count(*) from s where s.status in ('cancelled', 'expired') and lower(s.plan) = any (select lower(i) from unnest(p.idents) i))
         ) order by p.price_kobo nulls first, p.name), '[]'::jsonb)
    into v from public._a18_plans() p;
  return jsonb_build_object('ok', true, 'available', true, 'items', v);
end $$;

create or replace function public.admin_subscriber_list(p_search text default null, p_status text default 'all', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_st text := lower(coalesce(p_status, 'all')); v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(btrim(coalesce(p_search, '')), ''); v_out jsonb;
begin
  if not public.admin_has('subscriptions.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_st not in ('all', 'active', 'past_due', 'ended', 'ending_soon', 'cancel_at_end') then v_st := 'all'; end if;
  if v_q is not null then v_q := left(v_q, 80); end if;
  with pl as (select * from public._a18_plans()),
  f as (
    select s.*, u.name as person,
           (select p.name from pl p where lower(s.plan) = any (select lower(i) from unnest(p.idents) i) limit 1) as plan_label
      from public._a18_subs() s left join public.users u on u.id::text = s.user_id
     where (v_st = 'all'
            or (v_st = 'active' and s.status = 'active') or (v_st = 'past_due' and s.status = 'past_due')
            or (v_st = 'ended' and s.status in ('cancelled', 'expired'))
            or (v_st = 'ending_soon' and s.status = 'active' and s.period_end >= now() and s.period_end < now() + interval '7 days')
            or (v_st = 'cancel_at_end' and s.status = 'active' and s.cancel_at_end))
       and (v_q is null or u.name ilike public._a18_like(v_q) or starts_with(s.user_id, lower(v_q)))
  )
  select jsonb_build_object('ok', true, 'status', v_st, 'offset', v_off, 'page_size', 25, 'total', (select count(*) from f),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('user_id', t.user_id, 'name', nullif(btrim(t.person), ''), 'plan', t.plan,
              'plan_label', coalesce(t.plan_label, t.plan), 'tier', t.tier, 'status', t.status, 'period_end', t.period_end,
              'cancel_at_period_end', t.cancel_at_end, 'pending_plan', t.pending_plan,
              'days_left', case when t.period_end is null then null else floor(extract(epoch from (t.period_end - now())) / 86400)::int end
            ) order by t.ord, t.period_end nulls last, t.user_id), '[]'::jsonb)
      from (select f.*, (case when f.status in ('active', 'past_due') then 0 else 1 end) as ord from f
             order by (case when f.status in ('active', 'past_due') then 0 else 1 end), f.period_end nulls last, f.user_id offset v_off limit 25) t))
    into v_out;
  return v_out;
end $$;

create or replace function public.admin_subscriber_detail(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_sub jsonb; v_name text; v_rec jsonb := null; v_ev jsonb; v_allowed boolean;
begin
  if not public.admin_has('subscriptions.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if p_user is null then return jsonb_build_object('ok', false, 'error', 'No person was chosen.'); end if;
  select nullif(btrim(u.name), '') into v_name from public.users u where u.id = p_user;
  select to_jsonb(t) into v_sub from (
    select s.plan, (select p.name from public._a18_plans() p where lower(s.plan) = any (select lower(i) from unnest(p.idents) i) limit 1) as plan_label,
           s.tier, s.status, s.period_end, s.cancel_at_end as cancel_at_period_end, s.pending_plan, s.started_at
      from public._a18_subs() s where s.user_id = p_user::text limit 1) t;
  v_allowed := public.admin_has('subscriptions.payments.view');
  if v_allowed then
    select coalesce(jsonb_agg(jsonb_build_object('receipt_number', r.receipt_number, 'reference', r.reference, 'plan_name', r.plan_name, 'kind', r.kind,
             'amount_kobo', r.amount_kobo, 'paid_at', r.paid_at, 'period_start', r.period_start, 'period_end', r.period_end) order by r.paid_at desc nulls last), '[]'::jsonb)
      into v_rec from (select * from public._a18_receipts() where user_id = p_user::text order by paid_at desc nulls last limit 50) r;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('src', e.src, 'at', e.at, 'kind', e.kind, 'note', e.note, 'from_plan', e.from_plan, 'to_plan', e.to_plan,
           'actor', e.actor, 'has_approval', e.has_approval) order by e.at desc nulls last), '[]'::jsonb)
    into v_ev from (select * from public._a18_events() where user_id = p_user::text order by at desc nulls last limit 50) e;
  if v_name is null and v_sub is null and v_ev = '[]'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'No such person or subscription.');
  end if;
  return jsonb_build_object('ok', true, 'user_id', p_user, 'name', v_name, 'subscription', v_sub,
    'receipts', v_rec, 'receipts_allowed', v_allowed, 'timeline', v_ev);
end $$;

create or replace function public.admin_subscription_payments(p_filter text default 'review', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_f text := lower(coalesce(p_filter, 'review')); v_off integer := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  if not public.admin_has('subscriptions.payments.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_f not in ('receipts', 'not_paid', 'review') then v_f := 'review'; end if;
  with a as (select * from public._a18_pay_rows()),
       f as (select a.*, (select nullif(btrim(u.name), '') from public.users u where u.id::text = a.party_id) as person from a where a.cls = v_f)
  select jsonb_build_object('ok', true, 'filter', v_f, 'offset', v_off, 'page_size', 25, 'total', (select count(*) from f),
    'total_kobo', (select coalesce(sum(amount_kobo), 0)::bigint from f),
    'counts', (select jsonb_build_object('receipts', count(*) filter (where cls = 'receipts'), 'not_paid', count(*) filter (where cls = 'not_paid'),
                                         'review', count(*) filter (where cls = 'review')) from a),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('reference', t.ref, 'receipt_number', t.receipt_no, 'kind', t.kind, 'amount_kobo', t.amount_kobo,
              'status', t.status, 'at', t.at, 'user_id', t.party_id, 'name', t.person, 'plan', t.plan, 'reason', t.reason)
              order by t.at desc nulls last, t.ref), '[]'::jsonb)
      from (select * from f order by at desc nulls last, ref offset v_off limit 25) t))
    into v_out;
  return v_out;
end $$;

create or replace function public.admin_subscription_audit(p_source text default 'all', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_s text := lower(coalesce(p_source, 'all')); v_off integer := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  if not public.admin_has('subscriptions.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_s not in ('all', 'admin', 'event') then v_s := 'all'; end if;
  with f as (select e.*, (select nullif(btrim(u.name), '') from public.users u where u.id::text = e.user_id) as person
               from public._a18_events() e where v_s = 'all' or e.src = v_s)
  select jsonb_build_object('ok', true, 'source', v_s, 'offset', v_off, 'page_size', 25, 'total', (select count(*) from f),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('src', t.src, 'at', t.at, 'user_id', t.user_id, 'name', t.person, 'kind', t.kind, 'note', t.note,
              'from_plan', t.from_plan, 'to_plan', t.to_plan, 'actor', t.actor, 'has_approval', t.has_approval) order by t.at desc nulls last, t.user_id), '[]'::jsonb)
      from (select * from f order by at desc nulls last, user_id offset v_off limit 25) t))
    into v_out;
  return v_out;
end $$;

-- ---------- grants ----------
revoke all on function public._a18_pick(jsonb, text[]), public._a18_ts(text), public._a18_bigint(text), public._a18_bool(text), public._a18_like(text),
  public._a18_subs(), public._a18_plans(), public._a18_receipts(), public._a18_events(), public._a18_pay_rows(),
  public.admin_subscriptions_overview(), public.admin_subscription_plans(), public.admin_subscriber_list(text, text, integer),
  public.admin_subscriber_detail(uuid), public.admin_subscription_payments(text, integer), public.admin_subscription_audit(text, integer)
  from public, anon, authenticated;
grant execute on function public.admin_subscriptions_overview(), public.admin_subscription_plans(), public.admin_subscriber_list(text, text, integer),
  public.admin_subscriber_detail(uuid), public.admin_subscription_payments(text, integer), public.admin_subscription_audit(text, integer) to authenticated;

select case
  when to_regprocedure('public.admin_subscriptions_overview()') is not null
   and to_regprocedure('public.admin_subscription_plans()') is not null
   and to_regprocedure('public.admin_subscriber_list(text,text,integer)') is not null
   and to_regprocedure('public.admin_subscriber_detail(uuid)') is not null
   and to_regprocedure('public.admin_subscription_payments(text,integer)') is not null
   and to_regprocedure('public.admin_subscription_audit(text,integer)') is not null
   and (select count(*) >= 0 from public._a18_subs())
  then 'DONE: A18 installed.'
  else 'NOT DONE: see the messages above.'
end as a18_result;

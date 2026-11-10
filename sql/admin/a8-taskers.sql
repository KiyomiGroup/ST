-- ============================================================================
-- StreetTasker Admin Control Centre, stage A8: REGULAR TASKERS (spec S05).
-- ADDITIVE and safe to run twice. NO new table (it reuses admin_account_flags from A7). NO column, trigger, policy or function on users,
-- taskers, services, bookings, wallets, withdrawals, reviews, task_applications or identity_verifications is touched.
-- Rollback: a8-rollback.sql. Needs a1-admin-core.sql AND a7-customers.sql (the flags table and the Edge Function pattern).
-- Column names are the REAL ones from the owner's schema check of 2026-11-10 (a8-introspect.sql v2). Notes from that check:
--   taskers.id and taskers.user_id are TEXT (joins cast users.id to text); tasker_profiles does NOT exist; membership_for_users(uuid[]) returns jsonb.
--
--   admin_tasker_list(search, filter, offset)         read   taskers.view      25 per page, counts for the filter buttons
--   admin_tasker_get(id)                              read   taskers.view      profile; the money tab only with payouts.view
--   admin_tasker_reveal(id, field, reason)            read   pii.reveal        real email / WhatsApp / phone, reason required, logged (value NOT logged)
--   admin_tasker_account_check(id, action, reason)    read   taskers.suspend   can this login be suspended / restored? (called by the Edge Function)
--   admin_tasker_account_record(id, action, reason)   write  taskers.suspend   writes the flag and the audit row (called by the Edge Function)
--
-- A "Regular Tasker" here is a users row whose role is 'tasker' or whose roles contain 'tasker' AND that has NO local_tasker_profiles row.
-- (Local Taskers also get a users row with role 'tasker'; before this fix they leaked into this list.) Local Taskers have their own screen (A10).
-- Suspension only BLOCKS THE LOGIN (Edge Function admin-account-action, now with target "tasker") and RECORDS it. It does NOT hide the public
-- profile or services (hiding a service is stage A14), does not touch services, wallets, withdrawals, bookings, disputes, reviews or refunds.
-- NEVER written here: rating, wallet, commission, verification, membership. NEVER returned: street address, bank account number (last 4 only),
-- identity number, identity document result text, bio, profile_details, coordinates, message text of applications, wallet notes and references.
-- ============================================================================
do $pre$
begin
  if to_regprocedure('public.admin_has(text)') is null or to_regprocedure('public.admin_log(text,text,text,jsonb,jsonb,text,uuid,text,jsonb)') is null
     or to_regprocedure('public.admin_guard(text,text)') is null then
    raise exception 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
  end if;
  if to_regclass('public.admin_account_flags') is null then
    raise exception 'NOT DONE: stage A7 (admin_account_flags) is not installed. Run a7-customers.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.users') is null or to_regclass('public.taskers') is null or to_regclass('public.services') is null then
    raise exception 'NOT DONE: the users, taskers or services table is missing. Nothing was changed.';
  end if;
end
$pre$;

-- 1. Helpers (no browser access) -----------------------------------------------------------------------------------------
create or replace function public._a8_is_tasker(p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $f$
  select exists (select 1 from public.users u where u.id = p_id and (u.role = 'tasker' or 'tasker' = any (coalesce(u.roles::text[], '{}'::text[])))
                 and not exists (select 1 from public.local_tasker_profiles lp where lp.tasker_user_id = u.id))
$f$;
create or replace function public._a8_mask_email(p text)
returns text language sql immutable as $f$
  select case when p is null or position('@' in p) < 2 then null else left(p, 1) || '***@' || split_part(p, '@', 2) end
$f$;
create or replace function public._a8_mask_phone(p text)
returns text language sql immutable as $f$
  select case when p is null or btrim(p) = '' then null else repeat('*', 6) || right(regexp_replace(p, '\D', '', 'g'), 3) end
$f$;
-- The membership label (PRO / PREMIUM) only, from the site's own function; any other shape or any failure = no label.
create or replace function public._a8_membership_label(p_id uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare v jsonb; e jsonb; s text;
begin
  begin
    v := public.membership_for_users(array[p_id]);
  exception when others then return null;
  end;
  if v is null then return null; end if;
  if jsonb_typeof(v) = 'object' then e := v -> p_id::text;
  elsif jsonb_typeof(v) = 'array' then
    select x into e from jsonb_array_elements(v) x where coalesce(x ->> 'user_id', x ->> 'id') = p_id::text limit 1;
  end if;
  if e is null then return null; end if;
  s := case jsonb_typeof(e) when 'string' then e #>> '{}' when 'object' then coalesce(e ->> 'membership_label', e ->> 'label') else null end;
  s := upper(btrim(coalesce(s, '')));
  return case when s in ('PRO', 'PREMIUM') then s else null end;
end $f$;
revoke all on function public._a8_is_tasker(uuid) from public, anon, authenticated;
revoke all on function public._a8_mask_email(text) from public, anon, authenticated;
revoke all on function public._a8_mask_phone(text) from public, anon, authenticated;
revoke all on function public._a8_membership_label(uuid) from public, anon, authenticated;

-- 2. Directory ------------------------------------------------------------------------------------------------------------
-- p_filter: all | active | suspended | verified | unverified | available | flagged | open_dispute (a dispute they opened that is not resolved)
create or replace function public.admin_tasker_list(p_search text default null, p_filter text default 'all', p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text; v_filter text := lower(coalesce(p_filter, 'all')); v_off int := greatest(coalesce(p_offset, 0), 0);
  v_out jsonb;
begin
  if not public.admin_has('taskers.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_filter not in ('all', 'active', 'suspended', 'verified', 'unverified', 'available', 'flagged', 'open_dispute') then v_filter := 'all'; end if;
  if v_search is not null then
    v_search := left(v_search, 80);
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with base as (
    select u.id, coalesce(nullif(btrim(u.name), ''), t.name) as name, u.created_at,
           t.category, t.service_name,
           coalesce(t.is_verified, false) or coalesce(u.is_verified, false) as verified,
           coalesce(t.available, false) as available,
           (select count(*) from public.services s where s.user_id = u.id) as services,
           (select count(*) from public.bookings b where b.tasker_id = u.id) as bookings,
           exists (select 1 from public.admin_account_flags f where f.user_id = u.id and f.kind = 'suspended' and f.lifted_at is null) as suspended,
           coalesce(u.is_flagged, false) as flagged,
           exists (select 1 from public.job_disputes d where d.opened_by = u.id and d.resolved_at is null) as open_dispute,
           exists (select 1 from public.admin_users a where a.user_id = u.id) as is_admin,
           u.whatsapp
      from public.users u
      left join lateral (select x.* from public.taskers x where x.user_id = u.id::text order by x.created_at desc nulls last limit 1) t on true
     where (u.role = 'tasker' or 'tasker' = any (coalesce(u.roles::text[], '{}'::text[])))
       and not exists (select 1 from public.local_tasker_profiles lp where lp.tasker_user_id = u.id)   -- Local Taskers are a separate screen (A10)
  ), f as (
    select b.* from base b
     where (v_filter = 'all' or (v_filter = 'active' and not b.suspended) or (v_filter = 'suspended' and b.suspended)
            or (v_filter = 'verified' and b.verified) or (v_filter = 'unverified' and not b.verified)
            or (v_filter = 'available' and b.available) or (v_filter = 'flagged' and b.flagged) or (v_filter = 'open_dispute' and b.open_dispute))
       and (v_search is null or b.name ilike v_like or b.id::text = lower(v_search) or b.whatsapp ilike v_like or b.category ilike v_like
            or exists (select 1 from auth.users a where a.id = b.id and a.email ilike v_like))
  )
  select jsonb_build_object(
           'counts', (select jsonb_build_object('all', count(*), 'active', count(*) filter (where not suspended), 'suspended', count(*) filter (where suspended),
                                                 'verified', count(*) filter (where verified), 'unverified', count(*) filter (where not verified),
                                                 'available', count(*) filter (where available), 'flagged', count(*) filter (where flagged),
                                                 'open_dispute', count(*) filter (where open_dispute)) from base),
           'total', (select count(*) from f),
           'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'joined', t.created_at, 'category', t.category, 'services', t.services,
                       'bookings', t.bookings, 'status', case when t.suspended then 'suspended' else 'active' end, 'verified', t.verified, 'available', t.available,
                       'flagged', t.flagged, 'open_dispute', t.open_dispute, 'is_admin', t.is_admin) order by t.created_at desc nulls last, t.id), '[]'::jsonb)
                       from (select * from f order by created_at desc nulls last, id offset v_off limit 25) t))
    into v_out;

  return jsonb_build_object('ok', true, 'items', v_out -> 'items', 'total', (v_out ->> 'total')::bigint, 'offset', v_off, 'limit', 25, 'counts', v_out -> 'counts');
end $$;

-- 3. Profile --------------------------------------------------------------------------------------------------------------
create or replace function public.admin_tasker_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u public.users; t public.taskers; v_email text; v_flag public.admin_account_flags; v_money boolean := public.admin_has('payouts.view');
  v_services jsonb; v_takedowns jsonb; v_apps jsonb; v_app_counts jsonb; v_bookings jsonb; v_btotal bigint; v_bopen bigint; v_rev jsonb; v_revlist jsonb;
  v_idv jsonb; v_sub jsonb; v_hist jsonb; v_wallet jsonb := null; v_wtx jsonb := null; v_wd jsonb := null; v_wdc jsonb := null; v_banks jsonb := null; v_disp jsonb;
begin
  if not public.admin_has('taskers.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if p_id is null or not public._a8_is_tasker(p_id) then return jsonb_build_object('ok', false, 'error', 'That Tasker was not found.'); end if;
  select * into u from public.users x where x.id = p_id;
  select * into t from public.taskers x where x.user_id = p_id::text order by x.created_at desc nulls last limit 1;
  select a.email into v_email from auth.users a where a.id = p_id;
  select * into v_flag from public.admin_account_flags f where f.user_id = p_id and f.kind = 'suspended' and f.lifted_at is null;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.service_name, 'category', s.category, 'price', s.price, 'rate_unit', s.rate_unit, 'location', s.location,
           'listing_status', s.listing_status, 'available', s.available, 'verified', s.verified, 'is_main', s.is_main, 'rating', s.rating, 'reviews_count', s.reviews_count,
           'created_at', s.created_at) order by s.is_main desc nulls last, s.created_at desc), '[]'::jsonb)
    into v_services from public.services s where s.user_id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('entity', d.entity, 'reason', d.reason, 'taken_at', d.taken_at, 'restored_at', d.restored_at) order by d.taken_at desc), '[]'::jsonb)
    into v_takedowns from (select * from public.idv_takedowns x where x.user_id = p_id order by x.taken_at desc limit 10) d;

  select coalesce(jsonb_object_agg(coalesce(s.status, 'none'), s.n), '{}'::jsonb) into v_app_counts
    from (select a.status, count(*) n from public.task_applications a where a.tasker_id = p_id group by a.status) s;
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'status', a.status, 'created_at', a.created_at, 'task_title', (select k.title from public.tasks k where k.id = a.task_id),
           'task_status', (select k.status from public.tasks k where k.id = a.task_id)) order by a.created_at desc), '[]'::jsonb)
    into v_apps from (select * from public.task_applications x where x.tasker_id = p_id order by x.created_at desc limit 20) a;

  select count(*), count(*) filter (where b.status::text in ('pending', 'confirmed')) into v_btotal, v_bopen from public.bookings b where b.tasker_id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'title', b.job_title, 'status', b.status, 'payment_status', b.payment_status, 'amount', b.amount,
           'created_at', b.created_at, 'customer', (select c.name from public.users c where c.id = b.customer_id)) order by b.created_at desc), '[]'::jsonb)
    into v_bookings from (select * from public.bookings x where x.tasker_id = p_id order by x.created_at desc limit 25) b;

  select jsonb_build_object('count', count(*), 'avg', round(avg(r.rating)::numeric, 2),
           'by_rating', coalesce((select jsonb_object_agg(g.rating::text, g.n) from (select y.rating, count(*) n from public.reviews y where y.reviewee_id = p_id group by y.rating) g), '{}'::jsonb))
    into v_rev from public.reviews r where r.reviewee_id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'rating', r.rating, 'comment', left(r.comment, 300), 'created_at', r.created_at, 'reviewer', (select c.name from public.users c where c.id = r.reviewer_id)) order by r.created_at desc), '[]'::jsonb)
    into v_revlist from (select * from public.reviews x where x.reviewee_id = p_id order by x.created_at desc limit 10) r;

  select coalesce(jsonb_agg(jsonb_build_object('status', i.status, 'provider_status', i.provider_status, 'reason_codes', to_jsonb(i.status_reason_codes), 'liveness_ok', i.liveness_ok,
           'face_match_ok', i.face_match_ok, 'document_ok', i.document_ok, 'started', i.created_at, 'completed_at', i.completed_at) order by i.created_at desc), '[]'::jsonb)
    into v_idv from (select * from public.identity_verifications x where x.user_id = p_id and x.subject_kind = 'tasker_regular' order by x.created_at desc limit 5) i;

  select jsonb_build_object('plan', s.plan, 'tier', s.tier, 'status', s.status, 'period_start', s.current_period_start, 'period_end', s.current_period_end,
           'cancel_at_period_end', s.cancel_at_period_end, 'pending_plan', s.pending_plan) into v_sub
    from public.subscriptions s where s.user_id = p_id order by s.created_at desc nulls last limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'reason', f.reason, 'since', f.created_at, 'by', (select ad.display_name from public.admin_users ad where ad.user_id = f.created_by),
           'lifted_at', f.lifted_at, 'lift_reason', f.lift_reason, 'lifted_by', (select ad.display_name from public.admin_users ad where ad.user_id = f.lifted_by)) order by f.created_at desc), '[]'::jsonb)
    into v_hist from (select * from public.admin_account_flags x where x.user_id = p_id order by x.created_at desc limit 20) f;

  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'category', d.category, 'status', d.status, 'outcome', d.outcome, 'opened_at', d.opened_at, 'resolved_at', d.resolved_at) order by d.opened_at desc), '[]'::jsonb)
    into v_disp from (select * from public.job_disputes x where x.opened_by = p_id order by x.opened_at desc limit 20) d;

  if v_money then
    select jsonb_build_object('balance', w.balance, 'pending_balance', w.pending_balance, 'updated_at', w.updated_at) into v_wallet from public.wallets w where w.user_id = p_id limit 1;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'type', x.type, 'amount', x.amount, 'status', x.status, 'created_at', x.created_at, 'booking_id', x.booking_id) order by x.created_at desc), '[]'::jsonb)
      into v_wtx from (select * from public.wallet_transactions y where y.user_id = p_id order by y.created_at desc limit 20) x;
    select coalesce(jsonb_object_agg(coalesce(s.status, 'none'), jsonb_build_object('count', s.n, 'amount', s.amt)), '{}'::jsonb) into v_wdc
      from (select status, count(*) n, coalesce(sum(amount), 0) amt from public.withdrawals where user_id = p_id group by status) s;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'status', x.status, 'amount', x.amount, 'fee', x.fee, 'net_amount', x.net_amount, 'bank_name', x.bank_name,
             'account_last4', x.account_last4, 'failure_reason', x.failure_reason, 'created_at', x.created_at, 'settled_at', x.settled_at) order by x.created_at desc), '[]'::jsonb)
      into v_wd from (select * from public.withdrawals y where y.user_id = p_id order by y.created_at desc limit 20) x;
    select coalesce(jsonb_agg(jsonb_build_object('bank_name', x.bank_name, 'account_last4', x.account_last4, 'is_default', x.is_default, 'verified_at', x.verified_at, 'removed_at', x.removed_at) order by x.created_at desc), '[]'::jsonb)
      into v_banks from (select * from public.withdrawal_bank_accounts y where y.user_id = p_id order by y.created_at desc limit 5) x;
  end if;

  return jsonb_build_object('ok', true,
    'account', jsonb_build_object('id', u.id, 'name', coalesce(nullif(btrim(u.name), ''), t.name), 'business_name', coalesce(t.business_name, u.business_name), 'joined', u.created_at, 'location', u.location,
                                  'roles', to_jsonb(coalesce(u.roles::text[], array[u.role::text])), 'verified', coalesce(t.is_verified, false) or coalesce(u.is_verified, false),
                                  'verified_at', coalesce(t.verified_at, u.verified_at), 'flagged', coalesce(u.is_flagged, false), 'flagged_reason', u.flagged_reason,
                                  'contact_violations', coalesce(u.contact_violations, 0), 'available', coalesce(t.available, false), 'availability_status', t.availability_status,
                                  'category', t.category, 'has_tasker_row', t.id is not null,
                                  'is_admin', exists (select 1 from public.admin_users a where a.user_id = p_id),
                                  'is_customer', (u.role = 'customer' or 'customer' = any (coalesce(u.roles::text[], '{}'::text[]))),
                                  'is_coordinator', exists (select 1 from public.coordinators c where c.user_id = p_id)),
    'contact', jsonb_build_object('email', public._a8_mask_email(v_email), 'whatsapp', public._a8_mask_phone(coalesce(u.whatsapp, t.whatsapp)), 'phone', public._a8_mask_phone(t.phone),
                                  'has_email', v_email is not null, 'has_whatsapp', nullif(btrim(coalesce(u.whatsapp, t.whatsapp, '')), '') is not null, 'has_phone', nullif(btrim(coalesce(t.phone, '')), '') is not null),
    'status', case when v_flag.id is null then 'active' else 'suspended' end,
    'suspension', case when v_flag.id is null then null else jsonb_build_object('reason', v_flag.reason, 'since', v_flag.created_at) end,
    'restrictions', v_hist,
    'services', v_services, 'takedowns', v_takedowns,
    'applications', v_apps, 'application_counts', v_app_counts,
    'bookings', v_bookings, 'bookings_total', v_btotal, 'bookings_open', v_bopen,
    'reviews', coalesce(v_rev, jsonb_build_object('count', 0, 'avg', null, 'by_rating', '{}'::jsonb)), 'review_list', v_revlist,
    'verification', v_idv,
    'plan', jsonb_build_object('label', public._a8_membership_label(p_id), 'subscription', v_sub),
    'disputes', v_disp,
    'money', case when v_money then jsonb_build_object('wallet', v_wallet, 'transactions', v_wtx, 'withdrawals', v_wd, 'withdrawal_counts', v_wdc, 'bank_accounts', v_banks,
                                                       'platform_fee_rate', public.platform_fee_rate()) else null end,
    'money_allowed', v_money);
end $$;

-- 4. Reveal one contact value (logged) -----------------------------------------------------------------------------------------
create or replace function public.admin_tasker_reveal(p_id uuid, p_field text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_val text; v_field text := lower(coalesce(p_field, '')); v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.admin_guard('pii.reveal', 'admin.tasker.reveal') then return jsonb_build_object('ok', false, 'error', 'You do not have permission to reveal contact details.'); end if;
  if v_field not in ('email', 'whatsapp', 'phone') then return jsonb_build_object('ok', false, 'error', 'Choose email, WhatsApp or phone.'); end if;
  if char_length(v_reason) < 10 or char_length(v_reason) > 300 then return jsonb_build_object('ok', false, 'error', 'Write a reason of at least 10 characters.'); end if;
  if p_id is null or not public._a8_is_tasker(p_id) then return jsonb_build_object('ok', false, 'error', 'That Tasker was not found.'); end if;
  if v_field = 'email' then select a.email into v_val from auth.users a where a.id = p_id;
  elsif v_field = 'whatsapp' then
    select coalesce(nullif(btrim(x.whatsapp), ''), (select nullif(btrim(t.whatsapp), '') from public.taskers t where t.user_id = p_id::text order by t.created_at desc nulls last limit 1)) into v_val from public.users x where x.id = p_id;
  else select nullif(btrim(t.phone), '') into v_val from public.taskers t where t.user_id = p_id::text order by t.created_at desc nulls last limit 1; end if;
  if nullif(btrim(coalesce(v_val, '')), '') is null then return jsonb_build_object('ok', false, 'error', 'This Tasker has no ' || v_field || ' on file.'); end if;
  perform public.admin_log('admin.tasker.reveal', 'user', p_id::text, null, null, v_reason, null, 'ok', jsonb_build_object('field', v_field));
  return jsonb_build_object('ok', true, 'value', v_val);
end $$;

-- 5. Suspend / restore: check, then record (the Edge Function bans or unbans in between) ---------------------------------------------
create or replace function public.admin_tasker_account_check(p_id uuid, p_action text, p_reason text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_act text := lower(coalesce(p_action, '')); v_active boolean; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.admin_has('taskers.suspend') then return jsonb_build_object('ok', false, 'error', 'You do not have permission to suspend or restore Taskers.'); end if;
  if v_act not in ('suspend', 'restore') then return jsonb_build_object('ok', false, 'error', 'Unknown action.'); end if;
  if char_length(v_reason) < 10 or char_length(v_reason) > 300 then return jsonb_build_object('ok', false, 'error', 'Write a reason of at least 10 characters.'); end if;
  if p_id is null or not public._a8_is_tasker(p_id) then return jsonb_build_object('ok', false, 'error', 'That Tasker was not found.'); end if;
  if p_id = auth.uid() then return jsonb_build_object('ok', false, 'error', 'You cannot suspend or restore your own account.'); end if;
  if exists (select 1 from public.admin_users a where a.user_id = p_id) then return jsonb_build_object('ok', false, 'error', 'This login is an admin. Admins are managed on the Admin team page.'); end if;
  if exists (select 1 from public.coordinators c where c.user_id = p_id) then return jsonb_build_object('ok', false, 'error', 'This login is a coordinator. Coordinators are managed on the Coordinators page.'); end if;
  v_active := exists (select 1 from public.admin_account_flags f where f.user_id = p_id and f.kind = 'suspended' and f.lifted_at is null);
  if v_act = 'suspend' and v_active then return jsonb_build_object('ok', false, 'error', 'This Tasker is already suspended.'); end if;
  if v_act = 'restore' and not v_active then return jsonb_build_object('ok', false, 'error', 'This Tasker is not suspended.'); end if;
  return jsonb_build_object('ok', true, 'action', v_act);
end $$;

create or replace function public.admin_tasker_account_record(p_id uuid, p_action text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb; v_act text := lower(coalesce(p_action, '')); v_reason text := btrim(coalesce(p_reason, '')); v_msg text := null;
begin
  if not public.admin_guard('taskers.suspend', 'admin.tasker.' || v_act) then return jsonb_build_object('ok', false, 'error', 'You do not have permission to suspend or restore Taskers.'); end if;
  v := public.admin_tasker_account_check(p_id, v_act, v_reason);
  if not coalesce((v ->> 'ok')::boolean, false) then
    perform public.admin_log('admin.tasker.' || v_act, 'user', coalesce(p_id::text, ''), null, null, v_reason, null, 'refused', jsonb_build_object('error', v ->> 'error'));
    return v;
  end if;
  begin
    if v_act = 'suspend' then
      insert into public.admin_account_flags (user_id, kind, reason, created_by) values (p_id, 'suspended', v_reason, auth.uid());
    else
      update public.admin_account_flags set lifted_by = auth.uid(), lifted_at = now(), lift_reason = v_reason
       where user_id = p_id and kind = 'suspended' and lifted_at is null;
    end if;
    perform public.admin_log(case when v_act = 'suspend' then 'admin.tasker.suspended' else 'admin.tasker.restored' end, 'user', p_id::text,
                             jsonb_build_object('status', case when v_act = 'suspend' then 'active' else 'suspended' end),
                             jsonb_build_object('status', case when v_act = 'suspend' then 'suspended' else 'active' end), v_reason, null, 'ok', null);
  exception when others then v_msg := sqlerrm;
  end;
  if v_msg is not null then return jsonb_build_object('ok', false, 'error', 'Could not record the change: ' || v_msg); end if;
  return jsonb_build_object('ok', true);
end $$;

-- 6. Who may run what -------------------------------------------------------------------------------------------------------------
revoke all on function public.admin_tasker_list(text, text, int)            from public, anon, authenticated;
revoke all on function public.admin_tasker_get(uuid)                         from public, anon, authenticated;
revoke all on function public.admin_tasker_reveal(uuid, text, text)          from public, anon, authenticated;
revoke all on function public.admin_tasker_account_check(uuid, text, text)   from public, anon, authenticated;
revoke all on function public.admin_tasker_account_record(uuid, text, text)  from public, anon, authenticated;
grant execute on function public.admin_tasker_list(text, text, int)           to authenticated;
grant execute on function public.admin_tasker_get(uuid)                       to authenticated;
grant execute on function public.admin_tasker_reveal(uuid, text, text)        to authenticated;
grant execute on function public.admin_tasker_account_check(uuid, text, text) to authenticated;
grant execute on function public.admin_tasker_account_record(uuid, text, text) to authenticated;

select case
  when to_regprocedure('public.admin_tasker_list(text,text,integer)') is not null
   and to_regprocedure('public.admin_tasker_get(uuid)') is not null
   and to_regprocedure('public.admin_tasker_reveal(uuid,text,text)') is not null
   and to_regprocedure('public.admin_tasker_account_check(uuid,text,text)') is not null
   and to_regprocedure('public.admin_tasker_account_record(uuid,text,text)') is not null
  then 'DONE: A8 installed. Next: redeploy the admin-account-action function (see handoffs/A8.md).'
  else 'NOT DONE: see the messages above.'
end as a8_result;

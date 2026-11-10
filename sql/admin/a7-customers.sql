-- ============================================================================
-- StreetTasker Admin Control Centre, stage A7: CUSTOMERS (spec S04).
-- ADDITIVE and safe to run twice. ONE new table (admin_account_flags) and functions. NO column, trigger, policy or function on users,
-- bookings, reviews, job_disputes or any site table is touched (the users guard triggers make that risky, see A0).
-- Rollback: a7-rollback.sql. Needs a1-admin-core.sql. Column names below are the REAL ones from the owner's schema check of 2026-11-09
-- (a7-introspect.sql): users has NO email or phone column (email is read from auth.users; whatsapp is on users).
--
--   admin_customer_list(search, filter, offset)     read   customers.view   25 per page, counts for the filter buttons
--   admin_customer_get(id)                          read   customers.view   profile: masked contact, history, payments summary, reviews, disputes
--   admin_customer_reveal(id, field, reason)        read   pii.reveal       the real email or whatsapp, reason required, logged (the value is NOT logged)
--   admin_customer_account_check(id, action, reason)  read customers.suspend   can this account be suspended / restored? (called by the Edge Function)
--   admin_customer_account_record(id, action, reason) write customers.suspend  writes the flag and the audit row (called by the Edge Function)
--
-- Suspension: this SQL only RECORDS it. The Edge Function admin-account-action also BLOCKS the login in Supabase Auth (ban), in this order:
-- check, ban/unban, record. A suspension never deletes or hides bookings, disputes or reviews, and does not touch refunds.
-- A "customer" here is a users row whose role is 'customer' or whose roles contain 'customer'.
-- Who can be suspended here: not an admin, not a coordinator, not a Regular Tasker (those have their own screens), not yourself.
-- Never returned: street address, date of birth, bio, profile_details, coordinates, dispute text, booking notes.
-- ============================================================================
do $pre$
begin
  if to_regprocedure('public.admin_has(text)') is null or to_regprocedure('public.admin_log(text,text,text,jsonb,jsonb,text,uuid,text,jsonb)') is null then
    raise exception 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
  end if;
  if to_regclass('public.users') is null or to_regclass('public.bookings') is null then
    raise exception 'NOT DONE: the users or bookings table is missing. Nothing was changed.';
  end if;
end
$pre$;

-- 1. The suspension record ---------------------------------------------------------------------------------------------
create table if not exists public.admin_account_flags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  kind        text not null default 'suspended' check (kind in ('suspended')),
  reason      text not null check (char_length(reason) between 10 and 300),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  lifted_by   uuid,
  lifted_at   timestamptz,
  lift_reason text check (lift_reason is null or char_length(lift_reason) between 10 and 300)
);
create unique index if not exists admin_account_flags_one_active on public.admin_account_flags (user_id) where kind = 'suspended' and lifted_at is null;
create index if not exists admin_account_flags_user on public.admin_account_flags (user_id, created_at desc);
alter table public.admin_account_flags enable row level security;
revoke all on table public.admin_account_flags from public, anon, authenticated;

-- 2. Helpers (no browser access) -----------------------------------------------------------------------------------------
create or replace function public._a7_is_customer(p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $f$
  select exists (select 1 from public.users u where u.id = p_id and (u.role = 'customer' or 'customer' = any (coalesce(u.roles::text[], '{}'::text[]))))
$f$;
create or replace function public._a7_mask_email(p text)
returns text language sql immutable as $f$
  select case when p is null or position('@' in p) < 2 then null else left(p, 1) || '***@' || split_part(p, '@', 2) end
$f$;
create or replace function public._a7_mask_phone(p text)
returns text language sql immutable as $f$
  select case when p is null or btrim(p) = '' then null else repeat('*', 6) || right(regexp_replace(p, '\D', '', 'g'), 3) end
$f$;
revoke all on function public._a7_is_customer(uuid) from public, anon, authenticated;
revoke all on function public._a7_mask_email(text) from public, anon, authenticated;
revoke all on function public._a7_mask_phone(text) from public, anon, authenticated;

-- 3. Directory ------------------------------------------------------------------------------------------------------------
-- p_filter: all | active | suspended | flagged (flagged by the site's own trust flag) | open_dispute (has a dispute they opened that is not resolved)
create or replace function public.admin_customer_list(p_search text default null, p_filter text default 'all', p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text; v_filter text := lower(coalesce(p_filter, 'all')); v_off int := greatest(coalesce(p_offset, 0), 0);
  v_out jsonb;
begin
  if not public.admin_has('customers.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_filter not in ('all', 'active', 'suspended', 'flagged', 'open_dispute') then v_filter := 'all'; end if;
  if v_search is not null then
    v_search := left(v_search, 80);
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with base as (
    select u.id, u.name, u.created_at,
           (select count(*) from public.bookings b where b.customer_id = u.id) as bookings,
           exists (select 1 from public.admin_account_flags f where f.user_id = u.id and f.kind = 'suspended' and f.lifted_at is null) as suspended,
           coalesce(u.is_flagged, false) as flagged,
           exists (select 1 from public.job_disputes d where d.opened_by = u.id and d.resolved_at is null) as open_dispute,
           exists (select 1 from public.admin_users a where a.user_id = u.id) as is_admin,
           (u.role = 'tasker' or 'tasker' = any (coalesce(u.roles::text[], '{}'::text[]))) as is_tasker,
           u.whatsapp
      from public.users u
     where (u.role = 'customer' or 'customer' = any (coalesce(u.roles::text[], '{}'::text[])))
  ), f as (
    select b.* from base b
     where (v_filter = 'all' or (v_filter = 'active' and not b.suspended) or (v_filter = 'suspended' and b.suspended)
            or (v_filter = 'flagged' and b.flagged) or (v_filter = 'open_dispute' and b.open_dispute))
       and (v_search is null or b.name ilike v_like or b.id::text = lower(v_search) or b.whatsapp ilike v_like
            or exists (select 1 from auth.users a where a.id = b.id and a.email ilike v_like))
  )
  select jsonb_build_object(
           'counts', (select jsonb_build_object('all', count(*), 'active', count(*) filter (where not suspended), 'suspended', count(*) filter (where suspended),
                                                 'flagged', count(*) filter (where flagged), 'open_dispute', count(*) filter (where open_dispute)) from base),
           'total', (select count(*) from f),
           'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'joined', t.created_at, 'bookings', t.bookings,
                       'status', case when t.suspended then 'suspended' else 'active' end, 'flagged', t.flagged, 'open_dispute', t.open_dispute,
                       'is_admin', t.is_admin, 'is_tasker', t.is_tasker) order by t.created_at desc nulls last, t.id), '[]'::jsonb)
                       from (select * from f order by created_at desc nulls last, id offset v_off limit 25) t))
    into v_out;

  return jsonb_build_object('ok', true, 'items', v_out -> 'items', 'total', (v_out ->> 'total')::bigint, 'offset', v_off, 'limit', 25, 'counts', v_out -> 'counts');
end $$;

-- 4. Profile --------------------------------------------------------------------------------------------------------------
create or replace function public.admin_customer_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u public.users; v_email text; v_flag public.admin_account_flags;
  v_bookings jsonb; v_btotal bigint; v_pay jsonb; v_hist jsonb; v_rev jsonb; v_disp jsonb; v_gift jsonb;
begin
  if not public.admin_has('customers.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if p_id is null or not public._a7_is_customer(p_id) then return jsonb_build_object('ok', false, 'error', 'That customer was not found.'); end if;
  select * into u from public.users x where x.id = p_id;
  select a.email into v_email from auth.users a where a.id = p_id;
  select * into v_flag from public.admin_account_flags f where f.user_id = p_id and f.kind = 'suspended' and f.lifted_at is null;

  select count(*) into v_btotal from public.bookings b where b.customer_id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.job_title, 'status', t.status, 'payment_status', t.payment_status, 'amount', t.amount,
           'created_at', t.created_at, 'worker', (select w.name from public.users w where w.id = t.tasker_id)) order by t.created_at desc), '[]'::jsonb)
    into v_bookings from (select * from public.bookings b where b.customer_id = p_id order by b.created_at desc limit 25) t;
  select coalesce(jsonb_object_agg(coalesce(s.payment_status, 'none'), jsonb_build_object('count', s.n, 'amount', s.amt)), '{}'::jsonb)
    into v_pay from (select b.payment_status, count(*) n, coalesce(sum(b.amount), 0) amt from public.bookings b where b.customer_id = p_id group by b.payment_status) s;

  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'reason', f.reason, 'since', f.created_at, 'by', (select ad.display_name from public.admin_users ad where ad.user_id = f.created_by),
           'lifted_at', f.lifted_at, 'lift_reason', f.lift_reason, 'lifted_by', (select ad.display_name from public.admin_users ad where ad.user_id = f.lifted_by)) order by f.created_at desc), '[]'::jsonb)
    into v_hist from (select * from public.admin_account_flags x where x.user_id = p_id order by x.created_at desc limit 20) f;

  select jsonb_build_object(
           'given_count', (select count(*) from public.reviews r where r.reviewer_id = p_id),
           'given_avg', (select round(avg(r.rating)::numeric, 2) from public.reviews r where r.reviewer_id = p_id),
           'received_count', (select count(*) from public.reviews r where r.reviewee_id = p_id),
           'received_avg', (select round(avg(r.rating)::numeric, 2) from public.reviews r where r.reviewee_id = p_id)) into v_rev;

  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'category', d.category, 'status', d.status, 'outcome', d.outcome, 'opened_at', d.opened_at, 'resolved_at', d.resolved_at)
           order by d.opened_at desc), '[]'::jsonb)
    into v_disp from (select * from public.job_disputes x where x.opened_by = p_id order by x.opened_at desc limit 20) d;

  select jsonb_build_object('redeemed_count', count(*), 'redeemed_amount', coalesce(sum(g.amount), 0)) into v_gift from public.gift_cards g where g.redeemed_by = p_id;

  return jsonb_build_object('ok', true,
    'account', jsonb_build_object('id', u.id, 'name', u.name, 'first_name', u.first_name, 'last_name', u.last_name, 'joined', u.created_at, 'location', u.location,
                                  'roles', to_jsonb(coalesce(u.roles::text[], array[u.role::text])), 'verified', coalesce(u.is_verified, false), 'verified_at', u.verified_at,
                                  'flagged', coalesce(u.is_flagged, false), 'flagged_reason', u.flagged_reason, 'contact_violations', coalesce(u.contact_violations, 0),
                                  'is_admin', exists (select 1 from public.admin_users a where a.user_id = p_id),
                                  'is_tasker', (u.role = 'tasker' or 'tasker' = any (coalesce(u.roles::text[], '{}'::text[]))),
                                  'is_coordinator', exists (select 1 from public.coordinators c where c.user_id = p_id)),
    'contact', jsonb_build_object('email', public._a7_mask_email(v_email), 'whatsapp', public._a7_mask_phone(u.whatsapp), 'has_email', v_email is not null, 'has_whatsapp', nullif(btrim(coalesce(u.whatsapp, '')), '') is not null),
    'status', case when v_flag.id is null then 'active' else 'suspended' end,
    'suspension', case when v_flag.id is null then null else jsonb_build_object('reason', v_flag.reason, 'since', v_flag.created_at) end,
    'restrictions', v_hist,
    'bookings', v_bookings, 'bookings_total', v_btotal, 'payments', v_pay, 'reviews', v_rev, 'disputes', v_disp, 'gift_cards', v_gift,
    'reports_note', 'The site has no general user-report table yet. The trust flag above is the one the site sets itself. Reports are added with the moderation stage.');
end $$;

-- 5. Reveal one contact value (logged) -----------------------------------------------------------------------------------------
create or replace function public.admin_customer_reveal(p_id uuid, p_field text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_val text; v_field text := lower(coalesce(p_field, '')); v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.admin_guard('pii.reveal', 'admin.customer.reveal') then return jsonb_build_object('ok', false, 'error', 'You do not have permission to reveal contact details.'); end if;
  if v_field not in ('email', 'whatsapp') then return jsonb_build_object('ok', false, 'error', 'Choose email or WhatsApp.'); end if;
  if char_length(v_reason) < 10 or char_length(v_reason) > 300 then return jsonb_build_object('ok', false, 'error', 'Write a reason of at least 10 characters.'); end if;
  if p_id is null or not public._a7_is_customer(p_id) then return jsonb_build_object('ok', false, 'error', 'That customer was not found.'); end if;
  if v_field = 'email' then select a.email into v_val from auth.users a where a.id = p_id;
  else select x.whatsapp into v_val from public.users x where x.id = p_id; end if;
  if nullif(btrim(coalesce(v_val, '')), '') is null then return jsonb_build_object('ok', false, 'error', 'This customer has no ' || v_field || ' on file.'); end if;
  perform public.admin_log('admin.customer.reveal', 'user', p_id::text, null, null, v_reason, null, 'ok', jsonb_build_object('field', v_field));
  return jsonb_build_object('ok', true, 'value', v_val);
end $$;

-- 6. Suspend / restore: check, then record (the Edge Function bans or unbans in between) ---------------------------------------------
create or replace function public.admin_customer_account_check(p_id uuid, p_action text, p_reason text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_act text := lower(coalesce(p_action, '')); v_active boolean; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.admin_has('customers.suspend') then return jsonb_build_object('ok', false, 'error', 'You do not have permission to suspend or restore customers.'); end if;
  if v_act not in ('suspend', 'restore') then return jsonb_build_object('ok', false, 'error', 'Unknown action.'); end if;
  if char_length(v_reason) < 10 or char_length(v_reason) > 300 then return jsonb_build_object('ok', false, 'error', 'Write a reason of at least 10 characters.'); end if;
  if p_id is null or not public._a7_is_customer(p_id) then return jsonb_build_object('ok', false, 'error', 'That customer was not found.'); end if;
  if p_id = auth.uid() then return jsonb_build_object('ok', false, 'error', 'You cannot suspend or restore your own account.'); end if;
  if exists (select 1 from public.admin_users a where a.user_id = p_id) then return jsonb_build_object('ok', false, 'error', 'This login is an admin. Admins are managed on the Admin team page.'); end if;
  if exists (select 1 from public.coordinators c where c.user_id = p_id) then return jsonb_build_object('ok', false, 'error', 'This login is a coordinator. Coordinators are managed on the Coordinators page.'); end if;
  if exists (select 1 from public.users u where u.id = p_id and (u.role = 'tasker' or 'tasker' = any (coalesce(u.roles::text[], '{}'::text[])))) then
    return jsonb_build_object('ok', false, 'error', 'This login is also a Tasker. A suspension here would block the whole login, so it is done from the Regular Taskers screen.');
  end if;
  v_active := exists (select 1 from public.admin_account_flags f where f.user_id = p_id and f.kind = 'suspended' and f.lifted_at is null);
  if v_act = 'suspend' and v_active then return jsonb_build_object('ok', false, 'error', 'This customer is already suspended.'); end if;
  if v_act = 'restore' and not v_active then return jsonb_build_object('ok', false, 'error', 'This customer is not suspended.'); end if;
  return jsonb_build_object('ok', true, 'action', v_act);
end $$;

create or replace function public.admin_customer_account_record(p_id uuid, p_action text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb; v_act text := lower(coalesce(p_action, '')); v_reason text := btrim(coalesce(p_reason, '')); v_msg text := null;
begin
  if not public.admin_guard('customers.suspend', 'admin.customer.' || v_act) then return jsonb_build_object('ok', false, 'error', 'You do not have permission to suspend or restore customers.'); end if;
  v := public.admin_customer_account_check(p_id, v_act, v_reason);
  if not coalesce((v ->> 'ok')::boolean, false) then
    perform public.admin_log('admin.customer.' || v_act, 'user', coalesce(p_id::text, ''), null, null, v_reason, null, 'refused', jsonb_build_object('error', v ->> 'error'));
    return v;
  end if;
  begin
    if v_act = 'suspend' then
      insert into public.admin_account_flags (user_id, kind, reason, created_by) values (p_id, 'suspended', v_reason, auth.uid());
    else
      update public.admin_account_flags set lifted_by = auth.uid(), lifted_at = now(), lift_reason = v_reason
       where user_id = p_id and kind = 'suspended' and lifted_at is null;
    end if;
    perform public.admin_log(case when v_act = 'suspend' then 'admin.customer.suspended' else 'admin.customer.restored' end, 'user', p_id::text,
                             jsonb_build_object('status', case when v_act = 'suspend' then 'active' else 'suspended' end),
                             jsonb_build_object('status', case when v_act = 'suspend' then 'suspended' else 'active' end), v_reason, null, 'ok', null);
  exception when others then v_msg := sqlerrm;
  end;
  if v_msg is not null then return jsonb_build_object('ok', false, 'error', 'Could not record the change: ' || v_msg); end if;
  return jsonb_build_object('ok', true);
end $$;

-- 7. Who may run what -------------------------------------------------------------------------------------------------------------
revoke all on function public.admin_customer_list(text, text, int)            from public, anon, authenticated;
revoke all on function public.admin_customer_get(uuid)                         from public, anon, authenticated;
revoke all on function public.admin_customer_reveal(uuid, text, text)          from public, anon, authenticated;
revoke all on function public.admin_customer_account_check(uuid, text, text)   from public, anon, authenticated;
revoke all on function public.admin_customer_account_record(uuid, text, text)  from public, anon, authenticated;
grant execute on function public.admin_customer_list(text, text, int)           to authenticated;
grant execute on function public.admin_customer_get(uuid)                       to authenticated;
grant execute on function public.admin_customer_reveal(uuid, text, text)        to authenticated;
grant execute on function public.admin_customer_account_check(uuid, text, text) to authenticated;
grant execute on function public.admin_customer_account_record(uuid, text, text) to authenticated;

select case
  when to_regclass('public.admin_account_flags') is not null
   and to_regprocedure('public.admin_customer_list(text,text,integer)') is not null
   and to_regprocedure('public.admin_customer_get(uuid)') is not null
   and to_regprocedure('public.admin_customer_reveal(uuid,text,text)') is not null
   and to_regprocedure('public.admin_customer_account_check(uuid,text,text)') is not null
   and to_regprocedure('public.admin_customer_account_record(uuid,text,text)') is not null
  then 'DONE: A7 installed. Next: deploy the admin-account-action function (see handoffs/A7.md).'
  else 'NOT DONE: see the messages above.'
end as a7_result;

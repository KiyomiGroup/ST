-- ============================================================================
-- StreetTasker Admin Control Centre, stage A1: admin identity and permissions.
-- ADDITIVE and safe to run twice. Changes no existing table, function or policy.
-- (It does not touch _is_support(), support_staff, or anything the site uses today.)
-- Run the whole file once in the Supabase SQL editor. Rollback: a1-rollback.sql.
--
-- What it creates (all names checked against the live database in A0 part B: none existed):
--   tables    admin_users, admin_roles, admin_permissions, admin_role_permissions,
--             admin_user_roles, admin_audit_log, admin_settings
--   functions admin_has, admin_require, admin_guard, admin_log, admin_my_access,
--             admin_bootstrap_super_admin, plus four trigger functions
--
-- Access model:
--   * No table below has any grant for anon or authenticated, and row level security is ON
--     with no policy, so the browser cannot read or write any of them directly.
--   * Only admin_has(text) and admin_my_access() may be called by a signed-in browser.
--     admin_require, admin_guard, admin_log and admin_bootstrap_super_admin cannot be called
--     from the browser at all: other admin_* functions (later stages) call them on the server.
--   * The audit log is append-only (a trigger refuses UPDATE, DELETE and TRUNCATE).
--   * The last active Super Admin cannot be removed, suspended or demoted (trigger).
-- ============================================================================

-- ---------- tables ----------------------------------------------------------

create table if not exists public.admin_users (
  user_id      uuid primary key references auth.users (id) on delete restrict,
  display_name text,
  status       text not null default 'active' check (status in ('active', 'suspended', 'removed')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  removed_at   timestamptz
);

create table if not exists public.admin_roles (
  key       text primary key check (key ~ '^[a-z][a-z_]{1,39}$'),
  label     text not null,
  is_system boolean not null default true
);

create table if not exists public.admin_permissions (
  key        text primary key check (key ~ '^[a-z][a-z_.]{1,59}$'),
  label      text not null,
  group_name text not null,
  sensitive  boolean not null default false
);

create table if not exists public.admin_role_permissions (
  role_key       text not null references public.admin_roles (key) on delete cascade,
  permission_key text not null references public.admin_permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

create table if not exists public.admin_user_roles (
  user_id    uuid not null references public.admin_users (user_id) on delete restrict,
  role_key   text not null references public.admin_roles (key) on delete restrict,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_key)
);

create table if not exists public.admin_audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_roles text[],
  action      text not null,
  target_type text,
  target_id   text,
  old_value   jsonb,
  new_value   jsonb,
  reason      text,
  approval_id uuid,
  outcome     text not null default 'ok' check (outcome in ('ok', 'refused', 'error')),
  detail      jsonb
);
create index if not exists admin_audit_log_at_idx on public.admin_audit_log (at desc);
create index if not exists admin_audit_log_actor_idx on public.admin_audit_log (actor_id, at desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log (target_type, target_id);

create table if not exists public.admin_settings (
  key        text primary key,
  text_value text,
  updated_at timestamptz not null default now()
);

-- Row level security ON everywhere, no policies, no browser grants.
alter table public.admin_users            enable row level security;
alter table public.admin_roles            enable row level security;
alter table public.admin_permissions      enable row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.admin_user_roles       enable row level security;
alter table public.admin_audit_log        enable row level security;
alter table public.admin_settings         enable row level security;

revoke all on table public.admin_users, public.admin_roles, public.admin_permissions,
  public.admin_role_permissions, public.admin_user_roles, public.admin_audit_log,
  public.admin_settings from public, anon, authenticated;
revoke all on sequence public.admin_audit_log_id_seq from public, anon, authenticated;
-- (only this new sequence: no other sequence in the project is touched)

-- ---------- trigger functions -----------------------------------------------

create or replace function public.admin_audit_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'The admin audit log cannot be changed or deleted.' using errcode = 'P0001';
end $$;

drop trigger if exists admin_audit_no_update on public.admin_audit_log;
create trigger admin_audit_no_update before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_immutable();
drop trigger if exists admin_audit_no_truncate on public.admin_audit_log;
create trigger admin_audit_no_truncate before truncate on public.admin_audit_log
  for each statement execute function public.admin_audit_immutable();

-- The last active Super Admin cannot be removed, suspended or demoted.
create or replace function public.admin_protect_last_super_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.role_key = 'super_admin'
     and exists (select 1 from public.admin_users u where u.user_id = old.user_id and u.status = 'active' and u.removed_at is null)
     and (tg_op = 'DELETE' or new.role_key is distinct from old.role_key or new.user_id is distinct from old.user_id)
     and not exists (
       select 1 from public.admin_user_roles r join public.admin_users u on u.user_id = r.user_id
        where r.role_key = 'super_admin' and r.user_id <> old.user_id
          and u.status = 'active' and u.removed_at is null) then
    raise exception 'The last active Super Admin cannot be removed or demoted. Appoint another Super Admin first.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists admin_user_roles_protect_last on public.admin_user_roles;
create trigger admin_user_roles_protect_last before update or delete on public.admin_user_roles
  for each row execute function public.admin_protect_last_super_role();

create or replace function public.admin_protect_last_super_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'active' and old.removed_at is null
     and exists (select 1 from public.admin_user_roles r where r.user_id = old.user_id and r.role_key = 'super_admin')
     and (tg_op = 'DELETE' or new.status <> 'active' or new.removed_at is not null)
     and not exists (
       select 1 from public.admin_user_roles r join public.admin_users u on u.user_id = r.user_id
        where r.role_key = 'super_admin' and r.user_id <> old.user_id
          and u.status = 'active' and u.removed_at is null) then
    raise exception 'The last active Super Admin cannot be removed or suspended. Appoint another Super Admin first.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists admin_users_protect_last on public.admin_users;
create trigger admin_users_protect_last before update or delete on public.admin_users
  for each row execute function public.admin_protect_last_super_user();

-- ---------- seed: roles, permissions, role to permission ---------------------

insert into public.admin_settings (key, text_value) values ('require_mfa', 'off')
  on conflict (key) do nothing;
-- 'off' on purpose: the owner switches it on after enrolling her own authenticator (D-A2).

insert into public.admin_roles (key, label) values
  ('super_admin', 'Super Admin'), ('operations', 'Operations Admin'), ('finance', 'Finance Admin'),
  ('verification', 'Verification Admin'), ('support', 'Support Admin'), ('content', 'Content Admin')
on conflict (key) do nothing;

insert into public.admin_permissions (key, label, group_name, sensitive) values
  ('customers.view','View customers','People',false), ('customers.edit','Edit customers (non-identity fields)','People',false),
  ('customers.suspend','Suspend or restore customers','People',true),
  ('taskers.view','View Taskers','People',false), ('taskers.manage','Manage Taskers','People',false),
  ('taskers.suspend','Suspend or restore Taskers','People',true),
  ('local_taskers.view','View Local Taskers','People',false), ('local_taskers.manage','Manage Local Taskers','People',true),
  ('coordinators.view','View coordinators','People',false), ('coordinators.manage','Manage coordinators','People',true),
  ('coordinators.assign','Assign Local Taskers to coordinators','People',true),
  ('coordinators.applications.review','Review coordinator applications','People',false),
  ('admin.team.view','View the admin team','Admin',false), ('admin.team.manage','Manage the admin team','Admin',true),
  ('admin.roles.manage','Manage admin roles','Admin',true),
  ('verification.view','View identity verification results','Verification',false),
  ('verification.review','Review identity verification cases','Verification',true),
  ('bookings.view','View bookings and tasks','Operations',false), ('bookings.manage','Manage bookings and tasks','Operations',true),
  ('local_bookings.reassign','Reassign a Local Tasker booking','Operations',true),
  ('local_bookings.unlock','Unlock a locked booking','Operations',true),
  ('disputes.view','View disputes','Disputes',false), ('disputes.manage','Handle and decide disputes','Disputes',true),
  ('disputes.refund.record','Record a refund (record only)','Disputes',true),
  ('reviews.moderate','Moderate reviews','Trust',false), ('listings.moderate','Hide or restore listings','Trust',true),
  ('community.moderate','Moderate community posts','Trust',false),
  ('trust.flags.view','View flagged users','Trust',false), ('trust.flags.manage','Decide on flagged users','Trust',true),
  ('transactions.view','View transactions','Finance',false), ('revenue.view','View revenue reports','Finance',false),
  ('payouts.view','View payouts','Finance',false), ('withdrawals.view','View withdrawals','Finance',false),
  ('giftcards.view','View gift cards','Finance',false), ('giftcards.manage','Manage gift cards','Finance',true),
  ('referrals.view','View referrals','Finance',false), ('donations.view','View donations','Finance',false),
  ('subscriptions.view','View subscriptions','Subscriptions',false), ('subscriptions.plans.edit','Edit subscription plans','Subscriptions',true),
  ('subscriptions.payments.view','View subscription payments','Subscriptions',false),
  ('subscriptions.revenue.view','View subscription revenue','Subscriptions',false),
  ('subscriptions.override','Override a subscription','Subscriptions',true),
  ('subscriptions.adjust','Adjust a subscription','Subscriptions',true),
  ('subscriptions.credits.grant','Grant offer credits','Subscriptions',true),
  ('subscriptions.review.resolve','Resolve a subscription review case','Subscriptions',true),
  ('coordinator_plans.view','View coordinator plans','Subscriptions',false),
  ('notifications.send','Send a notification','Content',false), ('notifications.broadcast','Send a broadcast','Content',true),
  ('content.manage','Manage website content','Content',false), ('analytics.view','View analytics','Reports',false),
  ('settings.view','View platform settings','Settings',false), ('settings.manage','Change platform settings','Settings',true),
  ('audit_logs.view','View the audit log','Admin',false),
  ('approvals.view','View approval requests','Approvals',false), ('approvals.request','Request an approval','Approvals',false),
  ('approvals.decide','Decide approval requests (Super Admin only)','Approvals',true),
  ('pii.reveal','Reveal masked personal data','Privacy',true), ('export.run','Export data','Reports',true)
on conflict (key) do nothing;

-- Role to permission. super_admin is not listed here: admin_has() gives it every permission that exists.
-- PROPOSED DEFAULTS (the owner reviews them; none is final):
insert into public.admin_role_permissions (role_key, permission_key)
select r.role_key, r.permission_key from (values
  ('operations','customers.view'),('operations','customers.edit'),('operations','customers.suspend'),
  ('operations','taskers.view'),('operations','taskers.manage'),('operations','taskers.suspend'),
  ('operations','local_taskers.view'),('operations','local_taskers.manage'),
  ('operations','coordinators.view'),('operations','coordinators.manage'),('operations','coordinators.assign'),
  ('operations','coordinators.applications.review'),
  ('operations','bookings.view'),('operations','bookings.manage'),('operations','local_bookings.reassign'),
  ('operations','local_bookings.unlock'),
  ('operations','listings.moderate'),('operations','community.moderate'),('operations','analytics.view'),
  ('finance','transactions.view'),('finance','revenue.view'),('finance','payouts.view'),('finance','withdrawals.view'),
  ('finance','giftcards.view'),('finance','referrals.view'),('finance','donations.view'),('finance','subscriptions.view'),
  ('finance','subscriptions.payments.view'),('finance','subscriptions.revenue.view'),
  ('finance','coordinator_plans.view'),('finance','export.run'),
  ('verification','verification.view'),('verification','verification.review'),
  ('verification','local_taskers.view'),('verification','coordinators.view'),
  ('support','disputes.view'),('support','disputes.manage'),('support','disputes.refund.record'),
  ('support','trust.flags.view'),('support','trust.flags.manage'),('support','reviews.moderate'),
  ('support','customers.view'),('support','taskers.view'),('support','bookings.view'),('support','pii.reveal'),
  ('content','content.manage'),('content','notifications.send'),
  ('content','listings.moderate'),('content','community.moderate')
) as r(role_key, permission_key)
on conflict do nothing;

-- every role may look at and ask for approvals
insert into public.admin_role_permissions (role_key, permission_key)
select r.key, p.key from public.admin_roles r cross join public.admin_permissions p
 where r.key <> 'super_admin' and p.key in ('approvals.view', 'approvals.request')
on conflict do nothing;

-- ---------- functions -------------------------------------------------------

-- True only for an ACTIVE admin who holds this permission (and who passed two-step verification
-- when admin_settings.require_mfa is 'on'). A permission name that does not exist is false for everyone.
create or replace function public.admin_has(p_perm text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or p_perm is null then return false; end if;
  if not exists (select 1 from public.admin_users u where u.user_id = v_uid and u.status = 'active' and u.removed_at is null) then
    return false;
  end if;
  if not exists (select 1 from public.admin_permissions p where p.key = p_perm) then return false; end if;
  if coalesce((select s.text_value from public.admin_settings s where s.key = 'require_mfa'), 'off') = 'on'
     and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    return false;
  end if;
  return exists (
    select 1 from public.admin_user_roles ur
     where ur.user_id = v_uid
       and (ur.role_key = 'super_admin'
            or exists (select 1 from public.admin_role_permissions rp
                        where rp.role_key = ur.role_key and rp.permission_key = p_perm)));
end $$;

-- Raises 42501 when the caller lacks the permission. A raised error undoes the whole call, so it
-- cannot leave a log row; use admin_guard where the refusal must be logged.
create or replace function public.admin_require(p_perm text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.admin_has(p_perm) then
    raise exception 'You do not have permission to do this.' using errcode = '42501';
  end if;
end $$;

-- The one internal write path to the audit log (called by other admin_* functions).
create or replace function public.admin_log(
  p_action text, p_target_type text default null, p_target_id text default null,
  p_old jsonb default null, p_new jsonb default null, p_reason text default null,
  p_approval uuid default null, p_outcome text default 'ok', p_detail jsonb default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  insert into public.admin_audit_log (actor_id, actor_roles, action, target_type, target_id,
                                      old_value, new_value, reason, approval_id, outcome, detail)
  values (auth.uid(),
          (select array_agg(ur.role_key order by ur.role_key) from public.admin_user_roles ur where ur.user_id = auth.uid()),
          p_action, p_target_type, p_target_id, p_old, p_new, p_reason, p_approval,
          coalesce(p_outcome, 'ok'), p_detail)
  returning id into v_id;
  return v_id;
end $$;

-- For functions that return {ok:false,...} instead of raising: true when allowed. When an ACTIVE admin
-- is refused, a 'refused' row is written (a person who is not an admin writes nothing, so strangers
-- cannot fill the log).
create or replace function public.admin_guard(p_perm text, p_action text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.admin_has(p_perm) then return true; end if;
  if auth.uid() is not null
     and exists (select 1 from public.admin_users u where u.user_id = auth.uid() and u.status = 'active' and u.removed_at is null) then
    perform public.admin_log(coalesce(p_action, 'permission_check'), null, null, null, null, null, null,
                             'refused', jsonb_build_object('permission', p_perm));
  end if;
  return false;
end $$;

-- What the admin pages need to draw the menu. Hiding a menu item is not security (every admin_*
-- function checks on the server); this only says what to show.
create or replace function public.admin_my_access()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_user public.admin_users; v_roles text[]; v_perms text[]; v_mfa_req boolean; v_mfa_ok boolean;
begin
  v_mfa_req := coalesce((select s.text_value from public.admin_settings s where s.key = 'require_mfa'), 'off') = 'on';
  v_mfa_ok  := (not v_mfa_req) or coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
  if v_uid is null then
    return jsonb_build_object('active', false, 'roles', '[]'::jsonb, 'permissions', '[]'::jsonb,
                              'mfa_required', v_mfa_req, 'mfa_ok', v_mfa_ok);
  end if;
  select * into v_user from public.admin_users u where u.user_id = v_uid and u.status = 'active' and u.removed_at is null;
  if not found then
    return jsonb_build_object('active', false, 'roles', '[]'::jsonb, 'permissions', '[]'::jsonb,
                              'mfa_required', v_mfa_req, 'mfa_ok', v_mfa_ok);
  end if;
  select coalesce(array_agg(ur.role_key order by ur.role_key), '{}') into v_roles
    from public.admin_user_roles ur where ur.user_id = v_uid;
  if not v_mfa_ok then
    v_perms := '{}';
  elsif 'super_admin' = any (v_roles) then
    select coalesce(array_agg(p.key order by p.key), '{}') into v_perms from public.admin_permissions p;
  else
    select coalesce(array_agg(distinct rp.permission_key order by rp.permission_key), '{}') into v_perms
      from public.admin_user_roles ur join public.admin_role_permissions rp on rp.role_key = ur.role_key
     where ur.user_id = v_uid;
  end if;
  return jsonb_build_object('active', true, 'display_name', v_user.display_name, 'roles', to_jsonb(v_roles),
                            'permissions', to_jsonb(v_perms), 'mfa_required', v_mfa_req, 'mfa_ok', v_mfa_ok);
end $$;

-- Creates (or re-activates) a Super Admin. SQL editor only: it cannot be called from the browser.
-- It also adds the same login to support_staff (which is EMPTY today) so that support.html and every
-- existing support_* function and is_local_tasker_admin() policy work for this login.
-- (an earlier version of this file made a 2-argument version; remove it so the 3-argument one is not ambiguous)
drop function if exists public.admin_bootstrap_super_admin(text, text);
create or replace function public.admin_bootstrap_super_admin(p_email text, p_display_name text default null, p_allow_coordinator boolean default false)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_warn text := ''; v_name text;
begin
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
  if v_id is null then
    return 'NOT DONE: no login with this email exists in Supabase Authentication. In the Supabase dashboard open Authentication, then Users, add this user with a strong password, and run this statement again.';
  end if;
  if exists (select 1 from public.coordinators c where c.user_id = v_id) then
    if not coalesce(p_allow_coordinator, false) then
      return 'NOT DONE: this login is a coordinator account. Safer: use a separate login for admin work. If you accept one login for both, run the statement again with true as the third value.';
    end if;
    v_warn := v_warn || ' WARNING: this login is also a coordinator. Admin and coordinator actions share one identity, so the admin area will refuse any admin action on this login''s own coordinator records (rule R-SELF).';
  end if;
  if exists (select 1 from public.users x where x.id = v_id) then
    v_warn := v_warn || ' WARNING: this login also has a customer or Tasker profile (a row in public.users). Prefer a login made only for admin work.';
  end if;
  v_name := coalesce(nullif(btrim(p_display_name), ''), 'Super Admin');

  insert into public.admin_users (user_id, display_name, status, created_by)
    values (v_id, v_name, 'active', null)
    on conflict (user_id) do update set status = 'active', removed_at = null, display_name = coalesce(public.admin_users.display_name, excluded.display_name);
  insert into public.admin_user_roles (user_id, role_key, granted_by) values (v_id, 'super_admin', null)
    on conflict do nothing;
  insert into public.support_staff (user_id, note, added_at) values (v_id, 'admin bootstrap (A1)', now())
    on conflict (user_id) do nothing;
  perform public.admin_log('admin.bootstrap', 'admin_user', v_id::text, null,
                           jsonb_build_object('role', 'super_admin', 'support_staff', true), null, null, 'ok',
                           jsonb_build_object('via', 'sql editor'));
  return 'DONE: this login is now an active Super Admin and a support staff member. Two-step verification is not required yet (admin_settings.require_mfa is off).' || v_warn;
end $$;

-- ---------- who may run what ------------------------------------------------

revoke all on function public.admin_has(text)                         from public, anon, authenticated;
revoke all on function public.admin_require(text)                     from public, anon, authenticated;
revoke all on function public.admin_log(text, text, text, jsonb, jsonb, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_guard(text, text)                 from public, anon, authenticated;
revoke all on function public.admin_my_access()                       from public, anon, authenticated;
revoke all on function public.admin_bootstrap_super_admin(text, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_audit_immutable()                 from public, anon, authenticated;
revoke all on function public.admin_protect_last_super_role()         from public, anon, authenticated;
revoke all on function public.admin_protect_last_super_user()         from public, anon, authenticated;

grant execute on function public.admin_has(text)  to authenticated;   -- answers only about the caller
grant execute on function public.admin_my_access() to authenticated;  -- answers only about the caller

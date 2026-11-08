-- ============================================================================
-- StreetTasker Admin Control Centre, stage A2: the shared approval system.
-- ADDITIVE and safe to run twice. Needs a1-admin-core.sql to have been run first.
-- Changes no existing table, function, policy or trigger.
--
-- Idea: a sensitive action (a price change, a subscription override, a role change...) is never done on one
-- person's say-so. One admin REQUESTS it; a DIFFERENT Super Admin APPROVES it; then the function that does the
-- real work CONSUMES the approval inside its own transaction. The server decides which actions are sensitive
-- (admin_sensitive_actions), never the page.
--
-- Creates: admin_sensitive_actions, admin_approval_requests, and functions
--   browser (signed-in admin):  admin_request_approval, admin_decide_approval, admin_cancel_approval
--   server only:                admin_consume_approval, admin_expire_approvals, admin_approval_hash,
--                               admin_user_has, trigger function admin_approval_guard
-- Browser access to the two tables: none (no grants, row level security on, no policy).
-- ============================================================================

do $$ begin
  if to_regclass('public.admin_users') is null or to_regprocedure('public.admin_log(text,text,text,jsonb,jsonb,text,uuid,text,jsonb)') is null then
    raise exception 'Run sql/admin/a1-admin-core.sql first (the admin tables and admin_log are missing).';
  end if;
end $$;

-- ---------- registry of sensitive actions (the SERVER'S list) ----------------

create table if not exists public.admin_sensitive_actions (
  action               text primary key check (action ~ '^[a-z][a-z0-9_.]{2,79}$'),
  permission_required  text not null references public.admin_permissions (key),
  risk                 text not null default 'high' check (risk in ('medium', 'high', 'critical')),
  expires_hours        integer not null default 72 check (expires_hours between 0 and 720),
  check_target_version boolean not null default true,
  notes                text
);
alter table public.admin_sensitive_actions enable row level security;
revoke all on table public.admin_sensitive_actions from public, anon, authenticated;

-- PROPOSED launch list (owner reviews). The permission is what the REQUESTER needs; approval always needs approvals.decide.
insert into public.admin_sensitive_actions (action, permission_required, risk, notes) values
  ('subscription.plan.price_change',  'subscriptions.plans.edit',     'critical', 'Plan price change'),
  ('subscription.addon.price_change', 'subscriptions.plans.edit',     'critical', 'Add-on price change'),
  ('coordinator.tier.price_change',   'settings.manage',              'critical', 'Coordinator tier price or capacity change'),
  ('subscription.override',           'subscriptions.override',       'high',     'Override a subscription'),
  ('subscription.adjust',             'subscriptions.adjust',         'high',     'Adjust a subscription'),
  ('subscription.credits.grant',      'subscriptions.credits.grant',  'high',     'Grant offer credits'),
  ('subscription.review.resolve',     'subscriptions.review.resolve', 'high',     'Resolve a payment-review case'),
  ('commission.change',               'settings.manage',              'critical', 'Commission split change'),
  ('fee.change',                      'settings.manage',              'critical', 'Platform fee change'),
  ('withdrawal.limits.change',        'settings.manage',              'critical', 'Withdrawal limits change'),
  ('admin.role.change',               'admin.roles.manage',           'critical', 'Change what a role may do'),
  ('admin.team.change',               'admin.team.manage',            'high',     'Add, remove or re-role an admin'),
  ('notification.broadcast',          'notifications.broadcast',      'high',     'Broadcast above the recipient threshold')
on conflict (action) do nothing;

-- ---------- approval requests -------------------------------------------------

create table if not exists public.admin_approval_requests (
  id               uuid primary key default gen_random_uuid(),
  action           text not null references public.admin_sensitive_actions (action),
  target_type      text not null check (btrim(target_type) <> ''),
  target_id        text not null check (btrim(target_id) <> ''),
  payload          jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  payload_hash     text not null,
  previous_value   jsonb,
  target_version   text,
  reason           text not null check (char_length(btrim(reason)) >= 10),
  risk             text not null,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'consumed', 'cancelled')),
  requested_by     uuid not null,
  requested_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  decided_by       uuid,
  decided_at       timestamptz,
  decision_reason  text,
  consumed_at      timestamptz,
  consumed_by      uuid,
  execution_result jsonb
);
create index if not exists admin_approval_requests_status_idx on public.admin_approval_requests (status, requested_at desc);
create index if not exists admin_approval_requests_target_idx on public.admin_approval_requests (target_type, target_id);
alter table public.admin_approval_requests enable row level security;
revoke all on table public.admin_approval_requests from public, anon, authenticated;

-- A request can never be edited into something else, deleted, or moved out of a finished state.
create or replace function public.admin_approval_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Approval requests cannot be deleted.' using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id or new.action is distinct from old.action or new.target_type is distinct from old.target_type
     or new.target_id is distinct from old.target_id or new.payload is distinct from old.payload
     or new.payload_hash is distinct from old.payload_hash or new.previous_value is distinct from old.previous_value
     or new.target_version is distinct from old.target_version or new.reason is distinct from old.reason
     or new.risk is distinct from old.risk or new.requested_by is distinct from old.requested_by
     or new.requested_at is distinct from old.requested_at or new.expires_at is distinct from old.expires_at then
    raise exception 'An approval request cannot be edited.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'pending'  and new.status in ('approved', 'rejected', 'expired', 'cancelled'))
         or (old.status = 'approved' and new.status in ('consumed', 'expired', 'cancelled'))) then
      raise exception 'An approval request cannot go from % to %.', old.status, new.status using errcode = 'P0001';
    end if;
  elsif old.status in ('rejected', 'expired', 'consumed', 'cancelled') then
    raise exception 'A finished approval request cannot be changed.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists admin_approval_requests_guard on public.admin_approval_requests;
create trigger admin_approval_requests_guard before update or delete on public.admin_approval_requests
  for each row execute function public.admin_approval_guard();

-- ---------- helpers (server only) --------------------------------------------

-- Does THIS user (not the caller) hold the permission now? Used to re-check an approver at consume time.
create or replace function public.admin_user_has(p_user uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_user is not null
     and exists (select 1 from public.admin_users u where u.user_id = p_user and u.status = 'active' and u.removed_at is null)
     and exists (select 1 from public.admin_permissions p where p.key = p_perm)
     and exists (select 1 from public.admin_user_roles ur
                  where ur.user_id = p_user
                    and (ur.role_key = 'super_admin'
                         or exists (select 1 from public.admin_role_permissions rp where rp.role_key = ur.role_key and rp.permission_key = p_perm)))
$$;

-- Fingerprint of exactly what was asked for: action + target + payload (jsonb text is key-order independent).
create or replace function public.admin_approval_hash(p_action text, p_target_type text, p_target_id text, p_payload jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
  select encode(sha256(convert_to(coalesce(p_action, '') || '|' || coalesce(p_target_type, '') || '|' || coalesce(p_target_id, '') || '|' || coalesce(p_payload, '{}'::jsonb)::text, 'UTF8')), 'hex')
$$;

-- ---------- request ------------------------------------------------------------

create or replace function public.admin_request_approval(
  p_action text, p_target_type text, p_target_id text, p_payload jsonb, p_reason text,
  p_previous jsonb default null, p_target_version text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_reg public.admin_sensitive_actions; v_hash text; v_id uuid; v_exp timestamptz; r record;
begin
  if not public.admin_has('approvals.request') then
    perform public.admin_guard('approvals.request', 'approval.request');
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to ask for an approval.');
  end if;
  select * into v_reg from public.admin_sensitive_actions a where a.action = p_action;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This action is not one that needs approval.');
  end if;
  if not public.admin_guard(v_reg.permission_required, 'approval.request') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to ask for this action.');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    return jsonb_build_object('ok', false, 'error', 'Give a reason of at least 10 characters.');
  end if;
  if btrim(coalesce(p_target_type, '')) = '' or btrim(coalesce(p_target_id, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'Say what the action is about.');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'The details of the change are missing.');
  end if;
  if v_reg.check_target_version and btrim(coalesce(p_target_version, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'The current state of the target is missing, so a later change cannot be detected.');
  end if;

  v_hash := public.admin_approval_hash(p_action, p_target_type, p_target_id, p_payload);
  select id into v_id from public.admin_approval_requests q
   where q.requested_by = v_uid and q.payload_hash = v_hash and q.status in ('pending', 'approved') and q.expires_at > now() limit 1;
  if v_id is not null then
    return jsonb_build_object('ok', false, 'error', 'The same request is already waiting.', 'id', v_id);
  end if;

  v_exp := now() + make_interval(hours => v_reg.expires_hours);
  insert into public.admin_approval_requests (action, target_type, target_id, payload, payload_hash, previous_value, target_version,
                                              reason, risk, requested_by, expires_at)
  values (p_action, btrim(p_target_type), btrim(p_target_id), p_payload, v_hash, p_previous, p_target_version,
          btrim(p_reason), v_reg.risk, v_uid, v_exp)
  returning id into v_id;
  perform public.admin_log('approval.requested', p_target_type, p_target_id, p_previous, p_payload, btrim(p_reason), v_id, 'ok',
                           jsonb_build_object('action', p_action, 'risk', v_reg.risk, 'expires_at', v_exp));

  -- tell the other Super Admins (this also emails them, because the site emails every notification).
  -- A failed notification never undoes the request.
  if to_regprocedure('public._notify(uuid,text,text,text,jsonb)') is not null then
    for r in select distinct ur.user_id from public.admin_user_roles ur join public.admin_users u on u.user_id = ur.user_id
              where ur.role_key = 'super_admin' and u.status = 'active' and u.removed_at is null and ur.user_id <> v_uid loop
      begin
        execute 'select public._notify($1, $2, $3, $4, $5)'
          using r.user_id, 'admin_approval', 'An admin action needs your decision',
                'An admin asked for approval: ' || v_reg.notes || '. Open the admin area to decide.',
                jsonb_build_object('url', '/admin/approvals.html', 'approval_id', v_id);
      exception when others then null;
      end;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'expires_at', v_exp);
end $$;

-- ---------- decide --------------------------------------------------------------

create or replace function public.admin_decide_approval(p_id uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); q public.admin_approval_requests; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.admin_guard('approvals.decide', 'approval.decide') then
    return jsonb_build_object('ok', false, 'error', 'Only a Super Admin can decide.');
  end if;
  if p_approve is null then return jsonb_build_object('ok', false, 'error', 'Choose approve or reject.'); end if;
  select * into q from public.admin_approval_requests where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'That request does not exist.'); end if;
  if q.requested_by = v_uid then
    perform public.admin_log('approval.decide', 'approval', p_id::text, null, null, null, p_id, 'refused', jsonb_build_object('why', 'self_approval'));
    return jsonb_build_object('ok', false, 'error', 'You cannot decide your own request. Another Super Admin must.');
  end if;
  if q.status not in ('pending') then
    return jsonb_build_object('ok', false, 'error', 'This request is already ' || q.status || '.');
  end if;
  if q.expires_at <= now() then
    update public.admin_approval_requests set status = 'expired' where id = p_id;
    perform public.admin_log('approval.expired', 'approval', p_id::text, null, null, null, p_id, 'ok', null);
    return jsonb_build_object('ok', false, 'error', 'This request has expired. Ask again.');
  end if;
  if not p_approve and (v_reason is null or char_length(v_reason) < 5) then
    return jsonb_build_object('ok', false, 'error', 'Give a reason for rejecting (at least 5 characters).');
  end if;
  update public.admin_approval_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_uid, decided_at = now(), decision_reason = v_reason
   where id = p_id;
  perform public.admin_log(case when p_approve then 'approval.approved' else 'approval.rejected' end, q.target_type, q.target_id,
                           null, null, v_reason, p_id, 'ok', jsonb_build_object('action', q.action));
  return jsonb_build_object('ok', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end $$;

-- ---------- cancel ---------------------------------------------------------------

create or replace function public.admin_cancel_approval(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); q public.admin_approval_requests;
begin
  if not public.admin_has('approvals.request') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission.');
  end if;
  select * into q from public.admin_approval_requests where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'That request does not exist.'); end if;
  if q.requested_by <> v_uid and not public.admin_has('approvals.decide') then
    perform public.admin_log('approval.cancel', 'approval', p_id::text, null, null, null, p_id, 'refused', jsonb_build_object('why', 'not_owner'));
    return jsonb_build_object('ok', false, 'error', 'Only the person who asked, or a Super Admin, can cancel it.');
  end if;
  if q.status not in ('pending', 'approved') then
    return jsonb_build_object('ok', false, 'error', 'This request is already ' || q.status || '.');
  end if;
  update public.admin_approval_requests set status = 'cancelled', decision_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), decision_reason)
   where id = p_id;
  perform public.admin_log('approval.cancelled', q.target_type, q.target_id, null, null, nullif(btrim(coalesce(p_reason, '')), ''), p_id, 'ok', jsonb_build_object('action', q.action));
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end $$;

-- ---------- consume (called INSIDE the sensitive function, same transaction) ------

-- Raises (and so undoes the whole sensitive action) unless every rule holds. Never callable from the browser.
create or replace function public.admin_consume_approval(
  p_id uuid, p_action text, p_target_type text, p_target_id text, p_payload jsonb,
  p_target_version text default null, p_result jsonb default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); q public.admin_approval_requests; v_reg public.admin_sensitive_actions;
begin
  if p_id is null then raise exception 'An approval is required for this action.' using errcode = 'P0001'; end if;
  if v_uid is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  select * into q from public.admin_approval_requests where id = p_id for update;
  if not found then raise exception 'That approval does not exist.' using errcode = 'P0001'; end if;
  if q.status = 'consumed'  then raise exception 'That approval has already been used.' using errcode = 'P0001'; end if;
  if q.status = 'rejected'  then raise exception 'That approval was rejected.' using errcode = 'P0001'; end if;
  if q.status = 'cancelled' then raise exception 'That approval was cancelled.' using errcode = 'P0001'; end if;
  if q.status = 'expired' or q.expires_at <= now() then raise exception 'That approval has expired.' using errcode = 'P0001'; end if;
  if q.status <> 'approved' then raise exception 'That approval has not been approved yet.' using errcode = 'P0001'; end if;
  if q.action is distinct from p_action then raise exception 'That approval is for a different action.' using errcode = 'P0001'; end if;
  if q.target_type is distinct from p_target_type or q.target_id is distinct from p_target_id then
    raise exception 'That approval is for a different target.' using errcode = 'P0001';
  end if;
  if q.payload_hash is distinct from public.admin_approval_hash(p_action, p_target_type, p_target_id, p_payload) then
    raise exception 'The change is not the one that was approved.' using errcode = 'P0001';
  end if;
  select * into v_reg from public.admin_sensitive_actions a where a.action = q.action;
  if v_reg.check_target_version and q.target_version is distinct from p_target_version then
    raise exception 'The target changed after the approval was asked for. Ask again.' using errcode = 'P0001';
  end if;
  if q.decided_by is null or q.decided_by = q.requested_by then
    raise exception 'A request cannot be approved by the person who made it.' using errcode = 'P0001';
  end if;
  if not public.admin_user_has(q.decided_by, 'approvals.decide') then
    raise exception 'The approver no longer has the right to approve.' using errcode = 'P0001';
  end if;
  if q.requested_by <> v_uid then
    raise exception 'Only the person who asked for the approval can run the action.' using errcode = 'P0001';
  end if;
  if not public.admin_has(v_reg.permission_required) then
    raise exception 'You no longer have permission for this action.' using errcode = '42501';
  end if;

  update public.admin_approval_requests
     set status = 'consumed', consumed_at = now(), consumed_by = v_uid, execution_result = p_result
   where id = p_id;
  perform public.admin_log('approval.consumed', q.target_type, q.target_id, null, null, null, p_id, 'ok', jsonb_build_object('action', q.action));
end $$;

-- Marks old waiting requests as expired (run by a person or a schedule; a later stage adds the schedule).
create or replace function public.admin_expire_approvals()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  with x as (update public.admin_approval_requests set status = 'expired'
              where status in ('pending', 'approved') and expires_at <= now() returning 1)
  select count(*) into v_n from x;
  if v_n > 0 then
    perform public.admin_log('approval.expired_batch', 'approval', null, null, null, null, null, 'ok', jsonb_build_object('count', v_n));
  end if;
  return v_n;
end $$;

-- ---------- who may run what -------------------------------------------------------

revoke all on function public.admin_approval_guard()                                  from public, anon, authenticated;
revoke all on function public.admin_user_has(uuid, text)                              from public, anon, authenticated;
revoke all on function public.admin_approval_hash(text, text, text, jsonb)            from public, anon, authenticated;
revoke all on function public.admin_request_approval(text, text, text, jsonb, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_decide_approval(uuid, boolean, text)              from public, anon, authenticated;
revoke all on function public.admin_cancel_approval(uuid, text)                       from public, anon, authenticated;
revoke all on function public.admin_consume_approval(uuid, text, text, text, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_expire_approvals()                                from public, anon, authenticated;

grant execute on function public.admin_request_approval(text, text, text, jsonb, text, jsonb, text) to authenticated;
grant execute on function public.admin_decide_approval(uuid, boolean, text)           to authenticated;
grant execute on function public.admin_cancel_approval(uuid, text)                    to authenticated;
-- (each of the three checks the caller's admin permission itself; admin_consume_approval is for server code only)

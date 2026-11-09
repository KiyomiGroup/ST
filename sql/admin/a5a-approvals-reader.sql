-- ============================================================================
-- StreetTasker Admin Control Centre, stage A5a: approvals reader (READ ONLY).
-- ADDITIVE and safe to run twice. Creates four functions. Changes no table, no policy, no
-- existing function, and writes no row (not even an audit row: reading is not logged here, as in A6).
-- Rollback: a5a-rollback.sql. Needs a2-approvals.sql first.
--
--   admin_approval_scope()                  internal: 'all', 'own' or null (no approval permission)
--   admin_approval_counts()                 the four tab counts
--   admin_approval_list(tab, search, limit, offset)   one page of requests for a tab
--   admin_approval_detail(id)               one request with the diff, history and expiry
--
-- Who sees what (decided here, see handoffs/A5a.md):
--   approvals.view or approvals.decide  -> every request
--   approvals.request only              -> only the requests that admin made
--   none of the three                   -> error 42501 (the page shows "no permission")
-- A request that is 'pending' or 'approved' but past its expiry is shown as EXPIRED even if no
-- one has marked it yet (no schedule runs admin_expire_approvals() today).
-- Tabs: pending | approved (approved or already used) | rejected | expired (expired or cancelled).
-- NOT returned on purpose: execution_result, payload_hash, target_version (internal), and any
-- email address. Names come from admin_users.display_name.
-- ============================================================================

do $$
begin
  if to_regclass('public.admin_approval_requests') is null or to_regclass('public.admin_sensitive_actions') is null then
    raise exception 'Run sql/admin/a2-approvals.sql first (the approval tables are missing).';
  end if;
end $$;

create or replace function public.admin_approval_scope()
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if public.admin_has('approvals.view') or public.admin_has('approvals.decide') then return 'all'; end if;
  if public.admin_has('approvals.request') then return 'own'; end if;
  return null;
end $$;

create or replace function public.admin_approval_counts()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_scope text := public.admin_approval_scope(); v_uid uuid := auth.uid(); v jsonb;
begin
  if v_scope is null then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  select jsonb_build_object(
           'pending',  count(*) filter (where x.eff = 'pending'),
           'approved', count(*) filter (where x.eff in ('approved', 'consumed')),
           'rejected', count(*) filter (where x.eff = 'rejected'),
           'expired',  count(*) filter (where x.eff in ('expired', 'cancelled')))
    into v
    from (select case when r.status in ('pending', 'approved') and r.expires_at <= now() then 'expired' else r.status end as eff
            from public.admin_approval_requests r
           where v_scope = 'all' or r.requested_by = v_uid) x;
  return coalesce(v, jsonb_build_object('pending', 0, 'approved', 0, 'rejected', 0, 'expired', 0));
end $$;

create or replace function public.admin_approval_list(
  p_tab text default 'pending', p_search text default null, p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_scope  text := public.admin_approval_scope();
  v_uid    uuid := auth.uid();
  v_tab    text := lower(coalesce(nullif(btrim(p_tab), ''), 'pending'));
  v_limit  int  := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int  := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_rows   jsonb;
begin
  if v_scope is null then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_tab not in ('pending', 'approved', 'rejected', 'expired') then v_tab := 'pending'; end if;

  select coalesce(jsonb_agg(to_jsonb(y) order by y.requested_at desc, y.id), '[]'::jsonb)
    into v_rows
    from (
      select x.id, x.action, coalesce(a.notes, x.action) as action_label, x.risk, x.status, x.eff as effective_status,
             x.target_type, x.target_id, x.requested_at, x.expires_at,
             case when x.eff in ('pending', 'approved') then greatest(0, floor(extract(epoch from (x.expires_at - now()))))::bigint end as seconds_left,
             x.decided_at, x.requested_by = v_uid as is_mine,
             (select u.display_name from public.admin_users u where u.user_id = x.requested_by) as requested_by_name,
             (select u.display_name from public.admin_users u where u.user_id = x.decided_by)   as decided_by_name
        from (select r.*, case when r.status in ('pending', 'approved') and r.expires_at <= now() then 'expired' else r.status end as eff
                from public.admin_approval_requests r
               where v_scope = 'all' or r.requested_by = v_uid) x
        left join public.admin_sensitive_actions a on a.action = x.action
       where case v_tab
               when 'pending'  then x.eff = 'pending'
               when 'approved' then x.eff in ('approved', 'consumed')
               when 'rejected' then x.eff = 'rejected'
               else                 x.eff in ('expired', 'cancelled')
             end
         and (v_search is null
              or position(lower(v_search) in lower(
                   x.id::text || ' ' || x.action || ' ' || coalesce(a.notes, '') || ' ' || x.target_type || ' ' || x.target_id || ' ' ||
                   coalesce((select u.display_name from public.admin_users u where u.user_id = x.requested_by), ''))) > 0)
       order by x.requested_at desc, x.id
       limit v_limit + 1 offset v_offset
    ) y;

  return jsonb_build_object(
    'tab', v_tab, 'scope', v_scope, 'limit', v_limit, 'offset', v_offset,
    'has_more', jsonb_array_length(v_rows) > v_limit,
    'rows', (select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
               from jsonb_array_elements(v_rows) with ordinality as e(value, ord) where e.ord <= v_limit));
end $$;

create or replace function public.admin_approval_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_scope text := public.admin_approval_scope();
  v_uid   uuid := auth.uid();
  q       public.admin_approval_requests;
  v_eff   text;
  v_label text;
  v_hist  jsonb;
begin
  if v_scope is null then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  select * into q from public.admin_approval_requests r where r.id = p_id;
  -- a request-only admin asking for someone else's request gets the same answer as for a missing one
  if not found or (v_scope = 'own' and q.requested_by <> v_uid) then return jsonb_build_object('found', false); end if;

  v_eff := case when q.status in ('pending', 'approved') and q.expires_at <= now() then 'expired' else q.status end;
  select coalesce(a.notes, q.action) into v_label from public.admin_sensitive_actions a where a.action = q.action;
  v_label := coalesce(v_label, q.action);

  select coalesce(jsonb_agg(jsonb_build_object(
           'at', l.at, 'action', l.action, 'outcome', l.outcome, 'reason', l.reason,
           'actor_name', (select u.display_name from public.admin_users u where u.user_id = l.actor_id)) order by l.at, l.id), '[]'::jsonb)
    into v_hist
    from public.admin_audit_log l
   where l.approval_id = q.id;

  return jsonb_build_object(
    'found', true, 'id', q.id, 'action', q.action, 'action_label', v_label, 'risk', q.risk,
    'status', q.status, 'effective_status', v_eff,
    'target_type', q.target_type, 'target_id', q.target_id,
    'reason', q.reason, 'payload', q.payload, 'previous_value', q.previous_value,
    'requested_at', q.requested_at, 'expires_at', q.expires_at,
    'seconds_left', case when v_eff in ('pending', 'approved') then greatest(0, floor(extract(epoch from (q.expires_at - now()))))::bigint end,
    'requested_by_name', (select u.display_name from public.admin_users u where u.user_id = q.requested_by),
    'decided_at', q.decided_at, 'decision_reason', q.decision_reason,
    'decided_by_name', (select u.display_name from public.admin_users u where u.user_id = q.decided_by),
    'consumed_at', q.consumed_at,
    'consumed_by_name', (select u.display_name from public.admin_users u where u.user_id = q.consumed_by),
    'is_mine', q.requested_by = v_uid,
    'history', v_hist);
end $$;

revoke all on function public.admin_approval_scope()                          from public, anon, authenticated;
revoke all on function public.admin_approval_counts()                         from public, anon, authenticated;
revoke all on function public.admin_approval_list(text, text, int, int)       from public, anon, authenticated;
revoke all on function public.admin_approval_detail(uuid)                     from public, anon, authenticated;
grant execute on function public.admin_approval_counts()                      to authenticated;
grant execute on function public.admin_approval_list(text, text, int, int)    to authenticated;
grant execute on function public.admin_approval_detail(uuid)                  to authenticated;
-- (admin_approval_scope is for the other three only. The three above check the scope themselves: a signed-in person
--  with none of approvals.view, approvals.request or approvals.decide gets error 42501.)

select case
  when to_regprocedure('public.admin_approval_scope()') is not null
   and to_regprocedure('public.admin_approval_counts()') is not null
   and to_regprocedure('public.admin_approval_list(text,text,integer,integer)') is not null
   and to_regprocedure('public.admin_approval_detail(uuid)') is not null
  then 'DONE: A5a installed. Admins with an approvals permission can use /admin/approvals.html.'
  else 'NOT DONE: see the messages above.'
end as a5a_result;

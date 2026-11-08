-- ============================================================================
-- StreetTasker Admin Control Centre, stage A6: activity log reader (READ ONLY).
-- ADDITIVE and safe to run twice. Creates three functions. Changes no table, no policy, no
-- existing function, and never alters any log. Rollback: a6-rollback.sql.
--
--   admin_activity_feed(...)    one merged, newest-first list of the admin log and the older logs
--   admin_activity_detail(id)   previous and new value of ONE admin log row
--
-- Both need the permission audit_logs.view (checked on the server).
--
-- Sources (each is optional: a table that is missing or unreadable is reported as "not available",
-- the others still work):
--   admin                 admin_audit_log (the new, append-only admin log)
--   subscription_admin    subscription_admin_log
--   subscription_events   subscription_events
--   disputes              dispute_events
--   local_booking         local_booking_events
--   local_tasker          local_tasker_audit_log
--   job_events            job_events
-- NOT used on purpose: idv_* tables (hard boundary 7), and the free-text columns of the older logs
-- (job_events.text and note can hold chat text). Older logs show only time, kind, who (as an id,
-- or the admin's name when the id is an admin) and the booking or user id they concern.
-- The older tables' column names were not proven in A0, so each one is read through to_jsonb(row)
-- with a list of likely column names; a column that does not exist simply gives an empty value.
-- ============================================================================

-- helper: builds "coalesce(to_jsonb(t) ->> 'a', to_jsonb(t) ->> 'b')" from a JSON array of column names
create or replace function public.admin_feed_expr(p_cols jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when p_cols is null or jsonb_typeof(p_cols) <> 'array' or jsonb_array_length(p_cols) = 0
              then 'null::text'
              else 'nullif(coalesce(' || (select string_agg('to_jsonb(t) ->> ' || quote_literal(c), ', ') from jsonb_array_elements_text(p_cols) c) || '), '''')'
         end
$$;

create or replace function public.admin_activity_feed(
  p_source   text        default null,
  p_outcome  text        default null,
  p_search   text        default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null,
  p_security boolean     default false,
  p_limit    int         default 50,
  p_offset   int         default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_defs    jsonb := '[
    {"key":"subscription_admin","label":"Subscription admin actions","table":"subscription_admin_log",
     "at":["created_at","at"],"actor":["admin_id"],"action":["action"],"ttype":"user","tid":["target_user_id"],"reason":["reason"],"approval":["approval_id"]},
    {"key":"subscription_events","label":"Subscription events","table":"subscription_events",
     "at":["created_at","at"],"actor":["actor_id","admin_id"],"action":["kind","event","type","action"],"ttype":"subscription","tid":["user_id","subscription_id"],"reason":[],"approval":[]},
    {"key":"disputes","label":"Dispute events","table":"dispute_events",
     "at":["created_at","at"],"actor":["actor_id","admin_id"],"action":["kind","event","action"],"ttype":"dispute","tid":["dispute_id","booking_id"],"reason":[],"approval":[]},
    {"key":"local_booking","label":"Local booking events","table":"local_booking_events",
     "at":["created_at","at"],"actor":["actor_id","user_id"],"action":["kind","event","action"],"ttype":"booking","tid":["booking_id"],"reason":[],"approval":[]},
    {"key":"local_tasker","label":"Local Tasker audit","table":"local_tasker_audit_log",
     "at":["created_at","at"],"actor":["actor_id","user_id","admin_id"],"action":["action","kind","event"],"ttype":"local_tasker","tid":["tasker_user_id","tasker_id","profile_id"],"reason":[],"approval":[]},
    {"key":"job_events","label":"Job events","table":"job_events",
     "at":["created_at","at"],"actor":["actor_id"],"action":["kind"],"ttype":"booking","tid":["booking_id"],"reason":[],"approval":[]}
  ]'::jsonb;
  d         jsonb;
  v_sel     text;
  v_parts   text[] := array[
    'select ''admin''::text as source, a.at as at, a.actor_id::text as actor, a.action::text as action, a.target_type::text as target_type, a.target_id::text as target_id, a.reason::text as reason, a.approval_id::text as approval_id, a.outcome::text as outcome, a.id as admin_log_id from public.admin_audit_log a'];
  v_status  jsonb := '[]'::jsonb;
  v_sql     text;
  v_rows    jsonb;
  v_n       int;
  v_limit   int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset  int := greatest(coalesce(p_offset, 0), 0);
  v_search  text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.admin_require('audit_logs.view');

  v_status := v_status || jsonb_build_array(jsonb_build_object('key', 'admin', 'label', 'Admin actions', 'available', true));

  for d in select * from jsonb_array_elements(v_defs) loop
    if to_regclass('public.' || quote_ident(d ->> 'table')) is null then
      v_status := v_status || jsonb_build_array(jsonb_build_object('key', d ->> 'key', 'label', d ->> 'label', 'available', false, 'reason', 'This log table does not exist.'));
      continue;
    end if;
    v_sel := format(
      'select %L::text as source, (%s)::timestamptz as at, %s as actor, %s as action, %L::text as target_type, %s as target_id, %s as reason, %s as approval_id, null::text as outcome, null::bigint as admin_log_id from public.%I t',
      d ->> 'key', public.admin_feed_expr(d -> 'at'), public.admin_feed_expr(d -> 'actor'), public.admin_feed_expr(d -> 'action'),
      d ->> 'ttype', public.admin_feed_expr(d -> 'tid'), public.admin_feed_expr(d -> 'reason'), public.admin_feed_expr(d -> 'approval'),
      d ->> 'table');
    begin
      execute 'select 1 from (' || v_sel || ') s limit 1' into v_n;   -- trial: does it read at all?
      v_parts := v_parts || v_sel;
      v_status := v_status || jsonb_build_array(jsonb_build_object('key', d ->> 'key', 'label', d ->> 'label', 'available', true));
    exception when others then
      v_status := v_status || jsonb_build_array(jsonb_build_object('key', d ->> 'key', 'label', d ->> 'label', 'available', false, 'reason', 'This log could not be read.'));
    end;
  end loop;

  v_sql :=
    'select coalesce(jsonb_agg(to_jsonb(y) - ''rn'' order by y.rn), ''[]''::jsonb) from (' ||
    ' select x.*, row_number() over (order by x.at desc nulls last, x.source, x.admin_log_id desc nulls last) as rn from (' ||
    '   select f.*, (select u.display_name from public.admin_users u where u.user_id::text = f.actor) as actor_name from (' ||
          array_to_string(v_parts, ' union all ') ||
    '   ) f ) x ' ||
    ' where ($1 is null or x.source = $1)' ||
    '   and ($2 is null or x.outcome = $2)' ||
    '   and ($3 is null or position(lower($3) in lower(coalesce(x.action, '''') || '' '' || coalesce(x.target_id, '''') || '' '' || coalesce(x.actor, '''') || '' '' || coalesce(x.actor_name, ''''))) > 0)' ||
    '   and ($4 is null or x.at >= $4)' ||
    '   and ($5 is null or x.at < $5)' ||
    '   and (not $6 or (x.source = ''admin'' and (x.outcome <> ''ok'' or x.action ~ ''^(approval|admin|settings|role|mfa|permission|coordinator\.release)'')))' ||
    ' order by x.at desc nulls last, x.source, x.admin_log_id desc nulls last' ||
    ' limit $7 offset $8 ) y';

  execute v_sql into v_rows
    using nullif(btrim(coalesce(p_source, '')), ''), nullif(btrim(coalesce(p_outcome, '')), ''), v_search,
          p_from, p_to, coalesce(p_security, false), v_limit + 1, v_offset;

  return jsonb_build_object(
    'generated_at', now(),
    'sources',  v_status,
    'limit',    v_limit,
    'offset',   v_offset,
    'has_more', jsonb_array_length(v_rows) > v_limit,
    'rows',     (select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb) from jsonb_array_elements(v_rows) with ordinality as e(value, ord) where e.ord <= v_limit));
end $$;

-- previous and new value of one admin log row (only the admin log keeps these)
create or replace function public.admin_activity_detail(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.admin_audit_log;
begin
  perform public.admin_require('audit_logs.view');
  select * into a from public.admin_audit_log where id = p_id;
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'id', a.id, 'at', a.at, 'action', a.action, 'target_type', a.target_type,
    'target_id', a.target_id, 'actor_roles', to_jsonb(a.actor_roles), 'old_value', a.old_value, 'new_value', a.new_value,
    'reason', a.reason, 'approval_id', a.approval_id, 'outcome', a.outcome, 'detail', a.detail);
end $$;

revoke all on function public.admin_feed_expr(jsonb) from public, anon, authenticated;
revoke all on function public.admin_activity_feed(text, text, text, timestamptz, timestamptz, boolean, int, int) from public, anon, authenticated;
revoke all on function public.admin_activity_detail(bigint) from public, anon, authenticated;
grant execute on function public.admin_activity_feed(text, text, text, timestamptz, timestamptz, boolean, int, int) to authenticated;
grant execute on function public.admin_activity_detail(bigint) to authenticated;
-- (both check audit_logs.view themselves: a signed-in person without it gets error 42501)

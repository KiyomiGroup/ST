-- ============================================================================
-- StreetTasker Local Tasker: STAGE 7F (coordinators use the tasker wallet and withdrawals).
-- WRITTEN, NOT RUN. Run in the Supabase SQL editor, AFTER the withdrawal SQL (W2a, W2b, W2c-settle, W2d) is applied.
-- Safe to run twice.
--
-- What it does
--   1. Adds ONE helper, public.is_wallet_owner(uuid): true for a tasker (a row in public.taskers) or an ACTIVE coordinator.
--   2. Changes ONE line in each of five existing functions. The line that said
--          if not exists (select 1 from public.taskers t where t.user_id::text = p_user::text) then
--      now says
--          if not public.is_wallet_owner(p_user) then
--      in withdrawal_create (WD001) and bank_account_add / _set_default / _remove / _set_recipient (WA001).
--   It edits the function AS IT IS NOW IN YOUR DATABASE (it reads the live definition and replaces that one line),
--   so any change made after W2b/W2d (for example the "clearing" rule) is kept. If a function does not contain exactly
--   that one line, NOTHING is changed and an error says which function (nothing half-done).
--   3. Never creates a taskers row for a coordinator. Does not change RLS, grants or any table.
--   4. Ends with one result table: other wallet or withdrawal functions that still mention public.taskers (to be read, not changed).
-- Everything else is refused exactly as before: a customer, a suspended or unapproved coordinator, anon.
-- ============================================================================

-- 1. the helper -----------------------------------------------------------------------------------------
create or replace function public.is_wallet_owner(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_user is not null
     and ( exists (select 1 from public.taskers t where t.user_id::text = p_user::text)
           or coalesce(public.is_active_coordinator(p_user), false) )
$$;
revoke all on function public.is_wallet_owner(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.is_wallet_owner(uuid) to service_role';
  else
    raise notice '7F: role service_role was not found, so its grant is skipped.';
  end if;
end $$;

-- 2. the five one-line patches, all or nothing ---------------------------------------------------------
do $$
declare
  v_old constant text := 'if not exists (select 1 from public.taskers t where t.user_id::text = p_user::text) then';
  v_new constant text := 'if not public.is_wallet_owner(p_user) then';
  v_names constant text[] := array['withdrawal_create', 'bank_account_add', 'bank_account_set_default', 'bank_account_remove', 'bank_account_set_recipient'];
  v_name text; v_oid oid; v_n int; v_def text; v_cnt int; v_newdef text; v_done text := '';
begin
  foreach v_name in array v_names loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_name;
    if v_n <> 1 then
      raise exception '7F: expected exactly one public.% but found %. Nothing was changed. Send this message back.', v_name, v_n;
    end if;
    select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_name;
    v_def := pg_get_functiondef(v_oid);
    v_cnt := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    if v_cnt = 0 and position(v_new in v_def) > 0 then
      v_done := v_done || v_name || ' (already patched); ';
      continue;
    end if;
    if v_cnt <> 1 then
      raise exception '7F: public.% does not contain the expected taskers-only line exactly once (found % times). Nothing was changed. Send this message back.', v_name, v_cnt;
    end if;
  end loop;
  -- every function passed the check: now change them
  foreach v_name in array v_names loop
    select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_name;
    v_def := pg_get_functiondef(v_oid);
    if position(v_old in v_def) > 0 then
      v_newdef := replace(v_def, v_old, v_new);
      execute v_newdef;
      v_done := v_done || v_name || ' (patched); ';
    end if;
  end loop;
  raise notice '7F: %', v_done;
end $$;

-- 3. the result you can read: the five functions now use the helper; other functions that still mention taskers ---
select 'patched' as kind, p.proname::text as function_name,
       (position('public.is_wallet_owner(p_user)' in pg_get_functiondef(p.oid)) > 0) as uses_helper,
       (position('from public.taskers t where t.user_id::text = p_user::text' in pg_get_functiondef(p.oid)) > 0) as still_has_old_line
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('withdrawal_create', 'bank_account_add', 'bank_account_set_default', 'bank_account_remove', 'bank_account_set_recipient')
union all
select 'READ ONLY: still mentions public.taskers', p.proname::text, null, null
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and (p.proname like 'withdrawal%' or p.proname like 'bank_account%' or p.proname like '\_withdrawal%' or p.proname like 'wallet%' or p.proname like '\_ensure_wallet%')
   and p.proname not in ('withdrawal_create', 'bank_account_add', 'bank_account_set_default', 'bank_account_remove', 'bank_account_set_recipient')
   and pg_get_functiondef(p.oid) ~* 'public\.taskers|from taskers'
 order by 1, 2;

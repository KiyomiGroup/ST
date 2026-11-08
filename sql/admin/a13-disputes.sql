-- StreetTasker Admin Control Centre, stage A13: Disputes in the admin area.
-- Run the WHOLE file once in the Supabase SQL editor. Safe to run twice. Rollback: a13-rollback.sql.
--
-- What it does (and nothing else):
--   1. Keeps a copy of the current body of public._is_support() in admin_function_backups (first run only).
--   2. Extends public._is_support() so that an active admin who holds disputes.manage (and has passed two-step,
--      when two-step is required) also counts as support. It is only ever WIDER: the old two ways in
--      (a row in support_staff, or the SQL editor) are kept exactly. support.html keeps working.
--   3. Adds five admin_dispute_* functions. Each one checks the admin permission, calls the existing
--      support_* function (which still does the real work and writes the dispute history), and writes one
--      row to the admin activity log. They never move money: a refund is only a record, as before.
--
-- Money rule (hard boundary 1): nothing here calls Paystack or changes a wallet, escrow row or payment.
-- If the first line printed at the end is NOT DONE, nothing was changed; read the message.

-- 1. Backup table (server only: no grant, row level security on, no policy)
create table if not exists public.admin_function_backups (
  name        text primary key,
  definition  text not null,
  saved_at    timestamptz not null default now()
);
alter table public.admin_function_backups enable row level security;
revoke all on public.admin_function_backups from anon, authenticated;

-- 2. Extend _is_support()
do $a13$
declare
  v_def text;
begin
  if to_regprocedure('public._is_support()') is null then
    raise notice 'NOT DONE: public._is_support() does not exist. Nothing was changed.';
    return;
  end if;
  if to_regclass('public.admin_users') is null or to_regprocedure('public.admin_has(text)') is null then
    raise notice 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
    return;
  end if;

  v_def := pg_get_functiondef('public._is_support()'::regprocedure);

  if v_def ilike '%admin_has(%' then
    raise notice 'ALREADY DONE: _is_support() already accepts admins. Nothing was changed.';
    return;
  end if;
  -- the body must look like the one A0 recorded (support_staff list, or the SQL editor); otherwise do not touch it
  if v_def not ilike '%support_staff%' or v_def not ilike '%session_user%' then
    raise notice 'NOT DONE: _is_support() does not look like the version recorded in A0 (it should mention support_staff and session_user). Nothing was changed. Send me this text: %', v_def;
    return;
  end if;

  insert into public.admin_function_backups (name, definition)
  values ('_is_support()', v_def)
  on conflict (name) do nothing;

  create or replace function public._is_support()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
  as $f$
    select
      (auth.uid() is not null
        and exists (select 1 from public.support_staff s where s.user_id = auth.uid()))
      or (auth.uid() is null and session_user in ('postgres', 'supabase_admin'))
      or public.admin_has('disputes.manage');
  $f$;

  raise notice 'DONE: _is_support() now also accepts an active admin with disputes.manage.';
end
$a13$;

-- 3. The five admin functions. Arguments are text and are passed on as quoted literals, so each one is
--    converted to whatever type the existing support_* function declares (uuid, numeric, integer).
create or replace function public._admin_dispute_run(
  p_action text, p_perm text, p_extra_perm text, p_target_type text, p_target_id text,
  p_call text, p_reason text, p_detail jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_res jsonb;
  v_ok  boolean;
begin
  if not public.admin_guard(p_perm, 'dispute.' || p_action) then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if p_extra_perm is not null and not public.admin_guard(p_extra_perm, 'dispute.' || p_action) then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to record refunds.');
  end if;
  begin
    execute 'select to_jsonb(' || p_call || ')' into v_res;
  exception when others then
    perform public.admin_log('dispute.' || p_action, p_target_type, p_target_id, null, null, p_reason, null, 'error',
                             jsonb_build_object('sqlstate', sqlstate));
    return jsonb_build_object('ok', false, 'error', 'The request failed. Nothing was recorded.');
  end;
  v_ok := coalesce((v_res ->> 'ok')::boolean, false);
  perform public.admin_log('dispute.' || p_action, p_target_type, p_target_id, null,
                           case when v_ok then p_detail else null end, p_reason, null,
                           case when v_ok then 'ok' else 'refused' end,
                           case when v_ok then null else jsonb_build_object('error', left(coalesce(v_res ->> 'error', ''), 200)) end);
  return v_res;
end
$f$;
revoke all on function public._admin_dispute_run(text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.admin_dispute_start_review(p_dispute text)
returns jsonb language sql security definer set search_path = public, pg_temp as $f$
  select public._admin_dispute_run('start_review', 'disputes.manage', null, 'dispute', p_dispute,
    format('public.support_start_review(p_dispute => %L)', p_dispute), null, null);
$f$;

create or replace function public.admin_dispute_resolve(
  p_dispute text, p_outcome text, p_note text,
  p_refund_amount text default null, p_refund_ref text default null, p_refund_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare v_refund boolean := p_outcome in ('refund_full', 'refund_partial', 'split');
        v_call text;
begin
  v_call := format('public.support_resolve_dispute(p_dispute => %L, p_outcome => %L, p_note => %L', p_dispute, p_outcome, p_note);
  if p_refund_amount is not null then v_call := v_call || format(', p_refund_amount => %L', p_refund_amount); end if;
  if p_refund_ref    is not null then v_call := v_call || format(', p_refund_ref => %L', p_refund_ref); end if;
  if p_refund_note   is not null then v_call := v_call || format(', p_refund_note => %L', p_refund_note); end if;
  v_call := v_call || ')';
  return public._admin_dispute_run('resolve', 'disputes.manage',
    case when v_refund then 'disputes.refund.record' else null end, 'dispute', p_dispute, v_call, left(p_note, 500),
    jsonb_build_object('outcome', p_outcome, 'refund_amount', p_refund_amount, 'refund_ref', p_refund_ref));
end
$f$;

create or replace function public.admin_dispute_record_refund(p_dispute text, p_amount text, p_ref text)
returns jsonb language sql security definer set search_path = public, pg_temp as $f$
  select public._admin_dispute_run('record_refund', 'disputes.manage', 'disputes.refund.record', 'dispute', p_dispute,
    format('public.support_record_refund(p_dispute => %L, p_amount => %L, p_ref => %L)', p_dispute, p_amount, p_ref),
    null, jsonb_build_object('refund_amount', p_amount, 'refund_ref', p_ref));
$f$;

create or replace function public.admin_dispute_remove_evidence(p_attachment text, p_reason text)
returns jsonb language sql security definer set search_path = public, pg_temp as $f$
  select public._admin_dispute_run('remove_evidence', 'disputes.manage', null, 'attachment', p_attachment,
    format('public.support_remove_evidence(p_attachment => %L, p_reason => %L)', p_attachment, p_reason),
    left(p_reason, 500), null);
$f$;

-- Reading the private conversation is allowed only inside a dispute (decision D-A11). The existing function
-- already writes "support read the conversation" to the dispute history; this adds the admin log row.
create or replace function public.admin_dispute_read_chat(p_dispute text, p_limit text default '200')
returns jsonb language sql security definer set search_path = public, pg_temp as $f$
  select public._admin_dispute_run('read_chat', 'disputes.manage', null, 'dispute', p_dispute,
    format('public.support_dispute_messages(p_dispute => %L, p_limit => %L)', p_dispute, p_limit), null, null);
$f$;

revoke all on function public.admin_dispute_start_review(text) from public, anon;
revoke all on function public.admin_dispute_resolve(text, text, text, text, text, text) from public, anon;
revoke all on function public.admin_dispute_record_refund(text, text, text) from public, anon;
revoke all on function public.admin_dispute_remove_evidence(text, text) from public, anon;
revoke all on function public.admin_dispute_read_chat(text, text) from public, anon;
grant execute on function public.admin_dispute_start_review(text) to authenticated;
grant execute on function public.admin_dispute_resolve(text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_dispute_record_refund(text, text, text) to authenticated;
grant execute on function public.admin_dispute_remove_evidence(text, text) to authenticated;
grant execute on function public.admin_dispute_read_chat(text, text) to authenticated;

-- Result line
select case
  when pg_get_functiondef('public._is_support()'::regprocedure) ilike '%admin_has(%'
   and to_regprocedure('public.admin_dispute_resolve(text,text,text,text,text,text)') is not null
  then 'DONE: A13 installed. Admins with disputes.manage can now use /admin/disputes.html.'
  else 'NOT DONE: _is_support() was not changed (see the message above). The admin_dispute_* functions were still created, but admins cannot use them until it is.'
end as a13_result;

-- ============================================================================
-- StreetTasker Admin Control Centre, stage A5e (part 2): SEND AN INVITATION AGAIN.
-- ADDITIVE and safe to run twice. No table, policy, trigger or existing function changed; functions only. Rollback: a5e-resend-rollback.sql.
-- Needs a5e-invite.sql first.
-- A resend is NOT a new approval: the admin row was already approved and made. It only emails the SAME person (the address on their
-- login) a fresh link to choose a password. Safe because it grants nothing. Rules enforced here:
--   * needs admin.team.manage; never for yourself;
--   * only for an ACTIVE admin who was created by an invite (admin.team.invited is in the audit log) and who has NOT set a password yet;
--   * at most 3 per person per 24 hours (stops email flooding); every resend is in admin_audit_log (admin.team.invite_resent).
-- The Edge Function admin-invite (resend mode) does: check (as the caller), send the email, record (as the caller).
-- ============================================================================
do $$
begin
  if to_regprocedure('public.admin_invite_finish(uuid,uuid)') is null then
    raise exception 'Run sql/admin/a5e-invite.sql first.';
  end if;
end $$;

-- Is this person someone we may send a fresh link to? (read only; also used by the page list)
create or replace function public.admin_invite_resend_check(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_email text; v_pw text; v_n int;
begin
  if not public.admin_has('admin.team.manage') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to change the admin team.');
  end if;
  if p_user is null or p_user = v_uid then
    return jsonb_build_object('ok', false, 'error', 'You cannot send an invitation to yourself.');
  end if;
  if not exists (select 1 from public.admin_users u where u.user_id = p_user and u.status = 'active') then
    return jsonb_build_object('ok', false, 'error', 'That person is not an active admin.');
  end if;
  if not exists (select 1 from public.admin_audit_log l where l.action = 'admin.team.invited' and l.target_id = p_user::text and l.outcome = 'ok') then
    return jsonb_build_object('ok', false, 'error', 'That admin was not created by an invitation, so nothing can be sent again.');
  end if;
  select lower(a.email), a.encrypted_password into v_email, v_pw from auth.users a where a.id = p_user;
  if v_email is null then return jsonb_build_object('ok', false, 'error', 'That login was not found.'); end if;
  if coalesce(v_pw, '') <> '' then
    return jsonb_build_object('ok', false, 'error', 'That person has already chosen a password. They can sign in at the admin sign-in page.');
  end if;
  select count(*) into v_n from public.admin_audit_log l
   where l.action = 'admin.team.invite_resent' and l.target_id = p_user::text and l.outcome = 'ok' and l.at > now() - interval '24 hours';
  if v_n >= 3 then
    return jsonb_build_object('ok', false, 'error', 'The invitation was already sent again 3 times in the last 24 hours. Try again tomorrow.');
  end if;
  return jsonb_build_object('ok', true, 'email', v_email);
end $$;

-- Writes the audit row after the email was sent (re-checks first).
create or replace function public.admin_invite_resend_record(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if not public.admin_guard('admin.team.manage', 'admin.invite.resend') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to change the admin team.');
  end if;
  v := public.admin_invite_resend_check(p_user);
  if not coalesce((v ->> 'ok')::boolean, false) then
    perform public.admin_log('admin.invite.resend', 'admin_user', coalesce(p_user::text, ''), null, null, null, null, 'refused', jsonb_build_object('error', v ->> 'error'));
    return v;
  end if;
  perform public.admin_log('admin.team.invite_resent', 'admin_user', p_user::text, null, null, null, null, 'ok', jsonb_build_object('email', v ->> 'email'));
  return jsonb_build_object('ok', true);
end $$;

-- Invited admins who have not chosen a password yet (for the Team page).
create or replace function public.admin_invite_setup_pending()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rows jsonb;
begin
  if not public.admin_has('admin.team.manage') then
    raise exception 'You do not have permission to do this.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', u.user_id, 'email', lower(a.email), 'name', u.display_name,
           'invited_at', (select max(l.at) from public.admin_audit_log l where l.action = 'admin.team.invited' and l.target_id = u.user_id::text and l.outcome = 'ok'),
           'resends_24h', (select count(*) from public.admin_audit_log l where l.action = 'admin.team.invite_resent' and l.target_id = u.user_id::text and l.outcome = 'ok' and l.at > now() - interval '24 hours'))
         order by u.display_name), '[]'::jsonb)
    into v_rows
    from public.admin_users u join auth.users a on a.id = u.user_id
   where u.status = 'active' and u.user_id <> auth.uid() and coalesce(a.encrypted_password, '') = ''
     and exists (select 1 from public.admin_audit_log l where l.action = 'admin.team.invited' and l.target_id = u.user_id::text and l.outcome = 'ok');
  return jsonb_build_object('rows', v_rows);
end $$;

revoke all on function public.admin_invite_resend_check(uuid)  from public, anon, authenticated;
revoke all on function public.admin_invite_resend_record(uuid) from public, anon, authenticated;
revoke all on function public.admin_invite_setup_pending()     from public, anon, authenticated;
grant execute on function public.admin_invite_resend_check(uuid)  to authenticated;
grant execute on function public.admin_invite_resend_record(uuid) to authenticated;
grant execute on function public.admin_invite_setup_pending()     to authenticated;

select case
  when to_regprocedure('public.admin_invite_resend_check(uuid)') is not null
   and to_regprocedure('public.admin_invite_resend_record(uuid)') is not null
   and to_regprocedure('public.admin_invite_setup_pending()') is not null
  then 'DONE: A5e resend installed. Next: redeploy the admin-invite function.'
  else 'NOT DONE: see the messages above.'
end as a5e_resend_result;

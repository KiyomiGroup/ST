-- StreetTasker Admin Control Centre, stage A3c: switch two-step verification ON for the admin area.
-- Run this ONLY after every admin has set up an authenticator app on admin/profile.html.
--
-- It is guarded: it checks every ACTIVE admin for a verified authenticator app (Supabase Auth MFA).
-- If anyone is missing, it changes NOTHING and lists who. If everyone has one, it sets admin_settings.require_mfa = 'on'.
-- Safe to run twice. Read the last lines of the output.
-- To switch it back off (rollback, or if someone is locked out): run a3c-mfa-off.sql.

create temp table if not exists a3c_out (n serial, line text);
truncate a3c_out;

do $a3c$
declare
  r record; v_total int := 0; v_missing int := 0; v_was text;
begin
  if to_regclass('auth.mfa_factors') is null then
    insert into a3c_out(line) values ('NOT DONE: the table auth.mfa_factors was not found, so enrolment cannot be checked. Nothing was changed.');
    return;
  end if;

  for r in
    select au.user_id, coalesce(u.email, '(no email)') as email,
           exists (select 1 from auth.mfa_factors f
                    where f.user_id = au.user_id and f.factor_type::text = 'totp' and f.status::text = 'verified') as has_factor
      from public.admin_users au
      left join auth.users u on u.id = au.user_id
     where au.status = 'active' and au.removed_at is null
     order by u.email
  loop
    v_total := v_total + 1;
    if r.has_factor then
      insert into a3c_out(line) values ('OK       ' || r.email || ': authenticator app set up');
    else
      v_missing := v_missing + 1;
      insert into a3c_out(line) values ('MISSING  ' || r.email || ': no authenticator app yet');
    end if;
  end loop;

  if v_total = 0 then
    insert into a3c_out(line) values ('NOT DONE: no active admin was found. Nothing was changed.');
    return;
  end if;
  if v_missing > 0 then
    insert into a3c_out(line) values ('NOT DONE: ' || v_missing || ' of ' || v_total || ' admin(s) have not set up an authenticator app. They must do it on My profile first. Nothing was changed.');
    return;
  end if;

  select s.text_value into v_was from public.admin_settings s where s.key = 'require_mfa';
  if v_was = 'on' then
    insert into a3c_out(line) values ('NOTHING TO DO: two-step was already required.');
    return;
  end if;

  insert into public.admin_settings (key, text_value, updated_at) values ('require_mfa', 'on', now())
    on conflict (key) do update set text_value = 'on', updated_at = now();

  if to_regprocedure('public.admin_log(text,text,text,jsonb,jsonb,text,uuid,text,jsonb)') is not null then
    perform public.admin_log('settings.require_mfa', 'admin_settings', 'require_mfa',
                             jsonb_build_object('value', coalesce(v_was, 'off')), jsonb_build_object('value', 'on'),
                             'Stage A3c: all active admins enrolled', null, 'ok', jsonb_build_object('via', 'sql editor'));
  end if;
  insert into a3c_out(line) values ('DONE: two-step is now required. Each admin enters a 6-digit code after the password.');
end
$a3c$;

select line from a3c_out order by n;

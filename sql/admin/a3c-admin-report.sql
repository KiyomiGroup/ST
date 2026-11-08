-- StreetTasker Admin Control Centre, stage A3c: READ-ONLY report on the two admin logins. It changes nothing.
-- Purpose: see which of these logins are also a customer, Tasker or coordinator, so the next step is chosen from facts.
-- Run the whole file once and send me the output (a short list of lines; it contains no passwords or keys).

create temp table if not exists a3c_rep (n serial, line text);
truncate a3c_rep;

do $a3c$
declare
  e text; v_uid uuid; r record; n int; v_bal numeric; v_pend numeric;
begin
  foreach e in array array['admin@streettasker.com', 'kiyomigroups@gmail.com'] loop
    insert into a3c_rep(line) values ('=== ' || e);
    select u.id into v_uid from auth.users u where lower(u.email) = e;
    if v_uid is null then insert into a3c_rep(line) values ('  no sign-in login with this email'); continue; end if;

    select au.status, au.removed_at into r from public.admin_users au where au.user_id = v_uid;
    if found then
      insert into a3c_rep(line) values ('  admin_users: status ' || r.status || (case when r.removed_at is null then '' else ' (removed)' end)
        || '; roles: ' || coalesce((select string_agg(ur.role_key, ', ' order by ur.role_key) from public.admin_user_roles ur where ur.user_id = v_uid), '(none)'));
    else insert into a3c_rep(line) values ('  admin_users: no row'); end if;

    insert into a3c_rep(line) values ('  support_staff row: ' || (case when exists (select 1 from public.support_staff s where s.user_id = v_uid) then 'yes' else 'no' end));
    insert into a3c_rep(line) values ('  verified authenticator app: ' || (case when exists (select 1 from auth.mfa_factors f where f.user_id = v_uid and f.factor_type::text = 'totp' and f.status::text = 'verified') then 'yes' else 'no' end));

    select u.role, u.roles into r from public.users u where u.id = v_uid;
    if found then insert into a3c_rep(line) values ('  users row: yes; role = ' || coalesce(r.role, '(empty)') || '; roles = ' || coalesce(r.roles::text, '(empty)'));
    else insert into a3c_rep(line) values ('  users row: no (not a customer or Tasker on the public site)'); end if;

    select c.status into r from public.coordinators c where c.user_id = v_uid;
    insert into a3c_rep(line) values ('  coordinator: ' || coalesce('status ' || r.status, 'no row'));

    select count(*) into n from public.bookings b where b.customer_id = v_uid;
    insert into a3c_rep(line) values ('  bookings as customer: ' || n);
    select count(*) into n from public.bookings b where b.tasker_id = v_uid;
    insert into a3c_rep(line) values ('  bookings as tasker: ' || n);
    select coalesce(sum(w.balance), 0), coalesce(sum(w.pending_balance), 0) into v_bal, v_pend from public.wallets w where w.user_id = v_uid;
    insert into a3c_rep(line) values ('  wallet: balance ' || v_bal || ', pending ' || v_pend);
    select count(*) into n from public.coordinator_assignments a where a.coordinator_id = v_uid and a.ended_at is null;
    insert into a3c_rep(line) values ('  Local Taskers assigned to this login now: ' || n);
  end loop;
end
$a3c$;

select line from a3c_rep order by n;

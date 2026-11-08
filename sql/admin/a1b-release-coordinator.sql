-- StreetTasker Admin Control Centre, stage A1b: take admin@streettasker.com OUT of the coordinator role
-- (owner decision 2026-11-08: "only an admin").
--
-- This file CHANGES one thing, and only when it is clear: it sets that login's row in `coordinators`
-- to status 'deactivated' (a value the table already allows; it is reversible, nothing is deleted).
-- It first checks what depends on that coordinator. If ANY Local Tasker is still assigned to this login,
-- or any Local Tasker booking is still open under it, it changes NOTHING and lists what blocks it.
-- The database's own trigger `lt_coordinators_follow_bookings` runs when a coordinator's status changes
-- (its text was not seen); that is the reason for the guard.
--
-- Run the whole file once. The output is a short list of lines; read the last one.
-- GUESSED and flagged: "finished" below means a booking whose status is 'completed' or 'cancelled'.
-- The list also prints the real statuses so you can see whether that guess is right.

create temp table if not exists a1b_out (n serial, line text);
truncate a1b_out;

do $a1b$
declare
  v_uid uuid; v_status text; v_assign int; v_pub int; v_open int; v_all int; v_bal numeric; v_pend numeric; r record;
begin
  select u.id into v_uid from auth.users u where lower(u.email) = 'admin@streettasker.com';
  if v_uid is null then
    insert into a1b_out(line) values ('NOT DONE: no login admin@streettasker.com exists.');
    return;
  end if;
  select c.status into v_status from public.coordinators c where c.user_id = v_uid;
  if v_status is null then
    insert into a1b_out(line) values ('NOTHING TO DO: this login is not a coordinator (no row in coordinators).');
    return;
  end if;
  insert into a1b_out(line) values ('Coordinator status now: ' || v_status);

  select count(*) into v_assign from public.coordinator_assignments a where a.coordinator_id = v_uid and a.ended_at is null;
  select count(*) into v_pub from public.coordinator_assignments a join public.local_tasker_profiles p on p.tasker_user_id = a.tasker_user_id
   where a.coordinator_id = v_uid and a.ended_at is null and p.status = 'published';
  select count(*) into v_all from public.local_booking_state s where s.coordinator_id = v_uid;
  select count(*) into v_open from public.local_booking_state s join public.bookings b on b.id = s.booking_id
   where s.coordinator_id = v_uid and coalesce(b.status, '') not in ('completed', 'cancelled');
  select coalesce(sum(w.balance), 0), coalesce(sum(w.pending_balance), 0) into v_bal, v_pend from public.wallets w where w.user_id = v_uid;

  insert into a1b_out(line) values ('Local Taskers assigned to this login now: ' || v_assign || ' (of them published and live: ' || v_pub || ')');
  insert into a1b_out(line) values ('Local Tasker bookings under this login: ' || v_all || ' (not completed or cancelled: ' || v_open || ')');
  for r in select coalesce(b.status, '(none)') as st, count(*) as n from public.local_booking_state s join public.bookings b on b.id = s.booking_id
            where s.coordinator_id = v_uid group by 1 order by 1 loop
    insert into a1b_out(line) values ('   booking status ' || r.st || ': ' || r.n);
  end loop;
  insert into a1b_out(line) values ('Wallet of this login: balance ' || v_bal || ', pending ' || v_pend);

  if v_assign > 0 or v_open > 0 then
    insert into a1b_out(line) values ('NOT DONE: nothing was changed. This login still looks after ' || v_assign || ' Local Tasker(s) and ' || v_open
      || ' open booking(s). They need another ACTIVE coordinator first (the tool admin_reassign_local_tasker from stage F-6 moves one at a time, if you ran that file), '
      || 'otherwise their bookings would be left with no coordinator and a live Local Tasker would have nobody in charge.');
    return;
  end if;
  if v_status = 'deactivated' then
    insert into a1b_out(line) values ('NOTHING TO DO: already deactivated.');
    return;
  end if;

  update public.coordinators set status = 'deactivated' where user_id = v_uid;
  if to_regprocedure('public.admin_log(text,text,text,jsonb,jsonb,text,uuid,text,jsonb)') is not null then
    perform public.admin_log('coordinator.release_own_login', 'coordinator', v_uid::text,
                             jsonb_build_object('status', v_status), jsonb_build_object('status', 'deactivated'),
                             'Owner decision 2026-11-08: admin login is not a coordinator', null, 'ok', jsonb_build_object('via', 'sql editor'));
  end if;
  insert into a1b_out(line) values ('DONE: this login is no longer an active coordinator (status deactivated, reversible: update coordinators set status = ''active'' where user_id = this login). It stays an admin.');
end
$a1b$;

select line from a1b_out order by n;

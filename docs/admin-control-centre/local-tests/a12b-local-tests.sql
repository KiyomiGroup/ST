-- LOCAL ONLY: run via run-a12b.sh on a scratch Postgres (stand-ins, not the real database). Also executes the A12a SQL for the first time.
create temp table r (n serial, ok boolean, line text);
create function pg_temp.as_(p uuid, aal text default 'aal1') returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', case when p is null then '' else jsonb_build_object('sub', p::text, 'aal', aal)::text end, false);
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); end $f$;
create function pg_temp.chk(c boolean, t text) returns void language plpgsql as $f$ begin insert into r(ok,line) values (coalesce(c,false), t); end $f$;
do $t$
declare sa uuid := gen_random_uuid(); ops uuid := gen_random_uuid(); sup uuid := gen_random_uuid(); ver uuid := gen_random_uuid(); nobody uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t4 uuid := gen_random_uuid(); t5 uuid := gen_random_uuid(); t6 uuid := gen_random_uuid(); t7 uuid := gen_random_uuid();
  cust uuid := gen_random_uuid();
  bk1 uuid := gen_random_uuid(); bk1b uuid := gen_random_uuid(); bk2 uuid := gen_random_uuid(); bk3 uuid := gen_random_uuid(); bk4 uuid := gen_random_uuid();
  bk5 uuid := gen_random_uuid(); bk6 uuid := gen_random_uuid(); bk7 uuid := gen_random_uuid(); bk8 uuid := gen_random_uuid(); bk9 uuid := gen_random_uuid();
  v jsonb; n int; n2 int; x uuid; txt text; amt_before numeric; pay_before text; ev_before int;
begin
  insert into auth.users(id,email) values (sa,'sa@x'),(ops,'ops@x'),(sup,'sup@x'),(ver,'ver@x'),(nobody,'n@x'),(c1,'c1@x'),(c2,'c2@x'),(c3,'c3@x');
  insert into public.admin_users(user_id,display_name,status) values (sa,'Super','active'),(ops,'Ops','active'),(sup,'Support','active'),(ver,'Verif','active');
  insert into public.admin_user_roles(user_id,role_key) values (sa,'super_admin'),(ops,'operations'),(sup,'support'),(ver,'verification');
  insert into public.coordinators(user_id,status,display_name) values (c1,'active','Coord One'),(c2,'active','Coord Two'),(c3,'deactivated','Coord Three'),(ops,'active','Ops as coordinator');
  insert into public.users(id,name) values (cust,'Customer Ada'),(t1,'Tasker One'),(c1,'Coord One U'),(c2,'Coord Two U');
  insert into public.local_tasker_profiles(tasker_user_id,full_name,status,areas_served) values
    (t1,'Mama Ayo','published','Ikeja'),(t2,'Samsole','published','Yaba'),(t4,'Four','published','Lekki'),(t5,'Five','published','Ajah'),(t6,'Six','published','Ajah'),(t7,'Seven','published','Ajah');
  insert into public.taskers(user_id,available) values (t1::text,true),(t2::text,true),(t4::text,true);
  insert into public.coordinator_assignments(tasker_user_id,coordinator_id,assigned_by,assign_reason) values (t1,c1,sa,'seed'),(t4,ops,sa,'seed');
  -- bookings. bk1 locked (3 wrong tries), bk1b second open booking of t1, bk2 completed, bk3 worker t2 has no coordinator, bk4 ordinary booking,
  -- bk5 one wrong try, bk6 frozen by a problem report, bk7 in the care of the acting admin's own coordinator account, bk8 unpaid but 3 tries, bk9 five "unreachable"
  insert into public.bookings(id,status,customer_id,tasker_id,payment_status,amount,code_attempts) values
    (bk1,'confirmed',cust,t1,'paid',25000,3),(bk1b,'confirmed',cust,t1,'paid',9000,0),(bk2,'completed',cust,t1,'released',12000,3),
    (bk3,'confirmed',cust,t2,'paid',7000,0),(bk4,'confirmed',cust,t5,'paid',5000,3),(bk5,'confirmed',cust,t1,'paid',6000,1),
    (bk6,'confirmed',cust,t1,'paid',6500,3),(bk7,'confirmed',cust,t4,'paid',8000,3),(bk8,'pending',cust,t1,'unpaid',null,3),(bk9,'confirmed',cust,t1,'paid',4000,0);
  insert into public.local_booking_state(booking_id,coordinator_id,original_coordinator_id,tasker_user_id,lt_status,resume_status) values
    (bk1,c1,c1,t1,'quote_approved',null),(bk1b,c1,c1,t1,'awaiting_tasker_confirmation',null),(bk2,c1,c1,t1,'quote_approved',null),
    (bk3,null,null,t2,'needs_reassignment','tasker_confirmed'),(bk5,c1,c1,t1,'assigned',null),(bk6,c1,c1,t1,'assigned',null),
    (bk7,ops,ops,t4,'assigned',null),(bk8,c1,c1,t1,'assigned',null),(bk9,c1,c1,t1,'quote_approved',null);
  insert into public.frozen_bookings values (bk6);
  insert into public.local_booking_exceptions(booking_id,kind,coordinator_id,note) values (bk1,'customer_unreachable',c1,'PRIVATE-NOTE-TEXT'),(bk1,'tasker_no_show',c1,'PRIVATE-NOTE-TEXT'),(bk2,'customer_unreachable',c1,null);
  insert into public.local_booking_exceptions(booking_id,kind,coordinator_id) select bk9,'customer_unreachable',c1 from generate_series(1,5);
  insert into public.escrow_payments(booking_id,status,amount,platform_fee,tasker_amount) values (bk1,'held',25000,3000,22000);

  -- A. permissions
  perform pg_temp.as_(null);
  perform pg_temp.chk((public.admin_local_booking_coordinators()->>'ok')='false', 'A1 anonymous: coordinator list refused');
  perform pg_temp.chk((public.admin_local_booking_reassign(bk1,c2,'a reason that is long enough')->>'ok')='false', 'A2 anonymous: reassign refused');
  perform pg_temp.chk((public.admin_local_booking_unlock(bk1,'a reason that is long enough')->>'ok')='false', 'A3 anonymous: unlock refused');
  perform pg_temp.chk((public.admin_local_exception_list()->>'ok')='false', 'A4 anonymous: problems list refused');
  perform pg_temp.as_(nobody);
  perform pg_temp.chk((public.admin_local_booking_unlock(bk1,'a reason that is long enough')->>'ok')='false' and (public.admin_local_exception_list()->>'ok')='false', 'A5 stranger: refused');
  perform pg_temp.as_(sup);   -- support: bookings.view only
  perform pg_temp.chk((public.admin_local_exception_list()->>'ok')='true', 'A6 support admin can read the problems list');
  perform pg_temp.chk((public.admin_local_booking_coordinators()->>'ok')='false', 'A7 support admin: coordinator list refused');
  perform pg_temp.chk((public.admin_local_booking_reassign(bk1,c2,'a reason that is long enough')->>'ok')='false', 'A8 support admin: reassign refused');
  perform pg_temp.chk((public.admin_local_booking_unlock(bk1,'a reason that is long enough')->>'ok')='false', 'A9 support admin: unlock refused');
  perform pg_temp.chk((select code_attempts from public.bookings where id=bk1)=3 and (select coordinator_id from public.local_booking_state where booking_id=bk1)=c1, 'A10 refusals changed nothing');
  perform pg_temp.chk(exists (select 1 from public.admin_audit_log where action='local_booking.unlock' and outcome='refused'), 'A11 a refused attempt by an admin is logged');
  perform pg_temp.as_(ver);   -- verification admin: no bookings.view
  perform pg_temp.chk((public.admin_local_exception_list()->>'ok')='false', 'A12 verification admin: problems list refused');
  perform pg_temp.as_(sa,'aal1'); update public.admin_settings set text_value='on' where key='require_mfa';
  perform pg_temp.chk((public.admin_local_booking_unlock(bk1,'a reason that is long enough')->>'ok')='false', 'A13 two-step required but aal1: unlock refused');
  update public.admin_settings set text_value='off' where key='require_mfa';

  -- B. A12a SQL runs, and the detail now reads the real exception columns
  perform pg_temp.as_(ops);
  v := public.admin_booking_list('local');
  perform pg_temp.chk((v->>'ok')='true' and (v->>'total')::int=9 and (v->'counts'->>'needs_reassignment')='1', 'B1 A12a Local list works (9 Local bookings, 1 needs a coordinator)');
  v := public.admin_booking_list('regular');
  perform pg_temp.chk((v->>'ok')='true' and (v->>'total')::int=1, 'B2 A12a ordinary list works (1 booking)');
  v := public.admin_booking_list('local', null, 'locked');
  perform pg_temp.chk((v->'counts'->>'locked')='4', 'B3b Local counts include locked');
  perform pg_temp.chk((v->>'ok')='true' and (v->>'total')::int=4, 'B3 locked filter: 4 open bookings with 3 tries (bk2 is closed; bk8 is counted by the site''s own rule) got ' || (v->>'total'));
  v := public.admin_booking_detail(bk1);
  perform pg_temp.chk((v->>'ok')='true' and (v->'booking'->>'locked')='true' and v->'local' is not null, 'B4 detail works for a Local booking');
  perform pg_temp.chk(jsonb_array_length(v->'exceptions')=2 and (v->'exceptions'->0->>'happened_at') is not null and not (v->'sections_failed') ? 'exceptions', 'B5 detail reads happened_at for problems reported');
  perform pg_temp.chk(jsonb_array_length(v->'payment')=1, 'B6 payment held is read through booking_id');
  perform pg_temp.chk(v::text not ilike '%PRIVATE-NOTE-TEXT%', 'B7 coordinator note text is not in the detail');

  -- C. coordinator choices
  v := public.admin_local_booking_coordinators();
  perform pg_temp.chk((v->>'ok')='true' and jsonb_array_length(v->'coordinators')=3, 'C1 three active coordinators (the deactivated one is not offered)');
  perform pg_temp.chk(exists (select 1 from jsonb_array_elements(v->'coordinators') e where (e->>'is_me')='true'), 'C2 the admin''s own coordinator account is marked');

  -- D. reassign
  perform pg_temp.chk((public.admin_local_booking_reassign(bk1,c2,'short')->>'ok')='false', 'D1 short reason refused');
  perform pg_temp.chk((public.admin_local_booking_reassign(null,c2,'a reason that is long enough')->>'ok')='false', 'D2 no booking refused');
  perform pg_temp.chk((public.admin_local_booking_reassign(bk4,c2,'a reason that is long enough')->>'error') ilike '%not a Local%', 'D3 an ordinary booking is refused');
  perform pg_temp.chk((public.admin_local_booking_reassign(bk2,c2,'a reason that is long enough')->>'error') ilike '%closed%', 'D4 a completed booking is refused');
  perform pg_temp.chk((public.admin_local_booking_reassign(bk1,c1,'a reason that is long enough')->>'error') ilike '%already%', 'D5 same coordinator refused');
  perform pg_temp.chk((public.admin_local_booking_reassign(bk1,c3,'a reason that is long enough')->>'ok')='false'
                      and (select coordinator_id from public.local_booking_state where booking_id=bk1)=c1, 'D6 a deactivated coordinator is refused and nothing changes');
  perform pg_temp.chk((public.admin_local_booking_reassign(bk7,c2,'a reason that is long enough')->>'error') ilike '%own coordinator%'
                      and (select coordinator_id from public.local_booking_state where booking_id=bk7)=ops, 'D7 R-SELF: a booking in the admin''s own care is refused');
  perform pg_temp.chk((public.admin_local_booking_reassign(bk1,ops,'a reason that is long enough')->>'ok')='false', 'D8 R-SELF: cannot assign to the admin''s own coordinator account');
  amt_before := (select amount from public.bookings where id=bk1); pay_before := (select payment_status from public.bookings where id=bk1);
  select count(*) into ev_before from public.escrow_payments;
  v := public.admin_local_booking_reassign(bk1,c2,'Coordinator One is away for two weeks');
  perform pg_temp.chk((v->>'ok')='true' and (v->>'coordinator_id')=c2::text, 'D9 reassign works');
  perform pg_temp.chk((select coordinator_id from public.local_booking_state where booking_id=bk1)=c2 and (select coordinator_id from public.local_booking_state where booking_id=bk1b)=c2
                      and (select coordinator_id from public.local_booking_state where booking_id=bk9)=c2, 'D10 the booking and the worker''s other open bookings followed');
  perform pg_temp.chk((select coordinator_id from public.local_booking_state where booking_id=bk2)=c1, 'D11 a closed booking was not touched');
  perform pg_temp.chk((select coordinator_id from public.coordinator_assignments where tasker_user_id=t1 and ended_at is null)=c2, 'D12 the worker now belongs to the new coordinator');
  perform pg_temp.chk((select lt_status from public.local_booking_state where booking_id=bk1)='quote_approved', 'D13 the booking stage is unchanged (no consent or quote bypass)');
  perform pg_temp.chk((select amount from public.bookings where id=bk1)=amt_before and (select payment_status from public.bookings where id=bk1)=pay_before
                      and (select count(*) from public.escrow_payments)=ev_before, 'D14 no price, payment status or escrow row changed');
  perform pg_temp.chk(exists (select 1 from public.admin_audit_log where action='local_booking.reassign' and outcome='ok' and target_id=bk1::text and reason ilike '%away%'), 'D15 the admin log has the reassign with its reason');
  perform pg_temp.chk(exists (select 1 from public.lt_audit where action='local_booking_reassigned_by_admin'), 'D16 the Local Tasker audit has a row');
  perform pg_temp.chk(exists (select 1 from public.notes_sent where to_user=c2), 'D17 the new coordinator was told');
  -- worker with no coordinator: booking waits, assign brings it back to its earlier stage
  v := public.admin_local_booking_reassign(bk3,c1,'Giving Samsole a coordinator again');
  perform pg_temp.chk((v->>'ok')='true' and (select coordinator_id from public.local_booking_state where booking_id=bk3)=c1
                      and (select lt_status from public.local_booking_state where booking_id=bk3)='tasker_confirmed', 'D18 a waiting booking (needs a coordinator) is placed and returns to its earlier stage');
  -- capacity: c2 already has t1; add one more worker (capacity stand-in is 2), then a third must be refused and undone
  insert into public.coordinator_assignments(tasker_user_id,coordinator_id,assigned_by,assign_reason) values (t5,c2,sa,'seed');
  perform pg_temp.chk((public.admin_local_booking_reassign(bk3,c2,'Trying to exceed the plan limit')->>'ok')='false'
                      and (select coordinator_id from public.local_booking_state where booking_id=bk3)=c1
                      and (select coordinator_id from public.coordinator_assignments where tasker_user_id=t2 and ended_at is null)=c1, 'D19 a coordinator with no free place is refused and the whole move is undone');
  perform pg_temp.chk(exists (select 1 from public.admin_audit_log where action='local_booking.reassign' and outcome='refused' and target_id=bk3::text), 'D20 the refusal is logged');

  -- E. unlock
  perform pg_temp.chk((public.admin_local_booking_unlock(bk1,'short')->>'ok')='false', 'E1 short reason refused');
  perform pg_temp.chk((public.admin_local_booking_unlock(bk4,'Spoke to the customer by phone')->>'error') ilike '%not a Local%', 'E2 an ordinary booking is refused');
  perform pg_temp.chk((public.admin_local_booking_unlock(bk2,'Spoke to the customer by phone')->>'error') ilike '%closed%', 'E3 a closed booking is refused');
  perform pg_temp.chk((public.admin_local_booking_unlock(bk5,'Spoke to the customer by phone')->>'error') ilike '%not locked%', 'E4 a booking with one wrong try is refused');
  perform pg_temp.chk((public.admin_local_booking_unlock(bk6,'Spoke to the customer by phone')->>'error') ilike '%problem report%' and (select code_attempts from public.bookings where id=bk6)=3, 'E5 a booking with an open problem report is refused');
  perform pg_temp.chk((public.admin_local_booking_unlock(bk8,'Spoke to the customer by phone')->>'error') ilike '%not been made%', 'E6 an unpaid booking is refused');
  perform pg_temp.chk((public.admin_local_booking_unlock(bk7,'Spoke to the customer by phone')->>'error') ilike '%own coordinator%' and (select code_attempts from public.bookings where id=bk7)=3, 'E7 R-SELF: own coordinator account refused');
  amt_before := (select amount from public.bookings where id=bk1);
  v := public.admin_local_booking_unlock(bk1,'Spoke to the customer by phone and confirmed the job');
  perform pg_temp.chk((v->>'ok')='true' and (select code_attempts from public.bookings where id=bk1)=0, 'E8 unlock resets the wrong-code counter');
  perform pg_temp.chk((select amount from public.bookings where id=bk1)=amt_before and (select status from public.bookings where id=bk1)='confirmed'
                      and (select payment_status from public.bookings where id=bk1)='paid' and (select count(*) from public.escrow_payments)=ev_before, 'E9 nothing else on the booking changed (no release, no status change)');
  perform pg_temp.chk(exists (select 1 from public.admin_audit_log where action='local_booking.unlock' and outcome='ok' and target_id=bk1::text and reason ilike '%Spoke%'), 'E10 the admin log has the unlock with its reason');
  perform pg_temp.chk(exists (select 1 from public.lt_audit where action='release_code_unlocked_by_admin'), 'E11 the Local Tasker audit has a row');
  perform pg_temp.chk(exists (select 1 from public.notes_sent where title='A booking was unlocked'), 'E12 the coordinator was told');
  perform pg_temp.chk((public.admin_local_booking_unlock(bk1,'Spoke to the customer by phone again')->>'error') ilike '%not locked%', 'E13 a second unlock is refused (not locked any more)');

  -- F. problems queue
  v := public.admin_local_exception_list();
  perform pg_temp.chk((v->>'ok')='true' and (v->>'total')::int=2 and (v->'counts'->>'all')='3' and (v->'counts'->>'open')='2', 'F1 two open bookings with problems (the closed one only under All)');
  perform pg_temp.chk((v->'counts'->>'limit_reached')='1' and (v->'counts'->>'no_show')='1', 'F2 counts: 1 at the five-attempt limit, 1 with a no-show');
  perform pg_temp.chk((public.admin_local_exception_list('limit_reached')->>'total')='1' and (public.admin_local_exception_list('no_show')->>'total')='1' and (public.admin_local_exception_list('all')->>'total')='3', 'F3 filters work');
  perform pg_temp.chk((public.admin_local_exception_list('bogus')->>'ok')='false', 'F4 an unknown filter is refused');
  perform pg_temp.chk(v::text not ilike '%PRIVATE-NOTE-TEXT%' and not (v->'items'->0 ? 'note'), 'F5 the coordinator note is never returned');
  perform pg_temp.chk((v->'items'->0->>'customer_name') is not null or (v->'items'->1->>'customer_name') is not null, 'F6 names are joined');

  -- G. grants and secrets
  perform pg_temp.chk(has_function_privilege('authenticated','public.admin_local_booking_unlock(uuid,text)','execute') and not has_function_privilege('anon','public.admin_local_booking_unlock(uuid,text)','execute')
                      and not has_function_privilege('anon','public.admin_local_exception_list(text,integer)','execute'), 'G1 authenticated may call them, anon may not (each checks the permission itself)');
  perform pg_temp.chk(not has_table_privilege('authenticated','public.bookings','update') and not has_table_privilege('authenticated','public.local_booking_state','update'), 'G2 the browser role has no table write on bookings or Local booking state');
  perform pg_temp.chk(not exists (select 1 from public.admin_audit_log where detail::text ilike '%PRIVATE-NOTE%' or reason ilike '%PRIVATE-NOTE%'), 'G3 no private note in the admin log');
end
$t$;
select case when ok then 'PASS ' else 'FAIL ' end || line from r order by n;
select 'TOTAL ' || count(*) || ', FAILED ' || count(*) filter (where not ok) from r;

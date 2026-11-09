-- LOCAL ONLY: run via run-a10.sh on a scratch Postgres (stand-ins, not the real database).
create temp table r (n serial, ok boolean, line text);
create function pg_temp.as_(p uuid, aal text default 'aal1') returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', case when p is null then '' else jsonb_build_object('sub', p::text, 'aal', aal)::text end, false);
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); end $f$;
create function pg_temp.chk(c boolean, t text) returns void language plpgsql as $f$ begin insert into r(ok,line) values (coalesce(c,false), t); end $f$;
do $t$
declare sa uuid := gen_random_uuid(); ops uuid := gen_random_uuid(); ver uuid := gen_random_uuid(); sup uuid := gen_random_uuid(); legacy uuid := gen_random_uuid(); nobody uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid(); t4 uuid := gen_random_uuid(); t5 uuid := gen_random_uuid(); notlt uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid();
  v jsonb; n int; n2 int; txt text; p1 numeric; p2 numeric;
begin
  insert into auth.users(id,email) values (sa,'sa@x'),(ops,'ops@x'),(ver,'ver@x'),(sup,'sup@x'),(legacy,'l@x'),(nobody,'n@x'),(c1,'c1@x'),(c2,'c2@x'),(c3,'c3@x');
  insert into public.admin_users(user_id,display_name,status) values (sa,'Super','active'),(ops,'Ops','active'),(ver,'Verif','active'),(sup,'Support','active');
  insert into public.admin_user_roles(user_id,role_key) values (sa,'super_admin'),(ops,'operations'),(ver,'verification'),(sup,'support');
  insert into public.support_staff(user_id,note) values (legacy,'legacy');
  insert into public.coordinators(user_id,status,display_name) values (c1,'active','Coord One'),(c2,'active','Coord Two'),(c3,'deactivated','Coord Three'),(ops,'active','Ops as coordinator');
  insert into public.coordinator_tiers_state values (c1,1);
  insert into public.users(id,name) values (t1,'Tasker One'),(t5,'Tasker Five');
  insert into public.local_tasker_profiles(tasker_user_id,full_name,status,areas_served,phone,skills,availability_notes,published_at,needs_republish) values
    (t1,'Tasker One','published','Ikeja','+2348031234567','{plumbing,tiling}','weekdays',now(),false),
    (t2,'Tasker Two','draft','Yaba','08099998888',null,null,null,false),
    (t3,'Tasker Three','inactive','Surulere',null,null,null,null,false),
    (t4,'Tasker Four','published','Lekki','08011112222',null,null,now(),false),
    (t5,'Tasker Five','published','Ajah','08033334444',null,null,now(),true);
  insert into public.taskers(user_id,available) values (t1::text,true),(t4::text,true),(t5::text,true);
  insert into public.coordinator_assignments(tasker_user_id,coordinator_id,assigned_by,assign_reason) values (t1,c1,sa,'seed'),(t5,c2,sa,'seed'),(t4,ops,sa,'seed');
  insert into public.identity_verifications(user_id,status,provider_session_id) values (t1,'VERIFIED','SESSION-SECRET-1'),(t5,'PENDING','SESSION-SECRET-2');
  insert into public.services(user_id,service_name,category,price,rate_unit,available,is_main) values (t1,'Plumbing repair','handyman',15000,'/job',true,true),(t1,'Tiling','handyman',9000,'/m2',true,false),(t5,'Cleaning','cleaning',5000,'/job',true,true);
  insert into public.local_tasker_photos(tasker_user_id,storage_path,kind,is_cover) values (t1,'t1/a.jpg','portfolio',true),(t1,'t1/b.jpg','portfolio',false),(t1,'t1/av.jpg','avatar',false);
  insert into public.local_tasker_photos(tasker_user_id,storage_path,kind,removed_at) values (t1,'t1/c.jpg','portfolio',now());
  insert into public.local_tasker_consents(tasker_user_id,purpose,method,evidence_ref,details) values (t1,'photos','in_person','EVIDENCE-REF-SECRET','CONSENT-NOTES-SECRET');
  insert into public.local_payouts(tasker_user_id,booking_id,status,amount,account_name) values (t1,gen_random_uuid(),'paid',12000,'ACCOUNT-HOLDER-SECRET');
  insert into public.local_payout_accounts(tasker_user_id,bank_name,account_number,account_name,last4,status) values (t1,'Some Bank','0123456789','ACCOUNT-HOLDER-SECRET','6789','active');
  insert into public.bookings(id,status) values (b1,'confirmed'),(b2,'completed');
  insert into public.local_booking_state(booking_id,coordinator_id,tasker_user_id,lt_status) values (b1,c1,t1,'assigned'),(b2,c2,t5,'tasker_confirmed');
  select price into p1 from public.services where user_id=t1 and service_name='Plumbing repair';

  -- A. permissions
  perform pg_temp.as_(null);   v := public.admin_local_tasker_list(); perform pg_temp.chk((v->>'ok')='false', 'A1 anonymous: list refused');
  v := public.admin_local_tasker_detail(t1); perform pg_temp.chk((v->>'ok')='false', 'A2 anonymous: detail refused');
  perform pg_temp.as_(nobody); v := public.admin_local_tasker_list(); perform pg_temp.chk((v->>'ok')='false', 'A3 stranger: list refused');
  perform pg_temp.as_(legacy); v := public.admin_local_tasker_list(); perform pg_temp.chk((v->>'ok')='false', 'A4 legacy support_staff (not an admin): list refused');
  perform pg_temp.as_(sup);    v := public.admin_local_tasker_list(); perform pg_temp.chk((v->>'ok')='false', 'A5 support admin (no local_taskers.view): list refused');
  v := public.admin_local_tasker_detail(t1); perform pg_temp.chk((v->>'ok')='false', 'A6 support admin: detail refused');
  perform pg_temp.as_(ver);    v := public.admin_local_tasker_list();
  perform pg_temp.chk((v->>'ok')='true' and (v->>'can_manage')='false' and (v->>'can_assign')='false', 'A7 verification admin: can view, cannot manage or assign');
  perform pg_temp.as_(sa,'aal1'); update public.admin_settings set text_value='on' where key='require_mfa';
  v := public.admin_local_tasker_list(); perform pg_temp.chk((v->>'ok')='false', 'A8 two-step required but aal1: refused');
  perform pg_temp.as_(sa,'aal2'); v := public.admin_local_tasker_list(); perform pg_temp.chk((v->>'ok')='true', 'A9 aal2: allowed');
  update public.admin_settings set text_value='off' where key='require_mfa';
  update public.admin_users set status='suspended' where user_id=ops; perform pg_temp.as_(ops);
  v := public.admin_local_tasker_list(); perform pg_temp.chk((v->>'ok')='false', 'A10 suspended admin refused');
  update public.admin_users set status='active' where user_id=ops;

  -- B. list
  perform pg_temp.as_(ops); v := public.admin_local_tasker_list();
  perform pg_temp.chk((v->>'ok')='true' and (v->>'total')::int=5 and jsonb_array_length(v->'items')=5, 'B1 five Local Taskers listed');
  perform pg_temp.chk((v->'counts'->>'published')='3' and (v->'counts'->>'not_published')='1' and (v->'counts'->>'inactive')='1', 'B2 counts: 3 published, 1 not published, 1 inactive');
  perform pg_temp.chk((v->'counts'->>'unassigned')='1', 'B3 unassigned count ignores the inactive one (1: Tasker Two)');
  perform pg_temp.chk((v->'counts'->>'unverified')='3' and (v->'counts'->>'needs_republish')='1', 'B4 unverified (not inactive) 3, needs republish 1');
  perform pg_temp.chk(position('08099998888' in v::text)=0 and position('2348031234567' in v::text)=0 and position('SESSION-SECRET' in v::text)=0, 'B5 list never contains a phone number or provider session id');
  perform pg_temp.chk((select (x->>'identity_verified')::boolean from jsonb_array_elements(v->'items') x where x->>'tasker_user_id'=t1::text), 'B6 verified flag from the identity table');
  perform pg_temp.chk((select x->>'coordinator_name' from jsonb_array_elements(v->'items') x where x->>'tasker_user_id'=t1::text)='Coord One', 'B7 coordinator name shown');
  perform pg_temp.chk(jsonb_array_length(v->'coordinators')=3 and not exists (select 1 from jsonb_array_elements(v->'coordinators') x where x->>'user_id'=c3::text), 'B8 only active coordinators offered (3: c1, c2, ops)');
  perform pg_temp.chk((select (x->>'capacity')::int from jsonb_array_elements(v->'coordinators') x where x->>'user_id'=c1::text)=2, 'B9 coordinator capacity shown');
  v := public.admin_local_tasker_list(null,'published'); perform pg_temp.chk((v->>'total')='3', 'B10 filter published = 3');
  v := public.admin_local_tasker_list(null,'unassigned'); perform pg_temp.chk((v->>'total')='1' and v->'items'->0->>'name'='Tasker Two', 'B11 filter unassigned = Tasker Two');
  v := public.admin_local_tasker_list(null,'inactive'); perform pg_temp.chk((v->>'total')='1', 'B12 filter inactive = 1');
  v := public.admin_local_tasker_list(null,'has_bookings'); perform pg_temp.chk((v->>'total')='2', 'B13 filter has bookings = 2');
  v := public.admin_local_tasker_list(null,'needs_republish'); perform pg_temp.chk((v->>'total')='1' and v->'items'->0->>'name'='Tasker Five', 'B14 filter needs republish = Tasker Five');
  v := public.admin_local_tasker_list(null,'unverified'); perform pg_temp.chk((v->>'total')='3', 'B15 filter unverified = 3');
  v := public.admin_local_tasker_list('five'); perform pg_temp.chk((v->>'total')='1', 'B16 search by name, any case');
  v := public.admin_local_tasker_list(t1::text); perform pg_temp.chk((v->>'total')='1', 'B17 search by id');
  v := public.admin_local_tasker_list('%'); perform pg_temp.chk((v->>'total')='0', 'B18 a percent sign is text, not a wildcard');
  v := public.admin_local_tasker_list(null,'all',c1); perform pg_temp.chk((v->>'total')='1', 'B19 filter by coordinator');
  v := public.admin_local_tasker_list(null,'bogus'); perform pg_temp.chk((v->>'ok')='false', 'B20 unknown filter refused');
  v := public.admin_local_tasker_list(null,'all',null,4); perform pg_temp.chk((v->>'ok')='true' and jsonb_array_length(v->'items')=1 and (v->>'total')='5', 'B21 offset 4 returns the last row, total stays 5');
  perform pg_temp.as_(ver); v := public.admin_local_tasker_list(); perform pg_temp.chk((v->>'ok')='true' and (v->>'total')='5', 'B22 verification admin sees the list');

  -- C. detail
  perform pg_temp.as_(ops); v := public.admin_local_tasker_detail(t1);
  perform pg_temp.chk((v->>'ok')='true' and v->'profile'->>'name'='Tasker One' and v->'profile'->>'phone_hint'='ending 567', 'C1 profile with a masked phone hint');
  txt := v::text;
  perform pg_temp.chk(position('08099998888' in txt)=0 and position('2348031234567' in txt)=0 and position('+234' in txt)=0, 'C2 full phone number never returned');
  perform pg_temp.chk(position('EVIDENCE-REF-SECRET' in txt)=0 and position('CONSENT-NOTES-SECRET' in txt)=0, 'C3 consent evidence and notes never returned');
  perform pg_temp.chk(position('ACCOUNT-HOLDER-SECRET' in txt)=0 and position('0123456789' in txt)=0 and position('SESSION-SECRET' in txt)=0, 'C4 payout account holder, account number and provider session never returned');
  perform pg_temp.chk(position('t1/a.jpg' in txt)=0, 'C5 no photo file names returned');
  perform pg_temp.chk(jsonb_array_length(v->'services')=2 and (select (x->>'price')::numeric from jsonb_array_elements(v->'services') x where x->>'service_name'='Plumbing repair')=15000, 'C6 services shown with prices (read only)');
  perform pg_temp.chk((v->'photos'->>'portfolio')='2' and (v->'photos'->>'profile_picture')='1' and (v->'photos'->>'removed')='1', 'C7 photo counts: 2 portfolio, 1 profile picture, 1 removed');
  perform pg_temp.chk(jsonb_array_length(v->'consents')=1 and v->'consents'->0->>'purpose'='photos' and v->'consents'->0->>'method'='in_person', 'C8 consent record shows purpose and method');
  perform pg_temp.chk(v->'identity'->>'status'='VERIFIED', 'C9 identity status shown');
  perform pg_temp.chk(jsonb_array_length(v->'bookings')=1 and v->'bookings'->0->>'booking_status'='confirmed', 'C10 booking history');
  perform pg_temp.chk(jsonb_array_length(v->'payouts')=1 and v->'payouts'->0->>'status'='paid' and v->'payout_accounts'->0->>'last4'='6789', 'C11 payout status and last four');
  perform pg_temp.chk(v->'coordinator'->>'name'='Coord One' and jsonb_array_length(v->'history')=1, 'C12 current coordinator and history');
  perform pg_temp.chk(jsonb_array_length(v->'sections_failed')=0 and (v->'profile'->>'in_my_care')='false', 'C13 no section failed; not in the viewer''s own care');
  v := public.admin_local_tasker_detail(t4); perform pg_temp.chk((v->'profile'->>'in_my_care')='true', 'C14 a Local Tasker in the viewer''s own coordinator care is marked');
  v := public.admin_local_tasker_detail(notlt); perform pg_temp.chk((v->>'ok')='false', 'C15 not a Local Tasker: not found');
  v := public.admin_local_tasker_detail(null); perform pg_temp.chk((v->>'ok')='false', 'C16 null id refused');

  -- D. unpublish
  perform pg_temp.as_(ver); v := public.admin_local_tasker_unpublish(t5, 'Customer complaint under review');
  perform pg_temp.chk((v->>'ok')='false', 'D1 verification admin (view only): unpublish refused');
  select count(*) into n from public.admin_audit_log where action='local_tasker.unpublish' and outcome='refused';
  perform pg_temp.chk(n=1, 'D2 refusal logged once');
  perform pg_temp.as_(sup); v := public.admin_local_tasker_unpublish(t5, 'Customer complaint under review'); perform pg_temp.chk((v->>'ok')='false', 'D3 support admin refused');
  perform pg_temp.as_(nobody); v := public.admin_local_tasker_unpublish(t5, 'Customer complaint under review'); perform pg_temp.chk((v->>'ok')='false', 'D4 stranger refused');
  perform pg_temp.as_(sa); v := public.admin_local_tasker_unpublish(t5, 'short'); perform pg_temp.chk((v->>'ok')='false' and (select status from public.local_tasker_profiles where tasker_user_id=t5)='published', 'D5 short reason refused, nothing changed');
  v := public.admin_local_tasker_unpublish(t2, 'Not live, should refuse'); perform pg_temp.chk((v->>'ok')='false', 'D6 not published: refused');
  v := public.admin_local_tasker_unpublish(null, 'Customer complaint under review'); perform pg_temp.chk((v->>'ok')='false', 'D7 null id refused');
  perform pg_temp.as_(ops); v := public.admin_local_tasker_unpublish(t4, 'Trying my own coordinator worker');
  perform pg_temp.chk((v->>'ok')='false' and (select status from public.local_tasker_profiles where tasker_user_id=t4)='published', 'D8 R-SELF: a Local Tasker in the admin''s own care is refused');
  perform pg_temp.as_(sa); select count(*) into n from public.notes_sent;
  v := public.admin_local_tasker_unpublish(t5, 'Customer complaint under review');
  perform pg_temp.chk((v->>'ok')='true' and (select status from public.local_tasker_profiles where tasker_user_id=t5)='ready', 'D9 unpublish: status back to ready');
  perform pg_temp.chk((select available from public.taskers where user_id=t5::text)=false, 'D10 the customer-facing taskers row is switched off');
  perform pg_temp.chk((select count(*) from public.coordinator_assignments where tasker_user_id=t5 and ended_at is null)=1, 'D11 the assignment is untouched by unpublish');
  perform pg_temp.chk((select count(*) from public.admin_audit_log where action='local_tasker.unpublish' and outcome='ok' and reason='Customer complaint under review')=1, 'D12 one ok row in the admin log, with the reason');
  perform pg_temp.chk((select count(*) from public.lt_audit where action='local_tasker_unpublished_by_admin')=1, 'D13 Local Tasker audit row written');
  perform pg_temp.chk((select count(*) from public.notes_sent)=n+1 and not exists (select 1 from public.notes_sent where title ilike '%complaint%'), 'D14 the coordinator was told; the reason is not in the notification');
  v := public.admin_local_tasker_unpublish(t5, 'Customer complaint under review'); perform pg_temp.chk((v->>'ok')='false', 'D15 second unpublish refused (already not published)');
  perform pg_temp.chk((select price from public.services where user_id=t1 and service_name='Plumbing repair')=p1 and (select price from public.services where user_id=t5)=5000, 'D16 no price changed anywhere');

  -- E. deactivate
  perform pg_temp.as_(ver); v := public.admin_local_tasker_deactivate(t1, 'Moved away, no longer working'); perform pg_temp.chk((v->>'ok')='false', 'E1 view-only admin refused');
  perform pg_temp.as_(sa); v := public.admin_local_tasker_deactivate(t1, 'Moved away, no longer working');
  perform pg_temp.chk((v->>'ok')='false' and (v->>'open_bookings')='1' and (select status from public.local_tasker_profiles where tasker_user_id=t1)='published', 'E2 an open booking blocks deactivation, nothing changed');
  perform pg_temp.chk((select count(*) from public.admin_audit_log where action='local_tasker.deactivate' and outcome='refused')>=1, 'E3 the refusal is logged');
  perform pg_temp.as_(ops); v := public.admin_local_tasker_deactivate(t4, 'Trying my own coordinator worker'); perform pg_temp.chk((v->>'ok')='false', 'E4 R-SELF refused');
  perform pg_temp.as_(sa); v := public.admin_local_tasker_deactivate(t1, 'short'); perform pg_temp.chk((v->>'ok')='false', 'E5 short reason refused');
  update public.bookings set status='completed' where id=b1;
  select count(*) into n from public.coordinator_assignments where tasker_user_id=t1;
  v := public.admin_local_tasker_deactivate(t1, 'Moved away, no longer working');
  perform pg_temp.chk((v->>'ok')='true' and (select status from public.local_tasker_profiles where tasker_user_id=t1)='inactive', 'E6 once the booking is completed, deactivate works');
  perform pg_temp.chk((select available from public.taskers where user_id=t1::text)=false, 'E7 customer-facing row switched off');
  perform pg_temp.chk((select count(*) from public.coordinator_assignments where tasker_user_id=t1)=n and (select count(*) from public.coordinator_assignments where tasker_user_id=t1 and ended_at is null)=0, 'E8 assignment history kept (same row count), the active one ended');
  perform pg_temp.chk((select count(*) from public.services where user_id=t1)=2 and (select count(*) from public.local_tasker_photos where tasker_user_id=t1)=4 and (select count(*) from public.local_tasker_consents where tasker_user_id=t1)=1
                      and (select count(*) from public.local_payouts where tasker_user_id=t1)=1 and (select count(*) from public.local_booking_state where tasker_user_id=t1)=1, 'E9 services, photos, consents, payouts and bookings all kept');
  perform pg_temp.chk((select count(*) from public.identity_verifications where user_id=t1)=1 and (select status from public.identity_verifications where user_id=t1)='VERIFIED', 'E10 identity record untouched');
  v := public.admin_local_tasker_deactivate(t1, 'Moved away, no longer working'); perform pg_temp.chk((v->>'ok')='false', 'E11 already deactivated refused');
  v := public.admin_local_tasker_deactivate(t3, 'Already inactive in seed data'); perform pg_temp.chk((v->>'ok')='false', 'E12 seed inactive refused');
  v := public.admin_local_tasker_deactivate(notlt, 'Not a Local Tasker at all'); perform pg_temp.chk((v->>'ok')='false', 'E13 not a Local Tasker refused');
  v := public.admin_coordinator_overview(); perform pg_temp.chk((select (x->>'workers')::int from jsonb_array_elements(v->'coordinators') x where x->>'user_id'=c1::text)=0, 'E14 the coordinator''s place was freed');

  -- F. placing a Local Tasker reuses the A9 function (no second assign function exists)
  perform pg_temp.chk((select count(*) from pg_proc where proname ilike 'admin\_local\_tasker\_%assign%')=0, 'F1 A10 added no assign function');
  perform pg_temp.as_(ops); v := public.admin_coordinator_assign_local_tasker(t2, c1, 'First placement by operations');
  perform pg_temp.chk((v->>'ok')='true' and (v->>'kind')='assigned', 'F2 an unassigned Local Tasker is placed through the A9 function');
  v := public.admin_local_tasker_list(null,'unassigned'); perform pg_temp.chk((v->>'total')='0', 'F3 the unassigned list is now empty');
  v := public.admin_coordinator_assign_local_tasker(t5, c1, 'Move to a full coordinator'); n := (select count(*) from public.coordinator_assignments where coordinator_id=c1 and ended_at is null);
  perform pg_temp.chk(n<=2, 'F4 the plan limit still holds (never more than the capacity of 2)');

  -- G. grants
  perform pg_temp.chk(not has_function_privilege('anon','public.admin_local_tasker_list(text,text,uuid,integer)','execute')
                      and not has_function_privilege('anon','public.admin_local_tasker_detail(uuid)','execute')
                      and not has_function_privilege('anon','public.admin_local_tasker_unpublish(uuid,text)','execute')
                      and not has_function_privilege('anon','public.admin_local_tasker_deactivate(uuid,text)','execute'), 'G1 anon has no execute on any A10 function');
  perform pg_temp.chk(has_function_privilege('authenticated','public.admin_local_tasker_list(text,text,uuid,integer)','execute')
                      and has_function_privilege('authenticated','public.admin_local_tasker_unpublish(uuid,text)','execute'), 'G2 authenticated may call them (each checks the admin permission)');
  perform pg_temp.chk(not has_function_privilege('authenticated','public._a10_pick(jsonb,text[])','execute'), 'G3 the helper is not callable from the browser');
  perform pg_temp.chk(not has_table_privilege('authenticated','public.local_tasker_profiles','update') and not has_table_privilege('authenticated','public.services','update') and not has_table_privilege('authenticated','public.local_payouts','update'), 'G4 no table write was granted to the browser by A10');
  perform pg_temp.chk(not exists (select 1 from public.admin_audit_log where detail::text ilike '%SESSION-SECRET%' or reason ilike '%SECRET%'), 'G5 no secret value in the admin log');
end
$t$;
select case when ok then 'PASS ' else 'FAIL ' end || line from r order by n;
select 'TOTAL ' || count(*) || ', FAILED ' || count(*) filter (where not ok) from r;

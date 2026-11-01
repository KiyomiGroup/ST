-- =====================================================================
-- W2d self-test. Run AFTER w2a-tables.sql, w2b-create.sql and w2d-accounts.sql.
-- Supabase dashboard > SQL Editor > New query > paste the WHOLE file > Run.
-- It makes temporary test rows, runs the four bank_account_* functions against them, checks the results, and UNDOES
-- everything before it ends (nothing is left in your tables, no real balance changes, no notification stays).
-- The result table has a SUMMARY row first, then one row per check.
-- Success = the SUMMARY row says "0 failed". Only if something says FAIL, copy the FAIL rows
-- (select the cells, Ctrl+C) and send them back.
-- Rows that start with INFO are not tests.
-- NOTE: the real two-at-once (concurrency) test cannot run in the SQL editor (it needs two connections);
-- it is run by the developer and listed in the W2d handoff.
-- =====================================================================

create or replace function pg_temp.t(p_label text, p_ok boolean, p_detail text default '') returns text
language sql as $$
  select case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end || ' | ' || p_label
         || case when not coalesce(p_ok, false) and p_detail <> '' then ' | ' || p_detail else '' end
$$;

-- run one of the functions AS a role (default: the service role); a refusal comes back as {"err": SQLSTATE, "msg": text}
create or replace function pg_temp.call(p_expr text, p_role text default 'service_role') returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  begin
    execute format('set local role %I', p_role);
    execute 'select ' || p_expr into v;
  exception when others then
    v := jsonb_build_object('err', sqlstate, 'msg', sqlerrm);
  end;
  execute 'reset role';
  return v;
end $$;

create or replace function pg_temp.add(p_user uuid, p_code text, p_bank text, p_num text, p_name text, p_role text default 'service_role') returns jsonb
language sql as $$
  select pg_temp.call(format('public.bank_account_add(%L::uuid,%L,%L,%L,%L)', p_user, p_code, p_bank, p_num, p_name), p_role) $$;
create or replace function pg_temp.def(p_user uuid, p_id uuid) returns jsonb
language sql as $$ select pg_temp.call(format('public.bank_account_set_default(%L::uuid,%L::uuid)', p_user, p_id)) $$;
create or replace function pg_temp.rem(p_user uuid, p_id uuid) returns jsonb
language sql as $$ select pg_temp.call(format('public.bank_account_remove(%L::uuid,%L::uuid)', p_user, p_id)) $$;
create or replace function pg_temp.rcp(p_user uuid, p_id uuid, p_code text) returns jsonb
language sql as $$ select pg_temp.call(format('public.bank_account_set_recipient(%L::uuid,%L::uuid,%L)', p_user, p_id, p_code)) $$;

create or replace function pg_temp.nid(p jsonb) returns uuid language sql as $$ select (p ->> 'id')::uuid $$;
create or replace function pg_temp.n_live(p_user uuid) returns bigint language sql as $$
  select count(*) from public.withdrawal_bank_accounts where user_id = p_user and removed_at is null $$;
create or replace function pg_temp.n_all(p_user uuid) returns bigint language sql as $$
  select count(*) from public.withdrawal_bank_accounts where user_id = p_user $$;
create or replace function pg_temp.n_def(p_user uuid) returns bigint language sql as $$
  select count(*) from public.withdrawal_bank_accounts where user_id = p_user and removed_at is null and is_default $$;
create or replace function pg_temp.is_def(p_id uuid) returns boolean language sql as $$
  select is_default from public.withdrawal_bank_accounts where id = p_id $$;
create or replace function pg_temp.n_note(p_user uuid) returns bigint language sql as $$
  select count(*) from public.notifications where user_id = p_user and type = 'bank_account' $$;
create or replace function pg_temp.bal(p_user uuid) returns numeric language sql as $$
  select balance from public.wallets where user_id = p_user $$;
-- make one account older (created_at is not a frozen column); inside one test transaction now() never moves
create or replace function pg_temp.age(p_id uuid, p_hours numeric) returns void language sql as $$
  update public.withdrawal_bank_accounts set created_at = now() - (p_hours * interval '1 hour') where id = p_id $$;
create or replace function pg_temp.setbal(p_user uuid, p_bal numeric) returns void language plpgsql as $$
begin
  perform public._ensure_wallet(p_user);
  update public.wallets set balance = p_bal where user_id = p_user;
end $$;

create or replace function pg_temp.w2d_run() returns setof text
language plpgsql as $fn$
declare
  v_res  text[] := '{}';
  ua     uuid := gen_random_uuid();      -- the test tasker
  ub     uuid := gen_random_uuid();      -- a second tasker (owner of "someone else's" accounts)
  uc     uuid := gen_random_uuid();      -- not a tasker
  mode   text := 'isolated';
  r jsonb; r2 jsonb; r3 jsonb; r4 jsonb; v_t text; v_pass int; v_fail int; v_probe_ok boolean := false;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; b1 uuid; v_n bigint; v_ts timestamptz; v_note record; v_row public.withdrawal_bank_accounts;
  v_fn text; v_wid uuid; v_ref text;
  v_num1 constant text := '0123456789';
  v_num2 constant text := '0123456780';
  v_num3 constant text := '0123456781';
  v_num4 constant text := '0123456782';
begin
  begin  -- everything below is undone at the end by raising 'w2d_done'

    -- 0. Can fresh test users be created here? (If the live tables insist on real users, borrow two: still undone at the end.)
    begin
      begin
        insert into public.taskers (user_id) values (ua::text);
        perform public._ensure_wallet(ua);
        insert into public.wallet_transactions (user_id, type, amount, reference, status, note)
          values (ua, 'withdrawal', 1, 'wd-' || repeat('0', 32), 'pending', 'probe');
        insert into public.notifications (user_id, type, title, message, data, is_read)
          values (ua, 'bank_account', 'probe', 'probe', '{}', false);
        raise exception 'w2d_probe_ok';
      exception when others then
        if sqlerrm = 'w2d_probe_ok' then v_probe_ok := true; end if;
      end;
    end;
    if not v_probe_ok then
      -- borrow two existing taskers that have no withdrawals and no saved accounts; everything we do to them is undone at the end
      select t.user_id::uuid into ua from public.taskers t
       where t.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and not exists (select 1 from public.withdrawals w where w.user_id::text = t.user_id)
         and not exists (select 1 from public.withdrawal_bank_accounts a where a.user_id::text = t.user_id)
       order by t.user_id limit 1;
      select t.user_id::uuid into ub from public.taskers t
       where t.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and not exists (select 1 from public.withdrawals w where w.user_id::text = t.user_id)
         and not exists (select 1 from public.withdrawal_bank_accounts a where a.user_id::text = t.user_id)
         and t.user_id::uuid <> ua
       order by t.user_id limit 1;
      mode := 'borrowed (all changes undone)';
      if ua is null or ub is null then
        v_res := v_res || 'FAIL | test setup: could not create or find two taskers to test with. Send this row back.';
        raise exception 'w2d_done';
      end if;
    else
      insert into public.taskers (user_id) values (ua::text), (ub::text);
    end if;
    v_res := v_res || ('INFO | test tasker mode: ' || mode);
    perform pg_temp.setbal(ua, 50000);

    -- A. who may call them ------------------------------------------------------------------------------
    foreach v_fn in array array['public.bank_account_add(uuid,text,text,text,text)', 'public.bank_account_set_default(uuid,uuid)',
                                'public.bank_account_remove(uuid,uuid)', 'public.bank_account_set_recipient(uuid,uuid,text)'] loop
      v_res := v_res || pg_temp.t(v_fn || ' is SECURITY DEFINER with a fixed search_path',
        exists (select 1 from pg_proc p where p.oid = v_fn::regprocedure
                and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')));
      v_res := v_res || pg_temp.t(v_fn || ': anon, logged-in users and public cannot execute it',
        not has_function_privilege('anon', v_fn, 'execute') and not has_function_privilege('authenticated', v_fn, 'execute')
        and not has_function_privilege('public', v_fn, 'execute'));
      if exists (select 1 from pg_roles where rolname = 'service_role') then
        v_res := v_res || pg_temp.t(v_fn || ': service_role can execute it', has_function_privilege('service_role', v_fn, 'execute'));
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      r := pg_temp.add(ua, '058', 'Test Bank', v_num1, 'TEST PERSON', 'authenticated');
      v_res := v_res || pg_temp.t('calling add as a logged-in user is refused (42501)', r ->> 'err' = '42501', r::text);
      r := pg_temp.add(ua, '058', 'Test Bank', v_num1, 'TEST PERSON', 'anon');
      v_res := v_res || pg_temp.t('calling add as anon is refused (42501)', r ->> 'err' = '42501', r::text);
      v_res := v_res || pg_temp.t('refused calls saved nothing', pg_temp.n_all(ua) = 0);
    end if;

    -- B. refusals leave NOTHING behind ---------------------------------------------------------------------
    r := pg_temp.add(uc, '058', 'Test Bank', v_num1, 'TEST PERSON');
    v_res := v_res || pg_temp.t('add: a customer (not a tasker) is refused WA001', r ->> 'err' = 'WA001', r::text);
    v_res := v_res || pg_temp.t('add: ...and got no account, no notification and no wallet',
      pg_temp.n_all(uc) = 0 and pg_temp.n_note(uc) = 0 and not exists (select 1 from public.wallets where user_id = uc));
    r := pg_temp.def(uc, gen_random_uuid());      v_res := v_res || pg_temp.t('set_default: a customer is refused WA001', r ->> 'err' = 'WA001', r::text);
    r := pg_temp.rem(uc, gen_random_uuid());      v_res := v_res || pg_temp.t('remove: a customer is refused WA001', r ->> 'err' = 'WA001', r::text);
    r := pg_temp.rcp(uc, gen_random_uuid(), 'RCP_abc'); v_res := v_res || pg_temp.t('set_recipient: a customer is refused WA001', r ->> 'err' = 'WA001', r::text);
    v_res := v_res || pg_temp.t('customer refusals created no wallet', not exists (select 1 from public.wallets where user_id = uc));

    r := pg_temp.add(null, '058', 'Test Bank', v_num1, 'TEST PERSON'); v_res := v_res || pg_temp.t('add: null user refused WA002', r ->> 'err' = 'WA002', r::text);
    r := pg_temp.add(ua, null, 'Test Bank', v_num1, 'TEST PERSON');   v_res := v_res || pg_temp.t('add: null bank code refused WA002', r ->> 'err' = 'WA002', r::text);
    r := pg_temp.add(ua, '058', null, v_num1, 'TEST PERSON');         v_res := v_res || pg_temp.t('add: null bank name refused WA002', r ->> 'err' = 'WA002', r::text);
    r := pg_temp.add(ua, '058', 'Test Bank', null, 'TEST PERSON');    v_res := v_res || pg_temp.t('add: null account number refused WA002', r ->> 'err' = 'WA002', r::text);
    r := pg_temp.add(ua, '058', 'Test Bank', v_num1, null);           v_res := v_res || pg_temp.t('add: null account name refused WA002', r ->> 'err' = 'WA002', r::text);
    r := pg_temp.def(null, gen_random_uuid());  v_res := v_res || pg_temp.t('set_default: null user refused WA002', r ->> 'err' = 'WA002', r::text);
    r := pg_temp.def(ua, null);                 v_res := v_res || pg_temp.t('set_default: null id refused WA002', r ->> 'err' = 'WA002', r::text);
    r := pg_temp.rem(null, gen_random_uuid());  v_res := v_res || pg_temp.t('remove: null user refused WA002', r ->> 'err' = 'WA002', r::text);
    r := pg_temp.rem(ua, null);                 v_res := v_res || pg_temp.t('remove: null id refused WA002', r ->> 'err' = 'WA002', r::text);
    r := pg_temp.rcp(null, gen_random_uuid(), 'RCP_abc'); v_res := v_res || pg_temp.t('set_recipient: null user refused WA002', r ->> 'err' = 'WA002', r::text);
    r := pg_temp.rcp(ua, null, 'RCP_abc');      v_res := v_res || pg_temp.t('set_recipient: null id refused WA002', r ->> 'err' = 'WA002', r::text);

    r := pg_temp.add(ua, '058', 'Test Bank', '12345', 'TEST PERSON');       v_res := v_res || pg_temp.t('add: 5-digit number refused WA003', r ->> 'err' = 'WA003' and r ->> 'msg' like '%10-digit%', r::text);
    r := pg_temp.add(ua, '058', 'Test Bank', '01234567890', 'TEST PERSON'); v_res := v_res || pg_temp.t('add: 11-digit number refused WA003', r ->> 'err' = 'WA003', r::text);
    r := pg_temp.add(ua, '058', 'Test Bank', '01234abcde', 'TEST PERSON');  v_res := v_res || pg_temp.t('add: number with letters refused WA003', r ->> 'err' = 'WA003', r::text);
    r := pg_temp.add(ua, '058', 'Test Bank', '', 'TEST PERSON');            v_res := v_res || pg_temp.t('add: empty number refused WA003', r ->> 'err' = 'WA003', r::text);
    r := pg_temp.add(ua, '', 'Test Bank', v_num1, 'TEST PERSON');           v_res := v_res || pg_temp.t('add: empty bank code refused WA003', r ->> 'err' = 'WA003', r::text);
    r := pg_temp.add(ua, 'bad code!', 'Test Bank', v_num1, 'TEST PERSON');  v_res := v_res || pg_temp.t('add: bank code with odd characters refused WA003', r ->> 'err' = 'WA003', r::text);
    r := pg_temp.add(ua, '058', '   ', v_num1, 'TEST PERSON');              v_res := v_res || pg_temp.t('add: blank bank name refused WA003', r ->> 'err' = 'WA003', r::text);
    r := pg_temp.add(ua, '058', 'Test Bank', v_num1, '   ');                v_res := v_res || pg_temp.t('add: blank account name refused WA003', r ->> 'err' = 'WA003', r::text);
    r := pg_temp.add(ua, '058', 'Test Bank', v_num1, repeat('X', 201));     v_res := v_res || pg_temp.t('add: absurdly long account name refused WA003', r ->> 'err' = 'WA003', r::text);
    v_res := v_res || pg_temp.t('all those refusals saved nothing and notified nobody', pg_temp.n_all(ua) = 0 and pg_temp.n_note(ua) = 0);
    v_res := v_res || pg_temp.t('refusal messages never contain the account number',
      not exists (select 1 where (pg_temp.add(ua, '058', 'Test Bank', '12345', 'TEST PERSON') ->> 'msg') like '%12345%'));

    -- C. add ---------------------------------------------------------------------------------------------------
    r := pg_temp.add(ua, ' 058 ', ' Test Bank ', ' ' || v_num1 || ' ', '  TEST PERSON  ');
    a1 := pg_temp.nid(r);
    v_res := v_res || pg_temp.t('add: first account saved', a1 is not null and r ->> 'err' is null, r::text);
    v_res := v_res || pg_temp.t('add: the first account becomes the default', (r ->> 'is_default')::boolean and pg_temp.is_def(a1), r::text);
    v_res := v_res || pg_temp.t('add: not flagged as already saved', (r ->> 'already_saved')::boolean = false, r::text);
    v_res := v_res || pg_temp.t('add: input is trimmed before it is stored',
      exists (select 1 from public.withdrawal_bank_accounts where id = a1 and bank_code = '058' and bank_name = 'Test Bank'
              and account_number = v_num1 and account_name = 'TEST PERSON'));
    v_res := v_res || pg_temp.t('add: result shows bank, name and last 4', r ->> 'bank_name' = 'Test Bank' and r ->> 'account_name' = 'TEST PERSON' and r ->> 'account_last4' = '6789', r::text);
    v_res := v_res || pg_temp.t('add: result has NO full account number and NO recipient code (key check)',
      not (r ? 'account_number') and not (r ? 'recipient_code') and r::text not like '%' || v_num1 || '%', r::text);
    v_res := v_res || pg_temp.t('add: a new account has no recipient code yet',
      exists (select 1 from public.withdrawal_bank_accounts where id = a1 and recipient_code is null and removed_at is null and last_used_at is null));
    v_res := v_res || pg_temp.t('add: one notification of type bank_account was written', pg_temp.n_note(ua) = 1);
    select * into v_note from public.notifications where user_id = ua and type = 'bank_account' order by created_at desc limit 1;
    v_res := v_res || pg_temp.t('add: notification text names the bank and last 4 only (no full number anywhere)',
      v_note.message like '%Test Bank%' and v_note.message like '%6789%' and v_note.message not like '%' || v_num1 || '%'
      and v_note.title not like '%' || v_num1 || '%' and v_note.data::text not like '%' || v_num1 || '%', v_note.message);
    v_res := v_res || pg_temp.t('add: notification says it was added and carries the account id',
      v_note.data ->> 'action' = 'added' and (v_note.data ->> 'bank_account_id')::uuid = a1 and not v_note.is_read);
    v_res := v_res || pg_temp.t('add: the wallet balance did not move', pg_temp.bal(ua) = 50000);

    r := pg_temp.add(ua, '044', 'Other Bank', v_num2, 'TEST PERSON');
    a2 := pg_temp.nid(r);
    v_res := v_res || pg_temp.t('add: second account saved and is NOT the default', a2 is not null and not (r ->> 'is_default')::boolean and not pg_temp.is_def(a2) and pg_temp.is_def(a1), r::text);
    v_res := v_res || pg_temp.t('add: still exactly one default', pg_temp.n_def(ua) = 1);
    v_res := v_res || pg_temp.t('add: two notifications so far', pg_temp.n_note(ua) = 2);

    -- duplicates -----------------------------------------------------------------------------------------------
    v_n := pg_temp.n_note(ua);
    r := pg_temp.add(ua, '058', 'Test Bank', v_num1, 'SOME OTHER NAME');
    v_res := v_res || pg_temp.t('add: the same bank + number again returns the EXISTING account', pg_temp.nid(r) = a1 and (r ->> 'already_saved')::boolean, r::text);
    v_res := v_res || pg_temp.t('add: ...keeps the stored (verified) name, saves no second row, sends no notification',
      r ->> 'account_name' = 'TEST PERSON' and pg_temp.n_live(ua) = 2 and pg_temp.n_note(ua) = v_n);
    r := pg_temp.add(ua, '044', 'Other Bank', v_num1, 'TEST PERSON');
    a3 := pg_temp.nid(r);
    v_res := v_res || pg_temp.t('add: the same number at a DIFFERENT bank is a different account (allowed)', a3 is not null and a3 <> a1 and (r ->> 'already_saved')::boolean = false, r::text);
    v_res := v_res || pg_temp.t('add: three live accounts, one default', pg_temp.n_live(ua) = 3 and pg_temp.n_def(ua) = 1);

    -- the limit ----------------------------------------------------------------------------------------------------
    v_n := pg_temp.n_note(ua);
    r := pg_temp.add(ua, '058', 'Test Bank', v_num3, 'TEST PERSON');
    v_res := v_res || pg_temp.t('add: a 4th account is refused WA004', r ->> 'err' = 'WA004' and r ->> 'msg' like '%3 bank accounts%', r::text);
    v_res := v_res || pg_temp.t('add: ...saved nothing, no notification', pg_temp.n_live(ua) = 3 and pg_temp.n_note(ua) = v_n);
    r := pg_temp.add(ua, '058', 'Test Bank', v_num1, 'TEST PERSON');
    v_res := v_res || pg_temp.t('add: re-adding an account you already have works even at the limit (returns it)', pg_temp.nid(r) = a1 and (r ->> 'already_saved')::boolean, r::text);
    r := pg_temp.add(ub, '058', 'Test Bank', v_num1, 'TEST PERSON');
    b1 := pg_temp.nid(r);
    v_res := v_res || pg_temp.t('add: another tasker can save the same bank + number (limits are per user)', b1 is not null and b1 <> a1, r::text);
    v_res := v_res || pg_temp.t('add: ...and it is THEIR first, so their default', (r ->> 'is_default')::boolean and pg_temp.n_def(ub) = 1);
    v_res := v_res || pg_temp.t('add: user A still has exactly 3 and one default', pg_temp.n_live(ua) = 3 and pg_temp.n_def(ua) = 1);

    -- the limit follows withdrawal_limits() -----------------------------------------------------------------------------
    execute $e$create or replace function public.withdrawal_limits() returns jsonb language sql immutable as
      $f$ select jsonb_build_object('min_amount',500,'max_amount',500000,'daily_max',1000000,'max_saved_accounts',2,'new_account_cooldown_hours',0) $f$$e$;
    r := pg_temp.add(ub, '044', 'Other Bank', v_num2, 'TEST PERSON');
    v_res := v_res || pg_temp.t('add: with max_saved_accounts = 2 a second account is allowed', pg_temp.nid(r) is not null, r::text);
    r := pg_temp.add(ub, '044', 'Other Bank', v_num3, 'TEST PERSON');
    v_res := v_res || pg_temp.t('add: with max_saved_accounts = 2 a third is refused WA004, message says 2', r ->> 'err' = 'WA004' and r ->> 'msg' like '%2 bank accounts%', r::text);
    execute $e$create or replace function public.withdrawal_limits() returns jsonb language sql immutable as
      $f$ select jsonb_build_object('min_amount',500,'max_amount',500000,'daily_max',1000000,'max_saved_accounts',3,'new_account_cooldown_hours',0) $f$$e$;

    -- D. set_default ------------------------------------------------------------------------------------------------------
    r := pg_temp.def(ua, a2);
    v_res := v_res || pg_temp.t('set_default: switches the default to the chosen account', (r ->> 'changed')::boolean and pg_temp.is_def(a2) and not pg_temp.is_def(a1) and not pg_temp.is_def(a3), r::text);
    v_res := v_res || pg_temp.t('set_default: still exactly one default', pg_temp.n_def(ua) = 1);
    r := pg_temp.def(ua, a2);
    v_res := v_res || pg_temp.t('set_default: choosing the current default again is harmless (changed = false)', r ->> 'err' is null and (r ->> 'changed')::boolean = false and pg_temp.is_def(a2), r::text);
    r := pg_temp.def(ua, a3);
    v_res := v_res || pg_temp.t('set_default: can move again', (r ->> 'changed')::boolean and pg_temp.is_def(a3) and not pg_temp.is_def(a2) and pg_temp.n_def(ua) = 1, r::text);
    r := pg_temp.def(ua, b1);
    v_res := v_res || pg_temp.t('set_default: someone else''s account refused WA005', r ->> 'err' = 'WA005', r::text);
    v_res := v_res || pg_temp.t('set_default: ...and neither user''s default changed', pg_temp.is_def(a3) and pg_temp.is_def(b1) and pg_temp.n_def(ua) = 1 and pg_temp.n_def(ub) = 1);
    r := pg_temp.def(ua, gen_random_uuid());
    v_res := v_res || pg_temp.t('set_default: an unknown id refused WA005 (same message as someone else''s)', r ->> 'err' = 'WA005' and r ->> 'msg' = (pg_temp.def(ua, b1) ->> 'msg'), r::text);
    v_res := v_res || pg_temp.t('set_default: sends no notification (add and remove only)', pg_temp.n_note(ua) = 3);

    -- E. remove ----------------------------------------------------------------------------------------------------------------
    -- make the creation order known: a1 oldest, then a2, then a3 (inside one test transaction now() never moves)
    perform pg_temp.age(a1, 30); perform pg_temp.age(a2, 20); perform pg_temp.age(a3, 10);
    perform pg_temp.def(ua, a3);

    -- E1. an open withdrawal blocks removal of ITS account only
    r := pg_temp.call(format('public.withdrawal_create(%L::uuid, 1000, %L::uuid)', ua, a3));
    v_ref := r ->> 'reference'; v_wid := (r ->> 'withdrawal_id')::uuid;
    v_res := v_res || pg_temp.t('setup: a pending withdrawal to account 3 was created', v_ref is not null, r::text);
    v_n := pg_temp.n_note(ua);
    r := pg_temp.rem(ua, a3);
    v_res := v_res || pg_temp.t('remove: refused WA006 while a PENDING withdrawal uses the account', r ->> 'err' = 'WA006', r::text);
    v_res := v_res || pg_temp.t('remove: ...nothing changed (still live, still default, no notification)',
      pg_temp.n_live(ua) = 3 and pg_temp.is_def(a3) and pg_temp.n_note(ua) = v_n);
    update public.withdrawals set status = 'processing' where id = v_wid;
    r := pg_temp.rem(ua, a3);
    v_res := v_res || pg_temp.t('remove: refused WA006 while a PROCESSING withdrawal uses it', r ->> 'err' = 'WA006', r::text);
    r := pg_temp.rem(ua, a1);
    v_res := v_res || pg_temp.t('remove: a DIFFERENT account of the same tasker can be removed while a withdrawal is open', (r ->> 'removed')::boolean, r::text);
    -- put a1 back for the next steps
    r := pg_temp.add(ua, '058', 'Test Bank', v_num1, 'TEST PERSON');
    a1 := pg_temp.nid(r);
    v_res := v_res || pg_temp.t('add: a removed account can be saved again (new row)', a1 is not null and pg_temp.n_live(ua) = 3, r::text);
    perform pg_temp.age(a1, 30);
    update public.withdrawals set status = 'success', settled_at = now() where id = v_wid;
    r := pg_temp.rem(ua, a3);
    v_res := v_res || pg_temp.t('remove: allowed once the withdrawal has finished (success)', (r ->> 'removed')::boolean, r::text);
    v_res := v_res || pg_temp.t('remove: it is a SOFT delete (row kept, removed_at set, no longer default)',
      exists (select 1 from public.withdrawal_bank_accounts where id = a3 and removed_at is not null and not is_default));
    v_res := v_res || pg_temp.t('remove: the old withdrawal still points at the removed account and keeps its snapshot',
      exists (select 1 from public.withdrawals where id = v_wid and bank_account_id = a3 and account_number = v_num1 and bank_name = 'Other Bank'));
    v_res := v_res || pg_temp.t('remove: it was the default, so the OLDEST remaining live account (a1) is now the default',
      (r ->> 'new_default_id')::uuid = a1 and pg_temp.is_def(a1) and not pg_temp.is_def(a2) and pg_temp.n_def(ua) = 1, r::text);
    select * into v_note from public.notifications where user_id = ua and type = 'bank_account' order by created_at desc, id limit 1;
    v_res := v_res || pg_temp.t('remove: a notification says removed, with last 4 only',
      (select count(*) from public.notifications where user_id = ua and type = 'bank_account' and data ->> 'action' = 'removed' and data ->> 'bank_account_id' = a3::text) = 1
      and not exists (select 1 from public.notifications where user_id = ua and type = 'bank_account' and (message like '%' || v_num1 || '%' or message like '%' || v_num2 || '%' or message like '%' || v_num3 || '%' or data::text like '%' || v_num3 || '%')));
    v_res := v_res || pg_temp.t('remove: result has no account number or recipient code', not (r ? 'account_number') and not (r ? 'recipient_code'), r::text);

    v_n := pg_temp.n_note(ua);
    r := pg_temp.rem(ua, a3);
    v_res := v_res || pg_temp.t('remove: removing it AGAIN is a harmless success (already_removed), no second notification',
      r ->> 'err' is null and (r ->> 'already_removed')::boolean and not (r ->> 'removed')::boolean and pg_temp.n_note(ua) = v_n, r::text);
    r := pg_temp.rem(ua, b1);
    v_res := v_res || pg_temp.t('remove: someone else''s account refused WA005', r ->> 'err' = 'WA005', r::text);
    v_res := v_res || pg_temp.t('remove: ...and it is untouched', exists (select 1 from public.withdrawal_bank_accounts where id = b1 and removed_at is null and is_default));
    r := pg_temp.rem(ua, gen_random_uuid());
    v_res := v_res || pg_temp.t('remove: an unknown id refused WA005', r ->> 'err' = 'WA005', r::text);

    -- a removed account cannot receive a withdrawal any more (W2b refuses WD008)
    update public.withdrawals set status = 'failed' where user_id = ua and status in ('pending', 'processing');
    r := pg_temp.call(format('public.withdrawal_create(%L::uuid, 1000, %L::uuid)', ua, a3));
    v_res := v_res || pg_temp.t('after remove: withdrawal_create to the removed account is refused WD008', r ->> 'err' = 'WD008', r::text);

    -- removing a NON-default account leaves the default alone
    r := pg_temp.rem(ua, a2);
    v_res := v_res || pg_temp.t('remove: removing a non-default account keeps the default where it was', (r ->> 'removed')::boolean and r ->> 'new_default_id' is null and pg_temp.is_def(a1) and pg_temp.n_def(ua) = 1, r::text);
    -- removing the LAST account leaves no default
    r := pg_temp.rem(ua, a1);
    v_res := v_res || pg_temp.t('remove: removing the last account leaves none and no default', (r ->> 'removed')::boolean and r ->> 'new_default_id' is null and pg_temp.n_live(ua) = 0 and pg_temp.n_def(ua) = 0, r::text);
    r := pg_temp.add(ua, '058', 'Test Bank', v_num4, 'TEST PERSON');
    a4 := pg_temp.nid(r);
    v_res := v_res || pg_temp.t('add: after removing everything, the next account is the default again', (r ->> 'is_default')::boolean and pg_temp.is_def(a4), r::text);

    -- E2. promotion order: oldest of several remaining
    r := pg_temp.add(ua, '044', 'Other Bank', v_num3, 'TEST PERSON'); a2 := pg_temp.nid(r);
    r := pg_temp.add(ua, '033', 'Third Bank', v_num2, 'TEST PERSON'); a3 := pg_temp.nid(r);
    perform pg_temp.age(a4, 5); perform pg_temp.age(a3, 9); perform pg_temp.age(a2, 7);    -- oldest is a3, then a2, then a4
    r := pg_temp.rem(ua, a4);
    v_res := v_res || pg_temp.t('remove: promotes the oldest remaining (a3, not just any)', (r ->> 'new_default_id')::uuid = a3 and pg_temp.is_def(a3) and not pg_temp.is_def(a2) and pg_temp.n_def(ua) = 1, r::text);

    -- F. set_recipient ----------------------------------------------------------------------------------------------------------------
    r := pg_temp.rcp(ua, a3, ' RCP_first123 ');
    v_res := v_res || pg_temp.t('set_recipient: fills an empty value', (r ->> 'applied')::boolean and r ->> 'recipient_code' = 'RCP_first123', r::text);
    v_res := v_res || pg_temp.t('set_recipient: stored trimmed', exists (select 1 from public.withdrawal_bank_accounts where id = a3 and recipient_code = 'RCP_first123'));
    r := pg_temp.rcp(ua, a3, 'RCP_second456');
    v_res := v_res || pg_temp.t('set_recipient: a second, different code is NOT stored (set once); the stored one is returned',
      (r ->> 'applied')::boolean = false and r ->> 'recipient_code' = 'RCP_first123'
      and exists (select 1 from public.withdrawal_bank_accounts where id = a3 and recipient_code = 'RCP_first123'), r::text);
    r := pg_temp.rcp(ua, a3, 'RCP_first123');
    v_res := v_res || pg_temp.t('set_recipient: the same code again is harmless', r ->> 'err' is null and (r ->> 'applied')::boolean = false, r::text);
    r := pg_temp.rcp(ua, a2, '');       v_res := v_res || pg_temp.t('set_recipient: empty code refused WA007', r ->> 'err' = 'WA007', r::text);
    r := pg_temp.rcp(ua, a2, '   ');    v_res := v_res || pg_temp.t('set_recipient: blank code refused WA007', r ->> 'err' = 'WA007', r::text);
    r := pg_temp.rcp(ua, a2, null);     v_res := v_res || pg_temp.t('set_recipient: null code refused WA007', r ->> 'err' = 'WA007', r::text);
    r := pg_temp.rcp(ua, a2, repeat('R', 65)); v_res := v_res || pg_temp.t('set_recipient: 65-character code refused WA007', r ->> 'err' = 'WA007', r::text);
    r := pg_temp.rcp(ua, a2, 'RCP abc'); v_res := v_res || pg_temp.t('set_recipient: code with a space refused WA007', r ->> 'err' = 'WA007', r::text);
    r := pg_temp.rcp(ua, a2, 'RCP_x''; drop'); v_res := v_res || pg_temp.t('set_recipient: code with a quote refused WA007', r ->> 'err' = 'WA007', r::text);
    v_res := v_res || pg_temp.t('set_recipient: refused codes stored nothing', exists (select 1 from public.withdrawal_bank_accounts where id = a2 and recipient_code is null));
    r := pg_temp.rcp(ua, b1, 'RCP_steal');
    v_res := v_res || pg_temp.t('set_recipient: someone else''s account refused WA005', r ->> 'err' = 'WA005'
      and exists (select 1 from public.withdrawal_bank_accounts where id = b1 and recipient_code is null), r::text);
    r := pg_temp.rcp(ua, a4, 'RCP_removed');
    v_res := v_res || pg_temp.t('set_recipient: a removed account refused WA005', r ->> 'err' = 'WA005', r::text);
    r := pg_temp.rcp(ua, gen_random_uuid(), 'RCP_nothing');
    v_res := v_res || pg_temp.t('set_recipient: an unknown id refused WA005', r ->> 'err' = 'WA005', r::text);

    -- G. the full flow works end to end with W2b, and the browser still cannot see secrets --------------------------------------------------
    perform pg_temp.setbal(ua, 20000);
    r := pg_temp.call(format('public.withdrawal_create(%L::uuid, 2000, %L::uuid)', ua, a3));
    v_res := v_res || pg_temp.t('flow: withdrawal_create to a saved account made by bank_account_add works', (r ->> 'reference') is not null and r ->> 'bank_name' = 'Third Bank' and r ->> 'account_last4' = '6780', r::text);
    v_res := v_res || pg_temp.t('flow: the saved account''s last_used_at was set by the withdrawal',
      exists (select 1 from public.withdrawal_bank_accounts where id = a3 and last_used_at is not null));
    v_res := v_res || pg_temp.t('flow: balance went down by the amount only (add/remove/default never move money)', pg_temp.bal(ua) = 18000, pg_temp.bal(ua)::text);

    v_res := v_res || pg_temp.t('browser: authenticated cannot read account_number', not has_column_privilege('authenticated', 'public.withdrawal_bank_accounts', 'account_number', 'SELECT'));
    v_res := v_res || pg_temp.t('browser: authenticated cannot read recipient_code', not has_column_privilege('authenticated', 'public.withdrawal_bank_accounts', 'recipient_code', 'SELECT'));
    v_res := v_res || pg_temp.t('browser: authenticated cannot insert, update or delete saved accounts',
      not (has_table_privilege('authenticated', 'public.withdrawal_bank_accounts', 'INSERT')
        or has_table_privilege('authenticated', 'public.withdrawal_bank_accounts', 'UPDATE')
        or has_table_privilege('authenticated', 'public.withdrawal_bank_accounts', 'DELETE')));
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      v_res := v_res || pg_temp.t('server: service_role still has no direct write on saved accounts (writes only via the functions)',
        not (has_table_privilege('service_role', 'public.withdrawal_bank_accounts', 'INSERT')
          or has_table_privilege('service_role', 'public.withdrawal_bank_accounts', 'UPDATE')
          or has_table_privilege('service_role', 'public.withdrawal_bank_accounts', 'DELETE')));
    end if;

    -- H. the money tables were NOT loosened (state check) -------------------------------------------------------------------------------------
    foreach v_t in array array['wallets', 'wallet_transactions', 'escrow_payments', 'payment_intents'] loop
      if to_regclass('public.' || v_t) is not null then
        v_res := v_res || pg_temp.t('browser has no write access on ' || v_t,
          not (has_table_privilege('authenticated', 'public.' || v_t, 'INSERT')
            or has_table_privilege('authenticated', 'public.' || v_t, 'UPDATE')
            or has_table_privilege('authenticated', 'public.' || v_t, 'DELETE')));
      end if;
    end loop;

    raise exception 'w2d_done';       -- undo every test row, every balance change, every notification and the temporary limits function
  exception when others then
    if sqlerrm <> 'w2d_done' then
      v_res := v_res || ('FAIL | the test run itself crashed: SQLSTATE ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  select count(*) filter (where x like 'PASS |%'), count(*) filter (where x like 'FAIL |%')
    into v_pass, v_fail from unnest(v_res) as x;
  return next 'SUMMARY | W2d: ' || v_pass || ' passed, ' || v_fail || ' failed';
  foreach v_t in array v_res loop
    return next v_t;
  end loop;
end $fn$;

select * from pg_temp.w2d_run();

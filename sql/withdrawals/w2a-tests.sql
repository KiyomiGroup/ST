-- =====================================================================
-- W2a self-test. Run AFTER w2a-tables.sql.
-- Supabase dashboard > SQL Editor > New query > paste the WHOLE file > Run.
-- It creates temporary test rows, checks them, and UNDOES every one of them before it ends
-- (nothing is left in your tables). The result table has a SUMMARY row first, then one row per check.
-- Success = the SUMMARY row says "0 failed". Only if something says FAIL, copy the FAIL rows (select the
-- cells, Ctrl+C) and send them back.
-- Rows that start with INFO are not tests: they just show what constraints your live tables have.
-- =====================================================================

create or replace function pg_temp.t(p_label text, p_ok boolean, p_detail text default '') returns text
language sql as $$
  select case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end || ' | ' || p_label
         || case when not coalesce(p_ok, false) and p_detail <> '' then ' | ' || p_detail else '' end
$$;

-- run one statement (optionally as another role) and report its SQLSTATE; 'ok' means it worked
create or replace function pg_temp.try(p_stmt text, p_role text default null, p_sub uuid default null) returns text
language plpgsql as $$
declare v_state text := 'ok';
begin
  begin
    -- always reset the fake login first, so one check can never leak its user into the next
    perform set_config('request.jwt.claims', case when p_sub is null then '' else json_build_object('sub', p_sub::text, 'role', coalesce(p_role, 'authenticated'))::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
    if p_role is not null then execute format('set local role %I', p_role); end if;
    execute p_stmt;
  exception when others then
    v_state := sqlstate;
  end;
  execute 'reset role';
  return v_state;
end $$;

-- count rows a query returns when run as a role / user; -1 if it errored
create or replace function pg_temp.cnt(p_query text, p_role text, p_sub uuid) returns bigint
language plpgsql as $$
declare v bigint;
begin
  begin
    perform set_config('request.jwt.claims', case when p_sub is null then '' else json_build_object('sub', p_sub::text, 'role', p_role)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
    execute format('set local role %I', p_role);
    execute 'select count(*) from (' || p_query || ') q' into v;
  exception when others then
    v := -1;
  end;
  execute 'reset role';
  return v;
end $$;

create or replace function pg_temp.wd_ins(p_user uuid, p_ref text, p_amount numeric, p_fee numeric, p_net numeric,
                                          p_status text, p_acct text default '0123456789') returns text
language sql as $$
  select format('insert into public.withdrawals (user_id, reference, amount, fee, net_amount, status, bank_code, bank_name, account_number, account_name)
                 values (%L, %L, %s, %s, %s, %L, %L, %L, %L, %L)',
                p_user, p_ref, p_amount, p_fee, p_net, p_status, '058', 'Test Bank', p_acct, 'TEST NAME')
$$;

create or replace function pg_temp.wba_ins(p_user uuid, p_num text, p_default boolean default false,
                                           p_removed boolean default false, p_bank text default '058',
                                           p_name text default 'TEST NAME') returns text
language sql as $$
  select format('insert into public.withdrawal_bank_accounts (user_id, bank_code, bank_name, account_number, account_name, is_default, removed_at)
                 values (%L, %L, %L, %L, %L, %L, %s)',
                p_user, p_bank, 'Test Bank', p_num, p_name, p_default, case when p_removed then 'now()' else 'null' end)
$$;

create or replace function pg_temp.tx_ins(p_user uuid, p_type text, p_ref text, p_status text) returns text
language sql as $$
  select format('insert into public.wallet_transactions (user_id, type, amount, reference, status, note) values (%L, %L, 100, %L, %L, %L)',
                p_user, p_type, p_ref, p_status, 'w2a test')
$$;

create or replace function pg_temp.w2a_run() returns setof text
language plpgsql as $fn$
declare
  v_res text[] := '{}';
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  ul uuid;                                   -- a user id the wallet tables accept
  ra text := 'wd-' || repeat('a', 32);
  rb text := 'wd-' || repeat('b', 32);
  rc text := 'wd-' || repeat('c', 32);
  rd text := 'wd-' || repeat('d', 32);
  re text := 'wd-' || repeat('e', 32);
  r record; v_t text; st text; v_bool boolean; v_n bigint; v_pass int; v_fail int; v_has_sr boolean;
begin
  select user_id into ul from public.wallets limit 1;
  ul := coalesce(ul, ua);
  v_has_sr := exists (select 1 from pg_roles where rolname = 'service_role');

  begin  -- everything below is undone at the end by raising 'w2a_done'

    -- A. INFO: what the live ledger tables already enforce -------------------------------
    for r in select 'INFO | CHECK on ' || c.conrelid::regclass::text || ' ' || c.conname || ': ' || pg_get_constraintdef(c.oid) as line
               from pg_constraint c
              where c.contype = 'c' and c.conrelid in (to_regclass('public.wallet_transactions'), to_regclass('public.notifications'))
    loop v_res := v_res || r.line; end loop;
    for r in select 'INFO | index on wallet_transactions: ' || indexdef as line from pg_indexes
              where schemaname = 'public' and tablename = 'wallet_transactions' and indexdef ilike '%unique%'
    loop v_res := v_res || r.line; end loop;

    -- B. Fee and limits ------------------------------------------------------------------
    for r in select * from (values (1, 10), (5000, 10), (5001, 25), (9999, 25), (10000, 75),
                                   (50000, 75), (50001, 100), (500000, 100)) as v(a, f)
    loop
      v_res := v_res || pg_temp.t('fee(' || r.a || ') = ' || r.f, public.withdrawal_fee(r.a) = r.f,
                                  'got ' || public.withdrawal_fee(r.a));
    end loop;
    v_res := v_res || pg_temp.t('fee(0) is refused',    pg_temp.try('select public.withdrawal_fee(0)') = '22023');
    v_res := v_res || pg_temp.t('fee(-5) is refused',   pg_temp.try('select public.withdrawal_fee(-5)') = '22023');
    v_res := v_res || pg_temp.t('fee(null) is refused', pg_temp.try('select public.withdrawal_fee(null)') = '22023');
    v_res := v_res || pg_temp.t('limits: min 500',      (public.withdrawal_limits()->>'min_amount')::numeric = 500);
    v_res := v_res || pg_temp.t('limits: max 500000',   (public.withdrawal_limits()->>'max_amount')::numeric = 500000);
    v_res := v_res || pg_temp.t('limits: daily 1000000',(public.withdrawal_limits()->>'daily_max')::numeric = 1000000);
    v_res := v_res || pg_temp.t('limits: 3 saved accounts', (public.withdrawal_limits()->>'max_saved_accounts')::int = 3);
    v_res := v_res || pg_temp.t('limits: cooldown 0 hours', (public.withdrawal_limits()->>'new_account_cooldown_hours')::int = 0);

    -- C. withdrawals: constraints and triggers (run as the owner role) --------------------------
    v_res := v_res || pg_temp.t('withdrawal insert (failed row)', pg_temp.try(pg_temp.wd_ins(ua, ra, 1000, 10, 990, 'failed')) = 'ok');
    v_res := v_res || pg_temp.t('withdrawal insert (first open row)', pg_temp.try(pg_temp.wd_ins(ua, rb, 2000, 10, 1990, 'pending')) = 'ok');
    v_res := v_res || pg_temp.t('second open withdrawal for same user refused',
                                pg_temp.try(pg_temp.wd_ins(ua, rc, 1000, 10, 990, 'processing')) = '23505');
    v_res := v_res || pg_temp.t('duplicate reference refused (other user)',
                                pg_temp.try(pg_temp.wd_ins(ub, ra, 1000, 10, 990, 'pending')) = '23505');
    v_res := v_res || pg_temp.t('unknown status refused',  pg_temp.try(pg_temp.wd_ins(ub, rd, 1000, 10, 990, 'paid')) = '23514');
    v_res := v_res || pg_temp.t('net <> amount - fee refused', pg_temp.try(pg_temp.wd_ins(ub, rd, 1000, 10, 900, 'pending')) = '23514');
    v_res := v_res || pg_temp.t('uppercase reference refused', pg_temp.try(pg_temp.wd_ins(ub, 'WD-' || repeat('A', 32), 1000, 10, 990, 'pending')) = '23514');
    v_res := v_res || pg_temp.t('short reference refused', pg_temp.try(pg_temp.wd_ins(ub, 'wd-abc', 1000, 10, 990, 'pending')) = '23514');
    v_res := v_res || pg_temp.t('9-digit account number refused', pg_temp.try(pg_temp.wd_ins(ub, rd, 1000, 10, 990, 'pending', '012345678')) = '23514');
    v_res := v_res || pg_temp.t('kobo amount refused (whole naira only)', pg_temp.try(pg_temp.wd_ins(ub, rd, 1000.5, 10, 990.5, 'pending')) = '23514');
    v_res := v_res || pg_temp.t('zero amount refused', pg_temp.try(pg_temp.wd_ins(ub, rd, 0, 0, 0, 'pending')) = '23514');
    v_res := v_res || pg_temp.t('negative fee refused', pg_temp.try(pg_temp.wd_ins(ub, rd, 1000, -10, 1010, 'pending')) = '23514');
    v_res := v_res || pg_temp.t('amount cannot be edited',
                                pg_temp.try(format('update public.withdrawals set amount = 9999, net_amount = 9989 where reference = %L', rb)) = '42501');
    v_res := v_res || pg_temp.t('account number cannot be edited',
                                pg_temp.try(format('update public.withdrawals set account_number = %L where reference = %L', '9999999999', rb)) = '42501');
    v_res := v_res || pg_temp.t('owner of a withdrawal cannot be changed',
                                pg_temp.try(format('update public.withdrawals set user_id = %L where reference = %L', ub, rb)) = '42501');
    v_res := v_res || pg_temp.t('status can move pending -> processing',
                                pg_temp.try(format('update public.withdrawals set status = ''processing'', paystack_transfer_code = %L where reference = %L', 'TRF_w2atest', rb)) = 'ok');
    select (updated_at > created_at) into v_bool from public.withdrawals where reference = rb;
    v_res := v_res || pg_temp.t('updated_at moves forward on update', v_bool);
    v_res := v_res || pg_temp.t('still one open row blocks a new one',
                                pg_temp.try(pg_temp.wd_ins(ua, rc, 1000, 10, 990, 'pending')) = '23505');
    v_res := v_res || pg_temp.t('duplicate Paystack transfer code refused',
                                pg_temp.try(format('update public.withdrawals set paystack_transfer_code = %L where reference = %L', 'TRF_w2atest', ra)) = '23505');
    v_res := v_res || pg_temp.t('close the open row (success)',
                                pg_temp.try(format('update public.withdrawals set status = ''success'' where reference = %L', rb)) = 'ok');
    v_res := v_res || pg_temp.t('new open row allowed once the old one is closed',
                                pg_temp.try(pg_temp.wd_ins(ua, rc, 1000, 10, 990, 'pending')) = 'ok');
    select account_last4 = '6789' into v_bool from public.withdrawals where reference = ra;
    v_res := v_res || pg_temp.t('account_last4 is the last 4 digits', v_bool);

    -- D. saved bank accounts --------------------------------------------------------------------
    v_res := v_res || pg_temp.t('saved account insert (default)', pg_temp.try(pg_temp.wba_ins(ua, '1111111111', true)) = 'ok');
    v_res := v_res || pg_temp.t('same live account twice refused', pg_temp.try(pg_temp.wba_ins(ua, '1111111111')) = '23505');
    v_res := v_res || pg_temp.t('second default refused', pg_temp.try(pg_temp.wba_ins(ua, '2222222222', true)) = '23505');
    v_res := v_res || pg_temp.t('second non-default account ok', pg_temp.try(pg_temp.wba_ins(ua, '2222222222')) = 'ok');
    v_res := v_res || pg_temp.t('9-digit number refused', pg_temp.try(pg_temp.wba_ins(ub, '123456789')) = '23514');
    v_res := v_res || pg_temp.t('letters in number refused', pg_temp.try(pg_temp.wba_ins(ub, '12345678ab')) = '23514');
    v_res := v_res || pg_temp.t('bank code with a space refused', pg_temp.try(pg_temp.wba_ins(ub, '3333333333', false, false, '05 8')) = '23514');
    v_res := v_res || pg_temp.t('empty bank code refused', pg_temp.try(pg_temp.wba_ins(ub, '3333333333', false, false, '')) = '23514');
    v_res := v_res || pg_temp.t('empty account name refused', pg_temp.try(pg_temp.wba_ins(ub, '3333333333', false, false, '058', '  ')) = '23514');
    v_res := v_res || pg_temp.t('a removed account cannot be default', pg_temp.try(pg_temp.wba_ins(ub, '3333333333', true, true)) = '23514');
    v_res := v_res || pg_temp.t('saved account number cannot be edited',
                                pg_temp.try(format('update public.withdrawal_bank_accounts set account_number = %L where user_id = %L and account_number = %L', '4444444444', ua, '1111111111')) = '42501');
    v_res := v_res || pg_temp.t('saved account can be soft-removed',
                                pg_temp.try(format('update public.withdrawal_bank_accounts set removed_at = now(), is_default = false where user_id = %L and account_number = %L', ua, '1111111111')) = 'ok');
    v_res := v_res || pg_temp.t('a removed number can be saved again (new default)', pg_temp.try(pg_temp.wba_ins(ua, '1111111111', true)) = 'ok');
    select count(*) = 1 into v_bool from public.withdrawal_bank_accounts where user_id = ua and account_number = '1111111111' and account_last4 = '1111' and removed_at is null;
    v_res := v_res || pg_temp.t('account_last4 on saved account', v_bool);

    -- E. who can read / write what (run AS the logged-in role) ---------------------------------------
    v_res := v_res || pg_temp.t('ub: insert a withdrawal row for another test user', pg_temp.try(pg_temp.wd_ins(ub, re, 1000, 10, 990, 'pending')) = 'ok');
    v_n := pg_temp.cnt('select id from public.withdrawals', 'authenticated', ua);
    v_res := v_res || pg_temp.t('user A sees only own withdrawals (3)', v_n = 3, 'got ' || v_n);
    v_n := pg_temp.cnt('select id from public.withdrawals', 'authenticated', ub);
    v_res := v_res || pg_temp.t('user B sees only own withdrawals (1)', v_n = 1, 'got ' || v_n);
    v_n := pg_temp.cnt('select id from public.withdrawals', 'authenticated', null);
    v_res := v_res || pg_temp.t('a login with no user id sees nothing', v_n = 0, 'got ' || v_n);
    v_n := pg_temp.cnt('select id from public.withdrawals', 'anon', null);
    v_res := v_res || pg_temp.t('anon cannot read withdrawals', v_n = -1, 'got ' || v_n);
    v_n := pg_temp.cnt('select id from public.withdrawal_bank_accounts', 'authenticated', ua);
    v_res := v_res || pg_temp.t('user A sees only own LIVE saved accounts (2, removed one hidden)', v_n = 2, 'got ' || v_n);
    v_n := pg_temp.cnt('select id from public.withdrawal_bank_accounts', 'authenticated', ub);
    v_res := v_res || pg_temp.t('user B sees none of A''s saved accounts', v_n = 0, 'got ' || v_n);
    v_n := pg_temp.cnt('select id from public.withdrawal_bank_accounts', 'anon', null);
    v_res := v_res || pg_temp.t('anon cannot read saved accounts', v_n = -1, 'got ' || v_n);

    foreach v_t in array array['withdrawals.account_number', 'withdrawals.recipient_code', 'withdrawals.paystack_transfer_code',
                             'withdrawals.failure_reason', 'withdrawal_bank_accounts.account_number',
                             'withdrawal_bank_accounts.recipient_code'] loop
      v_res := v_res || pg_temp.t('browser cannot read column ' || v_t,
        pg_temp.try('select ' || split_part(v_t, '.', 2) || ' from public.' || split_part(v_t, '.', 1), 'authenticated', ua) = '42501');
    end loop;
    v_res := v_res || pg_temp.t('select * on withdrawals is refused (list the columns)',
                                pg_temp.try('select * from public.withdrawals', 'authenticated', ua) = '42501');
    v_res := v_res || pg_temp.t('select * on saved accounts is refused (list the columns)',
                                pg_temp.try('select * from public.withdrawal_bank_accounts', 'authenticated', ua) = '42501');
    v_res := v_res || pg_temp.t('browser CAN read safe columns incl. last 4',
      pg_temp.try('select id, amount, fee, net_amount, status, bank_name, account_name, account_last4 from public.withdrawals', 'authenticated', ua) = 'ok');
    v_res := v_res || pg_temp.t('browser CAN read safe saved-account columns',
      pg_temp.try('select id, bank_name, account_name, account_last4, is_default from public.withdrawal_bank_accounts', 'authenticated', ua) = 'ok');

    v_res := v_res || pg_temp.t('browser cannot INSERT withdrawals',
                                pg_temp.try(pg_temp.wd_ins(ua, rd, 1000, 10, 990, 'failed'), 'authenticated', ua) = '42501');
    v_res := v_res || pg_temp.t('browser cannot UPDATE withdrawals',
                                pg_temp.try('update public.withdrawals set status = ''success''', 'authenticated', ua) = '42501');
    v_res := v_res || pg_temp.t('browser cannot DELETE withdrawals',
                                pg_temp.try('delete from public.withdrawals', 'authenticated', ua) = '42501');
    v_res := v_res || pg_temp.t('browser cannot INSERT saved accounts',
                                pg_temp.try(pg_temp.wba_ins(ua, '5555555555'), 'authenticated', ua) = '42501');
    v_res := v_res || pg_temp.t('browser cannot UPDATE saved accounts',
                                pg_temp.try('update public.withdrawal_bank_accounts set is_default = true', 'authenticated', ua) = '42501');
    v_res := v_res || pg_temp.t('browser cannot DELETE saved accounts',
                                pg_temp.try('delete from public.withdrawal_bank_accounts', 'authenticated', ua) = '42501');

    v_res := v_res || pg_temp.t('logged-in user can call withdrawal_fee',    pg_temp.try('select public.withdrawal_fee(1000)', 'authenticated', ua) = 'ok');
    v_res := v_res || pg_temp.t('logged-in user can call withdrawal_limits', pg_temp.try('select public.withdrawal_limits()', 'authenticated', ua) = 'ok');
    v_res := v_res || pg_temp.t('anon cannot call withdrawal_fee',           pg_temp.try('select public.withdrawal_fee(1000)', 'anon', null) = '42501');
    v_res := v_res || pg_temp.t('anon cannot call withdrawal_limits',        pg_temp.try('select public.withdrawal_limits()', 'anon', null) = '42501');

    v_res := v_res || pg_temp.t('column grant: authenticated cannot read account_number',
                                not has_column_privilege('authenticated', 'public.withdrawals', 'account_number', 'SELECT'));
    v_res := v_res || pg_temp.t('column grant: authenticated can read amount',
                                has_column_privilege('authenticated', 'public.withdrawals', 'amount', 'SELECT'));
    if v_has_sr then
      v_res := v_res || pg_temp.t('service_role can read withdrawals', has_table_privilege('service_role', 'public.withdrawals', 'SELECT'));
      v_res := v_res || pg_temp.t('service_role cannot write withdrawals directly',
        not (has_table_privilege('service_role', 'public.withdrawals', 'INSERT')
          or has_table_privilege('service_role', 'public.withdrawals', 'UPDATE')
          or has_table_privilege('service_role', 'public.withdrawals', 'DELETE')));
      v_res := v_res || pg_temp.t('service_role cannot write saved accounts directly',
        not (has_table_privilege('service_role', 'public.withdrawal_bank_accounts', 'INSERT')
          or has_table_privilege('service_role', 'public.withdrawal_bank_accounts', 'UPDATE')
          or has_table_privilege('service_role', 'public.withdrawal_bank_accounts', 'DELETE')));
      v_res := v_res || pg_temp.t('service_role can call withdrawal_fee',
        has_function_privilege('service_role', 'public.withdrawal_fee(numeric)', 'EXECUTE'));
    end if;

    -- F. ledger allowances --------------------------------------------------------------------------
    foreach st in array array['pending', 'processing', 'completed', 'failed'] loop
      v_res := v_res || pg_temp.t('wallet_transactions accepts type withdrawal with status ' || st,
                                  pg_temp.try(pg_temp.tx_ins(ul, 'withdrawal', 'w2a-legacy-' || st, st)) = 'ok');
    end loop;
    v_res := v_res || pg_temp.t('wallet_transactions accepts type withdrawal_refund',
                                pg_temp.try(pg_temp.tx_ins(ul, 'withdrawal_refund', ra || '-refund', 'completed')) = 'ok');
    v_res := v_res || pg_temp.t('second refund row for the same withdrawal refused',
                                pg_temp.try(pg_temp.tx_ins(ul, 'withdrawal_refund', ra || '-refund', 'completed')) = '23505');
    v_res := v_res || pg_temp.t('ledger row for a new-style withdrawal',
                                pg_temp.try(pg_temp.tx_ins(ul, 'withdrawal', rd, 'pending')) = 'ok');
    v_res := v_res || pg_temp.t('second ledger row for the same withdrawal refused',
                                pg_temp.try(pg_temp.tx_ins(ul, 'withdrawal', rd, 'pending')) = '23505');
    v_res := v_res || pg_temp.t('notifications accepts type withdrawal_update',
      pg_temp.try(format('insert into public.notifications (user_id, type, title, message, data, is_read) values (%L, ''withdrawal_update'', ''t'', ''t'', ''{}'', false)', ul)) = 'ok');
    v_res := v_res || pg_temp.t('notifications accepts type bank_account',
      pg_temp.try(format('insert into public.notifications (user_id, type, title, message, data, is_read) values (%L, ''bank_account'', ''t'', ''t'', ''{}'', false)', ul)) = 'ok');

    -- G. the money tables were NOT loosened (state check; a FAIL here pre-dates W2a) --------------------
    foreach v_t in array array['wallets', 'wallet_transactions', 'escrow_payments', 'payment_intents'] loop
      if to_regclass('public.' || v_t) is not null then
        v_res := v_res || pg_temp.t('browser has no write access on ' || v_t,
          not (has_table_privilege('authenticated', 'public.' || v_t, 'INSERT')
            or has_table_privilege('authenticated', 'public.' || v_t, 'UPDATE')
            or has_table_privilege('authenticated', 'public.' || v_t, 'DELETE')));
      end if;
    end loop;

    raise exception 'w2a_done';       -- undo every test row
  exception when others then
    if sqlerrm <> 'w2a_done' then
      v_res := v_res || ('FAIL | the test run itself crashed: SQLSTATE ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  select count(*) filter (where x like 'PASS |%'), count(*) filter (where x like 'FAIL |%')
    into v_pass, v_fail from unnest(v_res) as x;
  return next 'SUMMARY | W2a: ' || v_pass || ' passed, ' || v_fail || ' failed';
  foreach v_t in array v_res loop
    return next v_t;
  end loop;
end $fn$;

select * from pg_temp.w2a_run();

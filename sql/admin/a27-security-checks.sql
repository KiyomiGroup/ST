-- StreetTasker Admin, stage A27: security checks. READ ONLY. Writes nothing, changes nothing.
-- Run the WHOLE file once in the Supabase SQL editor. It is ONE query, so the editor shows ONE result table.
-- Download that result as CSV and send it back (the editor only shows the last result of a file, which is why this is one query).
--
-- What it NEVER returns: secret values, tokens, keys, emails, phone numbers, ID numbers, account numbers, addresses,
-- authorization codes or any row of personal data. It returns object NAMES, counts and yes/no answers only.
-- A trigger or cron job that contains a secret is reported by name with the word SECRET-IN-TEXT, never by its text.
--
-- Columns: section, item, detail, status.   status: OK (fine), CHECK (look at it), RISK (fix it), INFO (a fact).
-- Sections: A functions, B tables, C policies and columns, D secrets, E admin accounts, F sensitive data, G storage, H audit log.

with
fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl,
         pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
),
adminfn as (   -- the admin project's own functions
  select * from fn
   where proname like 'admin\_%' escape '\' or proname like '\_a%' escape '\' or proname like '\_acct%' escape '\'
      or proname like 'accountant\_%' escape '\' or proname in ('_is_support', 'is_local_tasker_admin')
),
pub_exec as (  -- functions that PUBLIC (grantee 0) may run: a null ACL means the default, which is PUBLIC execute
  select f.oid from fn f
   where f.proacl is null
      or exists (select 1 from aclexplode(f.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
),
tb as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
),
r as (

  -- ================= A. functions =================
  select 'A'::text sec, 'A1 admin function runnable by the signed-out role (anon)'::text item,
         coalesce(string_agg(f.proname, ', ' order by f.proname), 'none') detail,
         case when count(*) = 0 then 'OK' else 'RISK' end status
    from adminfn f where has_function_privilege('anon', f.oid, 'execute')

  union all
  select 'A', 'A2 admin function runnable by PUBLIC (default grant never revoked)',
         coalesce(string_agg(f.proname, ', ' order by f.proname), 'none'),
         case when count(*) = 0 then 'OK' else 'RISK' end
    from adminfn f where f.oid in (select oid from pub_exec)

  union all
  select 'A', 'A3 internal helper (name starts with an underscore) runnable by a signed-in user',
         coalesce(string_agg(f.proname, ', ' order by f.proname), 'none'),
         case when count(*) = 0 then 'OK' else 'CHECK' end
    from adminfn f
   where f.proname like '\_%' escape '\' and f.proname not in ('_is_support')
     and has_function_privilege('authenticated', f.oid, 'execute')

  union all
  select 'A', 'A4 SECURITY DEFINER function with no fixed search_path (anywhere in public)',
         case when count(*) = 0 then 'none'
              else count(*) || ' function(s), first 25: ' || (select string_agg(x.proname, ', ' order by x.proname) from (select proname from fn
                      where prosecdef and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%') order by proname limit 25) x) end,
         case when count(*) = 0 then 'OK' else 'RISK' end
    from fn where prosecdef and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')

  union all
  select 'A', 'A5 admin_* function that is NOT security definer (it would run with the caller''s rights)',
         coalesce(string_agg(f.proname, ', ' order by f.proname), 'none'),
         case when count(*) = 0 then 'OK' else 'CHECK' end
    from adminfn f where f.proname like 'admin\_%' escape '\' and not f.prosecdef
     and f.proname not in ('admin_approval_guard', 'admin_approval_hash', 'admin_audit_immutable', 'admin_feed_expr',
                           'admin_protect_last_super_role', 'admin_protect_last_super_user')

  union all
  select 'A', 'A6 count of admin-project functions found',
         count(*) || ' (admin_*, helpers, accountant_*)', 'INFO' from adminfn

  union all
  select 'A', 'A7 ALL public functions runnable by anon (the whole database, not just admin)',
         count(*) || ' of ' || (select count(*) from fn) || ' public functions', 'INFO'
    from fn where has_function_privilege('anon', oid, 'execute')

  union all
  select 'A', 'A8 SECURITY DEFINER functions runnable by anon (each one runs with owner rights for a signed-out caller)',
         case when count(*) = 0 then 'none'
              else count(*) || ' function(s), first 40: ' || (select string_agg(x.proname, ', ' order by x.proname) from (select proname from fn
                      where prosecdef and has_function_privilege('anon', oid, 'execute') order by proname limit 40) x) end,
         case when count(*) = 0 then 'OK' else 'CHECK' end
    from fn where prosecdef and has_function_privilege('anon', oid, 'execute')

  -- ================= B. tables =================
  union all
  select 'B', 'B1 table in public with row level security OFF',
         coalesce(string_agg(relname, ', ' order by relname), 'none'),
         case when count(*) = 0 then 'OK' else 'RISK' end
    from tb where not relrowsecurity

  union all
  select 'B', 'B2 table where the signed-out role (anon) can write (INSERT, UPDATE, DELETE or TRUNCATE)',
         coalesce(string_agg(relname, ', ' order by relname), 'none'),
         case when count(*) = 0 then 'OK' else 'RISK' end
    from tb where has_table_privilege('anon', oid, 'INSERT') or has_table_privilege('anon', oid, 'UPDATE')
               or has_table_privilege('anon', oid, 'DELETE') or has_table_privilege('anon', oid, 'TRUNCATE')

  union all
  select 'B', 'B3 table where anon can read (defence in depth; row level security is what stops it)',
         count(*) || ' of ' || (select count(*) from tb) || ' tables: ' ||
           coalesce((select string_agg(x.relname, ', ' order by x.relname) from (select relname from tb
                      where has_table_privilege('anon', oid, 'SELECT') order by relname limit 60) x), 'none'),
         case when count(*) = 0 then 'OK' else 'CHECK' end
    from tb where has_table_privilege('anon', oid, 'SELECT')

  union all
  select 'B', 'B4 table where a signed-in user holds TRUNCATE, TRIGGER or REFERENCES',
         coalesce(string_agg(relname, ', ' order by relname), 'none'),
         case when count(*) = 0 then 'OK' else 'CHECK' end
    from tb where has_table_privilege('authenticated', oid, 'TRUNCATE') or has_table_privilege('authenticated', oid, 'TRIGGER')
               or has_table_privilege('authenticated', oid, 'REFERENCES')

  union all
  select 'B', 'B5 money, admin or accountant table the browser can WRITE to (should be none: writes go through functions)',
         coalesce(string_agg(relname, ', ' order by relname), 'none'),
         case when count(*) = 0 then 'OK' else 'RISK' end
    from tb
   where (relname in ('wallets', 'wallet_transactions', 'payments', 'escrow_payments', 'payment_intents', 'payment_receipts',
                      'subscriptions', 'subscription_receipts', 'subscription_events', 'subscription_admin_log',
                      'withdrawals', 'withdrawal_bank_accounts', 'job_refunds', 'support_staff', 'donations')
          or relname like 'admin\_%' escape '\' or relname like 'accountant\_%' escape '\')
     and (has_table_privilege('authenticated', oid, 'INSERT') or has_table_privilege('authenticated', oid, 'UPDATE')
          or has_table_privilege('authenticated', oid, 'DELETE'))

  union all
  select 'B', 'B6 view in public that anon can read and that runs with the owner''s rights (it bypasses row level security)',
         coalesce(string_agg(c.relname, ', ' order by c.relname), 'none'),
         case when count(*) = 0 then 'OK' else 'RISK' end
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and has_table_privilege('anon', c.oid, 'SELECT')
     and not coalesce((select true from unnest(coalesce(c.reloptions, '{}')) o where o in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1') limit 1), false)

  union all
  select 'B', 'B7 views readable by a signed-in user that run with the owner''s rights',
         coalesce(string_agg(c.relname, ', ' order by c.relname), 'none'),
         case when count(*) = 0 then 'OK' else 'CHECK' end
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and has_table_privilege('authenticated', c.oid, 'SELECT')
     and not coalesce((select true from unnest(coalesce(c.reloptions, '{}')) o where o in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1') limit 1), false)

  -- ================= C. policies and columns =================
  union all
  select 'C', 'C1 policy that lets signed-out or every signed-in user read every row (condition is just true), SELECT only',
         coalesce(string_agg(tablename || ' (' || policyname || ')', ', ' order by tablename), 'none'),
         case when count(*) = 0 then 'OK' else 'CHECK' end
    from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and btrim(coalesce(qual, '')) in ('true', '(true)')

  union all
  select 'C', 'C2 policy that lets everyone INSERT, UPDATE or DELETE without a real condition',
         coalesce(string_agg(tablename || ' ' || cmd || ' (' || policyname || ')', ', ' order by tablename), 'none'),
         case when count(*) = 0 then 'OK' else 'RISK' end
    from pg_policies
   where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and ((cmd in ('UPDATE', 'DELETE', 'ALL') and btrim(coalesce(qual, '')) in ('true', '(true)'))
          or (cmd in ('INSERT', 'UPDATE', 'ALL') and btrim(coalesce(with_check, '')) in ('true', '(true)')))
     and (roles::text like '%anon%' or roles::text like '%public%' or roles::text like '%authenticated%')

  union all
  select 'C', 'C3 users or taskers column a signed-in user can read that is private (dob, whatsapp, flags, contact details)',
         coalesce(string_agg(t.relname || '.' || a.attname, ', ' order by t.relname, a.attname), 'none'),
         case when count(*) = 0 then 'OK' else 'CHECK' end
    from tb t join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
   where t.relname in ('users', 'taskers')
     and a.attname in ('dob', 'date_of_birth', 'whatsapp', 'phone', 'email', 'contact_violations', 'is_flagged', 'flagged_reason', 'address')
     and has_column_privilege('authenticated', t.oid, a.attnum, 'SELECT')

  union all
  select 'C', 'C4 same private columns readable by anon',
         coalesce(string_agg(t.relname || '.' || a.attname, ', ' order by t.relname, a.attname), 'none'),
         case when count(*) = 0 then 'OK' else 'RISK' end
    from tb t join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
   where t.relname in ('users', 'taskers')
     and a.attname in ('dob', 'date_of_birth', 'whatsapp', 'phone', 'email', 'contact_violations', 'is_flagged', 'flagged_reason', 'address')
     and has_column_privilege('anon', t.oid, a.attnum, 'SELECT')

  -- ================= D. secrets written into the database (names and yes/no only) =================
  union all
  select 'D', 'D1 trigger whose stored definition contains a token or secret header',
         coalesce(string_agg(c.relname || '.' || t.tgname, ', ' order by c.relname), 'none') ||
         case when count(*) = 0 then '' else '  [SECRET-IN-TEXT: value not shown]' end,
         case when count(*) = 0 then 'OK' else 'RISK' end
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal
     and (pg_get_triggerdef(t.oid) ilike '%bearer %' or pg_get_triggerdef(t.oid) ilike '%secret%' or pg_get_triggerdef(t.oid) ~ 'eyJ[A-Za-z0-9_-]{20,}')

  union all
  select 'D', 'D2 scheduled job whose command contains a token or secret header',
         coalesce(string_agg(j.jobname, ', ' order by j.jobname), 'none') ||
         case when count(*) = 0 then '' else '  [SECRET-IN-TEXT: value not shown]' end,
         case when count(*) = 0 then 'OK' else 'RISK' end
    from cron.job j
   where j.command ilike '%bearer %' or j.command ilike '%secret%' or j.command ~ 'eyJ[A-Za-z0-9_-]{20,}'

  union all
  select 'D', 'D3 function whose source contains a token (a JWT-looking string or "Bearer ")',
         coalesce(string_agg(f.proname, ', ' order by f.proname), 'none') ||
         case when count(*) = 0 then '' else '  [SECRET-IN-TEXT: value not shown]' end,
         case when count(*) = 0 then 'OK' else 'RISK' end
    from fn f join pg_proc p on p.oid = f.oid
   where p.prosrc ~ 'eyJ[A-Za-z0-9_-]{20,}' or p.prosrc ilike '%bearer eyJ%'

  union all
  select 'D', 'D4 is Supabase Vault in use (an extension to keep secrets out of text)',
         case when exists (select 1 from pg_extension where extname = 'supabase_vault') then 'yes, installed' else 'not installed' end,
         'INFO'

  -- ================= E. admin accounts =================
  union all
  select 'E', 'E1 admin accounts by status',
         coalesce((select string_agg(s.status || ': ' || s.n, ', ' order by s.status) from (select status, count(*) n from public.admin_users group by status) s), 'no admin rows'),
         'INFO'

  union all
  select 'E', 'E2 active admins holding the Super Admin role (the plan wants at least two, D-A10)',
         count(*)::text,
         case when count(*) >= 2 then 'OK' else 'CHECK' end
    from public.admin_users u join public.admin_user_roles ur on ur.user_id = u.user_id
   where u.status = 'active' and ur.role_key = 'super_admin'

  union all
  select 'E', 'E3 active admins with NO verified authenticator (MFA) factor',
         coalesce(string_agg(left(u.user_id::text, 8), ', ' order by u.user_id), 'none'),
         case when count(*) = 0 then 'OK' else 'RISK' end
    from public.admin_users u
   where u.status = 'active'
     and not exists (select 1 from auth.mfa_factors f where f.user_id = u.user_id and f.status = 'verified')

  union all
  select 'E', 'E4 active admins who have not signed in for 60 days (first 8 characters of the id)',
         coalesce(string_agg(left(u.user_id::text, 8), ', ' order by u.user_id), 'none'),
         case when count(*) = 0 then 'OK' else 'CHECK' end
    from public.admin_users u left join auth.users a on a.id = u.user_id
   where u.status = 'active' and coalesce(a.last_sign_in_at, 'epoch'::timestamptz) < now() - interval '60 days'

  union all
  select 'E', 'E5 people in support_staff (the dispute bridge) who are NOT an active admin',
         coalesce(string_agg(left(s.user_id::text, 8), ', ' order by s.user_id), 'none'),
         case when count(*) = 0 then 'OK' else 'CHECK' end
    from public.support_staff s
   where not exists (select 1 from public.admin_users u where u.user_id = s.user_id and u.status = 'active')

  union all
  select 'E', 'E6 admin audit rows in the last 7 days, by outcome',
         coalesce((select string_agg(o.outcome || ': ' || o.n, ', ' order by o.outcome)
                     from (select outcome, count(*) n from public.admin_audit_log where at > now() - interval '7 days' group by outcome) o), 'no rows'),
         'INFO'

  -- ================= F. sensitive data =================
  union all
  select 'F', 'F1 column that holds sensitive data in clear text and can be read by a signed-in user (name only)',
         coalesce(string_agg(t.relname || '.' || a.attname, ', ' order by t.relname, a.attname), 'none'),
         case when count(*) = 0 then 'OK' else 'CHECK' end
    from tb t join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
   where a.attname in ('id_number', 'account_number', 'authorization_code', 'bvn', 'nin', 'card_number', 'address', 'password', 'secret', 'api_key')
     and has_column_privilege('authenticated', t.oid, a.attnum, 'SELECT')
     and t.relname not like 'admin\_%' escape '\'

  union all
  select 'F', 'F2 rows in subscription_card_authorizations (rule R-C says no saved cards; expect 0)',
         (select count(*) from public.subscription_card_authorizations)::text,
         case when (select count(*) from public.subscription_card_authorizations) = 0 then 'OK' else 'CHECK' end

  union all
  select 'F', 'F3 can a signed-in user read authorization_code (column privilege)',
         case when has_column_privilege('authenticated', 'public.subscription_card_authorizations'::regclass, 'authorization_code', 'SELECT')
              then 'yes (row level security decides which rows)' else 'no' end,
         case when has_column_privilege('authenticated', 'public.subscription_card_authorizations'::regclass, 'authorization_code', 'SELECT')
              then 'CHECK' else 'OK' end

  union all
  select 'F', 'F4 payment_intents.purpose still allows topup (rule R-W: the site takes no top-ups)',
         case when exists (select 1 from pg_constraint k where k.conrelid = 'public.payment_intents'::regclass and k.contype = 'c'
                            and pg_get_constraintdef(k.oid) ilike '%topup%') then 'yes' else 'no' end,
         case when exists (select 1 from pg_constraint k where k.conrelid = 'public.payment_intents'::regclass and k.contype = 'c'
                            and pg_get_constraintdef(k.oid) ilike '%topup%') then 'CHECK' else 'OK' end

  -- ================= G. storage =================
  union all
  select 'G', 'G1 public storage buckets (anyone with the link can read every file in them)',
         coalesce(string_agg(b.name, ', ' order by b.name), 'none'), 'INFO'
    from storage.buckets b where b.public

  union all
  select 'G', 'G2 private storage buckets',
         coalesce(string_agg(b.name, ', ' order by b.name), 'none'), 'INFO'
    from storage.buckets b where not b.public

  union all
  select 'G', 'G3 storage policy with no condition at all on a private bucket name pattern (policy names only)',
         coalesce(string_agg(p.policyname, ', ' order by p.policyname), 'none'),
         case when count(*) = 0 then 'OK' else 'CHECK' end
    from pg_policies p
   where p.schemaname = 'storage' and p.tablename = 'objects'
     and btrim(coalesce(p.qual, '')) in ('true', '(true)') and p.cmd in ('UPDATE', 'DELETE', 'ALL')

  -- ================= H. audit log =================
  union all
  select 'H', 'H1 admin_audit_log blocks UPDATE, DELETE and TRUNCATE by trigger',
         (select count(*) from pg_trigger t where t.tgrelid = 'public.admin_audit_log'::regclass and not t.tgisinternal)::text || ' trigger(s)',
         case when (select count(*) from pg_trigger t where t.tgrelid = 'public.admin_audit_log'::regclass and not t.tgisinternal) >= 2 then 'OK' else 'RISK' end

  union all
  select 'H', 'H2 can a signed-in user or anon touch admin_audit_log directly',
         case when has_table_privilege('authenticated', 'public.admin_audit_log', 'SELECT,INSERT,UPDATE,DELETE')
                or has_table_privilege('anon', 'public.admin_audit_log', 'SELECT,INSERT,UPDATE,DELETE')
              or exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = 'admin_audit_log'
                          and g.grantee in ('anon', 'authenticated', 'PUBLIC')) then 'yes' else 'no' end,
         case when exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = 'admin_audit_log'
                            and g.grantee in ('anon', 'authenticated', 'PUBLIC')) then 'RISK' else 'OK' end
)
select sec as section, item, detail, status from r order by sec, item;

-- Run in Supabase > SQL Editor. Read only: it changes nothing.
-- Shows which tables still hold rows for mistressjanellekath@gmail.com and block deleting her from Authentication > Users.

-- 1) Her id
select id, email, created_at from auth.users where email = 'mistressjanellekath@gmail.com';

-- 2) Every foreign key that points at auth.users or public.users, and what it does on delete
--    NO ACTION / RESTRICT = blocks the delete while a row exists. CASCADE = removes the row for you.
select c.conrelid::regclass as in_table,
       a.attname            as column_name,
       c.confrelid::regclass as points_at,
       case c.confdeltype when 'a' then 'NO ACTION (blocks)' when 'r' then 'RESTRICT (blocks)'
                          when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as on_delete
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
where c.contype = 'f'
  and c.confrelid in ('auth.users'::regclass, 'public.users'::regclass)
order by on_delete desc, in_table::text;

-- 3) Is she an admin? admin_users is ON DELETE RESTRICT by design.
select * from public.admin_users
where user_id = (select id from auth.users where email = 'mistressjanellekath@gmail.com');

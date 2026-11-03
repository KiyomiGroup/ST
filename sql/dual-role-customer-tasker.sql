-- StreetTasker: one login, two roles (customer + tasker), and "only customers book or buy gift cards".
-- Run ONCE in the Supabase SQL editor, BEFORE uploading the website files. Safe to run twice.
-- Undo: sql/dual-role-customer-tasker-rollback.sql

-- 1. public.users.roles = every role the person holds. public.users.role stays the ACTIVE role.
alter table public.users add column if not exists roles text[];

update public.users
   set roles = case when role is null then '{}'::text[] else array[role] end
 where roles is null;

-- 2. Browsers cannot grant themselves a role or switch to one they do not hold.
--    Only add_my_role / switch_my_role below (and the SQL editor / service role) can.
create or replace function public.users_roles_guard()
returns trigger language plpgsql as $$
declare internal boolean := coalesce(current_setting('st.role_change', true), '') = 'ok';
begin
  if tg_op = 'INSERT' then
    if internal or auth.uid() is null then
      if new.roles is null or cardinality(new.roles) = 0 then
        new.roles := case when new.role is null then '{}'::text[] else array[new.role] end;
      end if;
    else
      new.roles := case when new.role is null then '{}'::text[] else array[new.role] end;
    end if;
    return new;
  end if;

  if internal or auth.uid() is null then
    return new;
  end if;

  new.roles := old.roles;                                   -- a browser cannot change the list
  if new.role is distinct from old.role then
    if new.role is null or old.roles is null or not (new.role = any (old.roles)) then
      new.role := old.role;                                 -- ignored: not a role this login holds
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_users_roles_guard on public.users;
create trigger trg_users_roles_guard
  before insert or update on public.users
  for each row execute function public.users_roles_guard();

-- 3. Add a role to the signed-in login (and make it active)
create or replace function public.add_my_role(p_role text)
returns text[] language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r text[];
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_role not in ('customer', 'tasker') then raise exception 'bad_role'; end if;
  perform set_config('st.role_change', 'ok', true);
  update public.users u
     set roles = (select array(select distinct x from unnest(
                   coalesce(u.roles, case when u.role is null then '{}'::text[] else array[u.role] end) || p_role) as x)),
         role  = p_role
   where u.id = uid
   returning u.roles into r;
  if not found then raise exception 'no_profile'; end if;
  return r;
end $$;

-- 4. Switch the active role to one the login already holds
create or replace function public.switch_my_role(p_role text)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ok boolean;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select (p_role = any (coalesce(roles, '{}'::text[]))) into ok from public.users where id = uid;
  if not coalesce(ok, false) then raise exception 'not_held'; end if;
  perform set_config('st.role_change', 'ok', true);
  update public.users set role = p_role where id = uid;
  return p_role;
end $$;

revoke all on function public.add_my_role(text), public.switch_my_role(text) from public, anon;
grant execute on function public.add_my_role(text), public.switch_my_role(text) to authenticated;

-- 5. Only customers can book. A booking made from a tasker-mode login is refused.
--    (Bookings written by the server or by a coordinator for someone else are not affected.)
create or replace function public.bookings_customer_only()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if auth.uid() is not null and new.customer_id::text = auth.uid()::text then
    select role into r from public.users where id = auth.uid();
    if r = 'tasker' then
      raise exception 'Only customer accounts can book a service. Switch to your customer account.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_bookings_customer_only on public.bookings;
create trigger trg_bookings_customer_only
  before insert on public.bookings
  for each row execute function public.bookings_customer_only();

-- 6. Only customers can buy gift cards (the checkout function writes this table with the service key)
create or replace function public.gift_orders_customer_only()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text;
begin
  select role into r from public.users where id::text = new.buyer_user_id::text;
  if r = 'tasker' then
    raise exception 'Only customer accounts can buy gift cards. Switch to your customer account.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_gift_orders_customer_only on public.gift_card_orders;
create trigger trg_gift_orders_customer_only
  before insert on public.gift_card_orders
  for each row execute function public.gift_orders_customer_only();

-- Check (read only): every user should have roles filled in
-- select count(*) filter (where roles is null) as missing_roles, count(*) as users from public.users;

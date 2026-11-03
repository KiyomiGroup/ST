-- Undo for dual-role-customer-tasker.sql. Run only if something goes wrong.
drop trigger if exists trg_gift_orders_customer_only on public.gift_card_orders;
drop trigger if exists trg_bookings_customer_only on public.bookings;
drop trigger if exists trg_users_roles_guard on public.users;
drop function if exists public.gift_orders_customer_only();
drop function if exists public.bookings_customer_only();
drop function if exists public.switch_my_role(text);
drop function if exists public.add_my_role(text);
drop function if exists public.users_roles_guard();
-- The roles column is left in place (harmless). To remove it too: alter table public.users drop column roles;

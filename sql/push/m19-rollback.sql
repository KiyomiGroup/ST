-- Undoes m19-core.sql (removes saved devices too).
drop function if exists public.push_save_subscription(text, text, text, text);
drop function if exists public.push_remove_subscription(text);
drop table if exists public.push_subscriptions;

-- Phone notification devices. RUN THIS ONLY IF the check below says the function is missing.
-- push.js calls push_save_subscription and push_remove_subscription; if they do not exist in your database,
-- "Turn on" fails. (These were not in the project files, so check first.)
--
-- CHECK (run alone first):
--   select proname from pg_proc where proname in ('push_save_subscription','push_remove_subscription');
-- Two rows back = you already have them: do NOT run the rest of this file.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
-- No policies: devices are written only through the functions below and read only by the push-send function (service role).

create or replace function public.push_save_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_ua)
  on conflict (endpoint) do update set
    user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, updated_at = now();
end;
$$;

create or replace function public.push_remove_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

grant execute on function public.push_save_subscription(text, text, text, text) to authenticated;
grant execute on function public.push_remove_subscription(text) to authenticated;

-- StreetTasker M19 phone notifications. Run the WHOLE file once.
-- A phone or browser that agrees to get notifications is saved here (one row per device). Browsers can only add or remove THEIR OWN device
-- through the two functions below; nobody can read the table from the site. The push-send edge function (server) reads it.
create table if not exists public.push_subscriptions (
  id           bigserial primary key,
  user_id      uuid not null,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;

create or replace function public.push_save_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $m19$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Please log in first.'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2000
     or p_p256dh is null or length(p_p256dh) not between 20 and 200
     or p_auth is null or length(p_auth) not between 8 and 100 then
    raise exception 'That device could not be saved.';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
  on conflict (endpoint) do update
    set user_id = v_uid, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, last_seen_at = now();
  -- at most 10 devices per person: the oldest go first
  delete from public.push_subscriptions
   where user_id = v_uid and id not in (select id from public.push_subscriptions where user_id = v_uid order by last_seen_at desc, id desc limit 10);
end $m19$;

create or replace function public.push_remove_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = public, pg_temp as $m19$
begin
  if auth.uid() is null then return; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $m19$;

revoke all on function public.push_save_subscription(text, text, text, text) from public, anon;
revoke all on function public.push_remove_subscription(text) from public, anon;
grant execute on function public.push_save_subscription(text, text, text, text) to authenticated;
grant execute on function public.push_remove_subscription(text) to authenticated;

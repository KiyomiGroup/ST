-- Notification preferences (phone + email). Run once in the Supabase SQL editor. Safe to run again.
-- Everyone is ON by default: a person with no row counts as push_enabled = true, email_enabled = true.

create table if not exists public.notification_preferences (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  push_enabled  boolean not null default true,
  email_enabled boolean not null default true,
  updated_at    timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;

drop policy if exists "own prefs read" on public.notification_preferences;
create policy "own prefs read" on public.notification_preferences for select using (user_id = auth.uid());
-- Writes go through set_my_notification_prefs below, so there is no insert/update policy.

create or replace function public.get_my_notification_prefs()
returns table (push_enabled boolean, email_enabled boolean)
language sql security definer set search_path = public stable as $$
  select coalesce(p.push_enabled, true), coalesce(p.email_enabled, true)
  from (select auth.uid() as uid) u
  left join public.notification_preferences p on p.user_id = u.uid
  where u.uid is not null;
$$;

-- p_push / p_email: null = leave unchanged
create or replace function public.set_my_notification_prefs(p_push boolean, p_email boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.notification_preferences (user_id, push_enabled, email_enabled)
  values (auth.uid(), coalesce(p_push, true), coalesce(p_email, true))
  on conflict (user_id) do update set
    push_enabled  = coalesce(p_push,  public.notification_preferences.push_enabled),
    email_enabled = coalesce(p_email, public.notification_preferences.email_enabled),
    updated_at    = now();
end;
$$;

grant execute on function public.get_my_notification_prefs() to authenticated;
grant execute on function public.set_my_notification_prefs(boolean, boolean) to authenticated;

-- FOR WHATEVER SENDS YOUR NOTIFICATION EMAILS AND PHONE PUSHES (Edge Function, trigger, cron):
-- check these before sending, so a switch the person turned off is respected.
--   Email:  select public.user_wants_email('<user id>');
--   Push:   select public.user_wants_push('<user id>');
-- Do NOT use them for sign-in, password-reset, verification or payment/receipt emails: those are always sent.
create or replace function public.user_wants_email(p_user uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce((select email_enabled from public.notification_preferences where user_id = p_user), true);
$$;
create or replace function public.user_wants_push(p_user uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce((select push_enabled from public.notification_preferences where user_id = p_user), true);
$$;
revoke execute on function public.user_wants_email(uuid) from public, anon, authenticated;
revoke execute on function public.user_wants_push(uuid) from public, anon, authenticated;
grant execute on function public.user_wants_email(uuid) to service_role;
grant execute on function public.user_wants_push(uuid) to service_role;

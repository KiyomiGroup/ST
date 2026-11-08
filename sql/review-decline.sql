-- Review pop-up: remember "No thanks" on the server so it never comes back, on any device.
-- Run once in the Supabase SQL editor. Safe to run again.
-- Only a deliberate "No thanks" is saved here. Clicking outside the pop-up or pressing Escape saves nothing (it is treated as a mistake).

create table if not exists public.review_declines (
  user_id    uuid not null references auth.users(id) on delete cascade,
  booking_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, booking_id)
);
alter table public.review_declines enable row level security;

drop policy if exists "own review declines read" on public.review_declines;
create policy "own review declines read" on public.review_declines for select using (user_id = auth.uid());
-- Writes go through decline_review below, so there is no insert/update/delete policy.

-- Only the customer of that booking can decline its review pop-up.
create or replace function public.decline_review(p_booking uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not exists (select 1 from public.bookings b where b.id = p_booking and b.customer_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'not your booking');
  end if;
  insert into public.review_declines (user_id, booking_id) values (auth.uid(), p_booking)
  on conflict do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.decline_review(uuid) from public, anon;
grant execute on function public.decline_review(uuid) to authenticated;

-- Check (run after the file above; expect: table exists = true, function exists = true)
select
  to_regclass('public.review_declines') is not null as table_exists,
  exists (select 1 from pg_proc where proname = 'decline_review') as function_exists;

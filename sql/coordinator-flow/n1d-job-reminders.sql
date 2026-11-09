-- Stage N1d: job-day reminders for the coordinator (30 minutes before AND at the start). ADDITIVE. Run once in the Supabase SQL editor.
-- Written from the introspect results of 2026-11-08. Tested on a scratch Postgres with stand-in tables, NOT on the real project.
-- Undo: n1d-rollback.sql.
--
-- bookings.scheduled_time is TEXT like '2026-11-09 — Afternoon (12pm – 5pm)': a date and a time WINDOW, not a clock time.
-- "Start" therefore means the first hour of the window (12pm here), in Lagos time. A booking with no scheduled_time gets no reminder.
-- Each reminder is sent once per booking (log table). It goes only while the job is approved (quote approved), open, and not under a problem report.

begin;

create table if not exists public.coordinator_job_reminders (
  booking_id uuid not null,
  kind text not null check (kind in ('before', 'start')),
  sent_at timestamptz not null default now(),
  primary key (booking_id, kind)
);
alter table public.coordinator_job_reminders enable row level security;   -- no policies: only the functions below touch it

-- '2026-11-09 — Afternoon (12pm – 5pm)'  ->  2026-11-09 12:00 Africa/Lagos. Anything it cannot read gives NULL.
create or replace function public._lt_window_start(p_text text)
returns timestamptz language plpgsql immutable set search_path to 'public', 'pg_temp' as $f$
declare d text; h int; ap text; m text[];
begin
  if p_text is null then return null; end if;
  m := regexp_match(p_text, '^\s*(\d{4}-\d{2}-\d{2})');
  if m is null then return null; end if;
  d := m[1];
  m := regexp_match(lower(p_text), '\(\s*(\d{1,2})\s*(am|pm)');
  if m is null then return null; end if;
  h := m[1]::int; ap := m[2];
  if h < 1 or h > 12 then return null; end if;
  h := (h % 12) + case when ap = 'pm' then 12 else 0 end;
  return (d::date + make_interval(hours => h)) at time zone 'Africa/Lagos';
exception when others then return null;
end $f$;

create or replace function public.coordinator_send_job_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare
  r record; v_start timestamptz; v_kind text; n int := 0; v_ins int;
begin
  for r in
    select s.booking_id, s.coordinator_id, b.scheduled_time
      from public.local_booking_state s join public.bookings b on b.id = s.booking_id
     where s.coordinator_id is not null and s.lt_status = 'quote_approved'
       and public._local_booking_is_open(b.status) and b.scheduled_time is not null
  loop
    begin
      if public.job_booking_frozen(r.booking_id) then continue; end if;
      v_start := public._lt_window_start(r.scheduled_time);
      if v_start is null then continue; end if;
      v_kind := case
        when p_now >= v_start and p_now < v_start + interval '6 hours' then 'start'
        when p_now >= v_start - interval '30 minutes' and p_now < v_start then 'before'
        else null end;
      if v_kind is null then continue; end if;
      insert into public.coordinator_job_reminders (booking_id, kind) values (r.booking_id, v_kind) on conflict do nothing;
      get diagnostics v_ins = row_count;
      if v_ins = 0 then continue; end if;                       -- already sent
      perform public._co_notify(
        r.coordinator_id, 'coordinator_job_reminder',
        case when v_kind = 'before' then 'Job starts in 30 minutes' else 'The job time has arrived' end,
        case when v_kind = 'before'
             then 'Phone the Local Tasker now and confirm they are ready and on their way. Booked time: ' || r.scheduled_time
             else 'Phone the Local Tasker and confirm they have begun work. Then record the step on the booking. Booked time: ' || r.scheduled_time end,
        jsonb_build_object('booking_id', r.booking_id, 'url', '/coordinator-booking.html?id=' || r.booking_id::text));
      n := n + 1;
    exception when others then
      raise warning 'coordinator_send_job_reminders (%): %', r.booking_id, sqlerrm;
    end;
  end loop;
  return n;
end $f$;
revoke all on function public.coordinator_send_job_reminders(timestamptz) from public, anon, authenticated;

-- every 5 minutes (pg_cron is on in this project: 3 jobs already run)
do $c$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'coordinator-job-reminders';
    perform cron.schedule('coordinator-job-reminders', '*/5 * * * *', 'select public.coordinator_send_job_reminders()');
  end if;
end $c$;

commit;

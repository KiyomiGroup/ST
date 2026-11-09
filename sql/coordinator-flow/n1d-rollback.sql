begin;
do $c$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'coordinator-job-reminders';
  end if;
end $c$;
drop function if exists public.coordinator_send_job_reminders(timestamptz);
drop function if exists public._lt_window_start(text);
drop table if exists public.coordinator_job_reminders;
commit;

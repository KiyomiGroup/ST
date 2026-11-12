-- Undo n2-task-alerts.sql (Stage 6f). Notifications already sent stay in people's bells.
begin;
do $c$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'task-alert-digest';
  end if;
end $c$;
drop function if exists public.send_task_alert_digests(timestamptz, interval);
drop function if exists public._task_alert_candidates(timestamptz, interval);
drop function if exists public.category_group(text);
drop table if exists public.task_alert_log;
commit;

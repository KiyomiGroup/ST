-- M18 step C check (READ ONLY): row rules of the OTHER tables browsers can write. Run it, export the 1 row as CSV, send it to me.
select string_agg(tablename || ' | ' || policyname || ' | ' || cmd || ' | roles=' || array_to_string(roles, ',') || ' | using=' || coalesce(qual, '-') || ' | check=' || coalesce(with_check, '-'), E'\n' order by tablename, cmd, policyname) as policies
  from pg_policies
 where schemaname = 'public'
   and tablename in ('verifications','notifications','payment_requests','job_requests','message_threads','messages','comments','feed_posts','booking_private','job_attachments','task_applications','_policy_backup_steps');

-- StreetTasker Admin Control Centre, stage A13: ROLLBACK.
-- Puts public._is_support() back to the body saved by a13-disputes.sql, then drops the A13 functions and the
-- backup table. Safe to run twice. After this, admins can no longer open /admin/disputes.html; support.html
-- keeps working for anyone in support_staff.
do $r$
declare v_def text;
begin
  select b.definition into v_def from public.admin_function_backups b where b.name = '_is_support()';
  if v_def is null then
    raise notice 'Nothing to restore: no saved copy of _is_support() (A13 was not applied, or it was already rolled back).';
  else
    execute v_def;
    delete from public.admin_function_backups where name = '_is_support()';
    raise notice 'DONE: _is_support() restored to its earlier body.';
  end if;
end
$r$;

drop function if exists public.admin_dispute_start_review(text);
drop function if exists public.admin_dispute_resolve(text, text, text, text, text, text);
drop function if exists public.admin_dispute_record_refund(text, text, text);
drop function if exists public.admin_dispute_remove_evidence(text, text);
drop function if exists public.admin_dispute_read_chat(text, text);
drop function if exists public._admin_dispute_run(text, text, text, text, text, text, text, jsonb);
drop table if exists public.admin_function_backups;

-- VR5 rollback: removes the Didit counter function and its two settings rows. Nothing else was changed by VR5 SQL.
drop function if exists public.admin_didit_usage();
delete from public.verification_rules where key in ('didit_monthly_limit', 'didit_warn_at');
select 'DONE: VR5 rolled back.' as vr5_rollback_result;

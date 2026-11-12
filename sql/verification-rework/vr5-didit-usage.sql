-- VR5 part C: Didit usage counter for the admin Identity verification page (READ ONLY).
-- Run the WHOLE file once in the Supabase SQL editor (safe to run twice). Rollback: vr5-rollback.sql. The last row says DONE or NOT DONE.
-- Needs: the admin core (A1), A11 (identity_verifications), and VR3a (table verification_rules).
--
-- Adds:
--   two rows in verification_rules:  didit_monthly_limit = 30,  didit_warn_at = 25   (change the numbers there, nothing is hard-coded)
--   function admin_didit_usage()     checks verification.view itself; reads identity_verifications only; writes nothing.
--
-- What is counted (UNVERIFIED against the Didit billing page, see "to confirm" below):
--   used     = LIVE (not sandbox) verification sessions STARTED this calendar month = rows with environment = 'live' and a provider_session_id
--              (a row without a provider session never reached Didit) and created_at inside the month.
--   approved = the same rows that ended VERIFIED, shown beside it so the two readings can be compared.
-- Month = calendar month in Lagos time (Africa/Lagos). Didit may bill by another month boundary: to confirm.
-- Level: 'ok' below the warning number, 'warn' from 25 (amber), 'over' from 30 (red).
-- To confirm in the Didit billing page: does a started session count, or only an approved result? Which month boundary? What happens after 30?

do $pre$
begin
  if to_regprocedure('public.admin_has(text)') is null then
    raise exception 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
  end if;
  if to_regclass('public.identity_verifications') is null then
    raise exception 'NOT DONE: identity_verifications does not exist. Nothing was changed.';
  end if;
  if to_regclass('public.verification_rules') is null then
    raise exception 'NOT DONE: verification_rules does not exist (VR3a is not installed). Nothing was changed.';
  end if;
end
$pre$;

insert into public.verification_rules (key, int_value) values ('didit_monthly_limit', 30) on conflict (key) do nothing;
insert into public.verification_rules (key, int_value) values ('didit_warn_at', 25) on conflict (key) do nothing;

create or replace function public.admin_didit_usage()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_limit integer; v_warn integer; v_from timestamptz; v_to timestamptz; v_used integer; v_ok integer; v_level text;
begin
  if not public.admin_has('verification.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  v_limit := coalesce((select int_value from public.verification_rules where key = 'didit_monthly_limit'), 30);
  v_warn  := coalesce((select int_value from public.verification_rules where key = 'didit_warn_at'), 25);
  v_from  := date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  v_to    := (date_trunc('month', now() at time zone 'Africa/Lagos') + interval '1 month') at time zone 'Africa/Lagos';
  select count(*), count(*) filter (where status = 'VERIFIED') into v_used, v_ok
    from public.identity_verifications
   where environment = 'live' and provider_session_id is not null and created_at >= v_from and created_at < v_to;
  v_level := case when v_used >= v_limit then 'over' when v_used >= v_warn then 'warn' else 'ok' end;
  return jsonb_build_object('ok', true, 'used', v_used, 'approved', v_ok, 'limit', v_limit, 'warn_at', v_warn,
    'level', v_level, 'month_start', v_from, 'month_end', v_to, 'generated_at', now());
end $$;

revoke all on function public.admin_didit_usage() from public, anon, authenticated;
grant execute on function public.admin_didit_usage() to authenticated;

select case
  when to_regprocedure('public.admin_didit_usage()') is not null
   and exists (select 1 from public.verification_rules where key = 'didit_monthly_limit')
   and exists (select 1 from public.verification_rules where key = 'didit_warn_at')
  then 'DONE: VR5 Didit counter installed.'
  else 'NOT DONE: see the messages above.'
end as vr5_result;

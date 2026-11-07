-- Run once in the Supabase SQL editor.
-- Lets the public referral link (/r/CODE) know whether a code belongs to a tasker or a customer,
-- so the preview can say "premium account" or "gift cards". Returns ONLY 'tasker' or 'customer' (or null). Nothing else is exposed.
-- NOTE: the referral_profiles columns used here (code, programme) are the ones js/referral-data.js already reads. Check them against your schema before running.
create or replace function public.referral_code_programme(p_code text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select programme::text
  from public.referral_profiles
  where code = upper(trim(p_code))
    and programme in ('tasker', 'customer')
  limit 1;
$$;

revoke all on function public.referral_code_programme(text) from public;
grant execute on function public.referral_code_programme(text) to anon, authenticated;

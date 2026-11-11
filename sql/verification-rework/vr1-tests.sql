-- VR1 tests. Run AFTER vr1-legal-name.sql. Changes nothing (pure functions and catalog checks only).
-- Last line must say: RESULT: ALL PASS
do $$
declare
  v text[] := public.idv_normalize_name('Chinedu Emmanuel Okafor');
  fails text[] := '{}';
begin
  -- normalisation
  if v is distinct from array['chinedu','emmanuel','okafor'] then fails := fails || 'normalise basic: ' || v::text; end if;
  if public.idv_normalize_name('Mr. CHIEF Okafor-Nwosu') is distinct from array['nwosu','okafor'] then fails := fails || 'normalise titles and hyphen'; end if;
  if public.idv_normalize_name('Ṣọlá Adébáyọ') is distinct from array['adebayo','sola'] then fails := fails || 'normalise Yoruba marks: ' || public.idv_normalize_name('Ṣọlá Adébáyọ')::text; end if;
  if public.idv_normalize_name(null) is distinct from '{}'::text[] then fails := fails || 'normalise null input'; end if;
  if public.idv_normalize_name('Zoë Müller') is distinct from array['muller','zoe'] then fails := fails || 'normalise accents: ' || public.idv_normalize_name('Zoë Müller')::text; end if;

  -- must PASS
  if not public.idv_names_match(v, public.idv_normalize_name('OKAFOR CHINEDU EMMANUEL')) then fails := fails || 'order swapped'; end if;
  if not public.idv_names_match(v, public.idv_normalize_name('Chinedu Okafor')) then fails := fails || 'bank has no middle name'; end if;
  if not public.idv_names_match(public.idv_normalize_name('Chinedu Okafor'), public.idv_normalize_name('OKAFOR CHINEDU EMMANUEL')) then fails := fails || 'ID has no middle name'; end if;
  if not public.idv_names_match(v, public.idv_normalize_name('MR CHINEDU E OKAFOR')) then fails := fails || 'title and initial in bank name'; end if;
  if not public.idv_names_match(public.idv_normalize_name('Zoë Müller'), public.idv_normalize_name('ZOE MULLER')) then fails := fails || 'accents'; end if;

  if not public.idv_names_match(v, public.idv_normalize_name('Chinedu Emmanuel Okafor Junior')) then fails := fails || 'bank name with an extra word'; end if;
  if not public.idv_names_match(public.idv_normalize_name('Ṣọlá Adébáyọ'), public.idv_normalize_name('ADEBAYO SOLA')) then fails := fails || 'Yoruba marks vs plain bank name'; end if;

  -- must FAIL
  if public.idv_names_match(v, public.idv_normalize_name('C E Okafor')) then fails := fails || 'initials only must fail'; end if;
  if public.idv_names_match(v, public.idv_normalize_name('Okafor')) then fails := fails || 'one word must fail'; end if;
  if public.idv_names_match(public.idv_normalize_name('Okafor'), public.idv_normalize_name('Okafor Chinedu')) then fails := fails || 'one-word ID must fail'; end if;
  if public.idv_names_match(v, public.idv_normalize_name('Ngozi Okafor')) then fails := fails || 'shared surname only must fail'; end if;
  if public.idv_names_match(v, public.idv_normalize_name('Ada Eze')) then fails := fails || 'different person must fail'; end if;
  if public.idv_names_match('{}'::text[], v) or public.idv_names_match(v, '{}'::text[]) then fails := fails || 'empty must fail'; end if;

  if array_length(fails, 1) is not null then raise exception 'VR1 TESTS FAILED: %', array_to_string(fails, ' | '); end if;
end $$;

-- objects and permissions
select case when
  to_regclass('public.idv_verified_names') is not null
  and (select relrowsecurity from pg_class where oid = 'public.idv_verified_names'::regclass)
  and not has_table_privilege('authenticated', 'public.idv_verified_names', 'select')
  and not has_function_privilege('authenticated', 'public.idv_store_name(text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.idv_name_check(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.idv_set_name_manual(uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.idv_store_name(text,text)', 'execute')
  and exists (select 1 from pg_trigger where tgname = 'idv_names_on_consent_revoke' and not tgisinternal)
 then 'RESULT: ALL PASS' else 'RESULT: FAIL (an object or permission is wrong)' end as result;

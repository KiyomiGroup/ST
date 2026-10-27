-- Stage 4A-3: audited edit of a Local Tasker profile, by the managing coordinator.
-- Additive and re-runnable. Rollback: stage-4a3-rollback.sql.
-- Run in the Supabase SQL editor (select all, Run). Run it twice; the second run must show no error.
--
-- Creates ONE function: public.update_local_tasker_profile(...), callable by a signed-in user
-- through the Supabase client (rpc). It is SECURITY DEFINER and decides everything itself:
--   * the caller is auth.uid(): never a parameter;
--   * the caller must be an ACTIVE coordinator who CURRENTLY manages this Local Tasker
--     (coordinator_manages_tasker). Anyone else gets the same "not found" answer, so it
--     cannot be used to find out who is a Local Tasker;
--   * it can change ONLY: public name (users.name and taskers.name), full name, phone,
--     areas served, skills, availability notes. It cannot touch status, assignment, consent,
--     verification, publishing, wallets or any money;
--   * the phone is written ONLY to local_tasker_profiles.phone, never to users or taskers;
--   * a real change writes one audit row listing the NAMES of the changed fields (never the
--     phone or full name). A save with no change writes nothing.
-- Changes NO existing object.

create or replace function public.update_local_tasker_profile(
  p_tasker uuid, p_public_name text, p_full_name text, p_phone text,
  p_areas_served text, p_skills text[], p_availability_notes text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid();
  p public.local_tasker_profiles;
  v_old_public text;
  v_public text := btrim(coalesce(p_public_name, ''));
  v_full text := btrim(coalesce(p_full_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_areas text := nullif(btrim(coalesce(p_areas_served, '')), '');
  v_notes text := nullif(btrim(coalesce(p_availability_notes, '')), '');
  v_skills text[] := coalesce(p_skills, '{}'::text[]);
  v_changed text[] := '{}';
begin
  if v_me is null or p_tasker is null
     or not public.is_active_coordinator(v_me)
     or not public.coordinator_manages_tasker(v_me, p_tasker) then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;

  if char_length(v_public) not between 2 and 80
     or char_length(v_full) not between 2 and 120
     or char_length(v_phone) not between 7 and 20
     or char_length(coalesce(v_areas, '')) > 300
     or char_length(coalesce(v_notes, '')) > 500
     or cardinality(v_skills) > 20
     or exists (select 1 from unnest(v_skills) s where s is null or char_length(btrim(s)) not between 1 and 60) then
    raise exception 'Invalid Local Tasker details.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  v_skills := array(select btrim(s) from unnest(v_skills) s);

  select * into p from public.local_tasker_profiles where tasker_user_id = p_tasker for update;
  if not found then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select u.name into v_old_public from public.users u where u.id = p_tasker;

  if p.full_name is distinct from v_full then v_changed := v_changed || 'full_name'::text; end if;
  if p.phone is distinct from v_phone then v_changed := v_changed || 'phone'::text; end if;
  if p.areas_served is distinct from v_areas then v_changed := v_changed || 'areas_served'::text; end if;
  if p.skills is distinct from v_skills then v_changed := v_changed || 'skills'::text; end if;
  if p.availability_notes is distinct from v_notes then v_changed := v_changed || 'availability_notes'::text; end if;
  if v_old_public is distinct from v_public then v_changed := v_changed || 'public_name'::text; end if;

  if cardinality(v_changed) = 0 then
    return jsonb_build_object('changed', '[]'::jsonb);
  end if;

  update public.local_tasker_profiles
     set full_name = v_full, phone = v_phone, areas_served = v_areas, skills = v_skills, availability_notes = v_notes
   where tasker_user_id = p_tasker;
  if 'public_name' = any (v_changed) then
    update public.users set name = v_public where id = p_tasker;
    update public.taskers set name = v_public where id = p_tasker::text or user_id = p_tasker::text;
  end if;

  perform public.local_tasker_audit('local_tasker_updated', 'local_tasker', p_tasker::text,
    case when 'public_name' = any (v_changed) then jsonb_build_object('public_name', v_old_public) else null end,
    jsonb_build_object('changed_fields', to_jsonb(v_changed))
      || case when 'public_name' = any (v_changed) then jsonb_build_object('public_name', v_public) else '{}'::jsonb end,
    v_me);

  return jsonb_build_object('changed', to_jsonb(v_changed));
end $$;

-- Signed-in users may call it (the function checks who they are); anonymous callers may not.
revoke all on function public.update_local_tasker_profile(uuid, text, text, text, text, text[], text) from public, anon;
grant execute on function public.update_local_tasker_profile(uuid, text, text, text, text, text[], text) to authenticated, service_role;

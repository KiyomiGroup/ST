-- Stage 4B-1: services (listings) for a Local Tasker, saved by the managing coordinator.
-- Additive and re-runnable. Rollback: stage-4b1-rollback.sql.
-- Run in the Supabase SQL editor (select all, Run). Run it twice; the second run must show no error.
--
-- Creates ONE function: public.save_local_tasker_service(...), callable by a signed-in user
-- through the Supabase client (rpc). It is SECURITY DEFINER and decides everything itself:
--   * the caller is auth.uid(): never a parameter;
--   * the caller must be an ACTIVE coordinator who CURRENTLY manages this Local Tasker.
--     Anyone else gets the same "not found" answer;
--   * it writes ONLY a row in public.services for that Local Tasker (create, or change one of
--     THEIR services), at most 5 services each. It never deletes: a service is paused with
--     available = false. verified / rating / reviews_count are always the defaults;
--   * the first time (no active "publish_info" agreement on record) it REQUIRES the agreement
--     method and records it, in the same transaction, as an append-only consent row;
--   * every real change writes an audit row. Nothing here publishes anything: the existing
--     hide-unpublished policy keeps the services hidden from customers until Stage 4C.
-- Changes NO existing object.

create or replace function public.save_local_tasker_service(
  p_tasker uuid, p_service_id uuid, p_name text, p_category text, p_price numeric,
  p_rate_unit text, p_description text, p_location text, p_specialties text[],
  p_availability text, p_available boolean,
  p_consent_method text, p_consent_evidence text, p_consent_details text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid();
  p public.local_tasker_profiles;
  s public.services;
  v_name text := btrim(coalesce(p_name, ''));
  v_cat text := btrim(coalesce(p_category, ''));
  v_unit text := btrim(coalesce(p_rate_unit, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  v_loc text;
  v_spec text[] := coalesce(p_specialties, '{}'::text[]);
  v_avail text := coalesce(nullif(btrim(coalesce(p_availability, '')), ''), 'available_this_week');
  v_changed text[] := '{}';
  v_id uuid;
  v_created boolean := false;
  v_has_consent boolean;
  v_consent uuid;
  v_method text := nullif(btrim(coalesce(p_consent_method, '')), '');
begin
  if v_me is null or p_tasker is null
     or not public.is_active_coordinator(v_me)
     or not public.coordinator_manages_tasker(v_me, p_tasker) then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;

  select * into p from public.local_tasker_profiles where tasker_user_id = p_tasker for update;
  if not found then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;

  v_loc := coalesce(nullif(btrim(coalesce(p_location, '')), ''), p.areas_served);

  if char_length(v_name) not between 3 and 100
     or v_cat !~ '^[a-z][a-z_]{1,39}$'
     or p_price is null or p_price <= 0 or p_price > 10000000
     or v_unit not in ('/hour', '/day', '/job', '/visit', '/session')
     or char_length(v_desc) not between 10 and 1000
     or char_length(coalesce(v_loc, '')) > 200
     or cardinality(v_spec) > 10
     or exists (select 1 from unnest(v_spec) x where x is null or char_length(btrim(x)) not between 1 and 40)
     or v_avail not in ('available_now', 'available_today', 'available_this_week')
     or p_available is null then
    raise exception 'Invalid service details.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  v_spec := array(select btrim(x) from unnest(v_spec) x);
  p_price := round(p_price, 2);

  select exists (select 1 from public.local_tasker_consents c
                  where c.tasker_user_id = p_tasker and c.purpose = 'publish_info' and c.revoked_at is null)
    into v_has_consent;
  if not v_has_consent and (v_method is null or v_method not in ('in_person', 'phone', 'written')) then
    raise exception 'Record how they agreed to have their service information published.' using errcode = 'P0001', hint = 'consent_required';
  end if;

  if p_service_id is null then
    if exists (select 1 from public.services x where x.user_id = p_tasker and lower(x.service_name) = lower(v_name)) then
      raise exception 'This Local Tasker already has a service with that name.' using errcode = 'P0001', hint = 'duplicate_name';
    end if;
    if (select count(*) from public.services x where x.user_id = p_tasker) >= 5 then
      raise exception 'A Local Tasker can have at most 5 services.' using errcode = 'P0001', hint = 'service_limit';
    end if;
    insert into public.services (user_id, service_name, category, price, rate_unit, description, location,
                                 specialties, availability_status, available, verified, rating, reviews_count)
    values (p_tasker, v_name, v_cat, p_price, v_unit, v_desc, v_loc, v_spec, v_avail, p_available, false, 0, 0)
    returning id into v_id;
    v_created := true;
  else
    select * into s from public.services where id = p_service_id and user_id = p_tasker for update;
    if not found then
      raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
    end if;
    v_id := s.id;
    if s.service_name is distinct from v_name then v_changed := v_changed || 'name'::text; end if;
    if s.category is distinct from v_cat then v_changed := v_changed || 'category'::text; end if;
    if s.price is distinct from p_price then v_changed := v_changed || 'price'::text; end if;
    if s.rate_unit is distinct from v_unit then v_changed := v_changed || 'rate_unit'::text; end if;
    if s.description is distinct from v_desc then v_changed := v_changed || 'description'::text; end if;
    if s.location is distinct from v_loc then v_changed := v_changed || 'location'::text; end if;
    if s.specialties is distinct from v_spec then v_changed := v_changed || 'specialties'::text; end if;
    if s.availability_status is distinct from v_avail then v_changed := v_changed || 'availability'::text; end if;
    if s.available is distinct from p_available then v_changed := v_changed || 'active'::text; end if;
    if cardinality(v_changed) = 0 and v_has_consent then
      return jsonb_build_object('service_id', v_id, 'created', false, 'changed', '[]'::jsonb);
    end if;
    if cardinality(v_changed) > 0 then
      update public.services
         set service_name = v_name, category = v_cat, price = p_price, rate_unit = v_unit, description = v_desc,
             location = v_loc, specialties = v_spec, availability_status = v_avail, available = p_available
       where id = v_id;
    end if;
  end if;

  if not v_has_consent then
    insert into public.local_tasker_consents (tasker_user_id, purpose, method, recorded_by, evidence_ref, details)
    values (p_tasker, 'publish_info', v_method, v_me,
            nullif(btrim(coalesce(p_consent_evidence, '')), ''), nullif(btrim(coalesce(p_consent_details, '')), ''))
    returning id into v_consent;
    perform public.local_tasker_audit('consent_recorded', 'local_tasker_consent', v_consent::text, null,
      jsonb_build_object('tasker_user_id', p_tasker, 'purpose', 'publish_info', 'method', v_method), v_me);
  end if;

  if v_created then
    perform public.local_tasker_audit('local_tasker_service_created', 'local_tasker_service', v_id::text, null,
      jsonb_build_object('tasker_user_id', p_tasker, 'name', v_name, 'category', v_cat, 'price', p_price,
                         'rate_unit', v_unit, 'available', p_available), v_me);
    return jsonb_build_object('service_id', v_id, 'created', true, 'changed', '[]'::jsonb);
  elsif cardinality(v_changed) > 0 then
    perform public.local_tasker_audit('local_tasker_service_updated', 'local_tasker_service', v_id::text,
      jsonb_build_object('price', s.price, 'rate_unit', s.rate_unit, 'available', s.available),
      jsonb_build_object('tasker_user_id', p_tasker, 'changed_fields', to_jsonb(v_changed),
                         'price', p_price, 'rate_unit', v_unit, 'available', p_available), v_me);
  end if;
  return jsonb_build_object('service_id', v_id, 'created', false, 'changed', to_jsonb(v_changed));
end $$;

revoke all on function public.save_local_tasker_service(uuid, uuid, text, text, numeric, text, text, text, text[], text, boolean, text, text, text) from public, anon;
grant execute on function public.save_local_tasker_service(uuid, uuid, text, text, numeric, text, text, text, text[], text, boolean, text, text, text) to authenticated, service_role;

-- StreetTasker Admin Control Centre, stage A10: Local Taskers.
-- Run the WHOLE file once in the Supabase SQL editor. Safe to run twice. Rollback: a10-rollback.sql.
-- Needs stages A1 (admin core) and A9 (it reuses admin_coordinator_assign_local_tasker for placing a Local Tasker). The last line says DONE or NOT DONE.
--
-- What it adds (all SECURITY DEFINER, execute for authenticated only, each one checks the admin permission itself):
--   admin_local_tasker_list(search, filter, coordinator, offset)  read   local_taskers.view   50 per page, plus counts and the active coordinators
--   admin_local_tasker_detail(tasker)                              read   local_taskers.view   profile, coordinator and history, identity, services (read only), photos (counts), consents, bookings, payouts
--   admin_local_tasker_unpublish(tasker, reason)                   write  local_taskers.manage hide a published Local Tasker from customers
--   admin_local_tasker_deactivate(tasker, reason)                  write  local_taskers.manage retire a Local Tasker (history kept)
-- Placing or moving a Local Tasker is NOT here: the page calls the A9 function admin_coordinator_assign_local_tasker (permission
-- coordinators.assign; the database's plan-limit guard decides, nothing bypasses it).
--
-- Hard boundaries kept: no price, service, photo, consent, identity or payout row is written. No money moves. The Local Tasker's phone,
-- bank name, consent evidence and consent notes are never returned. Every write needs a reason (10 to 300 characters), refuses a Local
-- Tasker who is in the acting admin's own coordinator care (Rule R-SELF), and writes one admin activity-log row (refusals too).
--
-- Guesses (flagged in docs/admin-control-centre/handoffs/A10.md): the real body of unpublish_local_tasker() was never seen, so the admin
-- unpublish writes what the publish function is known to write, in reverse (status back to 'ready', taskers.available false). Open
-- booking = a booking whose status is not 'completed' or 'cancelled' (the same working guess as A1b and A9; it errs on the side of blocking).

do $pre$
begin
  if to_regprocedure('public.admin_guard(text,text)') is null or to_regprocedure('public.admin_has(text)') is null
     or to_regprocedure('public.admin_log(text,text,text,jsonb,jsonb,text,uuid,text,jsonb)') is null then
    raise exception 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
  end if;
  if to_regprocedure('public.admin_coordinator_assign_local_tasker(uuid,uuid,text)') is null then
    raise exception 'NOT DONE: stage A9 is not installed (run sql/admin/a9-coordinators.sql first). Nothing was changed.';
  end if;
end
$pre$;

-- 0. Helper: keep only the named keys of a row (so a column we never looked at can never leak). No browser access.
create or replace function public._a10_pick(p_row jsonb, p_keys text[])
returns jsonb language sql immutable set search_path = public, pg_temp as $f$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(coalesce(p_row, '{}'::jsonb)) e where e.key = any (p_keys)
$f$;
revoke all on function public._a10_pick(jsonb, text[]) from public, anon, authenticated;

-- 1. List ------------------------------------------------------------------------------------------------------------
create or replace function public.admin_local_tasker_list(p_search text default null, p_filter text default 'all',
                                                          p_coordinator uuid default null, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_filter text := coalesce(p_filter, 'all');
  v_total integer; v_items jsonb; v_counts jsonb; v_coords jsonb;
begin
  if not public.admin_has('local_taskers.view') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if v_filter not in ('all', 'published', 'not_published', 'inactive', 'unassigned', 'unverified', 'has_bookings', 'needs_republish') then
    return jsonb_build_object('ok', false, 'error', 'Unknown filter.');
  end if;
  begin
    with base as (
      select p.tasker_user_id, p.full_name, p.status, p.areas_served, p.published_at, p.needs_republish,
             a.coordinator_id,
             exists (select 1 from public.identity_verifications v where v.user_id = p.tasker_user_id and v.status = 'VERIFIED') as verified,
             (select count(*) from public.local_booking_state s where s.tasker_user_id = p.tasker_user_id) as bookings
        from public.local_tasker_profiles p
        left join lateral (select x.coordinator_id from public.coordinator_assignments x
                            where x.tasker_user_id = p.tasker_user_id and x.ended_at is null limit 1) a on true
    ), filt as (
      select b.* from base b
       where (v_q is null or position(lower(v_q) in lower(coalesce(b.full_name, ''))) > 0 or b.tasker_user_id::text = v_q)
         and (p_coordinator is null or b.coordinator_id = p_coordinator)
         and case v_filter
               when 'all' then true
               when 'published' then b.status = 'published'
               when 'not_published' then b.status in ('draft', 'ready')
               when 'inactive' then b.status = 'inactive'
               when 'unassigned' then b.coordinator_id is null and b.status <> 'inactive'
               when 'unverified' then not b.verified and b.status <> 'inactive'
               when 'has_bookings' then b.bookings > 0
               when 'needs_republish' then b.needs_republish is true and b.status = 'published'
               else false end
    ), pg as (
      select * from filt order by lower(coalesce(full_name, '')), tasker_user_id limit 50 offset v_off
    )
    select (select count(*) from filt),
           (select coalesce(jsonb_agg(jsonb_build_object(
                'tasker_user_id', pg.tasker_user_id, 'name', pg.full_name, 'status', pg.status, 'areas', pg.areas_served,
                'published_at', pg.published_at, 'needs_republish', coalesce(pg.needs_republish, false),
                'coordinator_id', pg.coordinator_id,
                'coordinator_name', (select coalesce(nullif(c.display_name, ''), (select u.name from public.users u where u.id = c.user_id))
                                       from public.coordinators c where c.user_id = pg.coordinator_id),
                'identity_verified', pg.verified, 'bookings', pg.bookings)
                order by lower(coalesce(pg.full_name, '')), pg.tasker_user_id), '[]'::jsonb) from pg),
           jsonb_build_object(
             'all', (select count(*) from base),
             'published', (select count(*) from base where status = 'published'),
             'not_published', (select count(*) from base where status in ('draft', 'ready')),
             'inactive', (select count(*) from base where status = 'inactive'),
             'unassigned', (select count(*) from base where coordinator_id is null and status <> 'inactive'),
             'unverified', (select count(*) from base where not verified and status <> 'inactive'),
             'needs_republish', (select count(*) from base where needs_republish is true and status = 'published'))
      into v_total, v_items, v_counts;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'The list could not be read (' || sqlstate || ').');
  end;
  -- active coordinators with their free places (for the "Place with a coordinator" choice; the database still decides)
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', c.user_id,
             'name', coalesce(nullif(c.display_name, ''), (select u.name from public.users u where u.id = c.user_id)),
             'workers', (select count(*) from public.coordinator_assignments a where a.coordinator_id = c.user_id and a.ended_at is null),
             'capacity', public.coordinator_capacity(c.user_id),
             'is_me', (c.user_id = auth.uid()))
             order by coalesce(nullif(c.display_name, ''), c.user_id::text)), '[]'::jsonb)
      into v_coords from public.coordinators c where c.status = 'active';
  exception when others then
    v_coords := '[]'::jsonb;
  end;
  return jsonb_build_object('ok', true, 'total', v_total, 'offset', v_off, 'page_size', 50, 'items', v_items, 'counts', v_counts,
    'coordinators', v_coords,
    'can_manage', public.admin_has('local_taskers.manage'),
    'can_assign', public.admin_has('coordinators.assign'));
end $f$;

-- 2. Detail ----------------------------------------------------------------------------------------------------------
create or replace function public.admin_local_tasker_detail(p_tasker uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare
  p public.local_tasker_profiles;
  v_profile jsonb; v_cur jsonb; v_hist jsonb; v_idv jsonb; v_serv jsonb; v_photos jsonb; v_cons jsonb; v_book jsonb; v_pay jsonb; v_acct jsonb;
  v_failed text[] := '{}'::text[]; v_digits text;
begin
  if not public.admin_has('local_taskers.view') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if p_tasker is null then return jsonb_build_object('ok', false, 'error', 'Choose a Local Tasker.'); end if;
  select * into p from public.local_tasker_profiles x where x.tasker_user_id = p_tasker;
  if not found then return jsonb_build_object('ok', false, 'error', 'Local Tasker not found.'); end if;

  v_digits := regexp_replace(coalesce(p.phone, ''), '\D', '', 'g');
  v_profile := jsonb_build_object('tasker_user_id', p.tasker_user_id, 'name', p.full_name, 'status', p.status, 'areas', p.areas_served,
    'skills', to_jsonb(p.skills), 'availability_notes', p.availability_notes, 'published_at', p.published_at, 'created_at', p.created_at,
    'needs_republish', coalesce(p.needs_republish, false),
    'phone_hint', case when char_length(v_digits) >= 3 then 'ending ' || right(v_digits, 3) else null end,
    'in_my_care', exists (select 1 from public.coordinator_assignments a where a.tasker_user_id = p.tasker_user_id and a.ended_at is null and a.coordinator_id = auth.uid()));

  begin
    select jsonb_build_object('coordinator_id', a.coordinator_id, 'assigned_at', a.assigned_at, 'assign_reason', a.assign_reason,
             'name', coalesce(nullif(c.display_name, ''), (select u.name from public.users u where u.id = a.coordinator_id)),
             'coordinator_status', c.status)
      into v_cur from public.coordinator_assignments a left join public.coordinators c on c.user_id = a.coordinator_id
     where a.tasker_user_id = p_tasker and a.ended_at is null;
    select coalesce(jsonb_agg(jsonb_build_object('coordinator_id', a.coordinator_id, 'previous_coordinator_id', a.previous_coordinator_id,
             'name', coalesce(nullif(c.display_name, ''), (select u.name from public.users u where u.id = a.coordinator_id)),
             'assigned_at', a.assigned_at, 'assign_reason', a.assign_reason, 'ended_at', a.ended_at, 'end_reason', a.end_reason)
             order by a.assigned_at desc), '[]'::jsonb)
      into v_hist from public.coordinator_assignments a left join public.coordinators c on c.user_id = a.coordinator_id
     where a.tasker_user_id = p_tasker;
  exception when others then v_failed := v_failed || 'coordinator'; v_cur := null; v_hist := null;
  end;

  begin
    select jsonb_build_object('status', v.status, 'updated_at', coalesce(to_jsonb(v) ->> 'updated_at', to_jsonb(v) ->> 'created_at'))
      into v_idv from public.identity_verifications v where v.user_id = p_tasker
     order by coalesce(to_jsonb(v) ->> 'updated_at', to_jsonb(v) ->> 'created_at') desc nulls last limit 1;
  exception when others then v_failed := v_failed || 'identity'; v_idv := null;
  end;

  begin   -- services and prices are shown, never changed
    select coalesce(jsonb_agg(public._a10_pick(to_jsonb(s), array['id','service_name','category','price','rate_unit','available','is_main','availability_status','location'])
             order by s.created_at, s.id), '[]'::jsonb)
      into v_serv from public.services s where s.user_id = p_tasker;
  exception when others then v_failed := v_failed || 'services'; v_serv := null;
  end;

  begin   -- photos: counts only, no file names or links
    select jsonb_build_object(
             'portfolio', count(*) filter (where ph.removed_at is null and coalesce(ph.kind, 'portfolio') = 'portfolio'),
             'profile_picture', count(*) filter (where ph.removed_at is null and ph.kind = 'avatar'),
             'removed', count(*) filter (where ph.removed_at is not null))
      into v_photos from public.local_tasker_photos ph where ph.tasker_user_id = p_tasker;
  exception when others then v_failed := v_failed || 'photos'; v_photos := null;
  end;

  begin   -- consent records: what and how, never the evidence reference or the notes
    select coalesce(jsonb_agg(public._a10_pick(to_jsonb(c), array['id','purpose','method','created_at','recorded_at','revoked_at'])
             order by coalesce(to_jsonb(c) ->> 'created_at', to_jsonb(c) ->> 'recorded_at') desc nulls last), '[]'::jsonb)
      into v_cons from public.local_tasker_consents c where c.tasker_user_id = p_tasker;
  exception when others then v_failed := v_failed || 'consents'; v_cons := null;
  end;

  begin
    select coalesce(jsonb_agg(x order by x ->> 'created_at' desc nulls last), '[]'::jsonb) into v_book from (
      select jsonb_build_object('booking_id', s.booking_id, 'lt_status', s.lt_status, 'coordinator_id', s.coordinator_id,
                                'booking_status', b.status, 'created_at', to_jsonb(b) ->> 'created_at') as x
        from public.local_booking_state s left join public.bookings b on b.id = s.booking_id
       where s.tasker_user_id = p_tasker order by to_jsonb(b) ->> 'created_at' desc nulls last limit 25) q;
  exception when others then v_failed := v_failed || 'bookings'; v_book := null;
  end;

  begin   -- payout records: status and amount only. The payout table's link to the worker was not seen, so it is matched by key name.
    select coalesce(jsonb_agg(public._a10_pick(to_jsonb(lp), array['id','status','amount','amount_kobo','currency','created_at','paid_at','booking_id'])
             order by to_jsonb(lp) ->> 'created_at' desc nulls last), '[]'::jsonb)
      into v_pay from public.local_payouts lp where to_jsonb(lp) ->> 'tasker_user_id' = p_tasker::text;
    select coalesce(jsonb_agg(public._a10_pick(to_jsonb(la), array['bank_name','last4','account_last4','status'])), '[]'::jsonb)
      into v_acct from public.local_payout_accounts la where to_jsonb(la) ->> 'tasker_user_id' = p_tasker::text;
  exception when others then v_failed := v_failed || 'payouts'; v_pay := null; v_acct := null;
  end;

  return jsonb_build_object('ok', true, 'profile', v_profile, 'coordinator', v_cur, 'history', v_hist, 'identity', v_idv,
    'services', v_serv, 'photos', v_photos, 'consents', v_cons, 'bookings', v_book, 'payouts', v_pay, 'payout_accounts', v_acct,
    'sections_failed', to_jsonb(v_failed),
    'can_manage', public.admin_has('local_taskers.manage'), 'can_assign', public.admin_has('coordinators.assign'));
end $f$;

-- 3. Unpublish -------------------------------------------------------------------------------------------------------
create or replace function public.admin_local_tasker_unpublish(p_tasker uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_actor uuid := auth.uid(); v_reason text := btrim(coalesce(p_reason, '')); v_status text; v_coord uuid; v_name text;
begin
  if not public.admin_guard('local_taskers.manage', 'local_tasker.unpublish') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if p_tasker is null then return jsonb_build_object('ok', false, 'error', 'Choose a Local Tasker.'); end if;
  if char_length(v_reason) < 10 then return jsonb_build_object('ok', false, 'error', 'Write a reason of at least 10 characters.'); end if;
  if char_length(v_reason) > 300 then return jsonb_build_object('ok', false, 'error', 'The reason is too long (300 characters at most).'); end if;
  select a.coordinator_id into v_coord from public.coordinator_assignments a where a.tasker_user_id = p_tasker and a.ended_at is null;
  if p_tasker = v_actor or v_coord = v_actor then   -- Rule R-SELF
    perform public.admin_log('local_tasker.unpublish', 'local_tasker', p_tasker::text, null, null, v_reason, null, 'refused', jsonb_build_object('why', 'own_account'));
    return jsonb_build_object('ok', false, 'error', 'This Local Tasker is in the care of your own coordinator account. Another admin must do this.');
  end if;
  select p.status into v_status from public.local_tasker_profiles p where p.tasker_user_id = p_tasker for update;
  if v_status is null then return jsonb_build_object('ok', false, 'error', 'Local Tasker not found.'); end if;
  if v_status <> 'published' then return jsonb_build_object('ok', false, 'error', 'This Local Tasker is not published, so there is nothing to unpublish.'); end if;
  begin
    update public.local_tasker_profiles set status = 'ready' where tasker_user_id = p_tasker;
    update public.taskers set available = false where user_id = p_tasker::text;     -- the listing row customers search; publish set it true
  exception when others then
    perform public.admin_log('local_tasker.unpublish', 'local_tasker', p_tasker::text, null, null, v_reason, null, 'error', jsonb_build_object('sqlstate', sqlstate));
    return jsonb_build_object('ok', false, 'error', 'The database refused this change. Nothing was changed.', 'sqlstate', sqlstate);
  end;
  begin
    perform public.local_tasker_audit('local_tasker_unpublished_by_admin', 'local_tasker', p_tasker::text,
      jsonb_build_object('status', v_status), jsonb_build_object('status', 'ready', 'reason', v_reason), v_actor);
  exception when others then null;
  end;
  perform public.admin_log('local_tasker.unpublish', 'local_tasker', p_tasker::text, jsonb_build_object('status', v_status),
                           jsonb_build_object('status', 'ready'), v_reason, null, 'ok', null);
  if v_coord is not null then
    begin
      select coalesce(p.full_name, u.name) into v_name from public.local_tasker_profiles p left join public.users u on u.id = p.tasker_user_id where p.tasker_user_id = p_tasker;
      perform public._notify(v_coord, 'coordinator_assignment', 'A Local Tasker was unpublished',
        coalesce(v_name, 'A Local Tasker') || ' was hidden from customers by an administrator. Open their profile for details.',
        jsonb_build_object('url', '/coordinator-tasker.html?id=' || p_tasker::text));
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('ok', true, 'status', 'ready');
end $f$;

-- 4. Deactivate ------------------------------------------------------------------------------------------------------
create or replace function public.admin_local_tasker_deactivate(p_tasker uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_actor uuid := auth.uid(); v_reason text := btrim(coalesce(p_reason, '')); v_status text; v_coord uuid; v_open integer; v_name text;
begin
  if not public.admin_guard('local_taskers.manage', 'local_tasker.deactivate') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if p_tasker is null then return jsonb_build_object('ok', false, 'error', 'Choose a Local Tasker.'); end if;
  if char_length(v_reason) < 10 then return jsonb_build_object('ok', false, 'error', 'Write a reason of at least 10 characters.'); end if;
  if char_length(v_reason) > 300 then return jsonb_build_object('ok', false, 'error', 'The reason is too long (300 characters at most).'); end if;
  select a.coordinator_id into v_coord from public.coordinator_assignments a where a.tasker_user_id = p_tasker and a.ended_at is null;
  if p_tasker = v_actor or v_coord = v_actor then   -- Rule R-SELF
    perform public.admin_log('local_tasker.deactivate', 'local_tasker', p_tasker::text, null, null, v_reason, null, 'refused', jsonb_build_object('why', 'own_account'));
    return jsonb_build_object('ok', false, 'error', 'This Local Tasker is in the care of your own coordinator account. Another admin must do this.');
  end if;
  select p.status into v_status from public.local_tasker_profiles p where p.tasker_user_id = p_tasker for update;
  if v_status is null then return jsonb_build_object('ok', false, 'error', 'Local Tasker not found.'); end if;
  if v_status = 'inactive' then return jsonb_build_object('ok', false, 'error', 'This Local Tasker is already deactivated.'); end if;
  select count(*) into v_open from public.local_booking_state s join public.bookings b on b.id = s.booking_id
   where s.tasker_user_id = p_tasker and coalesce(b.status, '') not in ('completed', 'cancelled');
  if v_open > 0 then
    perform public.admin_log('local_tasker.deactivate', 'local_tasker', p_tasker::text, null, null, v_reason, null, 'refused', jsonb_build_object('open_bookings', v_open));
    return jsonb_build_object('ok', false, 'open_bookings', v_open,
      'error', 'This Local Tasker still has ' || v_open || ' open booking(s). Let them finish or be cancelled first. Nothing was changed.');
  end if;
  begin
    update public.local_tasker_profiles set status = 'inactive' where tasker_user_id = p_tasker;
    update public.taskers set available = false where user_id = p_tasker::text;
    if v_coord is not null then    -- frees the coordinator's place; the assignment row stays as history
      update public.coordinator_assignments set ended_at = now(), ended_by = v_actor, end_reason = 'Local Tasker deactivated by an administrator'
       where tasker_user_id = p_tasker and ended_at is null;
    end if;
  exception when others then
    perform public.admin_log('local_tasker.deactivate', 'local_tasker', p_tasker::text, null, null, v_reason, null, 'error', jsonb_build_object('sqlstate', sqlstate));
    return jsonb_build_object('ok', false, 'error', 'The database refused this change. Nothing was changed.', 'sqlstate', sqlstate);
  end;
  begin
    perform public.local_tasker_audit('local_tasker_deactivated_by_admin', 'local_tasker', p_tasker::text,
      jsonb_build_object('status', v_status, 'coordinator_id', v_coord), jsonb_build_object('status', 'inactive', 'reason', v_reason), v_actor);
  exception when others then null;
  end;
  perform public.admin_log('local_tasker.deactivate', 'local_tasker', p_tasker::text, jsonb_build_object('status', v_status, 'coordinator_id', v_coord),
                           jsonb_build_object('status', 'inactive'), v_reason, null, 'ok', null);
  if v_coord is not null then
    begin
      select coalesce(p.full_name, u.name) into v_name from public.local_tasker_profiles p left join public.users u on u.id = p.tasker_user_id where p.tasker_user_id = p_tasker;
      perform public._notify(v_coord, 'coordinator_assignment', 'A Local Tasker was deactivated',
        coalesce(v_name, 'A Local Tasker') || ' was deactivated by an administrator and is no longer in your care.',
        jsonb_build_object('url', '/coordinator-taskers.html'));
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('ok', true, 'status', 'inactive');
end $f$;

-- 5. Grants: the browser may call these four functions and nothing else; each checks the admin permission itself
do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'admin\_local\_tasker\_%' loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end
$g$;

-- Result line
select case
  when to_regprocedure('public.admin_local_tasker_list(text,text,uuid,integer)') is not null
   and to_regprocedure('public.admin_local_tasker_detail(uuid)') is not null
   and to_regprocedure('public.admin_local_tasker_unpublish(uuid,text)') is not null
   and to_regprocedure('public.admin_local_tasker_deactivate(uuid,text)') is not null
  then 'DONE: A10 installed. Admins with local_taskers.view can use /admin/local-taskers.html.'
  else 'NOT DONE: see the messages above.'
end as a10_result;

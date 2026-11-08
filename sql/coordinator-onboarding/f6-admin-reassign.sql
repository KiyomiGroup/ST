-- Stage F-6 SQL. Run ONCE in the Supabase SQL editor (safe to run twice). Creates the administrator tool that moves ONE Local Tasker
-- from their current coordinator (for example the center coordinator) to another ACTIVE coordinator.
--
-- Who may call it: an administrator (is_local_tasker_admin(), i.e. support) or the SQL editor / service role. Nobody else; a
-- coordinator can never move a Local Tasker, and the browser anon key is refused.
-- What it does, in one transaction (all or nothing):
--   1. ends the Local Tasker's current assignment (who ended it, why) and creates a new one for the target coordinator
--      (previous coordinator, who assigned, reason), using the existing assignment rules: the target must be an active coordinator
--      and have a free place on their plan (the plan check is the existing guard, so a full coordinator is refused with a clear message);
--   2. the existing trigger lt_assignments_follow_bookings then moves the Local Tasker's open bookings to the new coordinator by itself;
--   3. writes an audit row and sends a notification to the old and the new coordinator (a failed notification never undoes the move).
-- It does NOT touch the Local Tasker's identity check, published state, services, photos or payout account.
-- (The payout account was registered by the old coordinator with the Local Tasker's consent; the new coordinator can change it on the payout page.)

create or replace function public.admin_reassign_local_tasker(p_tasker uuid, p_to_coordinator uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_actor uuid := auth.uid();
  v_allowed boolean;
  v_cur public.coordinator_assignments;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_name text;
  v_moved integer;
begin
  v_allowed := coalesce(public.is_local_tasker_admin(), false) or coalesce(auth.role(), 'service_role') = 'service_role';
  if not v_allowed then
    raise exception 'Not allowed.' using errcode = 'P0001', hint = 'not_allowed';
  end if;
  if p_tasker is null or p_to_coordinator is null then
    raise exception 'Choose a Local Tasker and a coordinator.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if coalesce(char_length(v_reason), 0) > 300 then
    raise exception 'The reason is too long (300 characters at most).' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if not public.is_active_coordinator(p_to_coordinator) then
    raise exception 'The new coordinator is not an active coordinator.' using errcode = 'P0001', hint = 'not_active_coordinator';
  end if;

  select * into v_cur from public.coordinator_assignments
   where tasker_user_id = p_tasker and ended_at is null for update;
  if not found then
    raise exception 'This Local Tasker has no active coordinator.' using errcode = 'P0001', hint = 'not_assigned';
  end if;
  if v_cur.coordinator_id = p_to_coordinator then
    raise exception 'This Local Tasker already belongs to that coordinator.' using errcode = 'P0001', hint = 'same_coordinator';
  end if;

  update public.coordinator_assignments
     set ended_at = now(), ended_by = v_actor, end_reason = coalesce(v_reason, 'Moved to another coordinator by an administrator')
   where id = v_cur.id;

  insert into public.coordinator_assignments (tasker_user_id, coordinator_id, previous_coordinator_id, assigned_by, assign_reason)
  values (p_tasker, p_to_coordinator, v_cur.coordinator_id, v_actor, coalesce(v_reason, 'Moved by an administrator'));
  -- if the new coordinator has no free place the guard raises 'coordinator_cap' here and the whole move is rolled back

  select count(*) into v_moved from public.local_booking_state s where s.tasker_user_id = p_tasker and s.coordinator_id = p_to_coordinator;

  begin
    perform public.local_tasker_audit('local_tasker_reassigned', 'local_tasker', p_tasker::text,
      jsonb_build_object('coordinator_id', v_cur.coordinator_id),
      jsonb_build_object('coordinator_id', p_to_coordinator, 'reason', v_reason, 'bookings_now_with_new', v_moved), v_actor);
  exception when others then null;
  end;

  begin
    select u.name into v_name from public.users u where u.id = p_tasker;      -- the PUBLIC name only (notifications are also emailed)
    perform public._notify(v_cur.coordinator_id, 'coordinator_assignment', 'A Local Tasker was moved to another coordinator',
      coalesce(v_name, 'A Local Tasker') || ' is no longer in your care. An administrator moved them to another coordinator.',
      jsonb_build_object('url', '/coordinator-taskers.html'));
    perform public._notify(p_to_coordinator, 'coordinator_assignment', 'A Local Tasker was assigned to you',
      coalesce(v_name, 'A Local Tasker') || ' is now in your care. Open their profile to see their services and bookings.',
      jsonb_build_object('url', '/coordinator-tasker.html?id=' || p_tasker::text));
  exception when others then null;
  end;

  return jsonb_build_object('tasker_user_id', p_tasker, 'from_coordinator', v_cur.coordinator_id, 'to_coordinator', p_to_coordinator,
                            'bookings_with_new_coordinator', v_moved);
end $function$;

revoke all on function public.admin_reassign_local_tasker(uuid, uuid, text) from public, anon;
grant execute on function public.admin_reassign_local_tasker(uuid, uuid, text) to authenticated;   -- the function itself refuses everyone who is not an administrator

-- ------------------------------------------------------------------------------------------------------------------
-- HOW TO USE (run these yourself in the SQL editor when you want to move someone; nothing below runs automatically)
-- 1. Who can receive Local Taskers, and how full they are:
--      select c.user_id, c.display_name, u.email, c.status, coalesce(s.tier, 1) as tier,
--             (select count(*) from public.coordinator_assignments a where a.coordinator_id = c.user_id and a.ended_at is null) as active_taskers,
--             public.coordinator_capacity(c.user_id) as capacity
--        from public.coordinators c join auth.users u on u.id = c.user_id
--        left join public.coordinator_tiers_state s on s.coordinator_id = c.user_id order by c.created_at;
-- 2. Move one Local Tasker (example: Samsole, id 1df93e25-5f7b-4e79-b4ec-ecad65cd03fd) to the coordinator whose user_id you pick:
--      select public.admin_reassign_local_tasker('1df93e25-5f7b-4e79-b4ec-ecad65cd03fd', '<new coordinator user_id>', 'Moved to a local coordinator');
-- 3. Check: select tasker_user_id, coordinator_id, assigned_at, ended_at from public.coordinator_assignments where tasker_user_id = '1df93e25-5f7b-4e79-b4ec-ecad65cd03fd' order by assigned_at;
-- ------------------------------------------------------------------------------------------------------------------

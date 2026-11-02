-- ============================================================================
-- StreetTasker Local Tasker: STAGE 7C-1c (read side of the coordinator code-entry card). RE-RUNNABLE. Rollback: stage-7c1c-rollback.sql.
-- Needs stage-7c1b-core.sql (and so 7C-1, 7E, 5D-3b). Run in the Supabase SQL editor (select ALL, Run), then stage-7c1c-tests.sql.
--
-- ONE new READ-ONLY function. It writes nothing and never returns the release code, an amount, or any money object.
--   local_booking_code_state(p_booking)  coordinator only (the booking's current coordinator). Returns
--       { state, remaining }   state is exactly one of:
--         ready            paid, held, not frozen, not locked: the card may show the code field
--         not_paid         no payment on record yet (also 'pending' and 'refunded': deliberately STRICTER than 7C-1b, see note)
--         frozen           a problem report is open (or the booking is disputed)
--         locked           3 wrong attempts used; an administrator must unlock
--         released         payment already released (the payout is queued or sent; this card cannot tell more)
--         closed           cancelled, rejected, declined, or completed without a release on this record
--         consent_revoked  the Local Tasker withdrew every 'profile' consent
--       remaining = attempts left (3 minus wrong attempts, never below 0). Shown only so the coordinator knows how careful to be.
-- The order of the checks copies local_booking_submit_code (7C-1b) so the card and the real call agree:
--   consent -> not paid -> released -> completed -> frozen -> locked -> ready.
-- NOTE (flagged, not fixed here): 7C-1b lets payment_status 'pending' or 'refunded' reach _release_escrow. This read function says not_paid for both, so the
--   card never offers the field there. The database side is unchanged; if you want 7C-1b tightened the same way, say so (needs your decision).
-- ============================================================================
do $$
begin
  if to_regprocedure('public.local_booking_submit_code(uuid,text)') is null then
    raise exception 'Stage 7C-1b is not applied (local_booking_submit_code is missing). Run stage-7c1b-core.sql first. Nothing was changed.';
  end if;
  if to_regprocedure('public.is_active_coordinator(uuid)') is null or to_regprocedure('public.job_booking_frozen(uuid)') is null
     or to_regclass('public.local_booking_state') is null or to_regclass('public.local_tasker_consents') is null then
    raise exception 'A required function or table is missing. Nothing was changed.';
  end if;
end $$;

create or replace function public.local_booking_code_state(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; v_att int; v_state text;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;

  v_att := greatest(0, 3 - coalesce(b.code_attempts, 0));

  if exists (select 1 from public.local_tasker_consents c where c.tasker_user_id = s.tasker_user_id and c.purpose = 'profile' and c.revoked_at is not null)
     and not exists (select 1 from public.local_tasker_consents c where c.tasker_user_id = s.tasker_user_id and c.purpose = 'profile' and c.revoked_at is null) then
    v_state := 'consent_revoked';
  elsif b.payment_status = 'released' then v_state := 'released';
  elsif b.status = 'completed' then v_state := case when b.payment_status = 'paid' then 'closed' else 'released' end;
  elsif b.status in ('cancelled', 'rejected', 'declined') then v_state := 'closed';
  elsif b.payment_status is distinct from 'paid' then v_state := 'not_paid';
  elsif b.status = 'disputed' or public.job_booking_frozen(p_booking) then v_state := 'frozen';
  elsif coalesce(b.code_attempts, 0) >= 3 then v_state := 'locked';
  else v_state := 'ready';
  end if;

  return jsonb_build_object('state', v_state, 'remaining', v_att);   -- never the code, never an amount
end $$;
revoke all on function public.local_booking_code_state(uuid) from public, anon;
grant execute on function public.local_booking_code_state(uuid) to authenticated, service_role;

-- Stage B4: Local Tasker payout waits 24 hours after the release code; the coordinator sees the countdown and is told when the payout is paid.
-- One transaction. Undo: b4-rollback.sql. Built from the owner's b4-introspect results (exact text of _release_escrow and local_payout_claim).
-- NOT RUN yet when this file was written. local_payouts had 0 rows when the introspect ran, so nothing existing is delayed retroactively.
begin;

-- 1. When the payout may be sent (null = no wait)
alter table public.local_payouts add column if not exists release_after timestamptz;

-- 2. Every new "final" payout row waits 24 hours from the moment it is queued (queued by _release_escrow in the same call as the release code).
create or replace function public._lp_set_release_after()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $f$
begin
  if NEW.release_after is null and NEW.release_key = 'final' then
    NEW.release_after := now() + interval '24 hours';
  end if;
  return NEW;
end $f$;

drop trigger if exists lp_set_release_after on public.local_payouts;
create trigger lp_set_release_after before insert on public.local_payouts
  for each row execute function public._lp_set_release_after();

-- 3. The sender claims only payouts whose wait is over. The rest of this function is the pasted text.
create or replace function public.local_payout_claim(p_limit integer default 10, p_only uuid default null::uuid)
 returns table(out_id uuid, out_reference text, out_amount numeric, out_recipient text, out_booking uuid, out_attempts integer)
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare r public.local_payouts; a public.local_payout_accounts; v_ref text;
begin
  for r in
    select * from public.local_payouts p
     where p.status = 'queued' and (p_only is null or p.id = p_only)
       and (p.release_after is null or p.release_after <= now())          -- B4: the 24 hour wait
     order by p.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked
  loop
    if r.attempts >= 5 then
      update public.local_payouts set status = 'failed', status_reason = 'max_attempts', updated_at = now() where id = r.id;
      continue;
    end if;
    select * into a from public.local_payout_accounts x where x.tasker_user_id = r.tasker_user_id and x.status = 'active';
    if not found then
      update public.local_payouts set status = 'review', status_reason = 'no_verified_account', updated_at = now() where id = r.id;
      continue;
    end if;
    -- Paystack wants a lowercase reference of 16 to 50 characters: 'st-lp-' + the payout id without dashes = 38. Built once per generation, never changed in between.
    v_ref := 'st-lp-' || replace(r.id::text, '-', '') || case when r.ref_gen > 0 then '-r' || r.ref_gen else '' end;   -- 38 chars, or 40-42 after a retry
    update public.local_payouts
       set status = 'processing', attempts = attempts + 1, payout_account_id = a.id,
           transfer_reference = coalesce(transfer_reference, v_ref), claimed_at = now(), updated_at = now()
     where id = r.id
     returning * into r;
    out_id := r.id; out_reference := r.transfer_reference; out_amount := r.amount; out_recipient := a.recipient_code;
    out_booking := r.booking_id; out_attempts := r.attempts;
    return next;
  end loop;
  return;
end $function$;

-- 4. The coordinator is told once when the payout is paid (Paystack confirmed). Uses the existing _co_notify. An error here never blocks the payout.
create or replace function public._lp_notify_coordinator()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare v_coord uuid;
begin
  begin
    if NEW.status = 'paid' and OLD.status is distinct from 'paid' then
      select s.coordinator_id into v_coord from public.local_booking_state s where s.booking_id = NEW.booking_id;
      if v_coord is null then return null; end if;
      if exists (select 1 from public.notifications n where n.user_id = v_coord and n.type = 'coordinator_payout_sent'
                  and n.data ->> 'payout_id' = NEW.id::text) then
        return null;
      end if;
      perform public._co_notify(
        v_coord, 'coordinator_payout_sent', 'Payout sent to the Local Tasker',
        'The payout of ' || chr(8358) || to_char(NEW.amount, 'FM999,999,999') || ' has been paid to the Local Tasker''s bank account. You do not need to do anything. Tell the Local Tasker it is on its way.',
        jsonb_build_object('booking_id', NEW.booking_id, 'payout_id', NEW.id, 'url', '/coordinator-booking.html?id=' || NEW.booking_id::text));
    end if;
  exception when others then
    raise warning '_lp_notify_coordinator failed: %', sqlerrm;
  end;
  return null;
end $f$;

drop trigger if exists lp_notify_coordinator on public.local_payouts;
create trigger lp_notify_coordinator after update of status on public.local_payouts
  for each row execute function public._lp_notify_coordinator();

-- 5. What the booking page shows (coordinator of this booking only; same guard as local_booking_code_state)
create or replace function public.local_booking_payout_state(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
declare v_me uuid := auth.uid(); s public.local_booking_state; r public.local_payouts; v_phase text;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into r from public.local_payouts where booking_id = p_booking and release_key = 'final';
  if not found then return jsonb_build_object('has_payout', false); end if;
  v_phase := case
    when r.status = 'queued' and r.release_after is not null and r.release_after > now() then 'waiting'
    when r.status = 'queued' then 'due'
    else r.status end;
  return jsonb_build_object('has_payout', true, 'phase', v_phase, 'amount', r.amount,
    'release_after', r.release_after, 'seconds_left', case when v_phase = 'waiting' then greatest(0, ceil(extract(epoch from (r.release_after - now()))))::bigint end,
    'paid_at', r.paid_at, 'reason', r.status_reason);
end $f$;

revoke all on function public.local_booking_payout_state(uuid) from public, anon;
grant execute on function public.local_booking_payout_state(uuid) to authenticated;
revoke all on function public._lp_set_release_after() from public, anon, authenticated;
revoke all on function public._lp_notify_coordinator() from public, anon, authenticated;

commit;

-- CHECK (run after the commit): one row, four true
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'local_payouts' and column_name = 'release_after') as column_ok,
  (select count(*) = 2 from pg_trigger t where t.tgrelid = 'public.local_payouts'::regclass and t.tgname in ('lp_set_release_after', 'lp_notify_coordinator')) as triggers_ok,
  (select pg_get_functiondef(p.oid) ilike '%release_after%' from pg_proc p where p.proname = 'local_payout_claim' and p.pronamespace = 'public'::regnamespace) as claim_ok,
  exists (select 1 from pg_proc p where p.proname = 'local_booking_payout_state' and p.pronamespace = 'public'::regnamespace) as state_fn_ok;

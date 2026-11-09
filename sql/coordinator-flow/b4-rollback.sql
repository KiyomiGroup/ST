-- Undo of Stage B4. Restores local_payout_claim to the exact text the owner pasted. Payout rows are not touched (the release_after column is dropped).
begin;
drop trigger if exists lp_set_release_after on public.local_payouts;
drop trigger if exists lp_notify_coordinator on public.local_payouts;
drop function if exists public._lp_set_release_after();
drop function if exists public._lp_notify_coordinator();
drop function if exists public.local_booking_payout_state(uuid);

create or replace function public.local_payout_claim(p_limit integer default 10, p_only uuid default null::uuid)
 returns table(out_id uuid, out_reference text, out_amount numeric, out_recipient text, out_booking uuid, out_attempts integer)
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare r public.local_payouts; a public.local_payout_accounts; v_ref text;
begin
  for r in
    select * from public.local_payouts p
     where p.status = 'queued' and (p_only is null or p.id = p_only)
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

alter table public.local_payouts drop column if exists release_after;
commit;

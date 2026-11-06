-- StreetTasker M19 urgent fix. Run the WHOLE file once.
-- Before: a task was marked "urgent paid" if the browser said so and gave any unused reference text. Nothing checked Paystack.
-- Now: the new edge function urgent-verify asks Paystack and writes a row in urgent_payments. A task is urgent ONLY if its reference is a
-- verified payment of the SAME person that no other task has used. Otherwise the task is posted as normal (not urgent, fee 0). The fee saved
-- on the task is the amount Paystack really took. A browser can no longer change the plain "urgent" flag on its own.
create table if not exists public.urgent_payments (
  reference   text primary key,
  user_id     uuid not null,
  amount_kobo bigint not null check (amount_kobo > 0),
  verified_at timestamptz not null default now(),
  task_id     text,
  claimed_at  timestamptz
);
alter table public.urgent_payments enable row level security;
revoke all on public.urgent_payments from public, anon, authenticated;

create or replace function public._m19_urgent_claim(p_ref text, p_task text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $m19$
declare v bigint;
begin
  if auth.uid() is null or p_ref is null or p_task is null then return null; end if;
  update public.urgent_payments set task_id = p_task, claimed_at = now()
   where reference = p_ref and user_id = auth.uid() and task_id is null
   returning amount_kobo into v;
  return v;
end $m19$;
revoke all on function public._m19_urgent_claim(text, text) from public, anon;
grant execute on function public._m19_urgent_claim(text, text) to authenticated;

create or replace function public._m19_urgent_guard() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $m19$
declare v bigint;
begin
  if current_user in ('authenticated', 'anon') then
    if TG_OP = 'INSERT' then
      if coalesce(NEW.urgent_paid, false) then
        v := public._m19_urgent_claim(NEW.urgent_payment_ref, NEW.id::text);
        if v is null then
          NEW.urgent_paid := false; NEW.urgent_fee := 0; NEW.urgent_payment_ref := null;
        else
          NEW.urgent_fee := v / 100.0;
        end if;
      end if;
      NEW.urgent := coalesce(NEW.urgent_paid, false);
    elsif TG_OP = 'UPDATE' then
      NEW.urgent := OLD.urgent;
    end if;
  end if;
  return NEW;
end $m19$;
drop trigger if exists zz_m19_urgent_guard on public.tasks;
create trigger zz_m19_urgent_guard before insert or update on public.tasks for each row execute function public._m19_urgent_guard();

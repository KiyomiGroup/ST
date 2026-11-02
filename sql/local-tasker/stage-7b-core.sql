-- Stage 7B: verified payout destination (bank account) for a Local Tasker.
-- Additive and re-runnable. Rollback: stage-7b-rollback.sql. Run in the Supabase SQL editor (select all, Run). Run twice.
--
-- What this creates (nothing existing is altered):
--   TABLE local_payout_accounts   the payout destination. RLS on, NO policies, NO grant to anon or authenticated:
--                                 nobody reads it from the browser. Holds the Paystack recipient code, the bank,
--                                 the LAST FOUR digits and the bank's resolved account name. The full account number is
--                                 never stored here, in the audit log, or anywhere else. Rows are history: a change
--                                 supersedes the old row, nothing is edited or deleted (trigger).
--   TABLE local_payout_attempts   throttle ledger (who asked Paystack to look up an account, when). No account data.
--   local_payout_names_match(registered, resolved)  the ONE name rule (immutable, callable by the Edge Function only).
--   local_payout_begin(coordinator, tasker, kind)   server only: authority check + throttle + attempt row.
--   local_payout_check_name(tasker, resolved)       server only: does the bank's name match the registered full name.
--   local_payout_save(...)                           server only: the ONLY way a destination is created or changed.
--                                 Writes a FRESH 'payout' consent row, supersedes the old destination, writes audit rows.
--   local_payout_account(tasker)                     coordinator/admin read: MASKED details only.
-- Depends on: local_tasker_profiles, local_tasker_consents, local_tasker_audit(), is_active_coordinator(uuid),
--             coordinator_manages_tasker(uuid, uuid), is_local_tasker_admin() (Stages 2A, 2B).

create table if not exists public.local_payout_accounts (
  id                    uuid primary key default gen_random_uuid(),
  tasker_user_id        uuid not null references public.local_tasker_profiles(tasker_user_id) on delete restrict,
  status                text not null default 'active' check (status in ('active', 'superseded')),
  bank_code             text not null check (bank_code ~ '^[0-9]{3,6}$'),
  bank_name             text not null check (char_length(bank_name) between 2 and 100),
  account_last4         text not null check (account_last4 ~ '^[0-9]{4}$'),
  account_name_resolved text not null check (char_length(account_name_resolved) between 2 and 200),
  recipient_code        text not null check (recipient_code ~ '^RCP_[A-Za-z0-9]{6,40}$'),
  consent_id            uuid not null references public.local_tasker_consents(id) on delete restrict,
  verified_by           uuid not null,
  verified_at           timestamptz not null default now(),
  superseded_at         timestamptz,
  superseded_by         uuid,
  created_at            timestamptz not null default now()
);
create unique index if not exists local_payout_one_active_idx
  on public.local_payout_accounts (tasker_user_id) where status = 'active';
create index if not exists local_payout_tasker_idx on public.local_payout_accounts (tasker_user_id, created_at desc);

create table if not exists public.local_payout_attempts (
  id             uuid primary key default gen_random_uuid(),
  coordinator_id uuid not null,
  tasker_user_id uuid not null,
  kind           text not null check (kind in ('resolve', 'save')),
  created_at     timestamptz not null default now()
);
create index if not exists local_payout_attempts_idx on public.local_payout_attempts (coordinator_id, created_at desc);

alter table public.local_payout_accounts enable row level security;
alter table public.local_payout_attempts enable row level security;
revoke all on public.local_payout_accounts from public, anon, authenticated;
revoke all on public.local_payout_attempts from public, anon, authenticated;
grant select on public.local_payout_accounts to service_role;   -- 7C reads the recipient code with the service role

-- History guard: no delete or truncate for anyone; an update may only turn an ACTIVE row into SUPERSEDED.
create or replace function public._local_payout_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'active' and new.status = 'superseded'
       and (to_jsonb(new) - 'status' - 'superseded_at' - 'superseded_by')
         = (to_jsonb(old) - 'status' - 'superseded_at' - 'superseded_by') then
      return new;
    end if;
    raise exception 'Payout account history cannot be edited.' using errcode = 'P0001', hint = 'immutable';
  end if;
  raise exception 'Payout account history cannot be deleted.' using errcode = 'P0001', hint = 'immutable';
end $$;
drop trigger if exists local_payout_guard_row on public.local_payout_accounts;
create trigger local_payout_guard_row before update or delete on public.local_payout_accounts
  for each row execute function public._local_payout_guard();
drop trigger if exists local_payout_guard_trunc on public.local_payout_accounts;
create trigger local_payout_guard_trunc before truncate on public.local_payout_accounts
  for each statement execute function public._local_payout_guard();

-- THE NAME RULE (one place). Case, spacing, punctuation and word order are ignored. Every word of the registered
-- full name must be a word of the bank's name, and the bank's name may carry at most ONE extra word (a middle name).
-- A registered name of fewer than two words never matches (record the full legal name first). Letters a-z only:
-- a name with accents is split at the accent and will FAIL (safe direction); the coordinator is told to fix it.
create or replace function public.local_payout_names_match(p_registered text, p_resolved text)
returns boolean language plpgsql immutable as $$
declare r text[]; b text[];
begin
  select coalesce(array_agg(distinct w), '{}') into r
    from unnest(regexp_split_to_array(regexp_replace(lower(coalesce(p_registered, '')), '[^a-z]+', ' ', 'g'), ' ')) w where w <> '';
  select coalesce(array_agg(distinct w), '{}') into b
    from unnest(regexp_split_to_array(regexp_replace(lower(coalesce(p_resolved, '')), '[^a-z]+', ' ', 'g'), ' ')) w where w <> '';
  if cardinality(r) < 2 then return false; end if;
  return r <@ b and cardinality(b) - cardinality(r) <= 1;
end $$;

-- Authority + throttle. Same "not found" answer for every kind of outsider (no probing). Max 20 lookups per coordinator per hour.
create or replace function public.local_payout_begin(p_coordinator uuid, p_tasker uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.local_tasker_profiles;
begin
  if p_coordinator is null or p_tasker is null or p_kind not in ('resolve', 'save')
     or not public.is_active_coordinator(p_coordinator)
     or not public.coordinator_manages_tasker(p_coordinator, p_tasker) then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into p from public.local_tasker_profiles where tasker_user_id = p_tasker;
  if not found or p.status not in ('draft', 'ready', 'published') then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if (select count(*) from public.local_payout_attempts
       where coordinator_id = p_coordinator and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many account checks. Try again in an hour.' using errcode = 'P0001', hint = 'rate_limited';
  end if;
  insert into public.local_payout_attempts (coordinator_id, tasker_user_id, kind) values (p_coordinator, p_tasker, p_kind);
  return jsonb_build_object('ok', true, 'registered_name_ok', cardinality(regexp_split_to_array(btrim(coalesce(p.full_name, '')), '\s+')) >= 2);
end $$;

create or replace function public.local_payout_check_name(p_tasker uuid, p_resolved text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.local_payout_names_match(p.full_name, p_resolved)
    from public.local_tasker_profiles p where p.tasker_user_id = p_tasker $$;

create or replace function public.local_payout_save(
  p_coordinator uuid, p_tasker uuid, p_bank_code text, p_bank_name text, p_last4 text,
  p_resolved_name text, p_recipient_code text,
  p_consent_method text, p_consent_evidence text, p_consent_details text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.local_tasker_profiles;
  v_old public.local_payout_accounts;
  v_consent uuid; v_new uuid;
  v_ev text := nullif(btrim(coalesce(p_consent_evidence, '')), '');
  v_dt text := nullif(btrim(coalesce(p_consent_details, '')), '');
begin
  if p_coordinator is null or p_tasker is null
     or not public.is_active_coordinator(p_coordinator)
     or not public.coordinator_manages_tasker(p_coordinator, p_tasker) then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into p from public.local_tasker_profiles where tasker_user_id = p_tasker for update;
  if not found or p.status not in ('draft', 'ready', 'published') then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if p_consent_method is null or p_consent_method not in ('in_person', 'phone', 'written') then
    raise exception 'Record how the Local Tasker agreed to this bank account.' using errcode = 'P0001', hint = 'consent_required';
  end if;
  if coalesce(p_bank_code, '') !~ '^[0-9]{3,6}$' or coalesce(p_last4, '') !~ '^[0-9]{4}$'
     or coalesce(p_recipient_code, '') !~ '^RCP_[A-Za-z0-9]{6,40}$'
     or char_length(btrim(coalesce(p_bank_name, ''))) not between 2 and 100
     or char_length(btrim(coalesce(p_resolved_name, ''))) not between 2 and 200
     or char_length(coalesce(v_ev, '')) > 500 or char_length(coalesce(v_dt, '')) > 1000 then
    raise exception 'Invalid payout details.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  -- the free-text boxes must never be used to carry an account number into the permanent consent record
  if coalesce(v_ev, '') ~ '[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9]'
     or coalesce(v_dt, '') ~ '[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9]' then
    raise exception 'Do not type an account number in the reference or notes.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if not public.local_payout_names_match(p.full_name, p_resolved_name) then
    raise exception 'The bank''s account name does not match the registered name.' using errcode = 'P0001', hint = 'name_mismatch';
  end if;

  select * into v_old from public.local_payout_accounts where tasker_user_id = p_tasker and status = 'active' for update;
  if v_old.id is not null and v_old.recipient_code = p_recipient_code then
    return jsonb_build_object('changed', false, 'account_id', v_old.id);    -- retry of the same save: nothing new
  end if;

  insert into public.local_tasker_consents (tasker_user_id, purpose, method, recorded_by, evidence_ref, details)
  values (p_tasker, 'payout', p_consent_method, p_coordinator, v_ev, v_dt) returning id into v_consent;
  perform public.local_tasker_audit('consent_recorded', 'local_tasker_consent', v_consent::text, null,
    jsonb_build_object('tasker_user_id', p_tasker, 'purpose', 'payout', 'method', p_consent_method), p_coordinator);

  if v_old.id is not null then
    update public.local_payout_accounts set status = 'superseded', superseded_at = now(), superseded_by = p_coordinator where id = v_old.id;
  end if;
  insert into public.local_payout_accounts (tasker_user_id, bank_code, bank_name, account_last4, account_name_resolved,
                                            recipient_code, consent_id, verified_by)
  values (p_tasker, p_bank_code, btrim(p_bank_name), p_last4, btrim(p_resolved_name), p_recipient_code, v_consent, p_coordinator)
  returning id into v_new;

  perform public.local_tasker_audit(
    case when v_old.id is null then 'payout_account_registered' else 'payout_account_changed' end,
    'local_payout_account', v_new::text,
    case when v_old.id is null then null else jsonb_build_object('bank_code', v_old.bank_code, 'last4', v_old.account_last4) end,
    jsonb_build_object('tasker_user_id', p_tasker, 'bank_code', p_bank_code, 'last4', p_last4, 'consent_id', v_consent,
                       'replaced_account_id', v_old.id), p_coordinator);
  return jsonb_build_object('changed', true, 'account_id', v_new, 'replaced', v_old.id is not null);
end $$;

-- Coordinator (current manager) or admin: masked details only. Never the number, never the recipient code.
create or replace function public.local_payout_account(p_tasker uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); a public.local_payout_accounts; c public.local_tasker_consents;
begin
  if v_me is null or p_tasker is null or not (
       (public.is_active_coordinator(v_me) and public.coordinator_manages_tasker(v_me, p_tasker))
       or public.is_local_tasker_admin()) then
    raise exception 'Local Tasker not found, or not assigned to you.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into a from public.local_payout_accounts where tasker_user_id = p_tasker and status = 'active';
  if not found then return jsonb_build_object('has_account', false); end if;
  select * into c from public.local_tasker_consents where id = a.consent_id;
  return jsonb_build_object('has_account', true, 'bank_name', a.bank_name,
    'account_mask', '******' || a.account_last4, 'account_name', a.account_name_resolved,
    'verified_at', a.verified_at, 'consent_method', c.method, 'consent_recorded_at', c.recorded_at);
end $$;

revoke all on function public.local_payout_names_match(text, text) from public, anon, authenticated;
revoke all on function public.local_payout_begin(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.local_payout_check_name(uuid, text) from public, anon, authenticated;
revoke all on function public.local_payout_save(uuid, uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.local_payout_account(uuid) from public, anon;
revoke all on function public._local_payout_guard() from public, anon, authenticated;
grant execute on function public.local_payout_names_match(text, text) to service_role;
grant execute on function public.local_payout_begin(uuid, uuid, text) to service_role;
grant execute on function public.local_payout_check_name(uuid, text) to service_role;
grant execute on function public.local_payout_save(uuid, uuid, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.local_payout_account(uuid) to authenticated, service_role;

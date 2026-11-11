-- StreetTasker verification rework, stage VR1: the verified legal name, and the name-match rule.
-- Run once, whole file, in the Supabase SQL editor (live project). Safe to run again. Undo with vr1-rollback.sql.
-- Written against your VR0 results of 2026-11-11 (idv_apply_event, idv_gate_config, identity_verifications columns).
-- It does NOT change idv_apply_event, idv_can_publish, any gate, any guard or any existing table.
-- What it adds:
--   table idv_verified_names        normalised word tokens of the verified name only (no raw name, no date of birth, no ID number)
--   idv_normalize_name(text)        lower case, accents removed, titles removed, words of 2+ letters, sorted, unique
--   idv_names_match(text[],text[])  the match rule (decision D4)
--   idv_store_name(session, name)   called ONLY by the didit-webhook / didit-sync Edge Functions (service key)
--   idv_name_check(user, bank name) used later by the withdrawal gate (VR2); service key / other server functions only
--   idv_set_name_manual(user, name) SQL editor only: for your test accounts and for a person Didit could not read a name for
--   trigger: when a person withdraws ALL identity consents, their stored name is deleted

do $$ begin
  if to_regclass('public.identity_verifications') is null or to_regclass('public.identity_verification_consents') is null then
    raise exception 'NOT DONE: the identity tables do not exist. Nothing was changed.';
  end if;
end $$;

-- 1. Table (server only: row-level security on, no policy, no browser grant)
create table if not exists public.idv_verified_names (
  user_id         uuid primary key,
  name_tokens     text[] not null,
  verification_id uuid,
  source          text not null default 'didit',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint idv_verified_names_tokens_ok check (cardinality(name_tokens) between 2 and 12)
);
alter table public.idv_verified_names enable row level security;
revoke all on public.idv_verified_names from public, anon, authenticated;

-- 2. Normalise a name into word tokens
create or replace function public.idv_normalize_name(p text)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(array(
    select w from (
      select distinct w
        from regexp_split_to_table(
               regexp_replace(
                 regexp_replace(
                   translate(lower(normalize(coalesce(p, ''), NFD)), 'øßđł', 'osdl'),
                   '[\u0300-\u036f]', '', 'g'),                      -- strips accents and dots under letters (e.g. ọ, ṣ, é)
                 '[^a-z]+', ' ', 'g'),
               '\s+') as w
       where length(w) >= 2
         and w <> all (array['mr','mrs','miss','ms','dr','prof','chief','alhaji','alhaja','engr','pastor',
                             'mallam','sir','madam','hrh','mister','rev','barr','hon','ofr','mni','esq'])
    ) d order by w), '{}'::text[])
$$;

-- 3. The match rule (D4): both names need at least 2 words; every word of the shorter name is in the longer one;
--    at least 2 words in common. A missing middle name passes. Initials, one-word names and a shared surname alone do not.
create or replace function public.idv_names_match(p_verified text[], p_bank text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(cardinality(p_verified), 0) >= 2
     and coalesce(cardinality(p_bank), 0) >= 2
     and (select count(*) from (select unnest(p_verified) intersect select unnest(p_bank)) c)
         = least(cardinality(p_verified), cardinality(p_bank))
$$;

-- 4. Store the name after a VERIFIED result (Edge Functions only)
create or replace function public.idv_store_name(p_session_id text, p_full_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.identity_verifications;
  v_tokens text[];
begin
  if auth.uid() is not null then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_session_id is null or btrim(p_session_id) = '' or p_full_name is null or char_length(p_full_name) > 200 then
    return jsonb_build_object('stored', false, 'reason', 'bad_input');
  end if;
  select * into v_row from public.identity_verifications where provider_session_id = p_session_id;
  if not found then return jsonb_build_object('stored', false, 'reason', 'unknown_session'); end if;
  if v_row.status <> 'VERIFIED' then return jsonb_build_object('stored', false, 'reason', 'not_verified'); end if;
  if v_row.subject_kind = 'tasker_local' then return jsonb_build_object('stored', false, 'reason', 'not_for_local_tasker'); end if;
  v_tokens := public.idv_normalize_name(p_full_name);
  if cardinality(v_tokens) < 2 then return jsonb_build_object('stored', false, 'reason', 'name_too_short'); end if;
  if cardinality(v_tokens) > 12 then v_tokens := v_tokens[1:12]; end if;
  insert into public.idv_verified_names (user_id, name_tokens, verification_id, source)
  values (v_row.user_id, v_tokens, v_row.id, 'didit')
  on conflict (user_id) do update
    set name_tokens = excluded.name_tokens, verification_id = excluded.verification_id,
        source = excluded.source, updated_at = now();
  return jsonb_build_object('stored', true, 'words', cardinality(v_tokens));
end $$;

-- 5. Does a bank account name match the person's verified name?
create or replace function public.idv_name_check(p_user uuid, p_bank_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_tokens text[]; v_bank text[];
begin
  select name_tokens into v_tokens from public.idv_verified_names where user_id = p_user;
  if v_tokens is null then
    return jsonb_build_object('has_name', false, 'matches', false, 'reason', 'no_verified_name');
  end if;
  v_bank := public.idv_normalize_name(p_bank_name);
  if cardinality(v_bank) < 2 then
    return jsonb_build_object('has_name', true, 'matches', false, 'reason', 'bank_name_too_short');
  end if;
  if public.idv_names_match(v_tokens, v_bank) then
    return jsonb_build_object('has_name', true, 'matches', true, 'reason', 'match');
  end if;
  return jsonb_build_object('has_name', true, 'matches', false, 'reason', 'mismatch');
end $$;

create or replace function public.idv_name_matches(p_user uuid, p_bank_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select coalesce((public.idv_name_check(p_user, p_bank_name) ->> 'matches') = 'true', false) $$;

-- 6. Manual name (SQL editor / service key only). For a test account that was verified before names were kept,
--    or a person whose ID Didit could not read a name from. Writes an audit line with the word count, never the name.
create or replace function public.idv_set_name_manual(p_user uuid, p_full_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_tokens text[];
begin
  if auth.uid() is not null then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.identity_verifications where user_id = p_user and status = 'VERIFIED') then
    raise exception 'This person is not verified.' using errcode = 'P0001';
  end if;
  v_tokens := public.idv_normalize_name(p_full_name);
  if cardinality(v_tokens) < 2 or cardinality(v_tokens) > 12 then
    raise exception 'The name needs 2 to 12 words.' using errcode = 'P0001';
  end if;
  insert into public.idv_verified_names (user_id, name_tokens, source)
  values (p_user, v_tokens, 'manual')
  on conflict (user_id) do update set name_tokens = excluded.name_tokens, source = 'manual', updated_at = now();
  perform public.local_tasker_audit('idv.name_set_manual', 'user', p_user::text, null,
                                    jsonb_build_object('words', cardinality(v_tokens)), null);
  return jsonb_build_object('stored', true, 'words', cardinality(v_tokens));
end $$;

-- 7. Withdrawing consent deletes the stored name (only when no active consent is left)
create or replace function public.idv_names_on_consent_revoke()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.revoked_at is not null and old.revoked_at is null
     and not exists (select 1 from public.identity_verification_consents c
                      where c.user_id = new.user_id and c.revoked_at is null) then
    delete from public.idv_verified_names where user_id = new.user_id;
  end if;
  return new;
end $$;

drop trigger if exists idv_names_on_consent_revoke on public.identity_verification_consents;
create trigger idv_names_on_consent_revoke
  after update on public.identity_verification_consents
  for each row execute function public.idv_names_on_consent_revoke();

-- 8. Who may call what (nobody in the browser; the Edge Functions use the service key)
revoke all on function public.idv_normalize_name(text), public.idv_names_match(text[], text[]),
  public.idv_store_name(text, text), public.idv_name_check(uuid, text), public.idv_name_matches(uuid, text),
  public.idv_set_name_manual(uuid, text), public.idv_names_on_consent_revoke()
  from public, anon, authenticated;
grant execute on function public.idv_normalize_name(text), public.idv_names_match(text[], text[]),
  public.idv_store_name(text, text), public.idv_name_check(uuid, text), public.idv_name_matches(uuid, text),
  public.idv_set_name_manual(uuid, text) to service_role;

select case when to_regprocedure('public.idv_store_name(text,text)') is not null
             and to_regprocedure('public.idv_name_check(uuid,text)') is not null
             and to_regclass('public.idv_verified_names') is not null
            then 'DONE: VR1 installed' else 'NOT DONE: something is missing' end as result;

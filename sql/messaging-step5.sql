-- ============================================================
-- StreetTasker Job Room, step 5 migration
-- File:    sql/messaging-step5.sql
-- Run in:  Supabase dashboard > SQL Editor (review it first).
-- Safe to run more than once (idempotent).
--
-- What it does
--   1. Pre-flight: stops with a clear message if the core ids are not uuid.
--   2. Creates `job_requests`: structured asks inside a conversation
--      (kinds used now: update, arrival, proof). Later steps add more kinds.
--   3. Row level security: only the two people in the thread can read or
--      create requests; a request can only be answered by the OTHER person,
--      or cancelled by whoever made it; nothing else can be edited.
--   4. messages: new column `job_request_id`, and allows the message types
--      'system' and 'job_request' (keeps every type already in your table).
--   5. message_threads: new column `customer_archived` (Archived tab).
--   6. Adds job_requests to Supabase realtime so cards update live.
--
-- Run this BEFORE deploying the step 5 front-end. The page still works
-- without it (the Request actions that need it are hidden), but nothing new
-- can be sent until it has run.
-- ============================================================

-- 1. Pre-flight --------------------------------------------------
do $$
declare bad text;
begin
  select string_agg(format('%s.%s is %s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod)), '; ')
    into bad
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid and c.relnamespace = 'public'::regnamespace
  where not a.attisdropped
    and ((c.relname = 'message_threads' and a.attname in ('id', 'customer_id', 'tasker_id'))
      or (c.relname = 'messages' and a.attname in ('id', 'thread_id')))
    and a.atttypid <> 'uuid'::regtype;
  if bad is not null then
    raise exception 'Step 5 migration expects uuid ids, found: %. Tell the developer before continuing.', bad;
  end if;
end $$;

-- 2. job_requests ------------------------------------------------
create table if not exists public.job_requests (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid not null references public.message_threads(id) on delete cascade,
  customer_id  uuid not null,
  tasker_id    uuid not null,
  requested_by uuid not null,
  kind         text not null check (kind ~ '^[a-z_]{2,40}$'),
  status       text not null default 'pending'
               check (status in ('pending', 'fulfilled', 'declined', 'cancelled', 'expired')),
  note         text check (note is null or char_length(note) <= 500),
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid,
  check (requested_by in (customer_id, tasker_id))
);

create index if not exists job_requests_thread_idx  on public.job_requests (thread_id, created_at);
create index if not exists job_requests_pending_idx on public.job_requests (thread_id) where status = 'pending';

-- 3. Row level security -----------------------------------------
alter table public.job_requests enable row level security;

drop policy if exists job_requests_select on public.job_requests;
create policy job_requests_select on public.job_requests
  for select using (auth.uid() in (customer_id, tasker_id));

drop policy if exists job_requests_insert on public.job_requests;
create policy job_requests_insert on public.job_requests
  for insert with check (
    requested_by = auth.uid()
    and auth.uid() in (customer_id, tasker_id)
    and exists (
      select 1 from public.message_threads t
      where t.id = job_requests.thread_id
        and t.customer_id = job_requests.customer_id
        and t.tasker_id   = job_requests.tasker_id
    )
  );

drop policy if exists job_requests_update on public.job_requests;
create policy job_requests_update on public.job_requests
  for update using (auth.uid() in (customer_id, tasker_id))
  with check (auth.uid() in (customer_id, tasker_id));

-- Only status may change, and only along allowed paths.
create or replace function public.job_requests_guard()
returns trigger language plpgsql as $$
begin
  if new.thread_id    is distinct from old.thread_id
  or new.customer_id  is distinct from old.customer_id
  or new.tasker_id    is distinct from old.tasker_id
  or new.requested_by is distinct from old.requested_by
  or new.kind         is distinct from old.kind
  or new.note         is distinct from old.note
  or new.payload      is distinct from old.payload
  or new.created_at   is distinct from old.created_at then
    raise exception 'job_requests: only the status can be changed';
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'pending' then
      raise exception 'job_requests: this request is already %', old.status;
    end if;
    if new.status in ('fulfilled', 'declined') then
      if auth.uid() = old.requested_by then
        raise exception 'job_requests: the other person answers a request';
      end if;
    elsif new.status = 'cancelled' then
      if auth.uid() is distinct from old.requested_by then
        raise exception 'job_requests: only the person who asked can cancel';
      end if;
    elsif new.status <> 'expired' then
      raise exception 'job_requests: invalid status %', new.status;
    end if;
    new.responded_at := now();
    new.responded_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists job_requests_guard on public.job_requests;
create trigger job_requests_guard before update on public.job_requests
  for each row execute function public.job_requests_guard();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, insert, update on public.job_requests to authenticated';
  end if;
end $$;

-- 4. messages ----------------------------------------------------
alter table public.messages
  add column if not exists job_request_id uuid references public.job_requests(id) on delete set null;
create index if not exists messages_job_request_idx on public.messages (job_request_id) where job_request_id is not null;

-- Allow the new message types. Works whether `type` is an enum or text + CHECK.
do $$
declare
  col_kind   "char";
  enum_name  text;
  c          record;
  existing   text[];
  allowed    text[];
begin
  select t.typtype, format('%I.%I', n.nspname, t.typname)
    into col_kind, enum_name
  from pg_attribute a
  join pg_type t on t.oid = a.atttypid
  join pg_namespace n on n.oid = t.typnamespace
  where a.attrelid = 'public.messages'::regclass and a.attname = 'type' and not a.attisdropped;

  if col_kind is null then
    raise notice 'messages.type not found, skipping type allowance';
    return;
  end if;

  if col_kind = 'e' then
    execute format('alter type %s add value if not exists %L', enum_name, 'system');
    execute format('alter type %s add value if not exists %L', enum_name, 'job_request');
  else
    for c in
      select conname from pg_constraint
      where conrelid = 'public.messages'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) ~* '\mtype\M'
    loop
      execute format('alter table public.messages drop constraint %I', c.conname);
    end loop;

    select coalesce(array_agg(distinct type), '{}') into existing
    from public.messages where type is not null;

    allowed := (
      select array_agg(distinct v) from unnest(
        existing || array['text', 'payment_request', 'payment_confirmed', 'system', 'job_request']
      ) as v
    );

    execute format(
      'alter table public.messages add constraint messages_type_check check (type is null or type = any (%L::text[]))',
      allowed
    );
  end if;
end $$;

-- 5. message_threads ---------------------------------------------
alter table public.message_threads
  add column if not exists customer_archived boolean not null default false;

-- 6. Realtime ----------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_requests') then
    alter publication supabase_realtime add table public.job_requests;
  end if;
end $$;

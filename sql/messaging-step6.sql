-- ============================================================
-- StreetTasker Job Room, step 6 migration (money cards)
-- File:    sql/messaging-step6.sql
-- Run in:  Supabase dashboard > SQL Editor (review it first).
-- Safe to run more than once (idempotent). Run step 5 first.
--
-- What it does (all on the existing `payment_requests` table)
--   1. Pre-flight: payment_requests must exist with uuid ids.
--   2. New columns: kind, reason, breakdown.
--        kind: payment (a custom amount, what exists today), full_payment,
--              remaining_payment, transport, additional_cost
--        reason: why (shown to the customer), max 300 characters
--        breakdown: optional split, e.g. {"work": 7000, "materials": 3000}
--   3. Allows the statuses the cards need: approved, declined, cancelled
--      (keeps pending, accepted, paid and anything already in the table).
--   4. Adds payment_requests to realtime so cards update live.
--
-- It does NOT change row level security on payment_requests. Check that, for
-- these rows, the customer can update status (approve / decline / pay) and the
-- tasker can update status (cancel). They already do for accepted / paid today.
-- ============================================================

-- 1. Pre-flight ---------------------------------------------------
do $$
declare bad text;
begin
  if to_regclass('public.payment_requests') is null then
    raise exception 'public.payment_requests does not exist. Nothing to migrate.';
  end if;
  select string_agg(format('payment_requests.%s is %s', a.attname, format_type(a.atttypid, a.atttypmod)), '; ')
    into bad
  from pg_attribute a
  where a.attrelid = 'public.payment_requests'::regclass and not a.attisdropped
    and a.attname in ('id', 'thread_id') and a.atttypid <> 'uuid'::regtype;
  if bad is not null then
    raise exception 'Step 6 migration expects uuid ids, found: %. Tell the developer before continuing.', bad;
  end if;
end $$;

-- 2. New columns ----------------------------------------------------
alter table public.payment_requests add column if not exists kind      text  not null default 'payment';
alter table public.payment_requests add column if not exists reason    text;
alter table public.payment_requests add column if not exists breakdown jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_requests_kind_check'
                 and conrelid = 'public.payment_requests'::regclass) then
    alter table public.payment_requests
      add constraint payment_requests_kind_check
      check (kind in ('payment', 'full_payment', 'remaining_payment', 'transport', 'additional_cost'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_requests_reason_check'
                 and conrelid = 'public.payment_requests'::regclass) then
    alter table public.payment_requests
      add constraint payment_requests_reason_check
      check (reason is null or char_length(reason) <= 300);
  end if;
end $$;

-- 3. Allow the new statuses ------------------------------------------
-- Works whether `status` is an enum or text + CHECK. Only CHECK constraints that
-- are clearly the status list (mention status AND 'pending') are replaced;
-- anything dropped is printed as a NOTICE so you can see it in the output.
do $$
declare
  col_kind  "char";
  enum_name text;
  c         record;
  existing  text[];
  allowed   text[];
  v         text;
begin
  select t.typtype, format('%I.%I', n.nspname, t.typname)
    into col_kind, enum_name
  from pg_attribute a
  join pg_type t on t.oid = a.atttypid
  join pg_namespace n on n.oid = t.typnamespace
  where a.attrelid = 'public.payment_requests'::regclass and a.attname = 'status' and not a.attisdropped;

  if col_kind is null then
    raise notice 'payment_requests.status not found, skipping';
    return;
  end if;

  if col_kind = 'e' then
    foreach v in array array['pending', 'accepted', 'paid', 'approved', 'declined', 'cancelled'] loop
      execute format('alter type %s add value if not exists %L', enum_name, v);
    end loop;
  else
    for c in
      select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'public.payment_requests'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) ~* '\mstatus\M' and pg_get_constraintdef(oid) ~* 'pending'
    loop
      raise notice 'Replacing status constraint %: %', c.conname, c.def;
      execute format('alter table public.payment_requests drop constraint %I', c.conname);
    end loop;

    select coalesce(array_agg(distinct status), '{}') into existing
    from public.payment_requests where status is not null;

    allowed := (
      select array_agg(distinct x) from unnest(
        existing || array['pending', 'accepted', 'paid', 'approved', 'declined', 'cancelled']
      ) as x
    );

    if not exists (select 1 from pg_constraint where conname = 'payment_requests_status_check'
                   and conrelid = 'public.payment_requests'::regclass) then
      execute format(
        'alter table public.payment_requests add constraint payment_requests_status_check check (status is null or status = any (%L::text[]))',
        allowed
      );
    end if;
  end if;
end $$;

-- 4. Realtime ---------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payment_requests') then
    alter publication supabase_realtime add table public.payment_requests;
  end if;
end $$;

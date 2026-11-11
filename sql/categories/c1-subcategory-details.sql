-- Categories Stage 1: room for a subcategory and the category-specific answers on every service.
-- Run once in the Supabase SQL editor BEFORE uploading the Stage 1+2 files. Safe to run twice. Nothing existing is changed.
--   services.subcategory  text   e.g. 'Plumbing' (what the tasker picked under the category)
--   services.details      jsonb  the answers to the category's own form (rooms, vehicle, brand...), filled in from Stage 3 on
-- Until this runs, post-service.html still saves (it drops the two new fields and says nothing), so nothing breaks.
begin;

alter table public.services add column if not exists subcategory text;
alter table public.services add column if not exists details jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'services_subcategory_len' and conrelid = 'public.services'::regclass) then
    alter table public.services add constraint services_subcategory_len
      check (subcategory is null or char_length(subcategory) <= 80);
  end if;
  -- details must be a JSON object and stay small (20 KB), so one listing cannot bloat the table
  if not exists (select 1 from pg_constraint where conname = 'services_details_shape' and conrelid = 'public.services'::regclass) then
    alter table public.services add constraint services_details_shape
      check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 20000);
  end if;
end $$;

-- Search by subcategory on Find Services (used from Stage 5)
create index if not exists services_subcategory_idx on public.services (subcategory) where subcategory is not null;

commit;

-- Check: should return 2 rows (subcategory, details), then the 2 constraint names.
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'services' and column_name in ('subcategory', 'details') order by column_name;
select conname from pg_constraint where conrelid = 'public.services'::regclass and conname in ('services_subcategory_len', 'services_details_shape') order by conname;

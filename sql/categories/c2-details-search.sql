-- Categories Stage 5: let Find Services filter by the category answers (services.details).
-- Run once in the Supabase SQL editor AFTER c1-subcategory-details.sql. Safe to run twice. Nothing existing is changed.
-- The page filters in the browser today (it loads up to 200 live services), so nothing breaks if this has not run yet.
-- The index is for when filtering moves to the database: details @> '{"supplies":"Either"}' and details->'property_types' ? 'Office'.
begin;

create index if not exists services_details_gin on public.services using gin (details jsonb_path_ops);

-- Category + type of work together (the Find Services "Type of work" chips)
create index if not exists services_category_subcategory_idx on public.services (category, subcategory) where subcategory is not null;

commit;

-- Check: should return 2 rows.
select indexname from pg_indexes where schemaname = 'public' and tablename = 'services'
  and indexname in ('services_details_gin', 'services_category_subcategory_idx') order by indexname;

-- Stage 3: price range for services. Run once in the Supabase SQL editor BEFORE uploading the Stage 3 files.
-- Adds services.price_max (nullable). A fixed-price service leaves it empty; a range service has price = "from" and price_max = "to".
-- Safe to run twice. Existing rows are untouched.
alter table public.services add column if not exists price_max numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'services_price_max_check') then
    alter table public.services
      add constraint services_price_max_check check (price_max is null or (price_max > 0 and price_max >= price));
  end if;
end $$;

-- Check: should return one row with data_type = numeric
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'services' and column_name = 'price_max';

-- Undo (only if you ever need it):
--   alter table public.services drop constraint if exists services_price_max_check;
--   alter table public.services drop column if exists price_max;

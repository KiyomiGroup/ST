-- Categories Stage 6a: pricing methods on services. Run once in the Supabase SQL editor. Safe to run twice. Nothing existing is changed.
--   services.price_type        text  fixed | hourly | daily | item | session | visit | unit | from | range | negotiable | quote   (null on old rows)
--   services.price_unit_label  text  only for "per unit": 'square metre'
-- Until this runs, Post a Service still saves (it drops the two new fields, tells the tasker, and the listing reads like an old one).
begin;
alter table public.services add column if not exists price_type text;
alter table public.services add column if not exists price_unit_label text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'services_price_type_ok' and conrelid = 'public.services'::regclass) then
    alter table public.services add constraint services_price_type_ok
      check (price_type is null or price_type in ('fixed','hourly','daily','item','session','visit','unit','from','range','negotiable','quote'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'services_price_unit_label_len' and conrelid = 'public.services'::regclass) then
    alter table public.services add constraint services_price_unit_label_len
      check (price_unit_label is null or char_length(price_unit_label) <= 30);
  end if;
end $$;
commit;

-- "Custom quotation" is saved with price 0. Check that nothing blocks a price of 0: this should list NO check that says price > 0,
-- and price should be nullable or have no NOT NULL problem with 0. If a rule such as (price > 0) shows, tell the developer before using Custom quotation.
select conname, pg_get_constraintdef(oid) as rule from pg_constraint
 where conrelid = 'public.services'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%price%';
select column_name, is_nullable, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'services' and column_name in ('price','price_max','rate_unit','price_type','price_unit_label') order by column_name;

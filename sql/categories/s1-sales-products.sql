-- Categories Stage 6b: Sales upgrade. Run once in the Supabase SQL editor, AFTER sql/pricing/p2-sales-products.sql. Safe to run twice.
-- Adds to public.service_products: condition, brand, model, colour, size, expiry_date, quantity, stock_status, negotiable, was_price.
-- Delivery and pickup are saved in services.details (no change needed there).
-- Until this runs, Post a Service still saves the products (name, price, photo), drops the new fields, and tells the seller.
begin;

alter table public.service_products add column if not exists condition    text;
alter table public.service_products add column if not exists brand        text;
alter table public.service_products add column if not exists model        text;
alter table public.service_products add column if not exists colour       text;
alter table public.service_products add column if not exists size         text;
alter table public.service_products add column if not exists expiry_date  date;
alter table public.service_products add column if not exists quantity     integer;
alter table public.service_products add column if not exists stock_status text not null default 'in_stock';
alter table public.service_products add column if not exists negotiable   boolean not null default false;
alter table public.service_products add column if not exists was_price    numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_products_condition_ok' and conrelid = 'public.service_products'::regclass) then
    alter table public.service_products add constraint service_products_condition_ok
      check (condition is null or condition in ('Brand New','Fairly Used','Refurbished'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'service_products_stock_ok' and conrelid = 'public.service_products'::regclass) then
    alter table public.service_products add constraint service_products_stock_ok
      check (stock_status in ('in_stock','out_of_stock','sold','paused'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'service_products_quantity_ok' and conrelid = 'public.service_products'::regclass) then
    alter table public.service_products add constraint service_products_quantity_ok
      check (quantity is null or (quantity >= 0 and quantity <= 99999));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'service_products_was_price_ok' and conrelid = 'public.service_products'::regclass) then
    alter table public.service_products add constraint service_products_was_price_ok
      check (was_price is null or was_price > price);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'service_products_text_len' and conrelid = 'public.service_products'::regclass) then
    alter table public.service_products add constraint service_products_text_len
      check (char_length(coalesce(brand,'')) <= 40 and char_length(coalesce(model,'')) <= 40
         and char_length(coalesce(colour,'')) <= 30 and char_length(coalesce(size,'')) <= 30);
  end if;
end $$;

commit;

-- Check: should return 10 rows.
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'service_products'
  and column_name in ('condition','brand','model','colour','size','expiry_date','quantity','stock_status','negotiable','was_price') order by column_name;

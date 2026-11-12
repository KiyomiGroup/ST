-- Undo s1-sales-products.sql. Drops the new product columns (their data is lost; name, price and photo stay).
alter table public.service_products drop constraint if exists service_products_condition_ok;
alter table public.service_products drop constraint if exists service_products_stock_ok;
alter table public.service_products drop constraint if exists service_products_quantity_ok;
alter table public.service_products drop constraint if exists service_products_was_price_ok;
alter table public.service_products drop constraint if exists service_products_text_len;
alter table public.service_products drop column if exists condition, drop column if exists brand, drop column if exists model,
  drop column if exists colour, drop column if exists size, drop column if exists expiry_date, drop column if exists quantity,
  drop column if exists stock_status, drop column if exists negotiable, drop column if exists was_price;

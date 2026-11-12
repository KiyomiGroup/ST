-- Undo p2-pricing-methods.sql. Drops the two columns (their data is lost; price, price_max and rate_unit stay).
alter table public.services drop constraint if exists services_price_type_ok;
alter table public.services drop constraint if exists services_price_unit_label_len;
alter table public.services drop column if exists price_type;
alter table public.services drop column if exists price_unit_label;

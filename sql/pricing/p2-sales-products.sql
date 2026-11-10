-- Stage 4: Sales category. Run once in the Supabase SQL editor, AFTER p1-price-range.sql and BEFORE uploading the Stage 4 files.
-- Creates public.service_products: up to 6 products per service (name, price, optional photo link).
-- Photos reuse the existing public "service-images" bucket (same folder as service photos), so NO Storage change is needed.
-- Safe to run twice. Nothing existing is changed.
begin;

do $$
declare t text;
begin
  -- match the type of services.id (uuid on most projects)
  select format_type(atttypid, atttypmod) into t
    from pg_attribute where attrelid = 'public.services'::regclass and attname = 'id' and not attisdropped;
  execute format($f$
    create table if not exists public.service_products (
      id         uuid primary key default gen_random_uuid(),
      service_id %s not null references public.services(id) on delete cascade,
      user_id    uuid not null,
      position   smallint not null check (position between 1 and 6),
      name       text not null check (char_length(name) between 1 and 60),
      price      numeric not null check (price > 0),
      image_url  text check (image_url is null or char_length(image_url) <= 600),
      created_at timestamptz not null default now(),
      unique (service_id, position)
    )$f$, t);
end $$;

create index if not exists service_products_service_idx on public.service_products (service_id);

alter table public.service_products enable row level security;

-- Anyone can see the products of a live service; the owner also sees them while it is a draft.
drop policy if exists service_products_read on public.service_products;
create policy service_products_read on public.service_products for select
  using (exists (select 1 from public.services s
                  where s.id = service_products.service_id
                    and (s.available = true or s.user_id::text = auth.uid()::text)));

-- Only the owner of the service writes its products, and user_id must be themselves.
drop policy if exists service_products_insert on public.service_products;
create policy service_products_insert on public.service_products for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.services s where s.id = service_products.service_id and s.user_id::text = auth.uid()::text));

drop policy if exists service_products_update on public.service_products;
create policy service_products_update on public.service_products for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
              and exists (select 1 from public.services s where s.id = service_products.service_id and s.user_id::text = auth.uid()::text));

drop policy if exists service_products_delete on public.service_products;
create policy service_products_delete on public.service_products for delete to authenticated
  using (user_id = auth.uid());

grant select on public.service_products to anon, authenticated;
grant insert, update, delete on public.service_products to authenticated;

commit;

-- Check: should return one row (table exists), then the 4 policy names.
select table_name from information_schema.tables where table_schema = 'public' and table_name = 'service_products';
select policyname from pg_policies where schemaname = 'public' and tablename = 'service_products' order by policyname;

-- Undo (only if ever needed):
--   drop table if exists public.service_products;

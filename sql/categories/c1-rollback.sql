-- Undo categories Stage 1 (only if ever needed). This deletes any subcategory and details already saved.
begin;
drop index if exists public.services_subcategory_idx;
alter table public.services drop constraint if exists services_details_shape;
alter table public.services drop constraint if exists services_subcategory_len;
alter table public.services drop column if exists details;
alter table public.services drop column if exists subcategory;
commit;

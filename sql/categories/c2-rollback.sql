-- Undo Categories Stage 5 (c2-details-search.sql). Only removes the two indexes; no data changes.
drop index if exists public.services_details_gin;
drop index if exists public.services_category_subcategory_idx;

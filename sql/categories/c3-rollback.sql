-- Undo c3-task-details.sql. Drops the two columns (their data is lost; everything else on tasks stays).
drop index if exists public.tasks_details_gin;
alter table public.tasks drop constraint if exists tasks_subcategory_len;
alter table public.tasks drop constraint if exists tasks_details_object;
alter table public.tasks drop column if exists subcategory, drop column if exists details;

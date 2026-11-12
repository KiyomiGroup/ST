-- Categories Stage 6c: the kind of work and the Poster's answers on tasks. Run once in the Supabase SQL editor. Safe to run twice.
--   tasks.subcategory  text   e.g. 'Deep Cleaning'  (null for old tasks and for the Other category)
--   tasks.details      jsonb  e.g. {"_v":1,"supplies":"I will provide them","cleaners_wanted":2}   (same flat shape as services.details)
-- Until this runs, Post a Task still posts (it drops these two fields). Nothing existing is changed.
begin;
alter table public.tasks add column if not exists subcategory text;
alter table public.tasks add column if not exists details jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_subcategory_len' and conrelid = 'public.tasks'::regclass) then
    alter table public.tasks add constraint tasks_subcategory_len check (subcategory is null or char_length(subcategory) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_details_object' and conrelid = 'public.tasks'::regclass) then
    alter table public.tasks add constraint tasks_details_object check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 8000);
  end if;
end $$;
create index if not exists tasks_details_gin on public.tasks using gin (details jsonb_path_ops);
commit;

-- Check: should return 2 rows.
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name in ('subcategory','details') order by column_name;

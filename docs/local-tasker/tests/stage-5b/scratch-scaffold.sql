-- SCRATCH ONLY (stage 5B). Load AFTER the 5A scaffold. Stand-ins for tables that 5B reads defensively.
-- The real tasks / verifications tables are NOT in the exported schema we have; these columns are the ones the website code reads.
alter table public.tasks add column if not exists title text, add column if not exists description text, add column if not exists budget numeric,
  add column if not exists location text, add column if not exists category text;
create table if not exists public.verifications (user_id uuid, phone text);
grant select on public.tasks, public.verifications to service_role;

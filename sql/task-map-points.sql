-- Task map points. Run once in the Supabase SQL editor. Safe to run again.
-- Gives each in-person task a rounded AREA point (about 100 m grid, the centre of its area, never an address) so the Find Tasks map can
-- draw it without a lookup per visitor, and "Search this area" can find tasks by position.
-- The browser never sends coordinates: the server works the point out from the task's own location text, with the same
-- homepage_place_point function the Home page and the maps already use. Run sql/coordinator-onboarding/c0-introspect.sql first if
-- you want to confirm homepage_place_point returns columns named lat and lon (the maps' JavaScript reads them by those names).

alter table public.tasks add column if not exists map_lat double precision;
alter table public.tasks add column if not exists map_lon double precision;
create index if not exists tasks_map_point_idx on public.tasks (map_lat, map_lon) where map_lat is not null;

-- Area centre for a location text. A long address is tried whole, then without its leading parts ("Lekki Phase 1, Lagos", then "Lagos"),
-- so the point is never finer than an area. Internal: not callable from the browser.
create or replace function public.task_area_point(p_location text)
returns table (lat numeric, lon numeric)
language plpgsql security definer set search_path = public as $$
declare
  parts text[];
  n int;
  i int;
  la numeric;
  lo numeric;
begin
  parts := array(select trim(x) from unnest(string_to_array(coalesce(p_location, ''), ',')) as x where trim(x) <> '');
  n := coalesce(array_length(parts, 1), 0);
  for i in 1 .. least(n, 3) loop
    select round(p.lat::numeric, 3), round(p.lon::numeric, 3) into la, lo
      from public.homepage_place_point(array_to_string(parts[i:n], ', ')) as p limit 1;
    exit when la is not null and lo is not null;
  end loop;
  if la is null or lo is null then return; end if;
  lat := la; lon := lo;
  return next;
end;
$$;
revoke all on function public.task_area_point(text) from public, anon, authenticated;

-- Called by the app right after a task is posted. Only the task's owner can set it; remote tasks get no point.
create or replace function public.set_task_map_point(p_task_id text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  j jsonb;
  la numeric;
  lo numeric;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select to_jsonb(tk) into j from public.tasks tk
    where tk.id::text = p_task_id and (tk.user_id = auth.uid() or tk.customer_id = auth.uid());
  if j is null then return false; end if;
  if lower(coalesce(j->>'work_mode', j->>'task_type', '')) = 'remote' then return false; end if;
  select a.lat, a.lon into la, lo from public.task_area_point(j->>'location') as a limit 1;
  if la is null then return false; end if;
  update public.tasks set map_lat = la, map_lon = lo where id::text = p_task_id;
  return true;
end;
$$;
revoke all on function public.set_task_map_point(text) from public, anon;
grant execute on function public.set_task_map_point(text) to authenticated;

-- OPTIONAL, run once by itself after the above: give the tasks that are already open a point. One lookup per task, so it takes
-- a moment if there are thousands. Until then the map works those out in the browser, as before.
-- update public.tasks t
--    set map_lat = (select a.lat from public.task_area_point(t.location) as a limit 1),
--        map_lon = (select a.lon from public.task_area_point(t.location) as a limit 1)
--  where t.status = 'open' and t.map_lat is null
--    and lower(coalesce(to_jsonb(t)->>'work_mode', to_jsonb(t)->>'task_type', '')) <> 'remote';

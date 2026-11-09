-- HP2: tells the public pages which of a list of people are Local Taskers who are NOT published, so their cards can be left out.
-- Run the whole file once in the Supabase SQL editor (after HP1). Safe to run twice. Adds one function; changes no table or row.
-- Returns only ids that were passed in, and only an id (no name, no status). Callable logged out because the public lists are.
-- Rollback: drop function if exists public.local_tasker_hidden_ids(text[]);

create or replace function public.local_tasker_hidden_ids(p_ids text[])
 returns table(user_id text)
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $f$
  select p.tasker_user_id::text
    from public.local_tasker_profiles p
   where p.status <> 'published'
     and cardinality(coalesce(p_ids, '{}'::text[])) between 1 and 100
     and p.tasker_user_id::text = any (p_ids)
$f$;

revoke all on function public.local_tasker_hidden_ids(text[]) from public;
grant execute on function public.local_tasker_hidden_ids(text[]) to anon, authenticated;

-- Check: should return Samsole's id (status not published).
select p.tasker_user_id, p.status, (select count(*) from public.local_tasker_hidden_ids(array[p.tasker_user_id::text])) as hidden
from public.local_tasker_profiles p where p.full_name ilike '%samsole%';

-- Stage 4B inputs. Read-only. Paste ALL of it in the Supabase SQL editor, press Run,
-- then Export > Download CSV and upload that CSV. (One row per section, well under 100 rows.)
select 'buckets' as section,
       coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public, 'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types) order by id), '[]'::jsonb)::text as detail
from storage.buckets
union all
select 'storage_policies',
       coalesce(jsonb_agg(jsonb_build_object('name', policyname, 'cmd', cmd, 'roles', roles, 'permissive', permissive, 'using', qual, 'check', with_check) order by policyname), '[]'::jsonb)::text
from pg_policies where schemaname = 'storage' and tablename = 'objects'
union all
select 'services_policies',
       coalesce(jsonb_agg(jsonb_build_object('name', policyname, 'cmd', cmd, 'roles', roles, 'permissive', permissive, 'using', qual, 'check', with_check) order by policyname), '[]'::jsonb)::text
from pg_policies where schemaname = 'public' and tablename = 'services'
union all
select 'services_triggers',
       coalesce(jsonb_agg(tgname order by tgname), '[]'::jsonb)::text
from pg_trigger where tgrelid = 'public.services'::regclass and not tgisinternal
union all
select 'services_check_constraints',
       coalesce(jsonb_agg(conname || ': ' || pg_get_constraintdef(oid) order by conname), '[]'::jsonb)::text
from pg_constraint where conrelid = 'public.services'::regclass and contype in ('c', 'f', 'u')
union all
select 'service_categories_in_use',
       coalesce(jsonb_agg(jsonb_build_object('category', category, 'n', n) order by n desc), '[]'::jsonb)::text
from (select category, count(*) n from public.services group by category order by n desc limit 40) c;

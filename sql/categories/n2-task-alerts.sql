-- Categories Stage 6f (replaces "match a task to a service"): a daily "New tasks you might be interested in" email for taskers.
-- Run once in the Supabase SQL editor. Safe to run twice. Undo: n2-rollback.sql.
--
-- What it does (like the LinkedIn job email):
--   Every morning at 8:00 Lagos time (07:00 UTC) the database looks at each tasker's live services, finds the OPEN tasks posted in the
--   last 3 days in the same categories, and writes ONE notification per tasker: the 5 best matches plus "and N more".
--   Writing a notification already sends the phone push and the email (triggers notifications_email and push-notifications), and the
--   tasker's existing switches (Email notifications / Phone notifications) are respected by those triggers. No email is sent when
--   there is nothing new. A task is never sent to the same tasker twice (log table).
--   Best matches first: same type of work (subcategory) as the tasker's service, then urgent tasks, then newest.
--   Left out: the tasker's own tasks, Local Taskers (nobody logs in as them), paused / unavailable services, and the "Other" category
--   (free text, too vague to match).
-- Matching uses the category GROUP, so old saved values (plumber, barber...) still count. category_group() below is a copy of
-- STCat.resolve() in js/categories.js; tests/task-alerts.test.js fails if the two ever differ.
-- Non-ASCII characters are written as codes (chr()) on purpose, see ADMIN-HANDOFF.md (the SQL editor garbles pasted symbols).

begin;

-- 1. old or free-text category value -> one of the 26 group values
create or replace function public.category_group(p_value text)
returns text language plpgsql immutable set search_path to 'public', 'pg_temp' as $f$
declare raw text; v_k text; g text;
begin
  raw := lower(btrim(coalesce(p_value, '')));
  if raw = '' then return 'other'; end if;
  v_k := regexp_replace(raw, '[^a-z]', '', 'g');
  select m.grp into g from (values
    ('accounting', 'financial'),
    ('admin', 'business'),
    ('administration', 'business'),
    ('advertising', 'marketing'),
    ('appliance', 'handyman'),
    ('architect', 'professional'),
    ('assembly', 'handyman'),
    ('assistance', 'assistance'),
    ('auto', 'automotive'),
    ('automotive', 'automotive'),
    ('barber', 'grooming'),
    ('beauty', 'grooming'),
    ('bricklayer', 'construction'),
    ('builder', 'construction'),
    ('building', 'construction'),
    ('business', 'business'),
    ('car', 'automotive'),
    ('carpenter', 'construction'),
    ('carpentry', 'construction'),
    ('catering', 'hospitality'),
    ('chef', 'hospitality'),
    ('cleaner', 'cleaning'),
    ('cleaning', 'cleaning'),
    ('construction', 'construction'),
    ('consultant', 'professional'),
    ('consulting', 'professional'),
    ('cooking', 'hospitality'),
    ('courier', 'logistics'),
    ('creative', 'creative'),
    ('delivery', 'logistics'),
    ('design', 'creative'),
    ('dispatch', 'logistics'),
    ('dryclean', 'laundry'),
    ('drycleaning', 'laundry'),
    ('education', 'education'),
    ('electrical', 'handyman'),
    ('electrician', 'handyman'),
    ('engineer', 'professional'),
    ('entertainment', 'events'),
    ('errand', 'assistance'),
    ('errands', 'assistance'),
    ('event', 'events'),
    ('eventplanning', 'events'),
    ('events', 'events'),
    ('fashion', 'fashion'),
    ('fashiondesigner', 'fashion'),
    ('finance', 'financial'),
    ('financial', 'financial'),
    ('fitness', 'health'),
    ('food', 'hospitality'),
    ('foodcatering', 'hospitality'),
    ('freight', 'logistics'),
    ('furniture', 'home_furniture'),
    ('garden', 'landscaping'),
    ('gardening', 'landscaping'),
    ('graphics', 'creative'),
    ('grooming', 'grooming'),
    ('guard', 'security'),
    ('hair', 'grooming'),
    ('handyman', 'handyman'),
    ('health', 'health'),
    ('home', 'home_furniture'),
    ('homefurniture', 'home_furniture'),
    ('homeimprovement', 'home_furniture'),
    ('hospitality', 'hospitality'),
    ('housekeeping', 'cleaning'),
    ('interior', 'home_furniture'),
    ('ironing', 'laundry'),
    ('it', 'it_tech'),
    ('ittech', 'it_tech'),
    ('landscaping', 'landscaping'),
    ('laundromat', 'laundry'),
    ('laundry', 'laundry'),
    ('law', 'legal'),
    ('lawn', 'landscaping'),
    ('lawyer', 'legal'),
    ('legal', 'legal'),
    ('lesson', 'education'),
    ('lessons', 'education'),
    ('logistics', 'logistics'),
    ('maintenance', 'handyman'),
    ('makeup', 'grooming'),
    ('marketing', 'marketing'),
    ('mason', 'construction'),
    ('mechanic', 'automotive'),
    ('moving', 'logistics'),
    ('nails', 'grooming'),
    ('nurse', 'health'),
    ('other', 'other'),
    ('outdoor', 'landscaping'),
    ('painter', 'handyman'),
    ('painting', 'handyman'),
    ('personalassistant', 'assistance'),
    ('personalcare', 'grooming'),
    ('personalshopping', 'assistance'),
    ('pet', 'pet'),
    ('petcare', 'pet'),
    ('pets', 'pet'),
    ('photographer', 'events'),
    ('photography', 'events'),
    ('physio', 'health'),
    ('plumber', 'handyman'),
    ('plumbing', 'handyman'),
    ('professional', 'professional'),
    ('repair', 'handyman'),
    ('repairs', 'handyman'),
    ('safety', 'security'),
    ('sales', 'sales'),
    ('salon', 'grooming'),
    ('seamstress', 'fashion'),
    ('security', 'security'),
    ('software', 'it_tech'),
    ('tailor', 'fashion'),
    ('tailoring', 'fashion'),
    ('tax', 'financial'),
    ('tech', 'it_tech'),
    ('technology', 'it_tech'),
    ('tiler', 'construction'),
    ('trades', 'handyman'),
    ('translator', 'professional'),
    ('tutor', 'education'),
    ('tutoring', 'education'),
    ('upholstery', 'home_furniture'),
    ('washing', 'laundry'),
    ('wedding', 'events'),
    ('welder', 'construction'),
    ('wellness', 'health')
  ) as m(k, grp) where m.k = v_k limit 1;
  if g is not null then return g; end if;
  if raw in ('cleaning','handyman','construction','logistics','creative','it_tech','events','grooming','education','landscaping','automotive','home_furniture','business','fashion','pet','assistance','professional','hospitality','security','laundry','health','financial','legal','marketing','sales','other') then return raw; end if;
  return 'other';
end $f$;

-- 2. who was already told about which task
create table if not exists public.task_alert_log (
  user_id uuid not null,
  task_id text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, task_id)
);
create index if not exists task_alert_log_sent_idx on public.task_alert_log (sent_at);
alter table public.task_alert_log enable row level security;   -- no policies: only the functions below touch it

-- 3. every (tasker, task) pair that should be told about, best first. Read-only: use it to preview, e.g.
--      select count(distinct user_id) as taskers, count(*) as pairs from public._task_alert_candidates();
create or replace function public._task_alert_candidates(p_now timestamptz default now(), p_max_age interval default interval '3 days')
returns table (user_id uuid, task_id text, grp text, title text, location text, budget numeric, no_budget boolean, urgent boolean, same_sub boolean, rn int, total int)
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  with live as (
    select t.id::text as task_id, t.title, t.location, t.budget, t.no_budget, t.urgent, t.subcategory, t.created_at,
           public.category_group(t.category) as grp, coalesce(t.user_id, t.customer_id) as poster
      from public.tasks t
     where t.status = 'open' and t.created_at >= p_now - p_max_age
       and public.category_group(t.category) <> 'other'
  ), svc as (
    select s.user_id, public.category_group(s.category) as grp,
           coalesce(array_agg(distinct lower(btrim(s.subcategory))) filter (where s.subcategory is not null), '{}') as subs
      from public.services s
     where s.available = true and coalesce(s.listing_status, 'active') = 'active' and s.user_id is not null
       and public.category_group(s.category) <> 'other'
       and not public.is_local_tasker(s.user_id)
     group by s.user_id, public.category_group(s.category)
  ), pairs as (
    select v.user_id, l.task_id, l.grp, l.title, l.location, l.budget, l.no_budget, coalesce(l.urgent, false) as urgent,
           (l.subcategory is not null and lower(btrim(l.subcategory)) = any (v.subs)) as same_sub, l.created_at
      from live l join svc v on v.grp = l.grp
     where v.user_id is distinct from l.poster
       and not exists (select 1 from public.task_alert_log g where g.user_id = v.user_id and g.task_id = l.task_id)
  )
  select p.user_id, p.task_id, p.grp, p.title, p.location, p.budget, p.no_budget, p.urgent, p.same_sub,
         (row_number() over (partition by p.user_id order by p.same_sub desc, p.urgent desc, p.created_at desc))::int as rn,
         (count(*) over (partition by p.user_id))::int as total
    from pairs p;
$f$;

-- 4. write the digests. Returns how many taskers were notified. Nothing is written for a tasker with no new matches.
create or replace function public.send_task_alert_digests(p_now timestamptz default now(), p_max_age interval default interval '3 days')
returns integer language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare
  r record; n int := 0; v_msg text; v_url text;
  naira text := chr(8358);
begin
  drop table if exists _tad;
  create temp table _tad on commit drop as select * from public._task_alert_candidates(p_now, p_max_age);

  for r in
    select c.user_id,
           max(c.total) as total,
           count(distinct c.grp) filter (where c.rn <= 5) as groups,
           min(c.grp) filter (where c.rn <= 5) as one_grp,
           jsonb_agg(c.task_id order by c.rn) filter (where c.rn <= 5) as shown_ids,
           string_agg(
             chr(8226) || ' ' || left(btrim(c.title), 60)
             || case when nullif(btrim(coalesce(c.location, '')), '') is not null then ' - ' || left(btrim(c.location), 30) else '' end
             || case when coalesce(c.no_budget, false) or coalesce(c.budget, 0) <= 0 then ''
                     else ' - ' || naira || to_char(c.budget, 'FM999G999G999G999') end
             || case when c.urgent then ' (urgent)' else '' end,
             E'\n' order by c.rn) filter (where c.rn <= 5) as lines
      from _tad c
     group by c.user_id
  loop
    begin
      v_msg := r.lines;
      if r.total > 5 then v_msg := v_msg || E'\n+ ' || (r.total - 5) || ' more that match your services'; end if;
      v_url := case when r.groups = 1 then 'find-tasks.html?category=' || r.one_grp else 'find-tasks.html' end;

      insert into public.notifications (user_id, type, title, message, data, is_read)
      values (r.user_id, 'task_digest', 'New tasks you might be interested in', v_msg,
              jsonb_build_object('kind', 'digest', 'count', r.total, 'task_ids', r.shown_ids, 'url', v_url), false);

      -- every matching task is marked as told (not only the 5 shown), so tomorrow's email holds only what is new
      insert into public.task_alert_log (user_id, task_id)
      select t.user_id, t.task_id from _tad t where t.user_id = r.user_id
      on conflict do nothing;
      n := n + 1;
    exception when others then
      raise warning 'send_task_alert_digests: skipped % (%)', r.user_id, sqlerrm;
    end;
  end loop;

  delete from public.task_alert_log where sent_at < p_now - interval '30 days';
  return n;
end $f$;

revoke all on function public.send_task_alert_digests(timestamptz, interval) from public, anon, authenticated;
revoke all on function public._task_alert_candidates(timestamptz, interval) from public, anon, authenticated;
revoke all on function public.category_group(text) from public, anon, authenticated;
grant execute on function public.category_group(text) to service_role;

-- every day at 07:00 UTC = 08:00 Lagos (pg_cron is on in this project)
do $c$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'task-alert-digest';
    perform cron.schedule('task-alert-digest', '0 7 * * *', 'select public.send_task_alert_digests()');
  else
    raise notice 'pg_cron is not installed: call select public.send_task_alert_digests(); once a day by hand or with another scheduler.';
  end if;
end $c$;

commit;

-- CHECKS (run after the commit; nothing below sends anything)
-- 1. Should be: handyman, handyman, grooming, other
select public.category_group('plumber') as a, public.category_group('Repairs') as b, public.category_group('barber') as c, public.category_group('xyz') as d;
-- 2. Who WOULD get an email right now, and how many tasks each:
select count(distinct user_id) as taskers_to_email, count(*) as task_matches from public._task_alert_candidates();
-- 3. The job is scheduled (empty if pg_cron is missing):
select jobname, schedule from cron.job where jobname = 'task-alert-digest';
-- TO SEND NOW (real emails and pushes): select public.send_task_alert_digests();

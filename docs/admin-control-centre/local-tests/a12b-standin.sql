-- LOCAL STAND-INS ONLY (never run on Supabase). Run AFTER standin.sql, a9-standin.sql and a10-standin.sql.
-- Imitates the booking tables and helper functions A12a and A12b use. The column names come from the REAL function sources the owner
-- pasted on 2026-11-09 (bookings, local_booking_state, local_booking_exceptions, local_booking_events). _local_booking_follow_assignment
-- is the REAL body; _local_booking_log is a stub; _local_booking_current_coordinator and job_booking_frozen are simple imitations.
alter table public.bookings add column if not exists customer_id uuid;
alter table public.bookings add column if not exists tasker_id uuid;
alter table public.bookings add column if not exists payment_status text;
alter table public.bookings add column if not exists work_stage text;
alter table public.bookings add column if not exists amount numeric;
alter table public.bookings add column if not exists scheduled_time timestamptz;
alter table public.bookings add column if not exists completed_at timestamptz;
alter table public.bookings add column if not exists dispute_reason text;
alter table public.bookings add column if not exists code_attempts integer default 0;
alter table public.bookings add column if not exists service_id uuid;
alter table public.bookings add column if not exists task_id uuid;
alter table public.local_booking_state add column if not exists original_coordinator_id uuid;
alter table public.local_booking_state add column if not exists resume_status text;
alter table public.local_booking_state add column if not exists updated_at timestamptz default now();
create table public.local_booking_exceptions (id uuid primary key default gen_random_uuid(), booking_id uuid, kind text, request_id uuid, happened_at timestamptz default now(),
  recorded_at timestamptz default now(), coordinator_id uuid, note text);
create table public.local_booking_events (id bigserial primary key, booking_id uuid, kind text, previous_coordinator_id uuid, created_at timestamptz default now());
create table public.local_booking_milestones (id uuid primary key default gen_random_uuid(), booking_id uuid, kind text, created_at timestamptz default now());
create table public.local_booking_quotes (id uuid primary key default gen_random_uuid(), booking_id uuid, version int, service_fee numeric, transport_amount numeric, materials_amount numeric, superseded_at timestamptz, created_at timestamptz default now());
create table public.job_events (id uuid primary key default gen_random_uuid(), booking_id uuid, kind text, created_at timestamptz default now());
create table public.escrow_payments (id uuid primary key default gen_random_uuid(), booking_id uuid, status text, amount numeric, platform_fee numeric, tasker_amount numeric, created_at timestamptz default now(), released_at timestamptz);
create table public.message_threads (id uuid primary key default gen_random_uuid(), booking_id uuid);
create table public.frozen_bookings (booking_id uuid primary key);
create function public._local_booking_is_open(s text) returns boolean language sql immutable as $$ select coalesce(s, '') not in ('completed', 'cancelled', 'rejected', 'declined') $$;
create function public.job_booking_frozen(b uuid) returns boolean language sql stable as $$ select exists (select 1 from public.frozen_bookings f where f.booking_id = b) $$;
create function public._local_booking_current_coordinator(p uuid) returns uuid language sql stable security definer as $$
  select a.coordinator_id from public.coordinator_assignments a join public.coordinators c on c.user_id = a.coordinator_id and c.status = 'active'
   where a.tasker_user_id = p and a.ended_at is null limit 1 $$;
create function public._local_booking_log(b uuid, k text, f text, t text, c uuid, pc uuid, a uuid, r text, n text) returns void language sql as
  $$ insert into public.local_booking_events(booking_id, kind, previous_coordinator_id) values (b, k, pc) $$;
CREATE OR REPLACE FUNCTION public._local_booking_follow_assignment(p_tasker uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare r record; v_coord uuid; n int := 0; v_to text;
begin
  v_coord := public._local_booking_current_coordinator(p_tasker);
  for r in select s.* from public.local_booking_state s join public.bookings b on b.id = s.booking_id
            where s.tasker_user_id = p_tasker and public._local_booking_is_open(b.status) for update of s loop
    if v_coord is not distinct from r.coordinator_id then continue; end if;
    n := n + 1;
    if v_coord is null then
      update public.local_booking_state
         set coordinator_id = null,
             resume_status = case when lt_status = 'needs_reassignment' then resume_status else lt_status end,
             lt_status = 'needs_reassignment', updated_at = now()
       where booking_id = r.booking_id;
      perform public._local_booking_log(r.booking_id, 'needs_reassignment', r.lt_status, 'needs_reassignment', null, r.coordinator_id, null, 'system', 'no active coordinator');
    else
      v_to := case when r.lt_status = 'needs_reassignment' then coalesce(r.resume_status, 'assigned') else r.lt_status end;
      update public.local_booking_state
         set coordinator_id = v_coord, original_coordinator_id = coalesce(original_coordinator_id, v_coord),
             lt_status = v_to, resume_status = null, updated_at = now()
       where booking_id = r.booking_id;
      perform public._local_booking_log(r.booking_id, case when r.original_coordinator_id is null then 'assigned' else 'reassigned' end,
                                        r.lt_status, v_to, v_coord,
                                        coalesce(r.coordinator_id, (select e.previous_coordinator_id from public.local_booking_events e
                                                                      where e.booking_id = r.booking_id and e.kind = 'needs_reassignment'
                                                                      order by e.created_at desc limit 1)),
                                        null, 'system', 'assignment changed');
    end if;
  end loop;
  return n;
end $function$;

create table public.tasks (id uuid primary key default gen_random_uuid(), title text, status text, created_at timestamptz default now());

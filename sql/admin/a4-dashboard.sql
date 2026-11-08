-- ============================================================================
-- StreetTasker Admin Control Centre, stage A4: Dashboard summary (READ ONLY).
-- ADDITIVE and safe to run twice. Creates ONE function. Changes no table, no policy,
-- no existing function. Rollback: a4-rollback.sql.
--
-- admin_dashboard_summary() returns one JSON object of counts for the Dashboard page.
-- Rules it follows (02-SCREEN-SPECS.md S01):
--   * Any ACTIVE admin may call it; each section is included only when the caller holds the
--     permission for it (a section the caller may not see is simply absent).
--   * Every section is read inside its own block. If a source cannot be read, that section
--     returns {"available": false, "reason": "..."} and the others still work.
--     It never returns 0 for something it could not read.
--   * It only SELECTs. It never writes money, status or any row, and never shows a person's
--     name, email, phone or address (counts only).
--   * Columns whose existence was not proven in A0 are read through to_jsonb(row) or checked
--     in information_schema first, so a missing column gives "Not available", not an error.
--   * Tables named test_archive_* are never read.
-- Not built here (no source is known): locked bookings (H3), subscription payments needing
-- review, subscription revenue, coordinator plan revenue. The page says so.
-- ============================================================================

create or replace function public.admin_dashboard_summary()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v      jsonb := '{}'::jsonb;
  r      jsonb;
  n      bigint;
  n2     bigint;
  has_created boolean;
  has_stamp   boolean;
begin
  -- must be an active admin (and past two-step when it is required): raises 42501 otherwise
  if not exists (select 1 from public.admin_users u
                  where u.user_id = auth.uid() and u.status = 'active' and u.removed_at is null) then
    raise exception 'You do not have permission to do this.' using errcode = '42501';
  end if;
  if coalesce((select t.text_value from public.admin_settings t where t.key = 'require_mfa'), 'off') = 'on'
     and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'You do not have permission to do this.' using errcode = '42501';
  end if;

  v := jsonb_build_object('generated_at', now());

  -- ---- Needs attention -------------------------------------------------------------------
  -- pending approvals (approvals.view)
  if public.admin_has('approvals.view') then
    begin
      select count(*) into n from public.admin_approval_requests where status = 'pending' and expires_at > now();
      r := jsonb_build_object('available', true, 'count', n);
    exception when others then
      r := jsonb_build_object('available', false, 'reason', 'The approvals table could not be read.');
    end;
    v := v || jsonb_build_object('pending_approvals', r);
  end if;

  -- local bookings waiting for a coordinator (bookings.view)
  if public.admin_has('bookings.view') then
    begin
      select count(*) into n from public.local_booking_state where lt_status = 'needs_reassignment';
      r := jsonb_build_object('available', true, 'count', n);
    exception when others then
      r := jsonb_build_object('available', false, 'reason', 'Local booking state could not be read.');
    end;
    v := v || jsonb_build_object('local_needs_coordinator', r);
  end if;

  -- open disputes (disputes.view): open + under_review
  if public.admin_has('disputes.view') then
    begin
      select count(*) filter (where status = 'open'), count(*) filter (where status = 'under_review')
        into n, n2 from public.job_disputes;
      r := jsonb_build_object('available', true, 'open', n, 'under_review', n2);
    exception when others then
      r := jsonb_build_object('available', false, 'reason', 'Disputes could not be read.');
    end;
    v := v || jsonb_build_object('disputes', r);
  end if;

  -- identity checks waiting for a person (verification.view)
  if public.admin_has('verification.view') then
    begin
      select count(*) into n from public.identity_verifications where status in ('PENDING', 'REVIEW_REQUIRED');
      r := jsonb_build_object('available', true, 'count', n);
    exception when others then
      r := jsonb_build_object('available', false, 'reason', 'Identity checks could not be read.');
    end;
    v := v || jsonb_build_object('verifications_waiting', r);
  end if;

  -- stuck withdrawals (withdrawals.view): pending or processing for more than 60 minutes
  if public.admin_has('withdrawals.view') then
    begin
      select exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'withdrawals'
                        and column_name in ('updated_at', 'created_at'))
        into has_stamp;
      if not has_stamp then
        r := jsonb_build_object('available', false, 'reason', 'The withdrawals table has no date column to measure age.');
      else
        select count(*) into n from public.withdrawals w
         where w.status in ('pending', 'processing')
           and coalesce((to_jsonb(w) ->> 'updated_at')::timestamptz, (to_jsonb(w) ->> 'created_at')::timestamptz)
               < now() - interval '60 minutes';
        r := jsonb_build_object('available', true, 'count', n, 'minutes', 60);
      end if;
    exception when others then
      r := jsonb_build_object('available', false, 'reason', 'Withdrawals could not be read.');
    end;
    v := v || jsonb_build_object('stuck_withdrawals', r);
  end if;

  -- coordinator applications waiting (coordinators.applications.review)
  if public.admin_has('coordinators.applications.review') then
    begin
      select count(*) into n from public.coordinator_applications where status = 'new';
      r := jsonb_build_object('available', true, 'count', n);
    exception when others then
      r := jsonb_build_object('available', false, 'reason', 'Coordinator applications could not be read.');
    end;
    v := v || jsonb_build_object('coordinator_applications', r);
  end if;

  -- ---- People totals ---------------------------------------------------------------------
  if public.admin_has('customers.view') or public.admin_has('taskers.view') then
    begin
      select jsonb_build_object('available', true,
               'customers', count(*) filter (where role = 'customer'),
               'taskers',   count(*) filter (where role = 'tasker'),
               'other',     count(*) filter (where role is null or role not in ('customer', 'tasker')),
               'total',     count(*))
        into r from public.users;
    exception when others then
      r := jsonb_build_object('available', false, 'reason', 'Accounts could not be read.');
    end;
    v := v || jsonb_build_object('people', r);
  end if;

  if public.admin_has('local_taskers.view') then
    begin
      select jsonb_build_object('available', true,
               'published', count(*) filter (where status = 'published'),
               'ready',     count(*) filter (where status = 'ready'),
               'draft',     count(*) filter (where status = 'draft'),
               'inactive',  count(*) filter (where status = 'inactive'),
               'total',     count(*))
        into r from public.local_tasker_profiles;
    exception when others then
      r := jsonb_build_object('available', false, 'reason', 'Local Tasker profiles could not be read.');
    end;
    v := v || jsonb_build_object('local_taskers', r);
  end if;

  if public.admin_has('coordinators.view') then
    begin
      select jsonb_build_object('available', true,
               'active',      count(*) filter (where status = 'active'),
               'pending',     count(*) filter (where status = 'pending'),
               'suspended',   count(*) filter (where status = 'suspended'),
               'deactivated', count(*) filter (where status = 'deactivated'),
               'total',       count(*))
        into r from public.coordinators;
    exception when others then
      r := jsonb_build_object('available', false, 'reason', 'Coordinators could not be read.');
    end;
    v := v || jsonb_build_object('coordinators', r);
  end if;

  if public.admin_has('admin.team.view') then
    begin
      select jsonb_build_object('available', true,
               'active', count(*) filter (where status = 'active' and removed_at is null),
               'total',  count(*))
        into r from public.admin_users;
    exception when others then
      r := jsonb_build_object('available', false, 'reason', 'The admin team could not be read.');
    end;
    v := v || jsonb_build_object('admins', r);
  end if;

  -- ---- Bookings by status, last 30 days (bookings.view) ----------------------------------
  -- bookings.status has no CHECK constraint (ARCHITECTURE B4), so values are shown exactly as stored.
  if public.admin_has('bookings.view') then
    begin
      select exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'bookings' and column_name = 'created_at')
        into has_created;
      if not has_created then
        r := jsonb_build_object('available', false, 'reason', 'The bookings table has no created_at column, so a 30-day window cannot be measured.');
      else
        select jsonb_build_object('available', true, 'days', 30,
                 'total', coalesce(sum(c), 0),
                 'by_status', coalesce(jsonb_object_agg(coalesce(s, 'unknown'), c), '{}'::jsonb))
          into r
          from (select b.status as s, count(*) as c
                  from public.bookings b
                 where (to_jsonb(b) ->> 'created_at')::timestamptz >= now() - interval '30 days'
                 group by b.status) x;
      end if;
    exception when others then
      r := jsonb_build_object('available', false, 'reason', 'Bookings could not be read.');
    end;
    v := v || jsonb_build_object('bookings_30d', r);
  end if;

  -- ---- Money (transactions.view): platform fee as STORED on escrow rows, by escrow status. ----
  -- Never one total, never recomputed from a rate (ARCHITECTURE B5 item 1). Amounts are as stored
  -- (the site shows these columns in naira). Subscription and coordinator plan revenue come in A16/A18.
  if public.admin_has('transactions.view') or public.admin_has('revenue.view') then
    begin
      select jsonb_build_object('available', true,
               'by_status', coalesce(jsonb_object_agg(coalesce(s, 'unknown'), jsonb_build_object('rows', c, 'platform_fee', f)), '{}'::jsonb))
        into r
        from (select e.status as s, count(*) as c, coalesce(sum(e.platform_fee), 0) as f
                from public.escrow_payments e group by e.status) x;
    exception when others then
      r := jsonb_build_object('available', false, 'reason', 'Escrow rows could not be read.');
    end;
    v := v || jsonb_build_object('commission', r);
  end if;

  -- ---- User growth: new accounts per week, last 12 weeks (customers.view or taskers.view) --
  if public.admin_has('customers.view') or public.admin_has('taskers.view') then
    begin
      select jsonb_build_object('available', true,
               'weeks', coalesce(jsonb_agg(jsonb_build_object('week_start', w.d::date, 'count', coalesce(c.n, 0)) order by w.d), '[]'::jsonb))
        into r
        from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as w(d)
        left join (select date_trunc('week', created_at) as wk, count(*) as n
                     from public.users where created_at >= date_trunc('week', now()) - interval '11 weeks' group by 1) c
               on c.wk = w.d;
    exception when others then
      r := jsonb_build_object('available', false, 'reason', 'Account dates could not be read.');
    end;
    v := v || jsonb_build_object('growth', r);
  end if;

  -- ---- Recent activity: last 20 audit rows (audit_logs.view) -----------------------------
  -- Action name, target kind, outcome and time only (no old/new values, no reasons, no names).
  if public.admin_has('audit_logs.view') then
    begin
      select jsonb_build_object('available', true,
               'rows', coalesce(jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'target_type', a.target_type, 'outcome', a.outcome) order by a.at desc), '[]'::jsonb))
        into r from (select * from public.admin_audit_log order by at desc limit 20) a;
    exception when others then
      r := jsonb_build_object('available', false, 'reason', 'The audit log could not be read.');
    end;
    v := v || jsonb_build_object('recent_activity', r);
  end if;

  return v;
end $$;

revoke all on function public.admin_dashboard_summary()     from public, anon, authenticated;
grant execute on function public.admin_dashboard_summary()  to authenticated;
-- (admin_dashboard_summary checks the caller itself, so a signed-in non-admin gets error 42501.)

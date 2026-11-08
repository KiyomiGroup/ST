-- StreetTasker Admin Control Centre, stage A2: ROLLBACK. Removes only what a2-approvals.sql created.
-- WARNING: this deletes every approval request. Use it only before approvals are in use.
-- (Audit rows written by A2 stay in admin_audit_log: that log is append-only on purpose.)
drop trigger if exists admin_approval_requests_guard on public.admin_approval_requests;
drop function if exists public.admin_expire_approvals();
drop function if exists public.admin_consume_approval(uuid, text, text, text, jsonb, text, jsonb);
drop function if exists public.admin_cancel_approval(uuid, text);
drop function if exists public.admin_decide_approval(uuid, boolean, text);
drop function if exists public.admin_request_approval(text, text, text, jsonb, text, jsonb, text);
drop function if exists public.admin_approval_hash(text, text, text, jsonb);
drop function if exists public.admin_user_has(uuid, text);
drop function if exists public.admin_approval_guard();
drop table if exists public.admin_approval_requests;
drop table if exists public.admin_sensitive_actions;

-- Rollback for the A5e resend part: removes its three functions only. Invites, admins and audit rows are untouched.
drop function if exists public.admin_invite_setup_pending();
drop function if exists public.admin_invite_resend_record(uuid);
drop function if exists public.admin_invite_resend_check(uuid);

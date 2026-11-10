-- Rollback for stage A5e: removes the functions and the registry row. Changes no admin, no log and no login.
-- Invite requests already in the approval queue stay (they can no longer be sent); logins already created in Auth stay.
drop function if exists public.admin_invites_mine();
drop function if exists public.admin_invite_finish(uuid, uuid);
drop function if exists public.admin_invite_precheck(uuid);
drop function if exists public.admin_invite_request(text, text[], text, text);
drop function if exists public.admin_invite_auth_lookup(text);
drop function if exists public.admin_invite_target_version(text);
delete from public.admin_sensitive_actions s
 where s.action = 'admin.team.invite'
   and not exists (select 1 from public.admin_approval_requests r where r.action = s.action);

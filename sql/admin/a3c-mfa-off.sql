-- StreetTasker Admin Control Centre, stage A3c rollback and lock-out recovery:
-- switch two-step verification OFF for the admin area (admin_settings.require_mfa = 'off').
-- Authenticator apps that admins already set up stay in place; nothing is deleted. Safe to run twice.

insert into public.admin_settings (key, text_value, updated_at) values ('require_mfa', 'off', now())
  on conflict (key) do update set text_value = 'off', updated_at = now();

select 'DONE: two-step is no longer required for the admin area.' as result;

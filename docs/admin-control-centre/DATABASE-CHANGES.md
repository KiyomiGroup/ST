# Admin Control Centre: database changes (one section per stage, newest last)

All admin SQL is additive, safe to run twice, and has a rollback file. "Written" means the file exists. "Run locally" means run on a scratch Postgres with stand-ins for the Supabase auth schema. "Applied" is only ever said when the owner reports it (owner convention: no error reported = applied, never "tested").

## A1 (2026-11-07): admin identity and permissions
Files: `sql/admin/a1-admin-core.sql`, `a1-rollback.sql`, `a1-tests.sql`, `a1-bootstrap.sql`.
State: written; run locally (see `handoffs/A1.md`); **not run on Supabase**.

| New object | Kind | Notes |
|---|---|---|
| `admin_users` | table | `user_id` references `auth.users` (restrict, never cascade); status `active`/`suspended`/`removed` |
| `admin_roles`, `admin_permissions`, `admin_role_permissions`, `admin_user_roles` | tables | 6 roles, 58 permissions (includes `donations.view`; the obsolete call-back permission is not seeded); `super_admin` has no rows in `admin_role_permissions` (it gets every permission that exists) |
| `admin_audit_log` | table | append-only; triggers refuse UPDATE, DELETE, TRUNCATE |
| `admin_settings` | table | key `require_mfa` = `off` |
| `admin_has(text)`, `admin_my_access()` | functions | the only two a signed-in browser may call |
| `admin_require(text)`, `admin_guard(text,text)`, `admin_log(...)`, `admin_bootstrap_super_admin(text,text,boolean)` (third value `true` allows a coordinator login, default `false`) | functions | no browser access; for other `admin_*` functions and the SQL editor |
| 4 trigger functions, 4 triggers | | audit immutability; last Super Admin protection |

Grants: no table has a grant for `anon` or `authenticated`; row level security is on with no policy. One new sequence (`admin_audit_log_id_seq`) is revoked from the browser roles. **No existing table, function, policy, trigger or grant was changed.** `_is_support()` and `support_staff` are untouched except that the bootstrap inserts one row into `support_staff` (note `admin bootstrap (A1)`), which the rollback deletes.

Rollback: `a1-rollback.sql` (it deletes the admin audit log; use only before the admin area is in use).

## A1b (2026-11-08): release the admin login from the coordinator role
File: `sql/admin/a1b-release-coordinator.sql`. State: written; run locally; not run on Supabase.
Changes at most one existing row: `coordinators.status` of `admin@streettasker.com` to `deactivated` (an allowed, reversible value), and only when no Local Taskers are assigned to it and no Local Tasker booking is open. Otherwise it changes nothing and prints what blocks it. Existing trigger `lt_coordinators_follow_bookings` fires on a status change (its text was not seen). Guessed: "finished" bookings are status `completed` or `cancelled`.

## A2 (2026-11-08): approval infrastructure
Files: `sql/admin/a2-approvals.sql`, `a2-rollback.sql`, `a2-tests.sql`. State: written; run locally (48 checks passed); not run on Supabase.
New: tables `admin_sensitive_actions` (13 proposed launch actions), `admin_approval_requests`; functions `admin_request_approval`, `admin_decide_approval`, `admin_cancel_approval` (browser, each checks its own permission), `admin_consume_approval`, `admin_expire_approvals`, `admin_user_has`, `admin_approval_hash` (server only); trigger `admin_approval_requests_guard` (no edit, no delete, legal status moves only). No existing object changed. Rollback: `a2-rollback.sql` (deletes all approval requests).

## A3a (2026-11-08): admin frame and sign-in
No database change. The pages call only `admin_my_access()` (A1). A1b and A2 are recorded as applied per the owner's no-error convention (not tested on Supabase).

## A3b (2026-11-08): My Profile and guard
No database change. The profile page reads the caller's own `notification_preferences` row; the `js/auth.js` guard calls `admin_my_access()` only for logins with no role.

## A3c (2026-11-08): two-step verification
No schema change. Files: `sql/admin/a3c-mfa-on.sql` (sets `admin_settings.require_mfa = 'on'` only if every active admin has a verified TOTP factor in `auth.mfa_factors`; otherwise changes nothing), `a3c-mfa-off.sql` (rollback and lock-out recovery: sets it to `'off'`), `a3c-admin-report.sql` (read-only report on `admin@streettasker.com` and `kiyomigroups@gmail.com`). State: written; **not run anywhere**. Guessed: the enum values `totp` and `verified` of `auth.mfa_factors.factor_type` and `.status` (compared as text).

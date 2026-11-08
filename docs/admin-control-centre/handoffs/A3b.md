# Stage A3b: My Profile and the admin guard (2026-11-08)

1. **Objective.** The admin's own profile page, and a guard so an admin-only login is not treated as a customer on the public site.
2. **Done.** `admin/profile.html` + `admin/js/admin-profile.js`; guard in `js/auth.js`; menu item "My profile" switched on. Tested in a headless browser against a **fake Supabase** (not the real one): profile at 390, 820, 1280px (no sideways scroll, no script errors); short password and mismatch refused on the page; a valid change calls `updateUser` with the password only and clears the fields; "all devices" calls sign-out with scope `global`; notification read failure shows "Not available"; a non-admin never sees the profile. Guard cases on `requireAuth` and `requireRole`: customer (role in users table or in metadata) unchanged; admin with no role sent to `admin/index.html`; admin who also has a customer role left alone; login with no role and not an admin unchanged. **Not exercised:** the third call site (`syncNavbarAuthState`, same helper), the real password change, the real "all devices" sign-out.
3. **Files inspected.** `js/auth.js` (guard sites, `_turnAwayCoordinator`), `sql/notification-preferences.sql`, A3a files.
4. **Files created.** `admin/profile.html`, `admin/js/admin-profile.js`.
5. **Files modified.** `js/auth.js` (helper `_sendAdminToAdminArea` and three one-line calls, each only when the login has NO role), `admin/js/admin-shell.js` (`built: true` for My profile), `css/admin.css` (detail rows and small forms), `DESIGN-SYSTEM.md` 4.17, docs.
6. **Database changes.** None.
7. **RLS and grants.** No change. The page reads only the caller's own `notification_preferences` row (policy "own prefs read" in `sql/notification-preferences.sql`; whether it exists live was not checked, the page shows "Not available" if the read fails).
8. **Decisions made.** (a) The guard never signs anyone out: it redirects an active admin with no customer or Tasker role to `admin/index.html`. This makes the owner question about `admin@streettasker.com` harmless: that login has a `public.users` row, so the guard leaves it alone. (b) The guard only asks the database when the login has no role at all, so normal customers pay nothing. (c) Preferences are read only, because admin alerts do not exist and `set_my_notification_prefs` was not confirmed live. (d) Last active comes from the sign-in time of the session, not `admin_users.last_seen_at` (no function reads it). (e) New password minimum is 12 characters, checked on the page only; Supabase's own rules still apply. (f) Spec items not built: change-email, reveal of MFA factors (A3c).
9. **Tests.** Item 2. Design check: still the same 22 lines as on the uploaded repo (older files and 6 root pages); no admin file and not `js/auth.js` is listed.
10. **Security notes.** Sign-out on this page ends the shared site session on the device. Password change relies on Supabase Auth. The guard is a convenience; every admin function still checks on the server.
11. **Backward compatibility.** `js/auth.js` behaves as before for every login that has a role. Root-level `auth.js` is a dead copy and was not edited.
12. **Outstanding issues.** Real sign-in and real password change untried. A second Super Admin still missing (D-A10). A1b result unknown.
13. **Config the owner must set.** None.
14. **NEXT STAGE.** **A3c**: `admin/help.html` (static, spec S27) and TOTP two-step set-up and challenge (Supabase Auth MFA) so `admin_settings.require_mfa` can be switched on safely; flip `built: true` for Help; update the profile's two-step line.
15. **What you do now.**
   1. Copy the files from `admin-A3b.zip` into the repo and let Vercel deploy.
   2. Open `/admin/profile.html` while signed in as the admin and tell me what you see. Do not change your password just to test unless you want to.
   3. Open any customer page (for example `home-feed.html`) as `admin@streettasker.com`; it should behave as before. Report anything odd.
   4. Say "go" for A3c.

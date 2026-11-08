# StreetTasker Admin Control Centre: handoff (START HERE for admin work)

Other handoffs in this repo are separate projects: `HANDOFF-README.md` is Didit identity verification, `SUBSCRIPTION-HANDOFF.md` is the subscription overhaul, `docs/coordinator-onboarding/` is coordinator onboarding. Do not mix them. This file is the admin project only.

Work is split into small stages so no session runs out of room. **Do ONE stage per session, then stop and wait for the owner's "go".**

## Read in this order
1. This file.
2. `docs/admin-control-centre/00-PLAN.md`: architecture, database contract, approvals, **the stage table**.
3. `docs/admin-control-centre/01-WHAT-NEEDS-ADMIN.md`: what the real site needs from an admin, with file evidence, and where the owner's ChatGPT brief differs from the real repo.
4. `docs/admin-control-centre/02-SCREEN-SPECS.md`: every screen, its data, actions, permissions and layout.
5. `docs/admin-control-centre/03-OWNER-DECISIONS.md`: open decisions with defaults.
6. The owner's master brief, saved as `docs/admin-control-centre/00-BRIEF.md` (business requirement; the repo wins where they disagree).
7. The newest file in `docs/admin-control-centre/handoffs/` (now `A3a.md`), and `ARCHITECTURE.md` (Parts B and C are the real database and the risks) and `IMPLEMENTATION-STATUS.md`.
8. `AGENTS.md`, `CLAUDE.md`, `DESIGN-SYSTEM.md` before any page or style work. Then `css/tokens.css`.

## CURRENT STATE (2026-11-08, after A3a)
A0 done. A1 applied by the owner (bootstrap returned DONE for `admin@streettasker.com`; not tested beyond that). A1b and A2 SQL: the owner sent new files and reported no error, so they are recorded **applied per the owner's no-error convention, not tested** (`handoffs/A2.md` item 18 asked her to run them and report). **A3a is written (2026-11-08): the first admin pages exist** (`admin/login.html`, `admin/index.html`, `css/admin.css`, `admin/js/*`), plus `/admin` security headers and `Disallow: /admin/`. They were tested in a headless browser against a **fake Supabase only**; the real sign-in has not been tried. `_is_support()` is untouched. `js/auth.js` is untouched (the guard is A3b). Site snapshot of 2026-11-08 01:07 is in `ARCHITECTURE.md` Part D.
Key facts: admin tables and functions are in `DATABASE-CHANGES.md`. The only admin is `admin@streettasker.com`, also the owner's coordinator login and it has a `public.users` row (she wants it admin-only; the coordinator release is blocked while it looks after Local Taskers); rule R-SELF applies. Only one Super Admin exists, so approvals cannot be decided until a second one is added (D-A10). No reference screens exist: follow `DESIGN-SYSTEM.md` (new 4.17 Admin shell) and the site style.
**Known, not caused by admin work:** `node tools/check-design-system.js` fails on the repo as uploaded (violations in older files and 6 root pages without the page shell; identical before and after A3a; no admin file is listed). Do not edit the baseline files to hide it; it needs the owner's decision.
**Security alert (not an admin stage):** `ARCHITECTURE.md` Part C item 6 (exposed service-role key and two secrets). Never copy a secret into a file or message. Rotation is stage S1, only on the owner's go.

## NEXT STAGE: **A3b** (My Profile and the admin guard in `js/auth.js`); then **A3c** (Help, two-step verification)
A3 was split because it was too large (see `handoffs/A3a.md`). First read the owner's report of the real sign-in (A3a item 15) and fix any failure before starting.
- **A3b writes:** `admin/profile.html` + `admin/js/admin-profile.js` (name, email, role names, last active, change password, sign out of this device and of all devices; admin alert preferences from the real `notification_preferences` table pattern in `sql/notification-preferences.sql`); the guard in `js/auth.js` (admin login on a customer or Tasker page is signed out and sent to `admin/login.html`, modelled on `_turnAwayCoordinator`; **ask the owner first** about `admin@streettasker.com` having a customer row, because a guard would sign her out of the customer site); flip `built: true` for My profile in the `NAV` array of `admin/js/admin-shell.js`. Needs a small SQL file only if `admin_users.last_seen_at` or the preference read needs a function (then also rollback and tests).
- **A3c writes:** `admin/help.html` (static how-to notes, escalation contact, link to these docs; spec S27) and TOTP two-step set-up and challenge (Supabase Auth MFA) so `admin_settings.require_mfa` can be turned on without locking the owner out.

## Owner rules (carry into every stage)
- Uses ONLY the Supabase SQL editor and dashboard function deploys. No console, curl or terminal steps. Leave non-compulsory steps out. Ask only for SQL-editor queries with no placeholders (get any needed value, such as an email address, in chat first and write it into the statement).
- Everything goes straight to production. No staging. All SQL additive, safe to run twice, with a rollback file.
- Never claim a test passed, SQL applied, a deploy done or a payment worked unless it really happened. Say "not run".
- Owner convention (set 2026-11-04): if she sends new files and reports no error, the previous stage is recorded as applied or deployed ("per the owner's no-error convention"). It never means "tested". If she reports an error, fix that first.
- No secrets in chat or in the browser. Never ask her to paste a Paystack, Didit or service-role key.
- Deliver `admin-<ID>.zip`: the changed site files in repo layout, plus the whole `docs/admin-control-centre/` folder, plus this file (standing preference: every zip carries everything the next AI needs; no unchanged site pages).
- All pages follow `DESIGN-SYSTEM.md` and `css/tokens.css`; run `node tools/check-design-system.js`; do not edit `tools/design-baseline.json` to make it pass.
- Edit only `js/db.js` and `js/auth.js`, never the root-level copies (dead copies, per the subscription handoff).

## Hard boundaries (from the owner's brief and earlier owner rules)
1. Admin never moves money, never calls Paystack, never changes a wallet, escrow row or payment status. "Record refund" and "Record adjustment" only record.
2. Admin never sets or lowers a Local Tasker's price and never bypasses a worker's agreement to a job.
3. Admin never writes a verified flag. PRO and PREMIUM are membership labels, never identity.
4. Subscription payments are not job escrow and never go through the dispute flow. Coordinator tiers are not subscriptions. Local Taskers are not subscribers.
5. Rule R-C: no saved cards, no automatic renewal. Rule R-W: no top-ups, wallet cannot pay for a plan.
6. No history is deleted. Deactivation preserves records. Audit logs are append-only.
7. Do not touch `verify*`, `didit-*`, `idv_*`, `task_applications`, or the payment Edge Functions.
8. Hiding a menu item is not security. Every `admin_*` function checks permission on the server.

## Ready-to-paste start message for each next session
> Continue the StreetTasker Admin Control Centre. The zips are attached (latest `admin-*.zip` plus the project). Read `ADMIN-HANDOFF.md`, then `docs/admin-control-centre/00-PLAN.md`, then the newest file in `docs/admin-control-centre/handoffs/`. Do the stage named under NEXT STAGE only (it may be a part such as A3b). Follow the owner rules, finish with the changed-files zip and my "What you do now" steps, then stop.

## Stage log
| Stage | State |
|---|---|
| Audit and plan | Done 2026-11-07 (this pack) |
| A0 | Done 2026-11-07 (part A repository, part B live database from the owner's results; 15 of 17 blocks). `a0-followup.sql` is optional and not run. |
| S1 (secret rotation) | Not started. Owner decides. |
| A1 | Written 2026-11-07; run on a local scratch Postgres (30 checks passed); not applied on Supabase until the owner reports it. |
| A1b, A2 | Recorded applied per the owner's no-error convention (2026-11-08); not tested on Supabase. |
| A3a (frame, sign-in, headers, design 4.17) | Written 2026-11-08; browser-tested against a fake Supabase only; not deployed. |
| A3b, A3c | Not started. A3b is next. |
| A4 to A28 | Not started. See `docs/admin-control-centre/00-PLAN.md` section 6. |

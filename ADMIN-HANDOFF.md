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
7. The newest file in `docs/admin-control-centre/handoffs/` (now `A13.md`), and `ARCHITECTURE.md` (Parts B and C are the real database and the risks) and `IMPLEMENTATION-STATUS.md`.
8. `AGENTS.md`, `CLAUDE.md`, `DESIGN-SYSTEM.md` before any page or style work. Then `css/tokens.css`.

## CURRENT STATE (2026-11-08, after A13)
**A13 (Disputes) is written:** `admin/disputes.html`, `admin/js/admin-disputes.js`, Disputes styles in `css/admin.css`, a "Disputes" item (new Marketplace group, needs `disputes.manage`) in `admin/js/admin-shell.js`, and `sql/admin/a13-disputes.sql` (+ `a13-rollback.sql`). The SQL extends `_is_support()` (wider only, guarded, old body saved in `admin_function_backups`) and adds five `admin_dispute_*` functions that check the admin permission, call the existing `support_*` function and write the admin activity log. **Tested on a scratch Postgres 16 with stand-ins (33 checks) and in a headless browser against a fake Supabase (39 checks); `a13-disputes.sql` was not run on Supabase; the real `support_*` function bodies were never seen** (the repo has no SQL for them), so argument types are passed as text literals. `support.html` is untouched and still works. Test files: `docs/admin-control-centre/local-tests/` (a scratch Postgres is available in the build environment: `/usr/lib/postgresql/16/bin`, run `initdb` as a non-root user).
**Owner reported (2026-11-08):** `kiyomigroups@gmail.com` **is a Super Admin** (D-A10 answered; not checked in the database). Both admins use an authenticator app and two-step is required (A3c). She reported no error for A4 and A6, so both are recorded applied per the no-error convention (not tested on Supabase; I loaded and called both functions on the scratch database: no error, but real column guesses are unproven). Still unreported: `a3c-admin-report.sql` output, whether `/docs/admin-control-centre/ARCHITECTURE.md` loads publicly, what the Dashboard and Activity log showed. `admin@streettasker.com` is still also a customer row and the coordinator login (owner wants admin-only).
Key facts: admin tables and functions are in `DATABASE-CHANGES.md`. Rule R-SELF applies. No reference screens exist: follow `DESIGN-SYSTEM.md` (4.17 Admin shell) and the site style.
**Not built in A13 (reasons in `handoffs/A13.md`):** separate Local Tasker and coordinator complaint kinds, the extra categories, an escalation flag. **Known side effect:** an admin with `disputes.manage` now also passes `is_local_tasker_admin()` (the Local Tasker admin reads and `admin_reassign_local_tasker`).
**Known, not caused by admin work:** `node tools/check-design-system.js` fails on the repo as uploaded (older files and root pages without the page shell; no admin file is listed). Do not edit the baseline to hide it.
**Security alert (not an admin stage):** `ARCHITECTURE.md` Part C item 6 (exposed service-role key and two secrets). Never copy a secret into a file or message. Rotation (S1): the owner will do it herself at the end of the admin stages; do not ask her about it.

## NEXT STAGE: **A9** (Coordinators and applications), per the plan's recommended order
Plan: `00-PLAN.md` A9 row, `02-SCREEN-SPECS.md` coordinators screen. **First**, replace the check of `admin_reassign_local_tasker` with `admin_guard('coordinators.assign', ...)` (`ARCHITECTURE.md` Part D item 3; its source is `sql/coordinator-onboarding/f6-admin-reassign.sql` in the main project), because A13 widened `_is_support()`. Run `a0-followup.sql` F1 and F3 first if she has not (ask only for results). Read the owner's report on A13 (`handoffs/A13.md` item 13) and fix any failure before starting. Do A5 (staff accounts) only if she asks, and only after that replacement exists. Export on the Activity log: A15.

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
| A3b (profile, `js/auth.js` guard) | Written 2026-11-08; fake-Supabase browser tests only; not deployed. |
| A3c (Help, two-step, `a3c-*.sql`) | Written 2026-11-08; fake-Supabase browser tests only; SQL not run; not deployed. |
| A4 (Dashboard, `a4-*.sql`) | Written 2026-11-08; fake-Supabase browser tests only; SQL not run; not deployed. |
| A6 (Activity log, `a6-*.sql`) | Written 2026-11-08; fake-Supabase browser tests only; SQL not run; not deployed. |
| A13 (Disputes, `a13-*.sql`) | Written 2026-11-08; scratch-Postgres SQL tests (33) and fake-Supabase browser tests (39); SQL not run on Supabase; not deployed. A4 and A6 recorded applied per the no-error convention. |
| A5, A7 to A12, A14 to A28 | Not started. See `docs/admin-control-centre/00-PLAN.md` section 6. |

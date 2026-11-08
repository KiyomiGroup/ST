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
7. The newest file in `docs/admin-control-centre/handoffs/` (now `A6.md`), and `ARCHITECTURE.md` (Parts B and C are the real database and the risks) and `IMPLEMENTATION-STATUS.md`.
8. `AGENTS.md`, `CLAUDE.md`, `DESIGN-SYSTEM.md` before any page or style work. Then `css/tokens.css`.

## CURRENT STATE (2026-11-08, after A6)
**A6 (Activity log reader) is written:** `admin/audit.html`, `admin/js/admin-audit.js`, activity-log classes in `css/admin.css`, the "Activity log" menu item (System group, needs `audit_logs.view`) in `admin/js/admin-shell.js`, and `sql/admin/a6-activity-feed.sql` (+ `a6-rollback.sql`). Tested in a headless browser against a **fake Supabase only** (390 and 1280px; filters, paging, detail rows, empty, function missing, no permission; no page errors). **`a6-activity-feed.sql` was not run anywhere** (no Postgres in the build environment): the owner must run it before the page shows rows. The older logs' column names are guessed (see `DATABASE-CHANGES.md` A6). A6 also fixed a label bug in the A4 dashboard feed (action names contain dots).
**Owner reported (2026-11-08):** both admins (`admin@streettasker.com`, `kiyomigroups@gmail.com`) have an authenticator app, and `a3c-mfa-on.sql` printed DONE: **two-step is now required** at admin sign-in. She did not report A4 results (whether `a4-dashboard.sql` was run and what the Dashboard showed), the `a3c-admin-report.sql` output, or whether `/docs/admin-control-centre/ARCHITECTURE.md` loads publicly. Earlier: A0 done; A1 applied; A1b and A2 recorded applied per the no-error convention (not tested); A3a, A3b confirmed live; A3c deployed and now confirmed working for two-step. `admin@streettasker.com` is still also a customer row and the coordinator login (owner wants admin-only; `a3c-admin-report.sql` first). Approvals need a second active **Super Admin**: check whether `kiyomigroups@gmail.com` holds that role (D-A10).
Key facts: admin tables and functions are in `DATABASE-CHANGES.md`. Rule R-SELF applies. No reference screens exist: follow `DESIGN-SYSTEM.md` (4.17 Admin shell) and the site style.
**Known, not caused by admin work:** `node tools/check-design-system.js` fails on the repo as uploaded (older files and root pages without the page shell; no admin file is listed). Do not edit the baseline to hide it.
**Security alert (not an admin stage):** `ARCHITECTURE.md` Part C item 6 (exposed service-role key and two secrets). Never copy a secret into a file or message. Rotation (S1): the owner will do it herself at the end of the admin stages; do not ask her about it.

## NEXT STAGE: **A13** (Disputes and Complaints), per the plan's recommended order (A5 first only if the owner asks for staff accounts)
Plan: `00-PLAN.md` A13 row, `02-SCREEN-SPECS.md` S12. Read `ARCHITECTURE.md` B2 and B3 (`support_*` functions, `_is_support()`, `support_staff`) before writing anything: A13 extends `_is_support()` and must keep `support.html` working. First read the owner's report on A4 and A6 (`handoffs/A6.md` item 12) and fix any failure. Export on the Activity log (spec S25 "export") is not built: it needs the `export.run` flow and a logged export; do it with the first export stage (A15).

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
| A5, A7 to A28 | Not started. See `docs/admin-control-centre/00-PLAN.md` section 6. |

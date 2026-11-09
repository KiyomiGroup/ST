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
7. The newest file in `docs/admin-control-centre/handoffs/` (now `A10.md`), and `ARCHITECTURE.md` (Parts B and C are the real database and the risks) and `IMPLEMENTATION-STATUS.md`.
8. `AGENTS.md`, `CLAUDE.md`, `DESIGN-SYSTEM.md` before any page or style work. Then `css/tokens.css`.

## CURRENT STATE (2026-11-09, after A10)
**A10 (Local Taskers) is written:** `admin/local-taskers.html`, `admin/js/admin-local-taskers.js`, a "People > Local Taskers" menu item, and `sql/admin/a10-local-taskers.sql` (+ `a10-rollback.sql`, and the read-only `a10-check.sql`). The SQL adds four functions: `admin_local_tasker_list` and `_detail` (`local_taskers.view`), `admin_local_tasker_unpublish` and `_deactivate` (`local_taskers.manage`, reason, R-SELF, logged). Placing or moving a worker reuses A9's `admin_coordinator_assign_local_tasker` (no second assign function). **Tested on a scratch Postgres 16 with stand-ins (87 checks) and in a headless browser against a fake Supabase (44 checks); `a10-local-taskers.sql` was not run on Supabase.** **Guesses:** the real `unpublish_local_tasker` body was never seen (the admin unpublish sets status `ready` and `taskers.available = false`), "open booking" = status not completed or cancelled, and the payout tables' link to the worker is matched by key name `tasker_user_id` (details: `handoffs/A10.md` item 10).
**Recorded (2026-11-09):** the owner sent the A9 project files and reported no error, so **A9 is recorded applied per the no-error convention** (not tested on Supabase). A4, A6 and A13 were already recorded that way. `kiyomigroups@gmail.com` is a Super Admin; both admins use an authenticator app and two-step is required (A3c). Still unreported: the `a9-coordinators.sql` last line, what Coordinators, Dashboard, Activity log and Disputes showed, `a3c-admin-report.sql` output, whether `/docs/admin-control-centre/ARCHITECTURE.md` loads publicly, `a0-followup.sql` F1 and F3. `admin@streettasker.com` is still also a customer row and the coordinator login (A1b may or may not have deactivated the coordinator row; she has not said).
Key facts: admin tables and functions are in `DATABASE-CHANGES.md`. Rule R-SELF applies. No reference screens exist: follow `DESIGN-SYSTEM.md` (4.17 Admin shell) and the site style. Test files for SQL and pages are in `docs/admin-control-centre/local-tests/` (a scratch Postgres is available in the build environment: `/usr/lib/postgresql/16/bin`; `initdb` as a non-root user, e.g. `useradd pgtest`, data under `/var/tmp`, `pg_ctl -o '-p 5544 -k /var/tmp'`; `run-a9.sh` and `run-a10.sh` show the load order; browser tests need Playwright and are in `a9-browser-test.js` and `a10-browser-test.js`, run as `node <file> <repo root>`).
**Not built in A10 (reasons in `handoffs/A10.md` item 9):** reactivate a worker, reveal of the phone, open-booking and pending-request counts, any edit of worker data.
**Known, not caused by admin work:** `node tools/check-design-system.js` fails on the repo as uploaded (older root pages without the page shell; no admin file is listed). Do not edit the baseline to hide it.
**Security alert (not an admin stage):** `ARCHITECTURE.md` Part C item 6 (exposed service-role key and two secrets). Never copy a secret into a file or message. Rotation (S1): the owner will do it herself at the end of the admin stages; do not ask her about it.

## NEXT STAGE: **A12a** (bookings, tasks and local booking operations, read-only queues first), per the plan's recommended order
Plan: `00-PLAN.md` A12 row (it says to split A12a read-only queues and A12b the H1, H3 and H4 hooks), `02-SCREEN-SPECS.md` bookings screens, `ARCHITECTURE.md` B4. It needs the real `bookings.status` values: the owner runs `sql/admin/a10-check.sql` (read only, one result) in A10's "What you do now"; if she has not sent it, ask for that one file's result in chat before writing status filters. Read the owner's report on A10 (`handoffs/A10.md` item 18) and fix any failure first. If she sent the `a10-check.sql` result, compare the real `unpublish_local_tasker` with `admin_local_tasker_unpublish` and fix the admin function if it differs (CREATE OR REPLACE in a new `a10b` SQL file; do not edit `a10-local-taskers.sql` after it was run). If she sent `a0-followup.sql` F1 or F3 results, record them in `ARCHITECTURE.md` and check the A9 wrappers. A5 (staff accounts) may be done instead if she asks. Export on the Activity log: A15.

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
| A13 (Disputes, `a13-*.sql`) | Written 2026-11-08; scratch-Postgres SQL tests (33) and fake-Supabase browser tests (39). Recorded applied per the no-error convention (2026-11-09); not tested on Supabase. A4 and A6 likewise. |
| A9 (Coordinators and applications, `a9-*.sql`) | Written 2026-11-09; scratch-Postgres SQL tests (83) and fake-Supabase browser tests (45); SQL not run on Supabase; not deployed. Replaces the check of `admin_reassign_local_tasker`. |
| A10 (Local Taskers, `a10-*.sql`) | Written 2026-11-09; scratch-Postgres SQL tests (87) and fake-Supabase browser tests (44); SQL not run on Supabase; not deployed. Adds four `admin_local_tasker_*` functions; reuses A9's assign function. A9 recorded applied per the no-error convention. |
| A5, A7, A8, A11, A12, A14 to A28 | Not started. See `docs/admin-control-centre/00-PLAN.md` section 6. |

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
7. The newest file in `docs/admin-control-centre/handoffs/` (now `A5c.md`), and `ARCHITECTURE.md` (Parts B and C are the real database and the risks) and `IMPLEMENTATION-STATUS.md`.
8. `AGENTS.md`, `CLAUDE.md`, `DESIGN-SYSTEM.md` before any page or style work. Then `css/tokens.css`.

## CURRENT STATE (2026-11-09, after A5c)
**A5c (Admin team and Roles, read only) is written**: `sql/admin/a5c-team-read.sql` (+ rollback; two read functions `admin_team_list`, `admin_role_directory`), `admin/team.html`, `admin/roles.html`, `admin/js/admin-team.js`, `admin/js/admin-roles.js`, two menu items in `admin-shell.js`. **Pages run against a fake Supabase (41 checks, `local-tests/a5c-browser-test.py`). The SQL was NOT run anywhere (no Postgres in this build environment) and nothing is on Supabase or deployed.** **Owner's `a3c-admin-report.sql` output (2026-11-09): `admin@streettasker.com` and `kiyomigroups@gmail.com` are both active Super Admins with a verified authenticator app, so a second active Super Admin exists (D-A10 met; two real admins can now decide approvals).** Both logins are still also customer `users` rows (0 bookings, empty wallets); `admin@streettasker.com`'s coordinator row is `deactivated`. The owner wants `admin@streettasker.com` not to stay a customer (separate small stage, not done). Read `handoffs/A5c.md`. **NEXT: A5d** (team and role changes through approvals), or A7, A8, A11. The A5b paragraph below is kept for history.

## PREVIOUS STATE (2026-11-09, after A5b)
**A5b (decide and cancel) is written**: only `admin/approvals.html` (intro text) and `admin/js/admin-approvals.js` changed; **no new SQL** (it calls the A2 functions `admin_decide_approval` and `admin_cancel_approval`). A Super Admin who is not the requester gets Approve and Reject (reason of 10+ characters, two presses, the second press shows exactly what will be approved); the requester and Super Admins get Cancel request (reason optional); the requester's own request shows "You cannot approve or reject your own request" with disabled buttons; read-only admins see no buttons. Approving only marks the request: nothing is carried out. **Page run against a fake Supabase (56 checks, `local-tests/a5b-browser-test.py`, which replaces the A5a test). The A2 SQL itself has not been reported as tested on Supabase (`a2-tests.sql` result missing), and no second active Super Admin has been verified.** `a5a-approvals-reader.sql` printed DONE on Supabase. Read `handoffs/A5b.md`. The A5a paragraph below is kept for history.

## PREVIOUS STATE (2026-11-09, after A5a)
**A5a (approvals reader) is written**: `sql/admin/a5a-approvals-reader.sql` (+ rollback), `admin/approvals.html`, `admin/js/admin-approvals.js`, menu item "Pending approvals" switched on in `admin-shell.js`. Read only: it lists requests in four tabs (Pending, Approved, Rejected, Expired or cancelled), shows a current-versus-proposed table, history and time left, and has NO Approve, Reject or Cancel button (that is A5b). **Page run against a fake Supabase (36 checks, `local-tests/a5a-browser-test.py`); the SQL was NOT run anywhere (this build environment had no Postgres) and nothing is on Supabase or deployed.** The owner ran `a10-local-taskers.sql`, `a12a-bookings.sql` and `a12b-local-booking-ops.sql` on Supabase on 2026-11-09 and each printed DONE; the Problems queue loads (empty). A5 is split in five (`00-PLAN.md`, row "A5 split"). Read `handoffs/A5a.md`. The A12b paragraph below is kept for history.

## PREVIOUS STATE (2026-11-09, after A12b)
**A12b (Local booking operations) is written** from the REAL function sources the owner pasted: `sql/admin/a12b-local-booking-ops.sql` (+ rollback), Bookings page now has a Problems queue tab, a coordinator-change panel (`local_bookings.reassign`) and an unlock panel (`local_bookings.unlock`). **SQL run on a scratch Postgres (65 checks pass); page run against a fake Supabase (54 checks); NOT run on Supabase, NOT deployed.** Running the SQL found a bug that also affects A10 and A12a (`v_failed || 'x'` needs `::text`): fixed in both files; **the owner must re-run `a10-local-taskers.sql` and `a12a-bookings.sql` before `a12b-local-booking-ops.sql`** (`handoffs/A12b.md` items 4 and 7). Read `handoffs/A12b.md`. The A12a paragraph below is kept for history.

### Earlier state (after A12a)
**A12a (Bookings, Local bookings and Tasks, read only) is written:** `admin/bookings.html`, `admin/js/admin-bookings.js`, a "Marketplace > Bookings and Tasks" menu item, and `sql/admin/a12a-bookings.sql` (+ `a12a-rollback.sql`). The SQL adds three read-only functions: `admin_booking_list`, `admin_booking_detail`, `admin_task_list` (all `bookings.view`). **The page was tested in a headless browser against a fake Supabase (32 checks). The SQL was NOT run anywhere (no Postgres in the build environment this time) and not on Supabase.** Guesses (read `handoffs/A12a.md` item 11): the link of `job_events`, Local booking events and `escrow_payments` to the booking is the key `booking_id`; an empty Timeline or Payment on a booking that has events means the key name is wrong.
**Recorded (2026-11-09):** the owner reported `DONE: A10 installed` (a real report: A10 SQL applied; the Local Taskers page result is unreported) and sent the `a10-check.sql` result. Real `bookings.status` values: `pending` 5, `confirmed` 4, `completed` 11, `cancelled` 3 (in `ARCHITECTURE.md`). **A10 was checked against the real `unpublish_local_tasker`: it writes the same things (status `ready`, `taskers.available = false`, a Local Tasker audit row), so no `a10b` fix is needed** (`handoffs/A12a.md` item 4). A4, A6, A9 and A13 are recorded applied per the no-error convention. `kiyomigroups@gmail.com` is a Super Admin; both admins use an authenticator app and two-step is required (A3c). Still unreported: the `a9-coordinators.sql` last line, what Coordinators, Dashboard, Activity log, Disputes and Local Taskers showed, `a3c-admin-report.sql` output, whether `/docs/admin-control-centre/ARCHITECTURE.md` loads publicly, `a0-followup.sql` F1 and F3. `admin@streettasker.com` is still also a customer row and the coordinator login.
Key facts: admin tables and functions are in `DATABASE-CHANGES.md`. Rule R-SELF applies. No reference screens exist: follow `DESIGN-SYSTEM.md` (4.17 Admin shell) and the site style. Test files for SQL and pages are in `docs/admin-control-centre/local-tests/` (a scratch Postgres was available in earlier build environments at `/usr/lib/postgresql/16/bin` but **not in the A12a one**: check first; `run-a9.sh` and `run-a10.sh` show the load order; browser tests need Playwright: `node <file> <repo root>`). **If Postgres is available next time, write and run an `a12a` SQL test first**: A12a's SQL has never been executed.
**Not built in A12a:** any write (reassign, unlock, exceptions: A12b), a task detail, offers and applications (`task_applications` is on the hard-boundary list), the street address, phone, notes and completion code (never shown).
**Known, not caused by admin work:** `node tools/check-design-system.js` fails on the repo as uploaded (older root pages without the page shell; no admin file is listed). Do not edit the baseline to hide it.
**Security alert (not an admin stage):** `ARCHITECTURE.md` Part C item 6 (exposed service-role key and two secrets). Never copy a secret into a file or message. Rotation (S1): the owner will do it herself at the end of the admin stages; do not ask her about it.

## NEXT STAGE: owner's choice (default **A5d**: team and role changes through approvals; A5e is the `admin-invite` Edge Function)
Read the owner's report on A12b first: did the three SQL files print DONE, what do the Bookings tabs and the Problems queue show, does a booking's Timeline show anything (`job_events.booking_id` is still a guess). Fix any failure first. Other candidates: A7 customers, A8 regular Taskers, A11 verification (`00-PLAN.md` stage table). **Build environment tip:** a scratch Postgres works if you create a non-root user (`useradd pgtest`), `initdb` as that user in `/var/tmp/pgdata` and start it with `-p 5544 -k /var/tmp`; `local-tests/run-a12b.sh <repo root>` loads every admin SQL file in order and runs the A12a/A12b tests; Playwright is preinstalled for `node local-tests/a12b-browser-test.js <repo root>`. Run SQL tests for every stage: they have found real bugs.

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
| A12a (Bookings, Local bookings, Tasks, read only; `a12a-*.sql`) | Written 2026-11-09; fake-Supabase browser tests (32); **SQL never run (no Postgres in the build environment)**; not deployed. A10 SQL reported applied (DONE) the same day. |
| A12b (Local booking operations; `a12b-*.sql`) | Written 2026-11-09 from the owner's pasted real function sources; scratch-Postgres SQL tests (65), fake-Supabase browser tests (54); SQL not run on Supabase; not deployed. Also fixed an array-append bug in A10 and A12a SQL (re-run both). A12a recorded applied per the no-error convention. |
| A5c (Admin team and Roles, read only; `a5c-*.sql`) | Written 2026-11-09; fake-Supabase browser tests (41); SQL not run anywhere; not deployed. |
| A5d, A5e, A7, A8, A11, A14 to A28 | Not started. See `docs/admin-control-centre/00-PLAN.md` section 6. |

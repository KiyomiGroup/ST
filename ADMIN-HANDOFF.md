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
7. The newest file in `docs/admin-control-centre/handoffs/` (now `A4.md`), and `ARCHITECTURE.md` (Parts B and C are the real database and the risks) and `IMPLEMENTATION-STATUS.md`.
8. `AGENTS.md`, `CLAUDE.md`, `DESIGN-SYSTEM.md` before any page or style work. Then `css/tokens.css`.

## CURRENT STATE (2026-11-08, after A4)
**A4 (Dashboard, read only) is written:** `admin/dashboard.html`, `admin/js/admin-dashboard.js`, new classes in `css/admin.css`, the Dashboard menu item switched on in `admin/js/admin-shell.js`, and `sql/admin/a4-dashboard.sql` (+ `a4-rollback.sql`). Tested in a headless browser against a **fake Supabase only** (full data, a limited role, function missing, permission denied; 390, 820, 1280px; no page errors). **`a4-dashboard.sql` was not run anywhere** (no Postgres in the build environment): it must be run in the Supabase SQL editor before the page shows numbers (until then the page says the function is not on the server).
Earlier state still stands: A0 done. A1 applied by the owner (bootstrap DONE for `admin@streettasker.com`). A1b and A2 recorded applied per the owner's no-error convention (not tested). A3a, A3b confirmed live (real sign-in, Overview and My profile open). A3c was uploaded to the site (the repo snapshot of 2026-11-08 11:38 contains it); the owner has **not reported** results of its three SQL files, the authenticator set-up, the second admin `kiyomigroups@gmail.com`, or whether `streettasker.com/docs/admin-control-centre/ARCHITECTURE.md` loads. These stay open (see `handoffs/A3c.md` item 15 and `handoffs/A4.md`). `admin@streettasker.com` is still also a customer row and the coordinator login; the owner wants it admin-only (`a3c-admin-report.sql` first). Only one Super Admin may exist until a second is confirmed, so approvals cannot be decided (D-A10).
Key facts: admin tables and functions are in `DATABASE-CHANGES.md`. Rule R-SELF applies. No reference screens exist: follow `DESIGN-SYSTEM.md` (4.17 Admin shell) and the site style.
**Known, not caused by admin work:** `node tools/check-design-system.js` fails on the repo as uploaded (older files and 6 root pages without the page shell; no admin file is listed). Do not edit the baseline to hide it.
**Security alert (not an admin stage):** `ARCHITECTURE.md` Part C item 6 (exposed service-role key and two secrets). Never copy a secret into a file or message. Rotation is stage S1, only on the owner's go (the owner said she will do S1 herself at the end of the admin stages: do not ask her about it).

## NEXT STAGE: **A5** (Approvals screens, Admin Team, Roles) or **A6** (Audit reader)
Plan: `00-PLAN.md` rows A5 and A6; the recommended order lists A6 next, then A13, A9, A10, A12. The owner said "do the next stage" without choosing, so pick the one the plan lists first (A6) unless she names another. First read her report on A3c and A4 (`handoffs/A4.md` item 15) and fix any failure. Dashboard follow-ups that need later stages: locked bookings (H3), subscription payments needing review, subscription / coordinator plan / other income boxes (A16, A18), and card links to pages as they are built (the card links only to pages marked `built` in the shell).

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
| A5 to A28 | Not started. See `docs/admin-control-centre/00-PLAN.md` section 6. |

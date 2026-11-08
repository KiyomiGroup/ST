# Admin Control Centre: implementation status

Updated 2026-11-08 (stage A13 written; owner reported A3c two-step done, and that `kiyomigroups@gmail.com` is a Super Admin). The owner reported the real admin sign-in worked and Overview and My profile open (A3a and A3b confirmed live). Never describe planned work as done. "Not run" means not run.

| Stage | State | Evidence |
|---|---|---|
| Audit and plan | Done | `00-PLAN.md`, `01`, `02`, `03` (written 2026-11-07, repo read, nothing executed) |
| **A0 Introspect and gather** | **Done (part A and part B)** | `ARCHITECTURE.md` Parts A, B, C. Part B is from the owner's pasted results of `sql/admin/a0-introspect.sql` (15 of 17 blocks). The AI ran nothing against Supabase. |
| **A1 Admin identity and permissions (SQL)** | **Applied by the owner (she ran the core and the bootstrap; the bootstrap returned DONE). Her run of `a1-tests.sql` was not reported, so it is untested on Supabase.** | `sql/admin/a1-*.sql`; local scratch Postgres: core x3 no error, tests ALL PASS (30), rollback x2 clean. Owner has not yet reported running it. |
| **A1b Release the admin login from coordinator** | Recorded applied per the owner's no-error convention (2026-11-08); not tested on Supabase; the coordinator release may have printed NOT DONE (the owner has not said) | `sql/admin/a1b-release-coordinator.sql` |
| **A2 Approval infrastructure (SQL)** | **Recorded applied per the owner's no-error convention; local run 48 checks passed; Supabase tests not reported** | `sql/admin/a2-*.sql` |
| **A3a Admin frame and sign-in** | **Written; pages tested in a headless browser against a fake Supabase (390, 820, 1280px); real sign-in not tried; not deployed** | `admin/`, `css/admin.css`, `handoffs/A3a.md` |
| **A3b My Profile and admin guard** | **Written; fake-Supabase browser tests only; not deployed** | `admin/profile.html`, `js/auth.js`, `handoffs/A3b.md` |
| **A3c Help and two-step verification** | **Written; fake-Supabase browser tests only (30 checks); the three `a3c-*.sql` files not run; not deployed** | `admin/help.html`, `admin/js/admin-mfa.js`, `sql/admin/a3c-*.sql`, `handoffs/A3c.md` |
| **A4 Dashboard (read only)** | **Written; fake-Supabase browser tests only (full, limited role, function missing, denied; 390, 820, 1280px); `a4-dashboard.sql` NOT run anywhere (no Postgres in the build environment); not deployed** | `sql/admin/a4-dashboard.sql`, `a4-rollback.sql`, `admin/dashboard.html`, `admin/js/admin-dashboard.js`, `handoffs/A4.md` |
| **A6 Activity log reader** | **Written; fake-Supabase browser tests only (full, filters, paging, details, empty, function missing, no permission; 390 and 1280px); `a6-activity-feed.sql` NOT run anywhere (no Postgres here); not deployed** | `sql/admin/a6-activity-feed.sql`, `a6-rollback.sql`, `admin/audit.html`, `admin/js/admin-audit.js`, `handoffs/A6.md` |
| **A13 Disputes** | **Written; SQL run on a scratch Postgres 16 with stand-ins (33 checks passed); page tested in a headless browser against a fake Supabase (39 checks passed); `a13-disputes.sql` NOT run on Supabase; not deployed. A4 and A6 are recorded applied per the owner's no-error convention (not tested on Supabase).** | `sql/admin/a13-disputes.sql`, `a13-rollback.sql`, `admin/disputes.html`, `admin/js/admin-disputes.js`, `handoffs/A13.md`, `local-tests/` |
| A5, A7, A8, A9 to A12, A14 to A28 | Not started | **A9 (Coordinators and applications) is next per the plan order** (A5 only after A9 has replaced the check of `admin_reassign_local_tasker`). |
| S1 (secret rotation, separate security stage) | Not started, waiting for the owner's decision | `ARCHITECTURE.md` Part C item 6 |

## What exists in the repo for admin
- Documentation, `sql/admin/a0-introspect.sql` (run by the owner), `sql/admin/a0-followup.sql` (**not run**) and `sql/admin/a1-*.sql`.
- A1 SQL is applied on Supabase per the owner (bootstrap DONE). A1b and A2 SQL are written, not applied. Admin pages: only `admin/login.html` and `admin/index.html` (A3a). Tests ran only on a local scratch Postgres.

## Owner-supplied inputs
| Input | Received? |
|---|---|
| Results of the 17 read-only SQL blocks | **15 of 17** (blocks 10 and 16 missing; 16 is answered by block 1; enum types still unknown) |
| Admin email for the first Super Admin (D-A3) | **Yes: admin@streettasker.com** (whether the account exists in Supabase Auth is not yet known; `a0-followup.sql` F5 or the A1 bootstrap checks) |
| Stitch reference screens | **None exist** (owner, 2026-11-07): follow `DESIGN-SYSTEM.md` and the site style |
| `docs/subscription/` incl. `ADMIN-REQUIREMENTS.md` | No (needed by A18) |
| `docs/verification/` | No (needed by A11) |
| `sql/messaging-step6a.sql`, `PAYMENTS-HARDENING.md`, `audit/frontend-audit.md` | No (not needed for A1) |
| Edge Function sources not in the repo (8 functions) | No (needed by A15, A16, A22) |
| Answers to D-A1 to D-A17 | Only D-A3 and D-A5; defaults apply to the rest |
| Master brief saved as `00-BRIEF.md` | No |

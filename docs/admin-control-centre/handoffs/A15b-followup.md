# A15b follow-up: owner ran pending SQL, encoding fixes, verification retry  (2026-11-11)

1. **Objective.** Record what the owner ran, fix the garbled symbols, and stop a rejected ID check being a dead end.
2. **Done.**
   - Owner reports she ran on Supabase the SQL for A3c, A4, A5c, A5d, A5e, A6, A7 and A8. Output not shown: recorded applied, not proven.
   - A15b SQL installed; the 9 pm email arrived, with garbled symbols.
   - Cause: symbols pasted into the SQL editor were stored garbled INSIDE functions (proven by the owner's dump of `_release_escrow`). The email layer is not at fault.
   - `a15b-fix-encoding.sql` run by the owner: `_acct_naira(132000)` starts with code 8358.
   - `a15c-fix-encoding-2.sql` delivered (`_local_tasker_sync_public`, `local_booking_send_quote`). Run status not reported.
   - Verification retry: "Needs attention" now has Try again and Contact support; "Pending" has Start again; a pop-up (`js/verify-retry-nudge.js`) asks people whose check failed, expired, needs attention or needs repeat steps to try again (once per session per status; not for pending).
3. **Files inspected.** `verify.html`, `js/verify.js`, `js/app.js`, `js/tasker-live-nudge.js`, `js/verify-gate.js`, `js/bank-reminder.js`, `supabase/functions/didit-sync`, `didit-create-session`, `sql/admin/a15b-accountant.sql`, the owner's CSV dumps of `_release_escrow`, `_local_tasker_sync_public`, `local_booking_send_quote`.
4. **Files created.** `sql/admin/a15b-fix-encoding.sql`, `sql/admin/a15c-fix-encoding-2.sql`, `js/verify-retry-nudge.js`.
5. **Files modified.** `verify.html` (two panels), `js/verify.js` (one line: REVIEW_REQUIRED shows the start area), `js/app.js` (one block that loads the pop-up), `js/tasker-live-nudge.js` (waits while the new pop-up is open), `sql/admin/a15b-accountant.sql` (symbols as `chr()` codes). Nothing else changed.
6. **Database changes.** Three functions replaced by `a15b-fix-encoding.sql`; two by `a15c`. No table or row changed, except the OPTIONAL commented repair of `taskers.rate` in `a15c` step 4.
7. **RLS and grants.** `create or replace` keeps existing grants. Not re-checked.
8. **Functions.** `_acct_naira`, `accountant_close_day`, `_release_escrow`, `_local_tasker_sync_public`, `local_booking_send_quote` (bodies otherwise unchanged from the owner's dumps; the last two were re-typed from pasted text, not from a file).
9. **Components reused.** The `tasker-live-nudge.js` pattern, `idv_my_status`, the existing `retry` action in `verify.js`.
10. **Decisions made.** Pending is excluded from the pop-up (a normal wait must not be nagged). New wording on the verify page is mine, not the owner's: needs her approval.
11. **Tests.** Verify panels rendered at 430px in a headless browser. Pop-up run in a headless browser with a stubbed `idv_my_status`: shown for REVIEW_REQUIRED, FAILED, EXPIRED, RESUBMIT_REQUESTED; not for PENDING, VERIFIED, NOT_STARTED, IN_PROGRESS; "Maybe later" stays closed after reload. NOT run: real Supabase, real Didit, the SQL patches (no Postgres here; the owner's check query for a15b-fix passed).
12. **Security notes.** The pop-up reads one status and writes nothing; all text set with `textContent`.
13. **Backward compatibility.** `PANELS_WITH_START` now includes REVIEW_REQUIRED: the Local Tasker (proxy) view of this page also shows its start area for that status. `coordinator-intake.js` was not changed.
14. **Outstanding.** (a) `idv_apply_event` and `idv_start_attempt` sources not seen: unknown why a rejected passport photo became REVIEW_REQUIRED, and whether retry from it makes a fresh Didit session or reuses the old link. TEST WITH THE SAME USER. (b) Other garbled functions may exist: `a15c` step 5 lists them. (c) Old emails, wallet notes and `taskers.rate` rows stay garbled. (d) `send-notification-email` source is still missing from the repo.
15. **Config the owner must set.** Deploy `admin-invite` and `admin-account-action` from `supabase/deploy/` if she wants invites and suspend to work.
16. **Owner status.** SQL A3c to A8: applied per owner, output not shown. a15b-fix: ran, check passed. a15c: not reported. Site files: delivered as zip, deployment not reported.
17. **NEXT STAGE.** Suggested A15b-2 (`admin/accountant.html`), then A17, then A11. Read first: this file, `A15b.md`, `04-ACCOUNTANT-ADMIN.md`, `sql/admin/a15b-accountant.sql`.
18. **What you do now (owner).** 1. Send the printed results of the A3c to A8 SQL (or say none showed an error). 2. Run `a15c-fix-encoding-2.sql`, send the step 3 and step 5 results. 3. Test Try again with the passport-photo user. 4. Deploy the two Edge Functions if you want invites and suspend. 5. Tell me which stage next.

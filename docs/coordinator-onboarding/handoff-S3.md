# S3 handoff: sign-up code, wrong-code link, apply form, function v2 (DONE 2026-11-06)

## What changed (every file)
- `signup.html`: collapsible "Have a coordinator code? Optional" box in BOTH forms (ids `cCoCode`/`tCoCode`, message `cCoMsg`/`tCoMsg`, attribute `data-av2-coord`, looks like the referral box, which is untouched). Code is uppercased, keeps the hyphen, max 11 characters. On submit `coordinatorCodeOk(prefix)` calls RPC `coordinator_code_check` BEFORE `signUpUser`:
  - empty box: sign-up goes ahead as before;
  - valid: the code is saved in `localStorage` key `st_pending_coord_code` (S6 reads it; see below) and sign-up goes ahead;
  - invalid: sign-up waits, the box opens, message "That code is not valid or has expired... clear the box to sign up without it" + link "Request to be a coordinator" -> `coordinator-apply.html`;
  - RPC error: sign-up waits with a "could not check the code right now" message (clearing the box always lets the person through).
  The box hint links "Take the coordinator test to be a coordinator" -> `coordinator-test.html`; the same link is also under "Already have an account?" on the choose screen.
- `css/styles.css`: five small rules after `.av2-ref-hint` (`.av2-ref-hint a`, `.av2-coord-msg`, `.av2-coord-link`). Tokens only.
- `coordinator-apply.html` + `js/coordinator-apply.js`: `tasker_count` is now a whole number (1 to 10,000, "How many Local Taskers can you bring in your area?"; the old range dropdown is gone); new `area_sqm` (whole number of square metres, 1 to 100,000,000, helper text "not far from where you live", football-pitch comparison); new panel "Meeting Local Taskers" with yes/no `can_meet_taskers`, yes/no `can_explain`, and `explain_text` (required when `can_explain` is Yes). All other fields kept.
- `supabase/functions/coordinator-apply/index.ts` v2: validates, STORES the row in `coordinator_applications` through the service role (plain `fetch` to PostgREST, no imports), then emails the admin (Resend) with every answer plus the exact lines `select admin_approve_coordinator_application('<id>');` and `select admin_reject_coordinator_application('<id>', 'reason here');`. Same email with a status `new` application already waiting: nothing stored or emailed, applicant still sees success. Store failure: error shown, no email. Email failure after storing: applicant still sees success (the row exists; the error is in the function logs). Email is lower-cased. Consent is saved in `answers.consent` + `answers.consent_at`.
- `supabase/deploy/coordinator-apply/index.ts`: same code with a one-line header, for pasting into the dashboard.
- Docs: `00-PLAN.md` (S3 DONE), this file.

## Verified (really run)
- `node --experimental-strip-types --test tests/coordinator-apply.test.mjs`: 19/19, Deno and fetch stubbed (insert columns, numbers as strings, duplicate, 12 rejection cases, store failure, email failure, HTML escaping). NOT run on Deno, NOT deployed.
- Headless Chromium: signup customer 390px and tasker 1280px, apply page 390 and 1280px: no sideways scroll, no JS errors. Sign-up box with a stubbed RPC: wrong code blocks and shows the link, network failure blocks, valid code continues and stores `st_pending_coord_code`, empty box continues and clears it. Apply form with a stubbed fetch: star check, new-field checks, and the payload (numbers and booleans) are right.
- `node tools/check-design-system.js` passes.
- NOT verified: the real `coordinator_code_check` / `coordinator_applications` (S2 SQL is still not confirmed run on the real project), real Resend, real browsers/phones.

## Notes for S4 to S6
- `coordinator-test.html` does not exist until S5, so the "Take the coordinator test" links 404 until then.
- S6: after sign-in, read `localStorage.st_pending_coord_code`, call `coordinator_redeem_code`, remove the key on `ok:true` or `invalid_code`, then route to `coordinator-dashboard.html`. Email sign-up needs verification first, so the redeem must happen on the first sign-in, not at sign-up. Google sign-up skips the box (it leaves the page); decide in S6 whether to offer the code after Google sign-in.
- The code is only checked (not used up) at sign-up, so a valid code can still be taken by someone else before the first login. S6 must handle `invalid_code` politely.
- Old applications from before v2 were only emailed, never stored; they have no row.

## Owner action
1. Make sure `sql/coordinator-onboarding/c1-coordinator-onboarding.sql` has been run (S2). The function v2 needs the `coordinator_applications` table.
2. Dashboard: Edge Functions > `coordinator-apply` > paste `supabase/deploy/coordinator-apply/index.ts` > Deploy. No new secrets (Supabase supplies the service key itself).
3. Push `signup.html`, `coordinator-apply.html`, `js/coordinator-apply.js`, `css/styles.css`, and the S1 and S2 files if not pushed yet.
4. Check: submit a test application; it should appear in the table (`select * from coordinator_applications order by created_at desc;`) and the admin email should contain the approve line.

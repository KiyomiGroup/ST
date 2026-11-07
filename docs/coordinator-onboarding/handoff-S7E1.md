# Handoff, Stage E-1 (identity check for coordinators) — 2026-11-07

## Owner's answers (2026-11-07)
1. Didit workflow: the SAME one as taskers (no new setting). 2. Existing active coordinators stay active. 3. New consent version.
4. D-1 / D-2 / C / C-3 SQL were all run on the real Supabase and reported success. 6. Sign-up card -> `coordinator-apply.html`.

## What E-1 does
- SQL `STAGE-E1-coordinator-identity.sql` (run once in the SQL editor; safe to run twice). Every changed function is the LIVE text from the E-0 result plus a small marked change.
  - `identity_verifications.subject_kind` also allows `'coordinator'`.
  - `idv_subject_kind`: a login whose users.role is `coordinator` and holds NO other role, and has a coordinators row, is kind `coordinator`. Checked AFTER the tasker branches, so an old account that is also a customer or tasker keeps its old kind (tested).
  - Consent: `idv_coordinator_consent_version()` = `coordinator-v1`. `idv_has_consent`, `idv_give_consent`, `idv_my_status` use it for kind coordinator only. The page text must change together with that function (coordinator-v2).
  - `idv_coordinator_sync` (trigger on identity_verifications): VERIFIED makes a PENDING coordinator ACTIVE (never a suspended/deactivated one); when the last VERIFIED check is withdrawn an ACTIVE coordinator goes back to PENDING.
  - `coordinators_a_new_pending` (BEFORE INSERT on coordinators): a new coordinator-only sign-up inserted as `active` becomes `pending`. This is how `coordinator_finish_signup` is left unedited (its SQL file was not available). It relies on the users row being written BEFORE the coordinators row, as the D-1 handoff describes. If a new sign-up ever shows `active` without a check, check that order.
  - `idv_can_publish`: coordinator = `not_gated_here` (like a Local Tasker). `idv_notify_subject` / `idv_apply_effects`: coordinator notices link to `/coordinator-identity.html` or the dashboard; nothing is "restored" or "taken down"; no profile page.
- Edge Function `didit-create-session`: for kind coordinator the Didit callback is `/coordinator-identity.html` (everything else still `/verify.html`). Same workflow. `didit-sync` and `didit-webhook` needed NO change.
- Pages: `coordinator-identity.html` + `js/coordinator-identity.js` + `css/coordinator-identity.css`. Consent text is written ON the page: `privacy.html`, `terms.html` and `data-consent.html` load `js/auth.js` + `js/app.js`, which sign a coordinator OUT, so the identity page must not link to them (a test enforces it).
- `js/coordinator-login.js`: a pending coordinator stays signed in and goes to the identity page (also when already signed in). `js/coordinator.js` (guard on every coordinator page): pending -> identity page, not login. Suspended/deactivated still get `login?denied=inactive`.
- `coordinator-signup.html`: "ready" panel now says verify identity next, button -> `coordinator-identity.html`.
- `signup.html`: third card "Be a Coordinator" in the role chooser -> `coordinator-apply.html` (no new CSS: it reuses the Work card classes + `av2-role-card--coord`).

## Tests run (all scratch; nothing on the real Supabase or Didit)
SQL on PGlite 41/41 + rollback; `didit-create-session` 24/24; browser (headless Chromium, stubs) `qa/e1_test.py` 81/81, `qa/signup_test.py` 44/44, `qa/d2_test.py` 53/53 (A1/A3 and S6 expectations were updated on purpose). `tools/check-design-system.js` fails only on `css/map-view.css` and `js/map-view.js` (the owner's separate map update, not E-1; none of the E-1 files are listed). `page_test_stageC.py` could not run (needs a guide PDF that is not in the zips).

## Known / open
- Real Didit session never run with a coordinator. First real test: new coordinator -> sign in -> identity page -> Didit -> back -> status. If Didit restricts redirect addresses in its console, allow `/coordinator-identity.html` on the site domain.
- `STAGE-D1-coordinator-signup.sql` is not in any zip. Send it next time if `coordinator_finish_signup` must be edited.
- Existing bug found: coordinator pages that link to `privacy.html`/`terms.html` (e.g. footer links on sign-up/apply/login/test pages) sign a signed-in coordinator out when clicked. Not changed in E-1 (outside the section).
- Withdrawing consent (`idv_withdraw_consent`) does not change a coordinator's status by itself.

## E-2 (next)
Move the Local Tasker proxy check out of `verify.html` into a coordinator-only page (shell like `coordinator-identity.html`), reusing `idv_record_local_consent`, `didit-create-session` (proxy) and `didit-sync` (proxy). Then `verify.html` stops serving proxy mode and `coordinator-tasker.html` / `coordinator-taskers.html` link to the new page. Ask first: should the Local Tasker's link/QR flow stay as is (link shown to the coordinator, opened on the tasker's phone)?

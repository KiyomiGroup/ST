# Handoff, Stage E-2 (Local Tasker identity check inside the coordinator portal) — 2026-11-07

## Why
`verify.html?mode=proxy` loads the customer scripts (`js/auth.js`, `js/app.js`). They sign a coordinator-only login out, so a coordinator could never reach the Local Tasker check from there. E-2 gives the check a coordinator-only page.

## What changed (no SQL, no Edge Function change)
- NEW `coordinator-tasker-verify.html?id=<local tasker user id>` + `js/coordinator-tasker-verify.js` + `css/coordinator-tasker-verify.css`. Coordinator shell and guard (`js/coordinator.js`), no customer scripts, no link to a customer/tasker/legal page.
  - Reads the status with `idv_local_status(p_tasker)`; records consent with `idv_record_local_consent` (method in person / phone / in writing, optional reference); starts with `didit-create-session` (mode proxy); refreshes with `didit-sync` (mode proxy). The server still decides: active coordinator AND assigned Local Tasker.
  - Shows the Didit link to give to the Local Tasker (copy / open on this device). Never redirects, never stores it. A non-Didit address is refused.
  - The consent notice is written on the page (data-consent.html would sign the coordinator out). Same text status as the customer notice v1: NOT legal text, a lawyer must approve it.
  - The status messages are written about the Local Tasker (third person). They are NOT the owner's first-person wording from verify.html: please approve or change.
- `coordinator-tasker.html`, `js/coordinator-tasker.js`, `js/coordinator-verify-status.js`: the "Start identity check" links now go to the new page.
- `verify.html`: a tiny script at the top sends old `?mode=proxy` links to the new page (and stops reading the page so no customer script runs). Self-check (customers/taskers) is unchanged.

## Left in place on purpose (outside this section)
- `js/verify.js` still contains the proxy-mode code and `verify.html` still contains the proxy panel markup. They are dead now. Remove them in a clean-up stage together with `css/verify.css` rules (ask the owner first).
- `didit-create-session` still uses `/verify.html` as the Didit callback for a Local Tasker (kind `tasker_local`). A Local Tasker has no login, so after finishing on their phone they land on the customer sign-in page. The result is still recorded by the webhook and shown to the coordinator. A neutral "Thank you, you can close this page" page for the callback is a candidate for a later stage (needs the owner's wording).
- Coordinator pages that link to `privacy.html` / `terms.html` sign a signed-in coordinator out when clicked (they load the customer scripts). Found in E-1, not changed.

## Tests (all scratch: stubbed Supabase and Didit, headless Chromium)
`qa/e2_test.py` 55/55; re-run on the E-2 site: `qa/e1_test.py` 81/81, `qa/signup_test.py` 44/44, `qa/d2_test.py` 53/53, `didit-create-session` 24/24, `tests/coordinator-apply.test.mjs` 19/19, `tests/coordinator-guide.test.mjs` 23/23. `tools/check-design-system.js` fails only on `css/map-view.css` and `js/map-view.js` (the owner's map update, not E-2).

## Plan status
Coordinator separation stages A, B, C, C-3, D-1, D-2, E-0, E-1, E-2 are done. Nothing is planned after E-2 except the clean-ups listed above.

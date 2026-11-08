# Stage 3 handoff: Edit details covers everything collected (2026-11-08)
Owner rules: no terminal steps; stage zip = changed files only. **No SQL, no function deploys.** Needs the Stage 2 files (js/coordinator-intake.js, css/coordinator-intake.css) in place first.

## Done
- coordinator-tasker-edit.html + js/coordinator-tasker-edit.js: after the profile form, the Edit page now shows the same checklist and sections as the Add page (services with an Edit service link on each, payout account with the current masked account and a replace flow, identity check status, photos), plus the "What to collect and explain" info button in the hero. Profile fields still save with Save changes; the other sections save on their own as they are used (a note on the page says so).
- Flow: Add page (first meeting) -> saved -> profile page -> Edit details (this page) to change anything later.

## Checked
Headless Chromium at 1280 and 390 with a fake Supabase and an already-complete Local Tasker: sections load their saved data, checklist shows 3 of 3, info pop-up opens and closes, no sideways scroll, no script errors. Design check: nothing listed for these files. NOT tested against real Supabase/Paystack/Didit.

## Left as it was
The profile page (coordinator-tasker.html) and its per-section links (service edit, photos, payout, verify pages) are untouched and still work.
Zip order: apply Stage 1 (public page), Stage 2, then this one; they do not overlap.

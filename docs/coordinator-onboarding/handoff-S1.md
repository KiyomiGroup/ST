# S1 handoff: foundation (DONE 2026-11-06)

## What changed (every file)
- `css/styles.css`: legacy phone rules `main {...!important}` (two places, ~lines 1711 and 2041) are now `main:not(.st-page)`. Cause of the nav covering headings: they overrode the top padding of every bare `<main>` on phones. New block "PAGE SHELL" at the end of the file (`.st-shell`, `.st-page`, `.st-page--narrow`, `.st-hero*`, `.st-panel*`, `.st-req`) plus `html { scroll-padding-top }` so `#anchor` links stop under the nav.
- `css/tokens.css`: `--page-width-narrow: 720px`.
- `css/coordinator-apply.css`: old `.coa-page/.coa-card/.coa-lead` rules removed; `.co-cta` (homepage block) untouched.
- `coordinator-apply.html`: rebuilt on the shell (hero + panels). Form fields, ids and `js/coordinator-apply.js` unchanged. Only the classes changed.
- `privacy.html`, `terms.html`: top padding now clears the nav (was 48px under a 64px nav).
- `DESIGN-SYSTEM.md` (4.14 and section 9), `AGENTS.md`, `CLAUDE.md` (rule 9), `design-system.html` (page-shell section).
- `tools/check-design-system.js` + new `tools/legacy-pages.json`: a page with the shared nav that is not in the legacy list and has no `.st-page` FAILS. 42 existing pages are listed as legacy. Do not add to the list.
- `sql/coordinator-onboarding/c0-introspect.sql`, `docs/coordinator-onboarding/*`.

## Verified (really run)
- Headless Chromium, logged-out, every page at 360, 390 and 768px: no first heading sits under the nav (before: coordinator-apply, privacy, terms). No sideways scroll.
- `node tools/check-design-system.js` passes; a throwaway page without the shell was rejected.
- NOT verified: logged-in phone views (needs Supabase login); real devices; the dashboards' legacy `main` rule still applies to them as before.

## Notes for next stages
- `learn.css` uses `var(--text-h1)` which does not exist (title falls back to the default h1 size). Left alone (out of scope).
- Unknown: the `coordinators` table columns, who inserts into it, and how `is_active_coordinator` works. The zip has no SQL for them. S2 REQUIRES the owner's C0 introspect results first. Ask for them if they are not attached.
- Existing `coordinator-apply` Edge Function only emails the admin through Resend (secrets `RESEND_API_KEY`, optional `COORDINATOR_APPLICATIONS_TO`, `COORDINATOR_EMAIL_FROM`); nothing is stored. `js/coordinator-apply.js` posts to it with the anon key.
- Signup page: `signup.html` has customer and tasker forms with a collapsible referral box (`data-av2-ref`, ids `cRefCode`/`tRefCode`) and handlers `handleCustomerSignup` / `handleTaskerSignup` (find them in `js/`). Copy the referral box for the coordinator code.

## Owner actions after S1
1. Push the changed files (list above).
2. Run the five blocks of `sql/coordinator-onboarding/c0-introspect.sql` in the Supabase SQL editor and paste the results into the next session (needed for S2).

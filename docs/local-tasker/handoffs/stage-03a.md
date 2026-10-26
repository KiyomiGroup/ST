# Stage 3A handoff: Coordinator sign-in, route guard, dashboard shell (WRITTEN; browser-tested with a MOCKED Supabase only)

Status: all files written. 28 browser checks pass against a fake Supabase client (see section 5). NOTHING has been run against the real Supabase project: the real sign-in, the real `is_active_coordinator()` call and the real `coordinators` read are UNVERIFIED until the owner does section 8.

## OWNER STANDING INSTRUCTIONS (every AI session must follow these; the owner should never have to repeat them)
1. Read this handoff, `00-PROJECT-CONTEXT.md` and `IMPLEMENTATION-STATUS.md` first. The next stage is the first one not marked Done / Applied (see section 14).
2. Ask the owner for what the stage needs ONCE, in ONE short batch, BEFORE generating. Ask only for what the stage file lists and what is not already filed. If nothing is needed, generate straight away.
3. Supabase's SQL editor shows at most 100 rows. Prefer one compact aggregated query (one row per section) over many pastes.
4. At the end of every stage, REDO the handoff in `handoffs/` (what was done, what was not, what the next AI must note) and update `IMPLEMENTATION-STATUS.md`.
5. Deliver a zip with ONLY the files created or changed in this stage, in their proper folders, including the handoff and status files. Never the full project. Repeat these instructions in the new handoff.
6. Never claim a test passed, a migration was applied or a payment worked unless it was actually run and observed.
7. Hard safety rules: no production deploys, no live payments, no secrets in the browser, no destructive migrations, no coordinator control over payout destination or payment records. One Supabase project, no staging, no real users yet: NO backup, test copy or dry-run is needed; run SQL directly (additive, re-runnable, with a rollback file).
8. ASSUME THE OWNER FOLLOWED YOUR PREVIOUS INSTRUCTIONS CORRECTLY. If the last handoff said "owner runs X", treat X as run and correct (the owner reports only problems). Do not ask the owner to confirm or re-paste a past stage's results unless you genuinely need that output to proceed.
9. WHEN YOU MUST ASK FOR A FILE OR OUTPUT, ALWAYS SAY EXACTLY HOW TO GET IT: the repo folder path, or a ready-to-run SQL file (one query, one row per section) plus the clicks (run in the Supabase SQL editor, then Export > Download CSV, and upload it). Never just name a file.
10. The zips the owner uploads may not include `inputs/`, `sql/` or earlier handoffs. If a file is missing, do not guess: ask once, with how to get it (rule 9).
11. If the owner uploads the introspect CSV or schema again, regenerate `architecture/schema-2a-2b-2c.md` from it. A scratch Postgres can be built to RUN SQL before handing it over: see section 9 item 6.
12. OWNER PREFERENCE (2026-10-26): NEVER ask the owner to use the browser console, curl, a terminal, or any developer tooling. The owner is a designer who only uses the Supabase SQL editor and dashboard function deploy. Optional tests are left out; anything that cannot be proven with SQL or a dashboard deploy is verified later through the real app flow (the stage that builds the UI) and recorded as UNVERIFIED until then.


## 1. What this stage did
- `coordinator-login.html` + `js/coordinator-login.js`: email and password sign-in (desktop and mobile layouts from the owner's screens). After sign-in it calls `rpc is_active_coordinator()`. Not an active coordinator: it signs the user straight back out and shows a plain message (different text for "no coordinator record" and "record exists but not active", using `rpc is_coordinator()`). A signed-in active coordinator who opens the page is sent on to the dashboard. `?redirect=` only accepts `coordinator-*.html` pages on this site (an external URL or `login.html` is ignored).
- `js/coordinator.js`: the route guard for every `coordinator-*.html` page. Order: session exists, then `is_active_coordinator()`, then own `coordinators` row for the display name. FAILS CLOSED: content is hidden (`body.co-guarding`) until the server says yes. A network or server error shows a retry button and does NOT redirect or sign out. SIGNED_OUT in another tab and the browser back button after sign-out are handled (`pageshow`).
- `coordinator-dashboard.html` + `components/coordinator-nav.html`: the shell. Header with desktop pill nav and account menu (Sign out); mobile hamburger drawer and bottom bar; hero with "Welcome back, <first name>"; four summary cards showing a dash; an "Active Requests" dark panel and "Assigned Local Taskers" section, both with honest empty states. No invented numbers anywhere.
- `css/coordinator.css`, `--co-*` tokens in `css/tokens.css` (sampled from the owner's screens, so approximate), note in `DESIGN-SYSTEM.md`.
- No SQL. The guard uses what 2B/2C already provide, confirmed from the owner's export (`inputs/schema-results/stage-3a-introspect.csv`): no-argument `is_active_coordinator()` and `is_coordinator()` (SECURITY DEFINER, executable by signed-in users, not anon), and policy `lt_coordinators_read` (a user reads their own `coordinators` row).

## 2. Deviations from the reference screens (owner may overrule)
- Nav: desktop screen has Overview, My Local Taskers, Bookings, Messages, Help & Support; the mobile screen has Overview, Tasks, Messages, Profile with a + button. Both use the desktop set (mobile bottom bar: Overview, Taskers, Bookings, Messages, no + button). Items for pages that do not exist yet are greyed text, not links: 4A, 5B and 6B turn them into links. Help & Support has no target page yet.
- Dropped from the screens: the "State: Normal / Invalid Auth / Maintenance" and "Active / Failed Attempt / Desk Notice" toggles (design-review controls, not features), the "348 Neighborhood Taskers Active" figure (an invented number), the calendar/chat/bell/settings icons (no pages behind them), "Dispatch Artisan / Browse Open Tasks" buttons, the whole sample booking list and the sample Local Tasker cards (3B/4A use real data).
- The fourth summary card is "My Local Taskers (up to 10)", not "Escrow held". The screen shows money amounts on a coordinator screen; S5 says the coordinator never handles payment records, so what a coordinator may see of money is a 7D decision.
- Hero sentence changed from "...client escrow, and daily earnings" to a neutral line for the same reason.
- "Co-ordinator" is spelled "Coordinator". "Verified Guild Ops" is "Verified coordinators". "Contact Coordinator Support" links to `terms.html` as a placeholder: there is no coordinator support page yet.
- Google sign-in is not offered on this page.

## 3. Files created or modified
NEW: `coordinator-login.html`, `coordinator-dashboard.html`, `components/coordinator-nav.html`, `css/coordinator.css`, `js/coordinator.js`, `js/coordinator-login.js`, `sql/local-tasker/stage-3a-introspect.sql`, `docs/local-tasker/inputs/schema-results/stage-3a-introspect.csv`, `docs/local-tasker/tests/stage-3a/` (README, run.py, fake-supabase.js), this handoff.
MODIFIED: `css/tokens.css` (appended a `--co-*` block, nothing existing changed), `DESIGN-SYSTEM.md` (appended a note), `docs/local-tasker/IMPLEMENTATION-STATUS.md`.
No existing page, script or stylesheet other than those two was changed. `js/auth.js`, `js/app.js` and the customer/tasker navbar are untouched, so the main site behaves as before.

## 4. Decisions and things the next AI must know
- Coordinator pages do NOT load `js/app.js` or `js/auth.js` (the login page does, only for the logged-out site nav and footer). Reason: the shared nav and bottom nav are customer/tasker-only and would show a customer menu to a coordinator. Coordinator pages never write the `st_role`/`st_name`/`st_session` cache.
- A coordinator is an ordinary Supabase Auth user plus a `coordinators` row. If they sign in on the MAIN login page they land on the customer home feed; there is no link from the main site to the coordinator portal (owner call whether to add one).
- "Remember me" unticked: the session ends when the browser is closed (a `localStorage` flag plus a `sessionStorage` marker). Supabase sessions live in the shared browser storage, so this also ends the main-site session in that browser.
- A non-coordinator who signs in on the coordinator page is signed out again (same shared-storage effect on the main site).
- `body.co-guarding` hides `.co-app`; later coordinator pages must copy the gate markup (`#coGate`) and load `js/coordinator.js`. The guard fires `coordinator:ready` (detail: `userId`, `displayName`) on `document`: 3B and later load their data on that event, not on DOMContentLoaded.
- The design-system check passes with no baseline change (new files have zero violations). New tokens were added to `tokens.css` following the Post a Task / Gift Cards precedent instead of stopping to ask, because the screens have no matching tokens; the owner can reject or replace them.
- Mobile reference width is 390px; verified no horizontal scroll at 390px.

## 5. Tests executed and ACTUAL results
- `node tools/check-design-system.js`: "Design-system check passed."
- 28 browser checks (Playwright, Chromium, MOCKED Supabase client; see `tests/stage-3a/`): signed-out redirect keeps `?redirect=`; wrong password message; active coordinator reaches the dashboard, name and initials shown, gate hidden, Overview marked current; sign out returns to login with a notice; customer account refused and signed back out; inactive coordinator refused with its own message; a signed-in customer opening the dashboard is sent to login with `denied=no` and the dashboard stays hidden; an rpc error shows the retry state, stays put and keeps content hidden; external and non-coordinator `?redirect=` ignored; "Remember me" off ends the session after a simulated browser restart; mobile drawer opens and closes with Escape; no horizontal scroll at 390px; no page errors. Result: TOTAL 28, FAILED 0.
- Screens were compared by eye with the owner's four reference images (desktop and mobile, sign-in and overview).
- NOT run: anything against the real Supabase project (real password sign-in, the real rpc, the real `coordinators` read, Auth "banned" behaviour), keyboard/screen-reader pass, real phones, Safari/Firefox.

## 6. Security notes
The guard is a convenience, the database is the control: coordinator data is protected by RLS and `is_active_coordinator()`, none of which this stage changed. The guard fails closed. `?redirect=` is whitelisted. Pages carry `noindex, nofollow`. No secret was added to the browser (the existing anon key in `js/supabaseClient.js` is unchanged).

## 7. Known limitations
- "Forgot password?" calls `resetPasswordForEmail` with the same `redirectTo` as the main login page (`login.html`). Whether that page completes a password reset is UNVERIFIED (it was not checked). Until proven, the owner can set a coordinator's password in the Supabase dashboard.
- "Contact Coordinator Support" is a placeholder link (`terms.html`).
- Greyed nav items have no link yet (4A, 5B, 6B, and a Help & Support target).
- Colours are sampled from screenshots (approximate).
- The coordinator sign-in page shows the public site nav and footer, as the desktop screen does.
- Unchanged carry-forwards from 2D: the Edge Function `local-tasker-create` has never completed a real create; 4A must prove it.

## 8. Manual owner actions (dashboard and SQL editor only)
This is the first real test, and it also gives 4A a signed-in coordinator to work with.
1. Find the test coordinator's email: Supabase dashboard, Authentication, Users, and look for the user whose UID is `6d9390b4-5106-451e-a464-d5e4ac4a2c77` (the "ST2D TEST COORDINATOR" row in `coordinators`, status `active`). Or in the SQL editor: `select email from auth.users where id = '6d9390b4-5106-451e-a464-d5e4ac4a2c77';`
2. If you do not know its password: on that user in the dashboard choose "Send password recovery", or set a new password for the user (Authentication, Users, the user's menu). Do not use a real customer's account.
3. Deploy the changed site files as you normally do, open `/coordinator-login.html`, sign in. Expected: you land on "Coordinator Overview" with the name "ST2D" in the welcome line and "ST" in the round avatar. Choose the avatar, then Sign out: you return to the sign-in page with "You have been signed out."
4. Optional: sign in on `/coordinator-login.html` with an ordinary customer account. Expected: "This account is not a coordinator account... Customer or tasker? Log in or sign up" and you are not let in. (Changed after owner feedback, see stage-03b.md.)
Report only problems. If sign-in works but the page shows "We couldn't check your access just now", tell the next session: that points at the rpc or grants and the next AI fixes it (the introspect export says the grants are correct).

## 9. Exact next steps
1. Stage 3B (coordinator overview, real data): needs a reference screen from the owner for the data states (the 3A Overview screens are the base; the "Live Workspace / Loading / No Artisans / No Bookings / Escrow Alert" toggles in the desktop screen suggest the states wanted). Load data on the `coordinator:ready` event. Decide with the owner what money a coordinator may see (see section 2).
2. Then 4A: My Local Taskers and the create form, which makes the first real call to the 2D Edge Function.

## 10. Dependencies to preserve
Keep `js/coordinator.js` as the single guard; do not add a second, different check. Keep fail-closed behaviour. Never trust `users.role` or JWT metadata for coordinator status. Keep coordinator pages off the customer/tasker navbar and `st_*` cache.

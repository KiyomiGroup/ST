# Stage 3B handoff: Coordinator overview with real data (+ Stage 3A sign-in message fix) (WRITTEN; browser-tested with a MOCKED Supabase only)

Status: written. 47 browser checks pass against a fake Supabase client. NOTHING has been run against the real Supabase project: the real reads of `coordinator_assignments` and `local_tasker_profiles` are UNVERIFIED until the owner does section 8.

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
Owner feedback (2026-10-26): (a) a normal user signing in on the coordinator page saw "This account's email isn't verified yet..." and should be told the account is not a coordinator and pointed to the normal login/sign up; (b) the Overview should get real data, and later screens should follow the brief and the existing design system without needing new reference screens.
- FIX (3A): `js/coordinator-login.js`. An Auth "Email not confirmed" error on this page now shows the not-a-coordinator message (a coordinator account is approved and verified, so an unverified account cannot be one). Every not-a-coordinator case (unverified, verified customer/tasker, `?denied=no`) shows: "This account is not a coordinator account. Coordinator access is by approval only. Customer or tasker? Log in or sign up" with links to `login.html` and `signup.html`. Wrong password still says "Incorrect email or password." (it must not reveal whether an account exists). The inactive-coordinator message is unchanged.
- 3B: `js/coordinator-overview.js`, loaded by `coordinator-dashboard.html` on the `coordinator:ready` event. REAL data only:
  - tiles: Assigned Local Taskers (count of own active `coordinator_assignments`, "of 10 allowed"), Published and Drafts (from `local_tasker_profiles.status`), Open places (10 minus assigned);
  - "Assigned Local Taskers" cards: private full name, skills, areas served, status chip (Draft / Published / Inactive), initials avatar (no photo data exists yet);
  - states: loading line, empty state (no assignments), error banner with "Try again" (tiles stay a dash, no empty claim is made on failure).
- Names, skills and areas are written with `textContent` (tested with a name containing an `<img onerror>` tag: shown as text, not run).

## 2. Why the booking numbers are not on the Overview yet
The brief's Overview lists new requests, quotes awaiting approval, active jobs, disputes. Stage 2C deliberately gave coordinators NO read access to `bookings` (`stage-2c-rls.sql` header) and the Local Tasker booking states do not exist until Stage 5A. Any number shown now would be invented, which the brief forbids ("Do not fabricate metrics"). The Active Requests panel therefore says booking requests are not switched on yet. The tiles for those metrics are added in 5B, which is the first stage that can supply them. The reference screen's money tile (Escrow held) stays out until 7D (what a coordinator may see of payments).

## 3. Files created or modified
NEW: `js/coordinator-overview.js`, `docs/local-tasker/handoffs/stage-03b.md`.
MODIFIED: `coordinator-dashboard.html` (tiles, loading/error/empty markup, loads the new script), `css/coordinator.css` (cards, status chips, loading, banner link), `js/coordinator-login.js` (message fix), `docs/local-tasker/handoffs/stage-03a.md` (owner-check wording), `docs/local-tasker/IMPLEMENTATION-STATUS.md`, `docs/local-tasker/tests/stage-3a/` (README, `run.py` now 47 checks, `fake-supabase.js` supports table reads).
No SQL. No existing site file outside the coordinator files changed. Design-system check: passed, baseline untouched.

## 4. Decisions and things the next AI must know
- The Overview only reads what 2C already allows: own active assignments (`lt_assignments_read`) and profiles of managed taskers (`lt_profiles_read`). Do not add booking reads from the browser until 5A defines the coordinator booking policies.
- The cap "10" in the tiles is a DISPLAY mirror (`CAP` in `coordinator-overview.js`). The database trigger is the authority (`local_tasker_max_active()` is server-only, so the browser cannot read it). If the cap ever changes, change both, or add a signed-in-callable function.
- Profile status values used: `draft`, `published`, `inactive` (the three the 2C/2D SQL uses). Any other value shows its raw label and counts in no tile.
- The cards show the PRIVATE full name (the coordinator is allowed to see it), not the public name. Do not put the phone on the Overview cards; 4A decides where the phone is shown.
- Cards are not links yet (the My Local Taskers page arrives in 4A).
- Per the owner: later stages (4A onward) are built from the brief and the existing design system, following the look of the coordinator screens, WITHOUT asking for a reference screen each time. Ask only if something genuinely cannot be decided from the brief and the design system.

## 5. Tests executed and ACTUAL results
- `node tools/check-design-system.js`: "Design-system check passed."
- 47 browser checks (Playwright, Chromium, MOCKED Supabase; `tests/stage-3a/`): all 28 earlier checks (with the new wording) plus: unverified normal user gets the not-a-coordinator message with links to `login.html` and `signup.html` and no "verified" wording; verified normal user gets the same; tiles show 3 / 2 / 1 / 7 for 3 assignments (2 published, 1 draft); three cards; a name containing HTML is shown as text; skills joined; the requests panel makes no count claim; empty state shows 0 and 10 and the empty message; a failed read keeps the tiles at a dash, shows the banner and makes no empty claim, and "Try again" recovers; no horizontal scroll at 390px with data; no page errors. Result: TOTAL 47, FAILED 0.
- NOT run: anything against the real Supabase project (the real reads under RLS), keyboard and screen-reader pass, real phones.

## 6. Security notes
Reads go through the browser Supabase client under RLS, so a coordinator can only ever receive their own assignments and their own taskers' profiles. The page never sends a coordinator id the user typed: it uses the signed-in user's id. No secret added to the browser. Rendering uses `textContent`.

## 7. Known limitations
- Real-data reads are UNVERIFIED against the live database (section 8).
- If a profile row is hidden from a coordinator by RLS but the assignment exists, the card shows "Local Tasker" with an "Unknown" status chip and the tile counts skip it. This should not happen for a managed tasker; if it does, check `coordinator_manages_tasker`.
- No booking metrics, no photos, no availability, no phone on the Overview (see section 2).
- Carry-forwards from 2D/3A: the 2D Edge Function has never completed a real create; "Forgot password" reset flow unverified; "Contact Coordinator Support" is a placeholder link.

## 8. Manual owner actions (dashboard and SQL editor only)
1. Deploy the changed site files.
2. Sign in on `/coordinator-login.html` as the test coordinator (see stage-03a.md section 8). Expected on the Overview: "Assigned Local Taskers 0, of 10 allowed", Open places 10, and the empty state "No Local Taskers assigned to you yet" (no taskers exist until 4A creates one).
3. Optional, to see real cards before 4A: nothing to do; 4A's create form will produce them.
4. Try a normal customer account on the coordinator page: expected "This account is not a coordinator account..." with Log in / sign up links (also for a customer whose email was never verified).
Report only problems. If the Overview shows "We couldn't load your overview just now", tell the next session: it points at the policies or grants on `coordinator_assignments` / `local_tasker_profiles`.

## 9. Exact next steps
Stage 4A: My Local Taskers (list page) and the create/edit form with recorded consent. It makes the first real call to the 2D Edge Function `local-tasker-create` (send ONE `request_id` per form open and reuse it on retry; show the function's `error` code in the UI error text). Build from the brief (Part 5, Part 9B) and the coordinator design (nav item "My Local Taskers" becomes a link in `components/coordinator-nav.html`). Reuse `js/coordinator.js` as the guard and the `coordinator:ready` event.

## 10. Dependencies to preserve
Everything in stage-03a.md section 10, plus: the Overview must never display a number it did not read from the database; booking metrics only after 5A/5B.

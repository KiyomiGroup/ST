# Stage 4A-1 handoff: My Local Taskers list and read-only profile (WRITTEN; browser-tested with a MOCKED Supabase only)

Status: Stage 4A is SPLIT. 4A-1 (this handoff) is the read-only list and profile pages. 4A-2 (create and edit form with recorded consent, first real call to the 2D Edge Function) is NOT started: it needs three inputs (section 8). 68 browser checks pass against a fake Supabase client; nothing has been run against the real project.

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
- `coordinator-taskers.html` + `js/coordinator-taskers.js`: "My Local Taskers". Real list of the coordinator's own ACTIVE assignments and those taskers' profiles (private full name, skills, areas, status chip). Search (name, skill, area) and status filter (All, Published, Draft, Inactive) run in the browser on the loaded rows. States: loading, empty (no assignments), no-match, error with "Try again". Summary line "N of 10 places used".
- `coordinator-tasker.html` + `js/coordinator-tasker.js`: read-only profile of one Local Tasker from `?id=<tasker user id>`: phone (tap-to-call link; the coordinator is allowed to see it, decision O5), areas, skills, availability notes, added/published dates, verification method/date/notes, a private-data note. An id that is malformed, missing or not yours shows the same "not found or not assigned to you" message (no leak, and a malformed id sends no query).
- `js/coordinator-common.js`: shared helpers (`window.STCo`: `el`, `initialsOf`, `statusLabel`, `statusClass`, `isUuid`, `formatDate`, `CAP`). The Overview now uses them and its cards link to the profile.
- Nav: "My Local Taskers" is a real link (header, drawer, bottom bar "Taskers"); it stays highlighted on the profile page. `js/coordinator.js` now accepts several pages per nav item (`data-co-page="a.html b.html"`).
- No SQL, no Edge Function change. Reads use the existing policies `lt_assignments_read` and `lt_profiles_read` (confirmed in the owner's 3A export).
- There is deliberately NO "Add Local Tasker" button yet: it would be dead until 4A-2.

## 2. Files created or modified
NEW: `coordinator-taskers.html`, `coordinator-tasker.html`, `js/coordinator-taskers.js`, `js/coordinator-tasker.js`, `js/coordinator-common.js`, `sql/local-tasker/stage-4a-introspect.sql`, this handoff.
MODIFIED: `coordinator-dashboard.html` (loads the common script), `js/coordinator-overview.js` (shared helpers, linked cards), `js/coordinator.js` (multi-page nav highlight), `components/coordinator-nav.html` (real links), `css/coordinator.css` (toolbar, filters, detail cards, links), `docs/local-tasker/IMPLEMENTATION-STATUS.md`, `docs/local-tasker/tests/stage-3a/` (68 checks).
Design-system check: passed, baseline untouched. No other existing site file changed.

## 3. Decisions and things the next AI must know
- The full name and phone are shown only on these private coordinator pages. Never copy them to a public view, `users`, or `taskers` (2C/2D rule: phone lives only in `local_tasker_profiles.phone`).
- Only the 3 tables coordinators can read are used. No `local_tasker_consents` read exists for coordinators in what was inspected: the consent record is not shown yet (4A-2 will decide after reading its policies).
- The profile page selects named columns, not `*`, so a later column (for example a bank reference) is not pulled to the browser by accident.
- Inactive status chip uses the danger-soft token; "Inactive" profiles still appear in the list (history is never hidden).

## 4. Tests executed and ACTUAL results
- `node tools/check-design-system.js`: passed.
- 68 browser checks (Playwright, Chromium, MOCKED Supabase; `tests/stage-3a/`): the 47 earlier ones plus: list shows only own taskers and hides another coordinator's profile (simulated RLS); summary "3 of 10"; nav highlight on list and profile; search by skill; no-match message; each status filter; card opens the right profile; name, tel link, "Not published", verification facts; another coordinator's tasker and a malformed id both show "not found"; error banners with retry on list and profile; empty state hides the toolbar; list is guarded like the dashboard; no horizontal scroll at 390px on list and profile; no page errors. Result: TOTAL 68, FAILED 0.
- NOT run: anything against the real Supabase project, keyboard/screen-reader pass, real phones.

## 5. Security notes
Reads only, under RLS; the id in the address bar is a filter on an RLS-restricted query, never an authorization. All user-entered text is rendered with `textContent`; the phone link keeps only digits and `+`. Pages carry `noindex`.

## 6. Known limitations
- Real reads UNVERIFIED against the live database (they are the same kinds of reads as the 3B Overview).
- No create, edit, publish or consent yet (4A-2, 4B, 4C). No photos or availability toggle.
- Carry-forwards: the 2D Edge Function has never completed a real create; "Forgot password" unverified; "Contact Coordinator Support" is a placeholder link.

## 7. Manual owner actions (dashboard and SQL editor only)
Deploy the changed files, sign in as the test coordinator, open My Local Taskers: expected the empty state (no Local Taskers exist until 4A-2). Report only problems.

## 8. INPUTS NEEDED for 4A-2 (ask once; do not start 4A-2 without them)
1. The Edge Function source. It is `supabase/functions/local-tasker-create/index.ts` in the 2D zip you downloaded earlier. If you no longer have it: Supabase dashboard, Edge Functions, `local-tasker-create`, open the code editor, select all, copy, paste into a text file named `index.ts`, and upload it. (The request body is in its header comment; I will not guess the field names.)
2. `sql/local-tasker/stage-2d-core.sql` from the same 2D zip (to see the exact `create_local_tasker` parameters and the allowed consent values).
3. Run `sql/local-tasker/stage-4a-introspect.sql` (in this zip): paste it into the Supabase SQL editor, run it (it only reads), choose Export, Download CSV, and upload the CSV. It lists the `local_tasker_consents` columns, the check constraints (allowed consent methods and statuses) and who may read that table.
4A-2 also needs NEW SQL (a server-side, audited "update Local Tasker profile" function, because coordinators have read-only access to the profile table). I will write and test it on the scratch Postgres first, as in 2D.

## 9. Exact next steps
4A-2: add-Local-Tasker form (public name, private full name, phone, areas, skills, availability notes, consent method and evidence) that calls `local-tasker-create` with ONE `request_id` generated when the form opens and reused on retry; show the function's `error` code in the error text; handle the 11th-tasker cap error plainly; then an edit form backed by the new audited SQL function. After the first successful create the owner runs BLOCK 2 of `stage-2d-edge-test-helpers.sql` (see stage-02d.md section 16). Then 4B (services and portfolio photos) and 4C (preview, publish, badge, marketplace, application block).

## 10. Dependencies to preserve
Everything in stage-03a.md and stage-03b.md section 10, plus: keep phone and full name private; keep the list and profile read-only until 4A-2's audited SQL exists; never let the browser write `local_tasker_profiles` directly.

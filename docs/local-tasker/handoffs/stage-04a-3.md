# Stage 4A-3 handoff: audited edit of a Local Tasker (SQL function + edit form + Edit button) (WRITTEN; SQL tested on a SCRATCH Postgres, browser tested with a MOCKED Supabase; nothing run in the real project)

Status: Stage 4A is complete once the owner runs section 7. 4A-1 = list and profile, 4A-2 = add form, 4A-3 (this handoff) = edit. Next is 4B (service listings and portfolio photos).

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
13. OWNER INSTRUCTION (2026-10-26): follow the existing website design system and tokens (`DESIGN-SYSTEM.md`, `css/tokens.css`, `css/styles.css`, shared `.btn` / `.form-*` / `.card` classes) and stay consistent with the screens already built (coordinator pages, `css/coordinator.css`), irrespective of any reference screen. Run `node tools/check-design-system.js` before finishing UI work.
14. CONSOLE AND CURL STEPS WERE REMOVED at the owner's request (see item 12 and handoffs/stage-02d.md section 16). The owner must NOT be asked for them again by any later session: they were dropped on purpose. Live behaviour is proven through the real app screens, with the error code shown on screen.


## 1. What this stage did
- NEW SQL `sql/local-tasker/stage-4a3-core.sql`: function `public.update_local_tasker_profile(p_tasker uuid, p_public_name text, p_full_name text, p_phone text, p_areas_served text, p_skills text[], p_availability_notes text) returns jsonb`. SECURITY DEFINER, `search_path = public, pg_temp`, callable by `authenticated` through RPC (NOT by `anon`; `service_role` also allowed). No Edge Function and no deploy: the choice (recorded as D34) is an RPC whose authority is decided INSIDE the function from `auth.uid()`: the caller must be an active coordinator (`is_active_coordinator`) who currently manages this person (`coordinator_manages_tasker`). Anything else gets one error, `not_found` ("Local Tasker not found, or not assigned to you."), so a stranger cannot learn whether a person exists.
- It changes ONLY: private `full_name`, `phone`, `areas_served`, `skills`, `availability_notes` (in `local_tasker_profiles`) and the public name (`users.name` and `taskers.name`). It cannot touch status, publishing, verification, assignment, consent, wallets or any coordinator/role data. Phone and full name are never copied into `users` or `taskers`.
- Input is trimmed and checked (public name 2-80, full name 2-120, phone 7-20, areas up to 300, notes up to 500, up to 20 skills of 1-60 characters; empty areas/notes become null); failures raise hint `bad_input`.
- It locks the profile row (`for update`), works out which fields really changed, and if NOTHING changed it writes nothing and no audit row (returns `{"changed": []}`). Otherwise it updates, writes one audit row `local_tasker_updated` (entity `local_tasker`, actor = the coordinator, role `coordinator`) whose JSON holds only the NAMES of the changed fields (plus public name before/after, which is public). The audit never contains the phone or the full name. It returns `{"changed": [...]}`.
- NEW `stage-4a3-rollback.sql` (drops the function) and `stage-4a3-tests.sql` (see section 4).
- NEW page `coordinator-tasker-edit.html` + `js/coordinator-tasker-edit.js`: `coordinator-tasker-edit.html?id=<uuid>`. Loads the profile (RLS limits it to the coordinator's own people) and the public name from `users.name`; same fields, validation and look as the add form, no agreement fields. Saves with `window.supabase.rpc('update_local_tasker_profile', {...})`, sending only the seven function arguments (the id comes from the address bar; it is only a filter, the function re-checks authority). Errors are shown on screen with `Error code: <hint or code>` (`not_found`, `bad_input` with the server message, `unauthenticated (42501)`, `server_error (<code>)`, `network`, `bad_response`). Double click sends one request. On success it goes to `coordinator-tasker.html?id=<uuid>&updated=1` ("Changes saved.") or `&updated=0` ("Nothing was changed, so nothing was saved.").
- If the public name cannot be read (the page reads `users.name`; whether a coordinator may read that row for a DRAFT person is UNVERIFIED), the box is left empty with a note asking the coordinator to type the name to keep. This cannot lose data: saving with the same name is a no-op for that field.
- Profile page: an "Edit details" button (`btn btn-outline`) under the header; it also shows the saved notice.

## 2. Files created or modified
NEW: `sql/local-tasker/stage-4a3-core.sql`, `sql/local-tasker/stage-4a3-rollback.sql`, `sql/local-tasker/stage-4a3-tests.sql`, `coordinator-tasker-edit.html`, `js/coordinator-tasker-edit.js`, `docs/local-tasker/handoffs/stage-04a-3.md`.
MODIFIED: `coordinator-tasker.html`, `js/coordinator-tasker.js` (Edit button, saved notice), `components/coordinator-nav.html` (highlight also on the edit page, 3 places), `css/coordinator.css` (`.co-detail-actions`, `.co-form[hidden]`; tokens only), `docs/local-tasker/IMPLEMENTATION-STATUS.md`, `docs/local-tasker/tests/stage-3a/fake-supabase.js` and `run.py` (177 checks).
No site-wide file changed. Design-system check: passed.

## 3. Decisions and things the next AI must know
- D34: Edit is an RPC with an in-function authority check (no Edge Function): the function needs no secrets and no Auth admin API. The same pattern (SECURITY DEFINER + `auth.uid()` + `is_active_coordinator` + `coordinator_manages_tasker`) should be used for later coordinator writes (publish, services) unless admin-level Auth access is needed.
- D35: A no-change save is not audited and is reported as "nothing changed".
- D36: The audit keeps field NAMES, never private values.
- The skills array is trimmed per item; blank items are rejected as `bad_input` by the function (the page already drops blanks before sending).
- The edit form does not change the agreement record. Withdrawing or adding consent purposes belongs to later stages.

## 4. Tests executed and ACTUAL results
- SQL, on a SCRATCH Postgres 16 built from the owner's exported schema (NOT Supabase): `stage-4a3-core.sql` loaded twice cleanly (re-runnable). `stage-4a3-tests.sql` result: 24 PASS, 0 FAIL ("RESULT: ALL PASS"). Covered: signed-in users can execute and anonymous cannot; all six fields reported changed; private profile updated and skills trimmed; public name updated in `users` and `taskers`; phone not copied to `users`/`taskers`; status/publishing/verification/created_by unchanged; assignment and consent unchanged; one audit row by the coordinator listing field names; audit has no phone or full name; no-change save writes nothing; optional fields can be cleared; refused (`not_found`) for another coordinator, a customer, an unknown user and a caller with no id, and nothing changed by them; anonymous refused (42501); suspended coordinator refused; coordinator whose assignment ended refused; `bad_input` for a 1-letter public name, empty full name, short phone, areas over 300, 21 skills, an empty skill. (A first run found a real bug, an untyped array append in the function; fixed and re-run.)
- Browser (Playwright, Chromium, MOCKED Supabase and a mocked `rpc`): TOTAL 177, FAILED 0 (143 earlier plus 34 new: Edit button link, pre-fill, nav highlight, validation sends nothing, exact seven-argument call with trimmed values, saved and nothing-changed notices, each failure code with its message and on-screen code, form stays usable, double click sends once, unreadable public name note, someone else's person / bad id / load failure / guard, 390px no horizontal scroll and 40px targets, no page errors).
- Screenshots looked at (desktop and 390px): edit form and profile with the Edit button.
- `node tools/check-design-system.js`: passed.
- NOT run: the function in the real Supabase project; the edit form against the real database; whether `users.name` is readable by the coordinator for a draft person; how supabase-js reports the function's `hint` (assumed `error.hint`, as PostgREST returns it: UNVERIFIED); keyboard/screen-reader pass; real phones.

## 5. Security notes
Authority is decided in the database from the verified sign-in, never from anything the page sends. `anon` has no execute right. The function cannot change status, assignment, consent, verification or money. Private values never go to the audit log or to `users`/`taskers`. All user text is shown with `textContent`.

## 6. Known limitations
- No publish, services or photos yet (4B/4C). Changing the public name on a person who is already published will be visible to customers immediately; publishing does not exist yet, so this cannot happen today.
- No edit history screen for coordinators (admins get the audit viewer in 8B).
- Carry-forward for 9A: blank the placeholder password hash; rate-limit the create Edge Function.

## 7. Manual owner actions (Supabase SQL editor and dashboard file deploy ONLY; no console, no curl, no terminal)
1. SQL editor: paste the whole of `sql/local-tasker/stage-4a3-core.sql` and press Run. Expect "Success. No rows returned". It is safe to run twice.
2. Optional check: paste the whole of `sql/local-tasker/stage-4a3-tests.sql` and press Run. An error box whose first line is "STAGE 4A-3 TESTS" listing all PASS and ending "RESULT: ALL PASS" is the NORMAL, successful result (it rolls itself back). Send it only if a FAIL appears.
3. Deploy the new and changed files (section 2).
4. Sign in as the test coordinator, open the test person, press Edit details, change the phone and press Save changes.
   - Expected: you land on the profile with "Changes saved." and the new phone.
   - If a red box appears: send its text and the "Error code".
   - If the Public name box is empty with a note: type the public name and save; tell me, so I can fix the read for 4B.
5. Optional proof of the audit (SQL editor only): `select created_at, action, after_data from local_tasker_audit_log where action = 'local_tasker_updated' order by created_at desc limit 5;` Expect `changed_fields` containing field names only.
Do NOT run Part A of `stage-2d-rollback.sql`.

## 8. INPUTS NEEDED for 4B
Ask the owner ONCE, before generating (rule 2). Likely: the design reference or existing screen for the service listing form and photo upload if the owner wants one (otherwise follow the design system), and whether the Supabase Storage bucket for portfolio photos already exists (give the SQL to check). Read `DECISIONS.md` and `implementation-plan.md` for 4B first.

## 9. Exact next steps
4B: service listings (coordinator creates services for a Local Tasker; the 2C policies and consent purpose `photos`/`publish_info` apply) and portfolio photos (Storage, private until publish). Reuse the RPC pattern of this stage. Then 4C (preview, publish, badge, marketplace, application block). If the owner reports an edit failure, fix that first.

## 10. Dependencies to preserve
Everything in handoffs 3A/3B/4A-1/4A-2 section 10, plus: the browser never writes Local Tasker tables directly; coordinator writes go through SECURITY DEFINER functions that re-check authority from `auth.uid()`; show the error code on screen for every failure; phone and full name stay private and out of audit JSON; keep `update_local_tasker_profile` unable to touch status, assignment, consent or verification.

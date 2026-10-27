# Stage 4C-2 handoff: customer side of Local Taskers (label, photos, profile note, real cards) (WRITTEN; SQL tested on a SCRATCH Postgres; browser tested with a MOCKED Supabase; NOTHING run in the real project)

Status: 4C-2 is built. Next is 5A (booking assignment and state machine). This session ALSO fixed a bug in the 4C-1 TESTS file that the owner hit in Supabase (section 6, D51).

## OWNER STANDING INSTRUCTIONS (every AI session must follow these; the owner should never have to repeat them)
1. Read this handoff, `00-PROJECT-CONTEXT.md` and `IMPLEMENTATION-STATUS.md` first. The next stage is the first one not marked Done / Applied (see section 12).
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
- FIX (4C-1 tests): `sql/local-tasker/stage-4c1-tests.sql` step 11 edited a service while the session was still the anonymous visitor from step 10, so `save_local_tasker_service` (correctly) answered `not_found`. One line added (coordinator A's claims set first). `stage-4c1-core.sql` is unchanged. Reproduced and fixed on a scratch Postgres 16: old file = the owner's exact error; fixed file = `RESULT: ALL PASS`, 39 PASS.
- NEW SQL `sql/local-tasker/stage-4c2-core.sql` (additive, re-runnable, rollback + tests): ONE function `local_tasker_public_cards(p_limit int default 12)`, callable by `anon`. Returns, for PUBLISHED Local Taskers only (newest first, 1 to 24): user id, public name, primary service (same rule as publish: oldest active service with a price), category, area, price, unit, specialties, cover photo path. Never phone, full name, notes, status or assignment. Reason: `local-taskers.html` is a public page with no id list, and a visitor cannot be assumed to read `users`/`taskers`/`services` (2C observation).
- NEW `js/local-tasker-public.js` (`window.STLocal`): `load(ids)` asks `local_tasker_public_info` once per id (100 per call) and signs cover paths for 1 hour on the private bucket; `isLocal(id)`, `coverUrl(id)`, `photos(id)` (`local_tasker_public_photos` + signing), `cards(limit)`; the labels and the profile note text live here. It never throws: any failure = the person shows as a normal listing (label missing, never a broken page).
- Marketplace cards (`find-taskers.html` via `js/taskers.js` + `stTaskerCard`, `find-services.html` via `js/services-search.js` + `stServiceCard`): a Local Tasker gets the chips "Local Tasker" and "Phone Assisted", the signed cover picture, and NO rating (the old `4.5` default in `taskers.js` is overridden for Local Taskers). Regular cards produce identical markup (new code only runs when `isLocal`).
- `tasker-profile.html` / `js/tasker-profile.js`: same two chips in the hero (no "Govt ID Verified"), the coordinator's photos as the portfolio (signed links; feed posts are not used for a Local Tasker), the cover as the avatar, and a new card "About Local Taskers" with plain text only (no fee, no donation, no percentage).
- `local-taskers.html`: "Meet Local Taskers" now shows real published people (public name, service, area, "From NGN price", Phone Assisted tag, View Profile). Craft chips filter them by service/category/specialties text. Names and text are inserted as text, never HTML. All other copy is untouched. The four sample cards stay ONLY when nobody is published or the lookup fails (D52).
- NEW `css/local-tasker-public.css` (tokens only), linked on the four pages.

## 2. Files created or modified
NEW: `sql/local-tasker/stage-4c2-core.sql`, `stage-4c2-rollback.sql`, `stage-4c2-tests.sql`, `js/local-tasker-public.js`, `css/local-tasker-public.css`, `docs/local-tasker/handoffs/stage-04c-2.md`, `docs/local-tasker/tests/stage-4c1/scratch-scaffold.sql`, `docs/local-tasker/tests/stage-4c2/run-4c2.py`, `docs/local-tasker/tests/stage-4c2/fake-customer-supabase.js`.
MODIFIED: `sql/local-tasker/stage-4c1-tests.sql` (the fix), `js/ui.js` (`stLocalTags`, two conditional lines), `js/taskers.js`, `js/services-search.js`, `js/tasker-profile.js`, `find-taskers.html`, `find-services.html`, `tasker-profile.html`, `local-taskers.html`, `docs/local-tasker/handoffs/stage-04c-1.md` (update note), `docs/local-tasker/IMPLEMENTATION-STATUS.md`.
`node tools/check-design-system.js`: passed.

## 3. Initial assumptions and existing architecture used
Handoff 4C-1 sections 6 and 12 (D46, D50). `local_tasker_public_info`, `local_tasker_public_photos`, policy `lt_photos_storage_public_read` (4C-1). `ST_NGN`, `stTaskerCard`, `stServiceCard`, the existing profile model and `renderPortfolio`. NOT available this session: the real schema export for `users`, `taskers`, `services` (only the 3A CSV for the coordinator tables), so the scratch database used stand-in columns taken from the SQL files (`docs/local-tasker/tests/stage-4c1/scratch-scaffold.sql`, including stand-ins for the 2C restrictive hide policies and the apply-block trigger).

## 4. Files inspected
`docs/local-tasker/*` (handoff 4C-1, status, 4B-2 scaffold, 3A introspect CSV), `sql/local-tasker/stage-4b1-core.sql`, `stage-4c1-core.sql`, `stage-4c1-tests.sql`, `js/ui.js`, `js/taskers.js`, `js/services-search.js`, `js/tasker-profile.js`, `tasker-profile.html`, `local-taskers.html`, `find-taskers.html`, `find-services.html`, `css/tasks.css`, `css/tokens.css`, `css/profile-pages.css`, `tools/check-design-system.js`.

## 5. Database objects
New function `public.local_tasker_public_cards(int)` (stable, security definer, search_path fixed, `revoke ... from public`, execute to `anon`, `authenticated`, `service_role`). No table, column, policy or existing function changed.

## 6. Decisions the next AI must know
- D51: the 4C-1 failure was the TEST file (anonymous session carried into step 11). Rule for every future SQL test: set `request.jwt.claims` for the actor immediately BEFORE each `set local role`, never rely on the previous step's claims.
- D52 (owner may overrule): `local-taskers.html` keeps the four static sample cards (which show invented names, ratings and a "Verified Tasker" pill) when nobody is published, so the page is not empty before launch. They are NOT real people. Once real people are published they disappear. Decide before launch whether to remove them.
- D53: a Local Tasker has no rating and no "verified" tick on customer pages until real reviews / a verification record exist; `rating` is forced to 0 for them (the existing `4.5` default in `taskers.js` is a bug for NEW regular taskers too, not changed here).
- D54: the profile note is text only (`STLocal.NOTE`); edit it in one place. No fee, donation or percentage is stated (4C-1 handoff, section 12).
- D50 still holds: no Make offer / Apply hiding is needed (a Local Tasker cannot log in; trigger `local_tasker_block_applications`).

## 7. Existing components reused
`stTaskerCard`, `stServiceCard`, `.st-chip`, `.st-tasker-*`, `.lt-tasker-*`, `.tp-card`, `.ap-card`, `.pp-hero-chip`, `renderPortfolio`, `ST_NGN`, tokens only.

## 8. Tests executed and ACTUAL results
- SQL, scratch Postgres 16 (NOT Supabase; stand-in schema): `stage-4c1-core.sql` and `stage-4c2-core.sql` each loaded twice with no error; `stage-4c1-tests.sql` (fixed) 39 PASS 0 FAIL, the original file reproduces the owner's error; `stage-4c2-tests.sql` 9 PASS (privileges; draft hidden; published listed with exact fields; no private column in the result; regular tasker not listed; limit clamped; paused service not listed; removed photo not the cover; unpublish removes).
- Browser (Playwright, Chromium, MOCKED Supabase): `docs/local-tasker/tests/stage-4c2/run-4c2.py` TOTAL 39 FAILED 0. Covered: both labels on find-taskers and find-services; no invented rating/tick; regular cards unchanged; signed cover link, 3600 s, private bucket, one info call; lookup failure and signing failure degrade safely; profile chips, no Govt ID chip, note is text-only, two signed portfolio photos, avatar, photos failure; regular profile untouched with no photo lookup; local-taskers real cards, price/area text, no fake rating or Verified pill, HTML in a name shown as text, initials without a photo, craft filter, empty craft note, sample fallback when nobody is published or the lookup fails; no sideways scroll at 390px; no page errors. Earlier `run-4c1.py` re-run: 57 PASS. Screenshots at 1440 and 390 were looked at (the mocked photo is a 1-pixel image, so pictures appear blank).
- NOT run: anything against the real Supabase project or real photos; keyboard/screen-reader pass; a real phone.
- UNVERIFIED: that an anonymous visitor can create signed links through `lt_photos_storage_public_read` on the real project; that `supabase-js` `createSignedUrls` returns `path` on every entry (assumed from the current library); that the real `taskers` row for a published person carries the columns `sync_public` writes; what a logged-OUT visitor can read on `find-taskers`/`tasker-profile` (the `users:user_id(...)` embed and `taskers`/`users` selects are existing behaviour; if they fail for visitors the page already fails for regular taskers and 4C-2 did not change that).

## 9. Security and backward-compatibility
Labels and photos come only from database functions that return published people (no column on `users`/`taskers`/`services`). `local_tasker_public_cards` returns public fields only (tested). Signed links last one hour; after unpublish an already issued link works until it expires (D46). No existing policy, function, table or regular-tasker behaviour changed; regular cards are byte-identical when `isLocal` is not set.

## 10. Known limitations and DANGER before 5A
- IMPORTANT: a customer can STILL book a published Local Tasker (the profile shows "Book" and "Request Quote / Message", and a booking row can be inserted: 2C observation). Stage 5A must block it and build the coordinator-assisted flow. Do not publish a REAL person before 5A (publish a test person, look, unpublish).
- The marketplace `availability`, distance and rating filters treat a Local Tasker like any tasker; rating shows none.
- `find-taskers` search filters still use the old fallbacks for specialties (unchanged).
- Craft chips on `local-taskers.html` filter by words in the service/category/specialties, not by a fixed craft list.
- Portfolio strip on marketplace cards is empty for Local Taskers (photos are on the profile only).

## 11. Configuration / migration requirements (none applied yet)
`stage-4c2-core.sql` is WRITTEN, NOT APPLIED. No Edge Function, no secrets.

## 12. Exact next steps: Stage 5A (booking assignment and state machine, SQL)
Read this handoff, handoff 4C-1 sections 6, 10, 13 and the 2C notes. It must: block bookings for non-published Local Taskers; create the coordinator-assisted booking flow and state machine; decide what happens to open bookings when someone is unpublished; and then hide or replace "Book" on a Local Tasker's profile (this stage left that button alone). Ask the owner once, in one batch, for whatever the stage file lists.

## 13. Dependencies to preserve
Everything in handoffs 3A to 4C-1 section 13, plus: the label comes only from `local_tasker_public_info`; `STLocal` never throws; cards on `local-taskers.html` come only from `local_tasker_public_cards`; never fill `photo_url`/`photo` for a Local Tasker.

## 14. Next stage after 5A
5B (coordinator booking list and detail).

## 15. Open decisions for the owner (defaults used)
D52 (sample cards stay until someone is published); O3 and D13 (as before).

## 16. Manual owner actions (Supabase SQL editor and dashboard file deploy ONLY; no console, no curl, no terminal)
1. SQL editor: paste the whole of `sql/local-tasker/stage-4c1-tests.sql` (the FIXED file) and Run. Expected: an error box starting "STAGE 4C-1 TESTS" and ending "RESULT: ALL PASS" (it rolls itself back). Send it only if a FAIL appears.
2. SQL editor: paste `sql/local-tasker/stage-4c2-core.sql`, Run. Expect "Success. No rows returned". Safe twice.
3. SQL editor: paste `sql/local-tasker/stage-4c2-tests.sql`, Run. Expected: an error box starting "STAGE 4C-2 TESTS" and ending "RESULT: ALL PASS".
4. Deploy the new and changed files (section 2).
5. Look: publish a TEST person (4C-1 screen), then open `local-taskers.html`, `find-taskers.html`, `find-services.html` and that person's profile while signed OUT, and once signed in. Expected: the two labels, the cover picture, the photos on the profile, the note, a real card on the Local Taskers page. Then Unpublish at once (section 10 danger). If anything looks wrong send a screenshot.
Do NOT run Part A of `stage-2d-rollback.sql`.

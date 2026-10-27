# Stage 4B-2 handoff: portfolio photos for a Local Tasker (WRITTEN; SQL tested on a SCRATCH Postgres, browser tested with a MOCKED Supabase; nothing run in the real project)

Status: 4B is complete once the owner runs section 7 (and the earlier 4A-3 and 4B-1 steps if not done). Next is 4C (preview, publish, Local Tasker badge, marketplace, application block).

## OWNER STANDING INSTRUCTIONS (every AI session must follow these; the owner should never have to repeat them)
1. Read this handoff, `00-PROJECT-CONTEXT.md` and `IMPLEMENTATION-STATUS.md` first. The next stage is the first one not marked Done / Applied (see section 9).
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
- NEW SQL `sql/local-tasker/stage-4b2-core.sql` (re-runnable, additive):
  - Private bucket `local-tasker-photos` (5 MB, jpeg/png/webp). NOT public: no photo can be opened by URL.
  - Storage policies on that bucket only: insert and select for an ACTIVE coordinator who currently manages the person named in the first path folder (path must be `<tasker uuid>/<uuid>.jpg|png|webp`); admins may select. No update or delete policy, so nothing can be overwritten or erased from the browser.
  - Table `public.local_tasker_photos` (`storage_path` unique, `caption` max 120, `is_cover` with a unique index = one cover per person, `removed_at/removed_by` soft removal). RLS: select for the managing coordinator and admins only; no write policy (writes only through the functions). Customer read access is NOT added (4C).
  - `add_local_tasker_photo(p_tasker, p_path, p_caption, p_make_cover, p_consent_method, p_consent_evidence, p_consent_details)`: authority from `auth.uid()` (same pattern as D34/D37); checks the path shape, that the file exists in the bucket (hint `upload_missing`), max 8 active photos (`photo_limit`), requires the `photos` agreement the first time (`consent_required`) and records it in the same transaction; first photo is the cover; repeating the same path returns the existing photo (safe retry). Audit: `local_tasker_photo_added` (no path, no caption text), `consent_recorded`.
  - `update_local_tasker_photo(p_tasker, p_photo, p_caption, p_make_cover)`: caption always applied (empty clears); `p_make_cover=true` moves the cover; `false` never removes a cover; no-change writes nothing. Audit `local_tasker_photo_updated` (field names only).
  - `remove_local_tasker_photo(p_tasker, p_photo)`: marks removed (row and file kept); if it was the cover the oldest remaining photo becomes the cover. Audit `local_tasker_photo_removed`.
  - All three: SECURITY DEFINER, `search_path = public, pg_temp`, executable by `authenticated` and `service_role`, not `anon`; every refusal is hint `not_found` for anyone not an active, currently assigned coordinator.
- NEW `stage-4b2-rollback.sql` (drops functions and policies; table, bucket, files, consent and audit rows stay) and `stage-4b2-tests.sql`.
- NEW page `coordinator-photos.html` + `js/coordinator-photos.js` (`?id=<tasker uuid>`): photo grid with caption save, Make cover, two-step Remove; Add form (file, caption, cover tick, agreement fields only if no active `photos` agreement). The browser shrinks pictures to max 1600px and re-saves them as JPEG (under 5 MB, strips phone location data; transparent PNGs get a white background), uploads to `<tasker id>/<new uuid>.jpg` without overwrite, then calls the RPC. A retry after a lost response reuses the same path ("already exists" counts as the earlier upload having worked). Pictures are shown through 1-hour signed links; if links fail the list and captions still work. All errors show `Error code: <code>`.
- Profile page: a "Photos" card (up to 4 thumbnails, cover tag, count, Add/Manage photos). Loads separately so a problem never hides the profile.

## 2. Files created or modified
NEW: `sql/local-tasker/stage-4b2-core.sql`, `stage-4b2-rollback.sql`, `stage-4b2-tests.sql`, `coordinator-photos.html`, `js/coordinator-photos.js`, `docs/local-tasker/handoffs/stage-04b-2.md`, `docs/local-tasker/tests/stage-4b2/scratch-scaffold.sql`.
MODIFIED: `coordinator-tasker.html`, `js/coordinator-tasker.js` (photos card), `components/coordinator-nav.html` (highlight, 3 places), `css/coordinator.css` (`.co-photo-*`, tokens only), `docs/local-tasker/IMPLEMENTATION-STATUS.md`, `docs/local-tasker/tests/stage-3a/fake-supabase.js` and `run.py` (307 checks), and that folder's `README.md` (count now 307).
No site-wide file changed. `node tools/check-design-system.js`: passed.

## 3. Decisions the next AI must know
- D41: Photos live in a NEW PRIVATE bucket, not the public app buckets. Customer-side URL form (signed URLs vs a public copy at publish) is a 4C decision; the table already holds the paths.
- D42: Photos belong to the person (profile portfolio), not to a service. The `taskers.photo_url` / `services.photo` sync is for the 4C publish function (use the cover photo).
- D43: Removal is soft (row and file kept). Max 8 active photos. Orphan files (upload done, registration failed) can exist in the private bucket; harmless, unreachable by customers.
- D44: Consent purpose `photos` is required once, recorded by the add function.
- D45: Re-encoding to JPEG happens in the browser (size limit and location-data removal); the server only enforces the 5 MB bucket limit and mime types.

## 4. Tests executed and ACTUAL results
- SQL on a SCRATCH Postgres 16 (NOT Supabase). IMPORTANT: this session's zips did not contain the exported schema, so the scratch database was a RECONSTRUCTION (`docs/local-tasker/tests/stage-4b2/scratch-scaffold.sql`): stand-in tables and helper functions with the signatures from the owner's introspect export, and the app-bucket storage policies assumed to be bucket-scoped. `stage-4b2-core.sql` loaded twice cleanly; `stage-4b2-tests.sql` 56 PASS, "RESULT: ALL PASS" (run twice). Covered: privileges; bucket settings; upload allowed only for the managing coordinator and refused for another coordinator, customer, bad names, .gif, anonymous; file readable only by the managing coordinator; no delete from the browser; consent_required writes nothing; first photo is cover; consent and audit rows; audit holds no path/caption; safe retry; upload_missing; bad paths; caption limits; cover moves keep exactly one cover; no-op writes nothing; table RLS; no direct writes; removal promotes the oldest; removed photo cannot be edited/removed/re-added; other person's photo untouched; refusals for other coordinator, customer, unknown user, no user id, anonymous, suspended coordinator, ended assignment; 9th photo refused; every other storage policy is bucket-scoped.
- Browser (Playwright, Chromium, MOCKED Supabase and storage): TOTAL 307, FAILED 0 (232 earlier plus 75 new, using real generated PNGs: 3000x2000 shrunk to 1600 wide, broken and text files refused, exact upload and rpc arguments, retry reuses the path, double click, every error code, 8-photo limit, signed-link failure, guard, 390px layout). Screenshots looked at (desktop and 390px). In the screenshots the mocked picture is a 1-pixel placeholder, so tiles look plain mint.
- NOT run: anything against the real Supabase project; real image upload from a phone; keyboard/screen-reader pass. UNVERIFIED: that the owner's existing `storage.objects` policies are all bucket-scoped (the last test line checks this and prints FAIL with a count if not); that `createSignedUrls` is permitted by the select policy in the real project; that supabase-js returns the function `hint` as `error.hint` (assumed since 4A-3); that coordinators can read `local_tasker_photos` through the policy.

## 5. Security notes
Authority is decided in the database from the verified sign-in. The bucket is private; uploads and reads need an active, currently assigned coordinator; nothing can be overwritten or deleted from the browser; photos are invisible to customers and anonymous visitors (table and bucket). The functions touch only photo rows and one consent row; they cannot change status, publishing, assignment, verification, money or private profile data. All text is rendered with `textContent`.

## 6. Known limitations
- No customer visibility, no publish, no `taskers.photo_url` sync (4C). No reordering other than choosing the cover. No per-service photos. HEIC pictures are not accepted (the browser cannot decode them everywhere); the file picker offers JPEG/PNG/WebP only.
- Removed photos' files stay in the private bucket.

## 7. Manual owner actions (Supabase SQL editor and dashboard file deploy ONLY; no console, no curl, no terminal)
1. SQL editor: paste the whole of `sql/local-tasker/stage-4b2-core.sql`, press Run. Expect "Success. No rows returned". Safe to run twice.
2. Optional: paste the whole of `sql/local-tasker/stage-4b2-tests.sql` and press Run. An error box starting "STAGE 4B-2 TESTS" and ending "RESULT: ALL PASS" is the NORMAL success result (it rolls itself back). Send it only if a FAIL appears (the last line also tells you if another storage policy could expose the photo bucket).
3. Deploy the new and changed files (section 2).
4. Sign in as the test coordinator, open the test person, press Add photos, choose a picture, choose how they agreed, tick the confirmation, Upload photo.
   - Expected: "Photo added. It is the cover photo." and the picture in the list; the profile shows it in the Photos card.
   - If a red box appears: send its text and the "Error code".
5. Optional proof (SQL editor only): `select created_at, action, entity, after_data from local_tasker_audit_log where action like 'local_tasker_photo_%' or (action = 'consent_recorded' and after_data->>'purpose' = 'photos') order by created_at desc limit 10;`
Do NOT run Part A of `stage-2d-rollback.sql`.

## 8. INPUTS for 4C
None required from the owner. Read `DECISIONS.md` and `implementation-plan.md` for 4C first (not in this session's zips; if missing, ask once per rule 10).

## 9. Exact next steps
4C: preview, publish function (SECURITY DEFINER; sets `status = published`, syncs the `taskers` row from the primary service and cover photo as `postService` in `js/db.js` does, requires consents `profile`, `publish_info` and, if photos exist, `photos`), Local Tasker badge, marketplace listing, application block, and the customer-side photo URL decision (D41). If the owner reports the first photo upload failing, fix that first.

## 10. Dependencies to preserve
Everything in handoffs 3A to 4B-1 section 10, plus: photo writes only through the three functions; the bucket stays private unless 4C records a decision; never sync `taskers` or flip `published` outside the publish function; photos are soft-removed, never deleted; use the shared `.co-hero--page`, `.co-proxy`, `.co-icon-badge`, `.co-card-head` classes for every coordinator page.

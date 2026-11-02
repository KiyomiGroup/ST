# Handoff: Stage 7G, coordinator tiers: model and capacity

Status: WRITTEN, NOT APPLIED, NOT DEPLOYED. Nothing was run in the real Supabase project.

## OWNER STANDING INSTRUCTIONS (carried forward)
1. Ask what a stage needs once, in one short batch. 2. Deliver only changed or new files as a zip. 3. Never claim a test passed, a migration applied or a payment worked unless it was run and observed. 4. TEST mode only; no live payments; no secrets in the browser. 5. SQL additive, re-runnable, with a rollback file. 6. Unverified values are flagged. 7. Follow the design system.

## 1. Stage number and title
Stage 7G: coordinator tiers, model and capacity (7G-1 SQL, 7G-2 replace the hard-coded 10 on the pages).

## 2. Objectives
Capacity per coordinator comes from a tier stored in the database. One function holds the schedule. A tier can be raised only by a server function, one step at a time. No payment is taken here (7H) and no plan page is built (7I).

## 3. Initial assumptions and relevant existing architecture
- Rules from `DECISIONS.md` C4, C6, C7, C8, C13 and the tier table (read from the stage-7-replan upload): capacity 10, 20, 30, then 5 x tier + 15 from tier 4; price to reach a tier 50,000 naira x (tier - 1); no skipping; no downgrade; no tier without payment; capacity counts ACTIVE assignments only; a coordinator above capacity keeps everyone but cannot add more.
- Owner answers this session: a downgrade is not allowed; the upgrade is a one-time permanent change; names are mine to choose (I use the word "tier"); prices come from the plan files (found in DECISIONS.md, so nothing was left unset).
- The REAL body of `local_tasker_assignment_guard` was taken from the owner's CSV of 2026-11-02 (trigger body section). `create_local_tasker` does not count anything itself: it inserts into `coordinator_assignments`, so the guard enforces the cap for it. (Its body in the CSV is cut off at the end of the file; the cap logic is not in the visible part.)
- `local_tasker_max_active()` and its settings row are not in the repo and their bodies were not seen.

## 4. Files inspected
`stages/stage-07g.md`, `DECISIONS.md`, `PROCESS-CHANGE-2026-11-01.md`, the 7D handoff and tests, the 2026-11-02 CSV, `js/coordinator-common.js`, `coordinator-overview.js`, `coordinator-taskers.js`, `coordinator-tasker-new.js`, `coordinator-tasker-new.html`, `supabase/functions/local-tasker-create/index.ts`, `tools/check-design-system.js`.

## 5. Files created or modified
NEW: `sql/local-tasker/stage-7g-core.sql`, `stage-7g-rollback.sql`, `stage-7g-tests.sql`; `docs/local-tasker/tests/stage-7g/run-7g.py`, `fake-plan-supabase.js`; this handoff.
MODIFIED: `js/coordinator-common.js` (`CAP` removed, `STCo.plan()` added), `js/coordinator-overview.js`, `js/coordinator-taskers.js`, `js/coordinator-tasker-new.js`, `coordinator-tasker-new.html`, `docs/local-tasker/IMPLEMENTATION-STATUS.md`.
NOT changed: `local-tasker-create/index.ts` (it only maps the hint `coordinator_cap` to a status code; the message comes from the database and the page).

## 6. Database objects affected (when run)
NEW tables (RLS on, no policy, all browser grants revoked): `coordinator_tiers_state` (coordinator_id PK to coordinators, tier default 1 check >= 1, updated_at; backfilled for every coordinator; a trigger on `coordinators` creates the row for new ones); `coordinator_tier_upgrades` (immutable: from_tier, to_tier = from_tier + 1, amount_kobo, payment_reference; unique (coordinator, to_tier) and unique payment_reference).
NEW functions: `coordinator_tier_terms(int)` (the schedule; tiers 1 to 100), `coordinator_capacity(uuid)`, `my_coordinator_plan()` (active coordinator only), `coordinator_apply_upgrade(uuid, int, text)` (service role only; takes the price from the schedule), plus two small trigger functions.
REPLACED: `local_tasker_assignment_guard()` (real body, one change: cap from `coordinator_capacity()`; same hint `coordinator_cap`; message now names the capacity and the tier).
Left in place, no longer read by the guard: `local_tasker_max_active()` and its settings row.

## 7. Existing components reused
`is_active_coordinator(uuid)`, `local_tasker_audit(text,text,text,jsonb,jsonb,uuid)`, `coordinators`, `coordinator_assignments`, the guard trigger, `STCo` helpers.

## 8. New functionality
A tier 1 coordinator can have 10 active Local Taskers, tier 2 has 20, and so on. The Overview tile, the taskers list line and the Add form read the capacity from `my_coordinator_plan()`. If it cannot be read the pages show a dash or no number (the database still enforces the cap).

## 9. Important decisions (defaults, owner may overrule)
- D-7G-1 Highest tier accepted: 100 (input guard; the table stops at 8).
- D-7G-2 `coordinator_apply_upgrade` does not require an active coordinator (7H must check that BEFORE taking payment); refusing after a verified payment could lose the money.
- D-7G-3 `coordinator_capacity()` is executable by signed-in users because the guard runs as whoever inserts; it returns one number.
- D-7G-4 A repeat or a lower tier is refused with hint `tier_already_applied`; a skip with `tier_skip`; a reused payment reference with `payment_reused`. 7H should treat `tier_already_applied` on a replayed webhook as "already done".
- D-7G-5 No link to the plan page in the messages: that page is 7I and does not exist. Add the link in 7I.
- Downgrade: no function exists and a test checks that no other tier or capacity function is present. The upgrade is permanent.

## 10. Tests executed and ACTUAL results
- Scratch Postgres 16 (real server, STAND-IN tables shaped from the CSV and the real guard body; the real `local_tasker_audit` and `coordinators` triggers are NOT there): core run twice clean; `stage-7g-tests.sql` 44 PASS 0 FAIL 0 SKIP (tiers 1 to 8 against the table, bad tiers, backfill, 11th refused at tier 1, skip, repeat, blank and reused reference, upgrade to 20, 21st refused, ending an assignment frees a place, over-capacity keeps people, plan read, no browser read or write of either table, service role only, no other tier function, ledger immutable, inactive and unknown coordinator still refused). Rollback then reinstall clean. Mutation check: 3 deliberate breaks (wrong capacity formula, `>` instead of `>=`, skip check removed) each made the tests FAIL.
- Browser, MOCKED Supabase (`run-7g.py`): 13 PASS 0 FAIL (overview at tiers 1, 2, 4 and over capacity, plan unreadable, list line, add form at capacity, below capacity, plan unreadable, no assignment counting in the form, 390px no sideways scroll). No browser mutation check was run.
- Code search of live code: no `CAP` and no "maximum of 10" left (`context-snapshot/js/coordinator-taskers.js` is an old copy and still has `C.CAP`; it is not served by the site).
- `node tools/check-design-system.js`: only the two failures that were already there.
- NOT RUN: the SQL in the real project; the real guard on real data; `create_local_tasker` end to end with a tier; the Edge Function; any payment.

## 11. Security and compatibility
Browsers cannot read or write either new table or run the upgrade function; a signed-in coordinator reads only their own plan. Nothing ends, moves or deletes an assignment. Existing coordinators start at tier 1 with capacity 10, the same as before. Error hint and status code for the cap are unchanged.

## 12. Known limitations, unresolved
- The real project's guard trigger and `coordinators` table may differ from the stand-in; the first real run may need small fixes (same as 7D).
- `local_tasker_audit` accepting these action names is assumed (other stages use free text).
- Tier state has `on delete cascade` from `coordinators`; the upgrade ledger has no foreign key so history survives.
- A coordinator who is over capacity (possible only if capacity ever drops) is handled; no code lowers capacity.
- The stale `context-snapshot` copy still mentions `C.CAP`.

## 13. Configuration or migration requirements
Run the SQL (section 16), then upload five site files. No Edge Function change, no secret.

## 14. Exact next steps
1. Owner runs section 16. 2. Stage 7H (pay for the next tier through Paystack, calling `coordinator_apply_upgrade` once after verification). 3. Stage 7I (plan page; add the link in the Add form message). 4. 7F last.

## 15. Dependencies the next stage must preserve
`coordinator_tier_terms` is the only place for capacity and price. `coordinator_apply_upgrade` is the only way to raise a tier and stays service-role only. Keep hint `coordinator_cap`. The pages read `my_coordinator_plan()` keys: tier, capacity, active_count, places_left, over_capacity, next {tier, capacity, price_kobo}.

## 16. Manual actions for the project owner
1. Supabase SQL editor: run `sql/local-tasker/stage-7g-core.sql` (select ALL, Run). It stops with a clear message if a required table or function is missing.
2. Run `sql/local-tasker/stage-7g-tests.sql`. An error box that starts "STAGE 7G TESTS" and ends "RESULT: ALL PASS" is the NORMAL result. Send me the text if any line says FAIL or SKIP.
3. Upload the five site files: `js/coordinator-common.js`, `js/coordinator-overview.js`, `js/coordinator-taskers.js`, `js/coordinator-tasker-new.js`, `coordinator-tasker-new.html`.
4. Still open from earlier: run the corrected 7D tests (core first), 7E tests, 7A-R tests.

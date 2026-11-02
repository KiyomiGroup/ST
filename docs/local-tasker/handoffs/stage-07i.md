# Handoff: Stage 7I, coordinator plan and upgrade page

Status: WRITTEN, NOT APPLIED, NOT DEPLOYED. Browser-tested against doubles only. No SQL was run. No Paystack call and no payment was ever made by an AI.

## OWNER STANDING INSTRUCTIONS (carried forward)
Unchanged from handoffs/stage-07h-2.md: ask once in one batch; zip only changed files; never claim a test passed, a migration applied or a payment worked unless observed; SQL additive with rollback; flag unverified values; design system; dashboard and SQL editor only (no console, curl, terminal, optional steps); zip for the next AI.
CHANGED THIS STAGE (owner, 2026-11-02): (1) Paystack keys stay LIVE (so "TEST mode only" in the 7H/7I briefs no longer applies). (2) There are REAL users now. (3) Build the page from the other website screens; no separate reference screens were supplied.

## 1. Stage
7I: coordinator plan and upgrade page.

## 2. Objectives
A page where a coordinator sees tier, places used of capacity, the next tier (capacity and price in naira), one Upgrade button for the NEXT tier only, upgrade history, a clear message at the top tier. It only starts the payment through the server and shows what the server says afterwards; it never sets a tier. Linked from the Overview tile, the Add form cap message and the navigation.

## 3. Assumptions and architecture
- Read: `my_coordinator_plan()` (7G) for tier, capacity, active_count, places_left, over_capacity, next {tier, capacity, price_kobo}. New read function `my_coordinator_upgrades()` for history (the table is closed to browsers).
- Pay: `ST.payments.upgradeCoordinatorTier()` -> `payment-init` with body `{purpose:'tier_upgrade'}` only -> Paystack pop-up with the server's amountKobo and reference -> `payment-verify` -> the page RE-READS the plan and shows that.
- Flow facts come from handoffs/stage-07h-2.md (init answer has `tier`, `capacity`, `amountKobo`, `reference`, `email`; verify 202 = pending, 409 + `needs_review` = paid but not applied).
- Design: built from existing coordinator pieces (`.co-hero`, `.co-stats`, `.co-card`, `.co-banner`, `.co-facts`, `.co-bk-event`, `.co-po-facts`, `.btn`). New classes live in a NEW file `css/coordinator-plan.css` (prefix `co-pl-`, plus `.co-meter`) so they cannot clash with other stages that edit `css/coordinator.css`.

## 4. Files inspected
AGENTS.md, DESIGN-SYSTEM.md (context-snapshot copy), css/coordinator.css, css/tokens.css (co tokens), components/coordinator-nav.html, coordinator-dashboard.html, coordinator-bookings.html, coordinator-tasker-new.html, js/coordinator.js, coordinator-common.js, coordinator-overview.js, coordinator-tasker-new.js, coordinator-taskers.js, js/payments.js, sql/local-tasker/stage-7g-core.sql, handoffs/stage-07g.md, stages/stage-07h.md, stage-07i.md, DECISIONS.md, PROCESS-CHANGE-2026-11-01.md, handoffs/stage-07h-2.md, payments-core.ts, RUNBOOK-7H-2.md, IMPLEMENTATION-STATUS.md, docs/local-tasker/tests/stage-7g/ (test pattern). NOT available: the 7H-1 SQL (`stage-7h-core.sql`), handoff 7H-1, 7D/7E/7C files, `00-PROJECT-CONTEXT.md`.

## 5. Files created or modified
NEW: `coordinator-plan.html`, `css/coordinator-plan.css`, `js/coordinator-plan.js`, `sql/local-tasker/stage-7i-core.sql`, `stage-7i-rollback.sql`, `stage-7i-tests.sql`, `docs/local-tasker/RUNBOOK-7I.md`, `handoffs/stage-07i.md`, `tests/stage-7i/` (`run-7i.py`, `fake-plan-supabase.js`, `screenshots/`).
MODIFIED: `js/payments.js` (additive: new `upgradeCoordinatorTier`, exported; `_verifyPayment` now throws an Error that also carries `status`, `pending`, `needsReview`, `reference`; the old text and `.message` are unchanged), `components/coordinator-nav.html` (Plan link: top menu and phone drawer), `coordinator-dashboard.html` (Overview "Open places" tile note is now a link), `coordinator-tasker-new.html` (link added inside the cap banner), `docs/local-tasker/IMPLEMENTATION-STATUS.md`, `docs/local-tasker/DECISIONS.md` (D-7I-1 to D-7I-3 appended).
NOT changed: any Edge Function, `paystack-webhook`, `css/coordinator.css`, `js/coordinator-common.js`, any other SQL.

## 6. Database objects affected
One NEW function `public.my_coordinator_upgrades()` (security definer, stable; active coordinator only; own rows; newest first; max 50; returns jsonb array of {from_tier, to_tier, capacity, amount_kobo, payment_reference, created_at}; execute for authenticated and service_role, not anon). No table, column, policy or other function changed. Rollback drops it.

## 7. Reused
`my_coordinator_plan()`, `coordinator_tier_terms`, `is_active_coordinator`, `payment-init`/`payment-verify` (7H-2), `_callFn`, `_openPaystack`, `_verifyPayment` in payments.js, the Paystack inline script already used by wallet and checkout pages, `STCo` helpers, the coordinator route guard.

## 8. New functionality
- Plan page: four summary cards (plan, used, left, next step and price), "Your places" card with a meter, "Next step" card, "Upgrade history" card. Top tier: "You're on the highest plan", no button. Over capacity: notice (keeps everyone, cannot add). Plan unreadable: error banner with retry, dashes, no grid, no button. History unreadable: its own error, the rest still works.
- Upgrade: "Upgrade to Tier N" opens an inline confirmation naming the price, that it is permanent and not refunded; only "Pay N" starts the payment. One attempt at a time (double click starts one payment).
- After any attempt the page re-reads plan and history. Outcomes: raised tier -> success message from the fresh plan; pop-up closed -> calm message; 202 still pending after 6 tries -> locked, "do not pay again", reference; paid but not applied (409/needs_review) -> locked, "contact support", reference; failed -> server text; confirmed but plan not risen -> locked, "reload, do not pay again"; server refused to start -> server text.
- Locked states keep the Upgrade and Pay buttons disabled until the page is reloaded, so nobody pays twice from an unclear state.

## 9. Important decisions
- D-7I-A The UI offers a button only if `plan.next.tier === plan.tier + 1`, capacity rises and price is a positive integer. Otherwise nothing is offered (tested with a malformed answer). The server remains the authority.
- D-7I-B No client price: the amount shown comes from `plan.next.price_kobo`; the amount charged is the server's `amountKobo` from payment-init. The page never sends an amount, tier or id (tested: body is exactly `{"purpose":"tier_upgrade"}`).
- D-7I-C Success is shown only from a FRESH plan read, never from the payment answer alone.
- D-7I-D An inline confirmation before any charge, because the keys are live and upgrades are permanent (C8).
- D-7I-E Own CSS file, to avoid conflicts with 7D and others.
- D-7I-F No tier ladder on the page: prices beyond the next step are held by the server and must not be copied into the page.
- D-7I-G Plan link is in the top menu and the phone drawer, NOT the 4-column phone bottom bar (that grid lives in `css/coordinator.css`).
- D-7I-H History shows the payment reference (it is the person's own receipt and helps support).

## 10. Tests executed and ACTUAL results
- Browser (`tests/stage-7i/run-7i.py`, Playwright Chromium, MOCKED Supabase, MOCKED Paystack pop-up, FAKE payment server written for the test; run on a copy of the site with the 7I files): **44 PASS, 0 FAIL**. Covers: tier 1 numbers and wording; exactly one upgrade button and none for Tier 3; confirmation charges nothing; payment-init body is only the purpose; pop-up uses the server amount (5,000,000 kobo) and reference; BEFORE verification the tier is unchanged and buttons are disabled; AFTER it Tier 2, capacity 20, places left 16, next step Tier 3 for N100,000, history row; one init and one verify; double click starts one payment; pop-up closed; pending (6 retries, locked); needs review (locked, reference); failed; confirmed-but-plan-not-risen (locked); server refusal; top tier; malformed next step; plan unreadable then retry; over capacity; history unreadable; reference text not run as HTML; Overview tile, nav and Add form links; 390px no sideways scroll, 44px button, confirmation fits.
- Mutation checks: 8 deliberate breaks tried. 7 made the suite FAIL (next-tier check removed; browser sends a tier and amount; no lock after needs-review; reference written as HTML; no plan re-read after payment; success trusting the payment answer; no confirmation step). 1 was EQUIVALENT and proved nothing (painting the tier from the payment answer: the re-read overwrites it), so it was replaced by the "no re-read" and "trust the payment answer" breaks above.
- `node tools/check-design-system.js`: fails on the same 3 items before and after my change (`context-snapshot/verify.html` inline +31, `withdrawals-reference/css/tokens.css` hex +102 and rgb +64). No new violation from the 7I files. I did not edit the baseline.
- Screenshots at 1440 and 390 are in `tests/stage-7i/screenshots/`. Google Fonts were blocked in the test browser, so they use fallback fonts.
- NOT RUN: the SQL (no Postgres in this environment, no parser either; I only read it through); the page against the real Supabase; the real Paystack pop-up or `pk_live` key; the deployed Edge Functions; any real payment; other pages that load `js/payments.js` (wallet, messages, checkout: only additive lines, but not re-tested); iOS/Android Safari.

## 11. Security and backward-compatibility checks
- Browser sends no amount, tier or id (tested; mutation caught). Server decides all. The page cannot set a tier: it has no write path (reads two rpc functions, calls payment-init/verify through payments.js).
- All server text and the payment reference are written with textContent (tested with an HTML payload).
- `my_coordinator_upgrades` is own-rows-only, active-coordinator-only, no anon (checked in the tests file, NOT YET RUN).
- payments.js: `_verifyPayment` still throws an Error with the same `.message`; extra fields are additive. All other exports unchanged.
- Existing coordinator pages keep working: only a link added to three of them.

## 12. Known limitations, unresolved, decisions required
1. LIVE KEYS. The first real upgrade charges real money; nothing was tested with Paystack. After a successful first upgrade the owner should report what the page showed.
2. REAL USERS NOW (D-7I-2). The "no real users, no backup" rule (O2) in the stage briefs is out of date. Before applying SQL that touches money (7E `_release_escrow` rebuild, 7C), take a backup or test copy, or have the owner read and approve the SQL first. 7I's SQL is read-only and low risk.
3. SQL never run. First real run may need a small fix (same as 7D/7G). The tests file inserts one throwaway row inside a transaction that is rolled back by an intentional error.
4. No place to contact support: "Help & Support" in the nav is "coming soon". The page tells people to "contact StreetTasker support" with the reference but gives no address. DECISION NEEDED: which email/WhatsApp should the message show?
5. On reload after a paid-but-not-applied upgrade the page cannot know about it (7H-2 limitation); the next attempt would show the server's refusal text. A later stage could add a "pending upgrade" read.
6. No email or notification is sent after an upgrade (7H-2 limitation).
7. No Plan item in the phone bottom bar (grid of 4 in `css/coordinator.css`). Reachable from the drawer, Overview tile and Add form.
8. `coordinator-nav.html`, `coordinator-dashboard.html`, `coordinator-tasker-new.html` and `js/payments.js` are copies from the 2026-11-02 05:06 site zip; merge if they changed (RUNBOOK-7I.md).
9. The confirmation sentence repeats two of the bullets above it on purpose (it is the last thing read before a live charge).
10. The tier table in DECISIONS.md stops at tier 8, the database accepts up to 100; the page shows whatever the server returns as next and hard-codes no price.
11. `coordinator-taskers.html` list line ("x of y places used") does not link to the plan yet (not requested).

## 13. Configuration or migration requirements
- SQL `stage-7i-core.sql` then `stage-7i-tests.sql`: written, NOT applied. Owner, SQL editor.
- Site upload of the 7 site files: NOT done. Owner.
- 7H-2 `payment-init` / `payment-verify` deploy (RUNBOOK-7H-2.md): the owner has not confirmed it is done. Required before a payment can start.
- No new secret. `PAYSTACK_SECRET_KEY` stays live (owner).

## 14. Exact next steps for the next stage
Replan order says 7F next (coordinators use the tasker wallet and withdrawals), LAST because it waits for the owner's W withdrawal stages working. If the owner says the W stages are not ready, go to 8A (admin: coordinator approval, assignment, reassignment, deactivation; admin also sees each coordinator's tier, capacity and upgrade history; admin can NOT give a tier without payment, C13). 8A and 8B addenda are in PROCESS-CHANGE-2026-11-01.md section 4.
Still waiting for owner action (do not assume applied): 7D, 7E, 7C-1b/2/3 SQL and deploys, 7B, 7H-2 deploy, 7I SQL and upload. Check IMPLEMENTATION-STATUS.md "Blockers" first. Before any money-path SQL read section 12 item 2.

## 15. Dependencies the next stage must preserve
- `coordinator_tier_terms` is the only source of price and capacity. Never copy a price into a page.
- `my_coordinator_plan()` answer shape and `next` rule; `my_coordinator_upgrades()` shape.
- `ST.payments.upgradeCoordinatorTier()` and its `err.code` values (`init`, `closed`, `pending`, `review`, `failed`) and `err.reference`; `_verifyPayment`'s extra fields.
- Page ids used by tests (`coPlUpgradeBtn`, `coPlPayBtn`, `coPlConfirm`, `coPlStatusText`, ...). Run `tests/stage-7i/run-7i.py` after touching the page: `ST_REPO_ROOT=<site folder with 7I files> python3 run-7i.py` (add `ST_SHOTS=<folder>` for screenshots).
- `css/coordinator-plan.css` stays separate from `css/coordinator.css`.
- Do not deploy `paystack-webhook` from `payments-core.ts` (7H-2 rule).

## 16. Manual actions required from the project owner
1. (If not done) deploy `payment-init` and `payment-verify` from the 7H-2 zip (RUNBOOK-7H-2.md).
2. Run `stage-7i-core.sql`, then `stage-7i-tests.sql`; send the whole result box (RUNBOOK-7I.md step 2).
3. Upload the 7 site files, merging the 4 changed ones if they changed since 2026-11-02 (RUNBOOK-7I.md step 3).
4. Open the Plan page as a coordinator and look at it on desktop and phone (RUNBOOK-7I.md "What you should see").
5. Tell me which support email/WhatsApp the page should name (section 12 item 4).
6. Read section 12 item 2 (real users) before running any further money-path SQL, and decide on a backup.
7. When you make the first real upgrade, tell me exactly what the page showed (it is the first real payment through this path).

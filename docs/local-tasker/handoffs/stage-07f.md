# Handoff: Stage 7F, coordinators use the tasker wallet and withdrawals

Status: WRITTEN, NOT APPLIED, NOT DEPLOYED. Tested against fakes and doubles only. No SQL was run (no Postgres was available). No Paystack call, no transfer and no payment was made by an AI. Transfer result: NOT TESTED.
Date: 2026-11-02. Built on the owner's site upload `ST-Real-Main_-_2026-11-02T235426_873.zip` (which already contains 7I) and the withdrawal packages W3c-complete, W6f-complete and W7a-final-changed-files.

## OWNER STANDING INSTRUCTIONS (carried forward)
Ask once in one batch; zip only changed files; never claim a test passed, a migration applied, a function deployed or a payment worked unless observed; SQL additive and re-runnable with a rollback file; no secrets in the browser or in chat; plain HTML/CSS/JS and design-system tokens; the owner uses only the Supabase SQL editor and dashboards (give exact clicks); every handoff has a "Manual actions" section; stop after one stage and wait for "go". CHANGED 2026-11-02 (owner): Paystack keys stay LIVE; there are REAL users (D-7I-1, D-7I-2).

## 1. Stage
7F: coordinators use the tasker wallet and withdrawals.

## 2. Objectives
Let an ACTIVE coordinator use the existing tasker wallet exactly as a tasker does (wallet page, saved bank accounts, withdrawals, same limits and fee), with no new wallet code of our own (C10). A customer, a suspended coordinator and anon stay refused by the database. Never create a `taskers` row for a coordinator. Add a Wallet link in the coordinator navigation and an Overview tile with the balance.

## 3. Initial assumptions and architecture
- The owner's W stages (W2a to W7a) are all WRITTEN; per `docs/withdrawals/STATUS.md` nothing is deployed and W7b (final audit and deploy) has not run. The repo's `supabase/functions/process-withdrawal/index.ts` is still the OLD function. The brief says never to edit it, so 7F ships a patched copy of the NEW W3c function elsewhere (D-7F-2).
- The site already contains a "clearing" rule (CR-2: `wallet-data.js` calls `withdrawal_clearing_mine`, handles `still_clearing`). Its SQL and handoff were NOT supplied. Therefore the SQL patch edits the live function text (D-7F-1).
- Users now can hold two roles (`sql/dual-role-customer-tasker.sql`; `users.role` = active role, `users.roles` = held). `getUserRole` is unchanged. Not examined further for coordinators.
- The coordinator ledger type is assumed to be `coordinator_commission` (see section 12, item 3).

## 4. Files inspected
`docs/local-tasker/stages/stage-07f.md`, `DECISIONS.md` (C10, D-7I-1/2), `IMPLEMENTATION-STATUS.md`, `handoffs/stage-07i.md` (head), `inputs/schema-results/stage-3a-introspect.csv` (columns, functions), `docs/withdrawals/STATUS.md`, `handoffs/W7a.md`; `sql/withdrawals/w2b-create.sql`, `w2d-accounts.sql` (the checks), `w2a-tables.sql` (grep); `supabase/functions/process-withdrawal/index.ts` (W7a version, in full around the checks and the wiring); `docs/withdrawals/tests/w3a..w3c` and `w6c`; `wallet.html`, `js/wallet-ui.js`, `js/wallet-data.js`, `js/payments.js` (getWallet, getClearing), `js/auth.js` (getUserRole, navbar), `js/coordinator-overview.js`, `js/coordinator-common.js`, `coordinator-dashboard.html`, `components/coordinator-nav.html`, `css/coordinator.css` and `css/wallet.css` (classes), `docs/local-tasker/tests/stage-7g` and `stage-7i` (fixtures, harness). The new-site diff against the earlier snapshot (dual role, booking popup, plan page, `auth.js`, `payments.js`) was listed and the files above were compared for changes: `wallet.html`, `wallet-data.js`, `sql/withdrawals/*`, the nav and the dashboard are identical to what I built on.

## 5. Files created or modified
NEW: `sql/local-tasker/stage-7f-core.sql`, `stage-7f-rollback.sql`, `stage-7f-tests.sql`; `docs/local-tasker/7f/process-withdrawal.index.ts`; `js/coordinator-wallet-tile.js`; `docs/local-tasker/RUNBOOK-7F.md`; `docs/local-tasker/handoffs/stage-07f.md`; `docs/local-tasker/tests/stage-7f/` (`sql-patch-check.py`, `process-withdrawal-coordinator.test.ts`, `wallet-7f.test.js`, `wallet-w6c-baseline.test.js`, `run-7f.py`, `fake-dashboard-supabase.js`, `screenshots/`).
CHANGED: `js/wallet-data.js`, `wallet.html`, `css/wallet.css`, `coordinator-dashboard.html`, `components/coordinator-nav.html`, `docs/local-tasker/IMPLEMENTATION-STATUS.md`, `docs/local-tasker/DECISIONS.md`.
NOT changed: the old live `process-withdrawal`, `paystack-webhook`, any W SQL file, `js/payments.js`, `js/wallet-ui.js`, RLS or grants of any money table, escrow, gift cards, verification.

Diffs (exact):
- `wallet-data.js`: (a) `state` gets `coordinator: false`; (b) new function `isActiveCoordinator(sb)` (rpc `is_active_coordinator`, true only for the exact `true`, any error or throw is false); (c) in `start()`, a non-tasker is asked once; `state.role = (role === 'tasker' || isCoordinator) ? 'tasker' : 'customer'`; a coordinator also gets `data-wallet-owner="coordinator"` and the `[data-wl-coordinator]` link is un-hidden; (d) `buildRows` has a branch for `coordinator_commission` (a credit, counted as an earning, filter "earning", title "Coordinator commission" plus the job title when known).
- `wallet.html`: one hidden desktop hero link and one hidden phone link ("Back to coordinator overview"), both `data-wl-coordinator`.
- `css/wallet.css`: `.wl-co-back` (tokens only) and `.wl-page [data-wl-coordinator][hidden] { display: none; }` (needed: the hero button class would otherwise show the link to every tasker; a test caught this).
- `coordinator-nav.html`: "Wallet" (top menu) and "Wallet & withdrawals" (drawer), both to `wallet.html`. Bottom bar untouched.
- `coordinator-dashboard.html`: a Wallet section (`.co-section` / `.co-card` / `.co-facts`) after the Local Taskers section, and the tile script tag.
- `process-withdrawal.index.ts` vs the W7a file: new exported `walletOwnerLookup(client, userId)` (rpc `is_wallet_owner`, `data === true`; falls back to the old taskers read only on 42883 / PGRST202; anything else throws `tasker_lookup_failed`); the real `isTasker` calls it; comments updated; a header note. 36 changed lines in total, shown by `diff`.
- SQL: see section 6.

## 6. Database objects affected
- NEW function `public.is_wallet_owner(p_user uuid) returns boolean` (SQL, stable, SECURITY DEFINER, `search_path = public, pg_temp`). True if `p_user` has a `public.taskers` row, or `is_active_coordinator(p_user)`. `revoke all` from public, anon, authenticated; execute to `service_role` only.
- CHANGED (one line each, by in-place text replacement of the live definition): `withdrawal_create` (WD001), `bank_account_add`, `bank_account_set_default`, `bank_account_remove`, `bank_account_set_recipient` (WA001). Old line: `if not exists (select 1 from public.taskers t where t.user_id::text = p_user::text) then`. New line: `if not public.is_wallet_owner(p_user) then`. All five are checked first; if any does not contain the old line exactly once (and is not already patched) NOTHING is changed and the error names it. Grants and ACLs are kept (`create or replace`).
- No table, column, policy, grant, trigger or RLS change. No row written by the migration. Rollback restores the line and drops the helper, deleting no rows.
- Not patched on purpose: `withdrawal_clearing_mine`, `withdrawal_limits`, `withdrawal_fee`, the W2c settle functions, the webhook and `withdrawal-reconcile` (none contain the taskers check in the files I have). The core's last query lists other wallet/withdrawal functions that still mention `public.taskers`, so the owner can see anything unexpected (read-only).

## 7. Existing components and functions reused
`is_active_coordinator(uuid)` and `is_active_coordinator()` (2C/3A), `withdrawal_limits()`, `withdrawal_fee()`, `withdrawal_create`, `bank_account_*`, `withdrawal_clearing_mine`, the whole tasker wallet page and `ST.payments`, the W3c Edge Function, `.co-section`, `.co-card`, `.co-facts`, `.co-fact-link`, `.wl-link`, `.pg-hero-btn`, the 7G/7I SQL test fixtures and the 7I browser harness.

## 8. New functionality implemented
An active coordinator: sees the tasker-style wallet, can open "Bank details" (and `#bank-details`), add/default/remove an account, open the withdraw popup and send a withdrawal request containing only action, amount and saved-account id; sees `coordinator_commission` credits in the ledger and in lifetime earnings; has a Wallet menu link, an Overview Wallet panel (balance, or a dash and a plain message if it cannot be read), and a way back from the wallet page. Everyone else is unchanged.

## 9. Important technical decisions and reasons
See DECISIONS.md D-7F-1 to D-7F-7. Key ones: patch the live function text (CR-2 SQL unknown); ship the Edge file outside `supabase/functions/` and have W7b deploy it; fail closed everywhere except the one "helper missing yet" case; no `taskers` row ever created for a coordinator.

## 10. Tests executed and ACTUAL results
Everything below ran on the AI's machine (Node 22, headless Chromium). "Fake" means the database, Paystack and login are stand-ins written for the test.
- `sql-patch-check.py` (text only, no SQL run): PASS, 0 failed. The old line occurs exactly once in each of the five functions in `w2b-create.sql` / `w2d-accounts.sql`, in no other function there; the patch changes exactly one line; undoing it restores the text exactly; core and rollback use the same two lines.
- `stage-7f-tests.sql`: **NOT RUN** (no Postgres). Written to check: helper exists / security definer / closed to browsers; five functions carry the change; helper answers (active coordinator yes; switched-off coordinator, customer, unknown, null no; a real tasker yes); refusals WA001/WD001 for a customer, a switched-off coordinator and an unknown person across the functions; an active coordinator saves an account (only last 4 digits returned) and asks for the minimum withdrawal; a tasker still passes; no coordinator has a `taskers` row. It rolls back by raising an error on purpose.
- Edge Function, fake database: existing W3a 28/0, W3b 52/0, W3c 25/0 re-run against the 7F file (105 pass); new `process-withdrawal-coordinator.test.ts` 11 passed / 0 failed (helper answers, only exact `true`, generic errors with no fallback, the 42883/PGRST202 fallback, wiring of the real `isTasker`, active coordinator can resolve a name and save an account, switched-off coordinator and customer get 403 before any Paystack lookup, a failing check gives a generic error and spends no lookup). 9 deliberate breakages, 9 caught (run on the same logic before the header comment was added).
- Wallet page in Chromium with fakes: the existing tasker wallet test (`wallet-w6c-baseline.test.js`, the W6c test with four harness repairs, see below) 190 passed / 0 failed on the final files; new `wallet-7f.test.js` 41 passed / 0 failed (coordinator gets the tasker view, ledger commission row, lifetime counts it, popup, bank sheet from `#bank-details`, one request with only action/amount/account id and the server's amounts shown, back link at 1280/390/320 px with no sideways scroll; a customer and a tasker are unchanged and see no back link; the check erroring, throwing, or answering `'true'` or `1` all give the customer view; `?role=tasker` does not make a customer an owner). 10 deliberate breakages of the wallet script and CSS caught.
- Overview and navigation in Chromium with a fake: `run-7f.py` 20 passed / 0 failed (real balance shown, one read of `wallets` for `balance` of this user only, nothing written, Wallet link in menu and drawer, other links intact, 0 balance when no wallet row, dash plus message on error/unreadable/negative, 390 and 320 px no sideways scroll, drawer, plan and taskers pages load the new nav). The 7I browser test `run-7i.py` re-run: 44 passed / 0 failed. 11 deliberate breakages of these pieces caught. Screenshots in `tests/stage-7f/screenshots/` (dashboard 1440 and 390, drawer 390, wallet as coordinator 1280, 390, 320).
- Bug found and fixed by the tests: (1) the desktop back link was visible to ordinary taskers (button class overrode `hidden`); (2) the first phone placement squeezed "Withdraw to Bank" until it was cut off.
- `node tools/check-design-system.js`: FAILS, with exactly the same three violations on the untouched site (`context-snapshot/verify.html`, `withdrawals-reference/css/tokens.css` hex and rgb). My files add none (no raw hex, no inline style, no `!important`). Baseline file not edited.
- Harness repairs to run the old W6c wallet test on the current site: add `auth.onAuthStateChange`; answer the `users` table read (the real `auth.js` now resolves the role); the function URL is now the real project URL; ignore blocked Google Fonts and `file://` navbar fetches.
- NOT RUN: any SQL, Deno, the real `process-withdrawal`, real Paystack (name lookup or transfer), the real `is_active_coordinator`, a real phone, the real navbar on `wallet.html` (the harness blocks it), a screen reader.

## 11. Security and backward-compatibility checks
- Refusals live in the database (WD001/WA001 through `is_wallet_owner`), not only the page; the helper is closed to browsers; the browser never sends a user id or a role (test-checked for withdraw).
- `is_wallet_owner` is true only for a tasker row or an active coordinator; a suspended coordinator, a customer, anon and null are false (SQL-tested in the file, NOT RUN; Edge fake-tested).
- Money functions' other checks (amount, limits, clearing, cooldown, locks, one open withdrawal) are untouched by construction (one line replaced; patch-check proves one line).
- No `taskers` row is created; a query and a test check this.
- RLS and grants on `wallets`, `wallet_transactions`, `escrow_payments`, `payments`, `payment_intents` unchanged. The Overview reads only the user's own `wallets.balance` through the existing own-row rule (not verified against the real policy).
- Fail-closed: any error in the coordinator check on the page gives the customer view with no money buttons; any error in the Edge check is a generic failure.
- Backward compatibility: tasker wallet behaviour unchanged (190 + 105 older checks pass on fakes).

## 12. Known limitations, unresolved problems, decisions still required
1. **The SQL and its tests have never been run.** `pg_get_functiondef`-based patching and `stage-7f-tests.sql` need one real run; expect to possibly send back a fix.
2. **CR-2 SQL not supplied** (`withdrawal_clearing_mine`, the `still_clearing` refusal). Preserved by design, but I do not know whether a coordinator's commission is treated as "clearing" (held for hours) or available at once. Check on the first real run.
3. **Ledger type unverified:** `coordinator_commission` comes from the status doc (7E), not from SQL I could read (`stage-7e-core.sql` is not in any upload). If 7E uses another type name, the money still arrives in the balance but no ledger row is drawn for it (the page skips unknown types). One-word fix in `buildRows`.
4. **The wallet page still shows tasker wording to coordinators** ("Task funds are held securely until client sign-off", "Escrow", "Task Earning" labels; a switched-off coordinator would see "Only taskers can withdraw money."). The brief reuses the tasker screens; owner decision if a coordinator-specific wording is wanted (that needs screens).
5. **The main navbar on `wallet.html` has no coordinator links** and may label a coordinator "CUSTOMER"/"TASKER"; I could not see the real navbar render (the harness blocks it). I added a way back only.
6. **`public.users` row:** `bank_account_add` sends a notification to the user; if a coordinator has no `public.users` row it may fail with a foreign-key error (23503). The SQL test reports this as an INFO line. Not assumed either way.
7. **LIVE keys:** the brief's "TEST mode only" no longer matches the owner's D-7I-1. No transfer was tested; the first one will be real.
8. **W7b not done:** until the W3c function and W4b webhook are deployed, nobody can use the new withdrawal path. W7b's audit gate in `DEPLOY.md` says to deploy the W7a file; it must now deploy `docs/local-tasker/7f/process-withdrawal.index.ts` (it still contains `account_add`, `bank_account_id`, `__ST_TEST__`).
9. **7D (coordinator Payments page):** its brief says it needs 7F's wallet; the handoff `stage-07d.md` and its page are not in the uploads, so any "wallet" note there was not updated.
10. **Dual roles:** a person who holds customer + tasker roles and has the "customer" role active sees the customer wallet (unchanged behaviour). Whether a coordinator can also add the tasker role was not examined; if one does, they would pass the old check anyway through their own `taskers` row.
11. Phone bottom bar not changed (D-7F-7). The Overview shows the total balance (including any clearing amount); the wallet page splits available and clearing.
12. Pre-existing: design check failures above; "growth" figure on the wallet's lifetime card (-100% when last month had earnings and this month none) is existing logic.
13. `W7a.md` item 4 open issues (profile hero button at 320, `bookings.js` refresh) are not part of 7F.

## 13. Configuration or migration requirements (none applied)
SQL `stage-7f-core.sql` (then tests): NOT applied; to be run by the owner in the Supabase SQL editor after the W SQL and CR-2 SQL. Edge Function: NOT deployed; to be deployed at W7b (dashboard, "Via Editor", JWT ON, no new secret). Site files: NOT uploaded. No new environment variable or secret.

## 14. Exact next steps
Owner: `RUNBOOK-7F.md`. Then either W7b (deploy and final audit; deploy the 7F function file), or the stages still waiting: 7D (coordinator Payments page; update its wallet note) and 8A (admin: needs the brief and reference screens, see the earlier note). After the first real run, tell the AI the SQL test output so any fix can be made.

## 15. Dependencies the next stage must preserve
`public.is_wallet_owner(uuid)` and its service-role-only grant; the one-line patch in the five functions (any rebuild of `withdrawal_create` or `bank_account_*` from `w2b`/`w2d` files MUST re-apply it, or re-run `stage-7f-core.sql` afterwards); the `isTasker`/`walletOwnerLookup` wiring in the deployed function; the `data-wl-coordinator` links and `data-wallet-owner` marker on `wallet.html`; `coordinator_commission` as the commission ledger type; no `taskers` row for any coordinator; the Wallet nav links.

## 16. MANUAL ACTIONS FOR THE OWNER
Follow `docs/local-tasker/RUNBOOK-7F.md` (numbered, with the exact clicks). In short: backup; run `stage-7f-core.sql`; run `stage-7f-tests.sql`; deploy the 7F function file at W7b; upload six site files; look at the pages; make a real withdrawal only when you are ready for a real transfer. Send back only the text of any error.

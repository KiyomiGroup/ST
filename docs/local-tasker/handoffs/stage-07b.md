# Stage 7B handoff: Verified payout destination (bank details)

Status: WRITTEN, NOT APPLIED, NOT DEPLOYED. Tested only on a scratch Postgres, with a fake database plus stubbed Paystack, and in a browser with a mocked Supabase. No real Paystack call was ever made. Nothing in your Supabase project has changed.

## OWNER STANDING INSTRUCTIONS (carried forward)
1. Read this handoff, `IMPLEMENTATION-STATUS.md` and `DECISIONS.md` first. 2. Ask for what a stage needs once, in one short batch, before generating. 3. Deliver only changed or new files as a zip. 4. Never claim a test passed, a migration applied or a payment worked unless it was run and observed. 5. No live payments, no secrets in the browser, no coordinator control over payout destinations. 6. One Supabase project, no real users yet (O2): no backup or dry-run needed; SQL stays additive, re-runnable, with a rollback file.

## 1-2. Stage and objectives
Stage 7B. Store a Local Tasker's payout destination so that only that account can ever receive their payment: verified by the bank (name resolved through Paystack and compared with the registered name), stored as a Paystack recipient code plus bank and last four digits only, changeable only through a new verification and a fresh recorded agreement, audited, never readable by the browser.

## 3. Assumptions and architecture relied on
O1 (Transfers enabled, TEST mode only), D3 (private data in new RLS tables), D9 (separate payout path, not `process-withdrawal`), D15/D16/D18 (no client writes, append-only audit and consent, audit through `local_tasker_audit()`), S3 (consent through `local_tasker_consents`, purpose `payout`). Owner answers to my three questions were not given in words; the owner sent the missing source files and asked to continue, so I proceeded with my stated proposals (strict name rule; leave out screen elements with no backing data; coordinator shell on both sizes).

## 4. Files inspected
Stage files 07a-07d; `process-withdrawal/index.ts` (flaws re-checked: recipient created from a client-supplied name, no idempotency, transfer sent before the wallet debit, CORS `*`); `payments-core.ts`; `DECISIONS.md`; `stage-02b.md`; `stage-4b1-core.sql` and `stage-2d-core.sql` (consent and audit call patterns); `coordinator-tasker-edit.html/js`, `coordinator-tasker-new.html/js`, `coordinator-tasker.html/js`, `coordinator-common.js`, `coordinator.js`, `coordinator-nav.html`, `css/coordinator.css`; `local-tasker-create/index.ts` (Edge pattern); the two reference screens; Paystack public docs (resolve and transfer recipient pages).

## 5. Files created or modified
NEW: `sql/local-tasker/stage-7b-core.sql`, `stage-7b-rollback.sql`, `stage-7b-tests.sql`; `supabase/functions/local-payout-account/index.ts`; `coordinator-tasker-payout.html`; `js/coordinator-payout.js`; `docs/local-tasker/tests/stage-7b/` (`run-scratch.mjs`, `scratch-after-scaffold.sql`, `test-edge.mjs`, `fake-supabase-7b.js`, `run-7b.py`, `README.md`, `shots/`).
MODIFIED (rebased on your 2026-11-01 zip): `css/coordinator.css` (one appended block, tokens only), `components/coordinator-nav.html` (the new page counts as "My Local Taskers", 3 places), `coordinator-tasker.html` (new "Payout account" card), `js/coordinator-tasker.js` (`loadPayout`, called after `loadPhotos`), `docs/local-tasker/IMPLEMENTATION-STATUS.md`.

## 6. Database objects (all NEW; nothing existing altered)
Tables: `local_payout_accounts` (RLS on, no policies, no grant to anon or authenticated; select to service_role for 7C; one ACTIVE row per Local Tasker by partial unique index; history guard trigger: no delete, no truncate, an update may only turn active into superseded), `local_payout_attempts` (throttle ledger, no browser access).
Functions: `local_payout_names_match(text,text)` (the single name rule), `local_payout_begin` (authority + 20 per hour throttle), `local_payout_check_name`, `local_payout_save` (the only write path; fresh `payout` consent, supersede, 2 audit rows), all SERVER-ONLY (service_role); `local_payout_account(uuid)` (masked read; managing active coordinator or admin; signed-in only).
Foreign keys: to `local_tasker_profiles(tasker_user_id)` and `local_tasker_consents(id)`, both ON DELETE RESTRICT.

## 7. Existing components reused
`is_active_coordinator(uuid)`, `coordinator_manages_tasker(uuid,uuid)`, `is_local_tasker_admin()`, `local_tasker_audit(...)`, `local_tasker_consents` (purpose `payout`, methods in_person/phone/written), the Edge pattern of `local-tasker-create` (origin allow-list, token check, hint-to-status mapping), the coordinator shell, route guard, form, card and consent patterns, `STCo` helpers.

## 8. New functionality
Coordinator opens the profile, "Payout account" card, then the new page: picks a bank (list from Paystack through the function), types the 10-digit number, presses "Check account with the bank" (name shown ONLY when it matches; a non-matching account reveals neither whose it is nor the number), ticks the two confirmations, chooses how the person agreed, and saves. The function checks again server-side, creates the Paystack recipient with the BANK's resolved name, and the database saves recipient code, bank, last four, resolved name. The browser then shows only `******1234`. Replacing an account supersedes the old one, needs a new check and a new consent, and keeps history.

## 9. Important technical decisions (add to DECISIONS.md as D30-D36)
- D30 Name rule (database, one place): ignore case, spacing, punctuation, order; every word of the registered full name must be in the bank name; at most ONE extra word; a registered name of fewer than two words never matches. Letters a-z only (an accented name is split and FAILS, the safe direction). No coordinator override.
- D31 The server never trusts a name, bank name or recipient from the browser; the bank name comes from Paystack's list, the holder name from Paystack's resolve.
- D32 Save re-resolves with Paystack and re-checks the name in the database (second lock); the function refuses to save if Paystack's recipient echoes a different last four.
- D33 A mismatch returns `matched:false` and no name (stops using the lookup to learn who owns an account). Lookups throttled to 20 per coordinator per hour in the database.
- D34 The full account number is never stored, logged, audited or returned; it exists only in the request. Free-text consent boxes refuse an 8-digit run (client and database).
- D35 A `sk_live_` key is refused unless the secret `PAYOUT_LIVE_APPROVED=yes` exists (owner O1: test only).
- D36 Screen elements with no backing data were left out on purpose: escrow figure and job count, KYC/BVN tier, "98% match", daily limit, "instant payouts", hash digest, OTP / 24-hour freeze claims, "View Historical Payouts", "Call" button, "Save Draft". The "Payout security" panel lists only things the system enforces.

## 10. Tests executed and ACTUAL results
- SQL, scratch Postgres (PGlite = Postgres 18 in WASM, NOT Supabase, NOT the Postgres 16 earlier stages used; 4C-1 scaffold stand-ins incl. a stand-in `create_local_tasker`): core run twice no errors; `stage-7b-tests.sql` 43 PASS, 0 FAIL, run twice; rollback clean; reinstall clean; tests 43 PASS again. Mutation check (name check, history trigger and throttle removed): 11 FAIL, so the tests do detect those breakages. Covers: no table or write-function privilege for anon or signed-in users; direct SELECT refused; name rule cases; authority (other coordinator, suspended, customer); throttle; refused saves leave nothing; first save, retry, change, history, one active row; masked read; audit rows hold no long digit run or recipient code; edit, re-activate, delete, truncate refused; retired person refused.
- Edge Function logic, fake database + STUBBED Paystack: 37 PASS, 0 FAIL (access, CORS, bank list and cache, validation, resolve and mismatch privacy, Paystack down or rejecting, database errors hidden, consent, server-side name and bank, only last four reach the database, name mismatch / recipient failure / wrong echo save nothing, nothing logged contains the number or name).
- Browser, MOCKED Supabase, Chromium via Playwright: 56 PASS, 0 FAIL at 1440 and 390 (states, validation, digit stripping, verification reset on edit, mismatch, save, wipe after save, masked card, error codes on screen, profile card, no storage of the number, code search: no insert/update/upsert/delete, no browser storage, no secrets, no inline styles). Screenshots in `tests/stage-7b/shots/`.
- Design check: my files add no violation. The repo-wide check FAILS on your zip as supplied, on `context-snapshot/verify.html` (31 inline) and `withdrawals-reference/css/tokens.css` (hex, rgb); not mine, and the same failure appears on the untouched zip.
- NOT RUN: anything against your Supabase; any real Paystack request (bank list, resolve, transfer recipient); Deno runtime; `stage-7b-tests.sql` in your project.

## 11. Security and compatibility checks
No existing table, policy, function or page behaviour changed except the added profile card and nav match strings. The payout table is invisible to anon and signed-in roles (privilege test + direct SELECT refused). No secret in client code (code search). Regular taskers, wallets, `process-withdrawal` and the webhook are untouched.

## 12. Known limitations, unresolved, decisions
- UNVERIFIED with real Paystack: whether `GET /bank/resolve` works in TEST mode (Paystack test keys may only resolve certain test accounts; if it fails the page shows "bank check not available" and nothing saves; no fake success is built); the bank-list cursor paging (`use_cursor`, `next`); whether creating a recipient twice returns the same code; whether the recipient response echoes the number (the function only checks the last four if it does). The 10 per-page dedupe by code is mine.
- An orphan Paystack recipient is possible if the database save fails after the recipient was created. Harmless (no money moves) but untidy.
- Re-saving an account Paystack returns with a NEW recipient code is treated as a change (new consent). If Paystack returns the same code for the same account, a retry is a no-op.
- `Top-level await` / `Deno.serve` wiring and `npm:` import follow `local-tasker-create`, but this file was never run on Deno.
- Profile statuses accepted for a new destination: `draft`, `ready`, `published` (my reading of earlier handoffs; `inactive` refused). Confirm there is no other status value.
- The throttle counts every lookup and save attempt (20 per hour), including failed ones.
- No admin view of payout history yet (8B). No coordinator can see an account number, by design, so a wrong account is fixed only by re-registering.
- 7A is still "written, not applied". 7B does not need it, but 7C does.

## 13. Configuration and migration requirements (NONE applied yet)
`stage-7b-core.sql`: written, NOT applied (by nobody). `local-payout-account`: NOT deployed. Secrets needed on the function: `PAYSTACK_SECRET_KEY` (a `sk_test_` key), optional `ALLOWED_ORIGINS`; `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` come from the runtime. Deploy with "Verify JWT" ON. Do NOT set `PAYOUT_LIVE_APPROVED` until you approve live payouts.

## 14. Exact next steps
1. Owner runs section 16. 2. Then Stage 7C (split 7C-1 payout record and release branch, 7C-2 transfer function, 7C-3 webhook and failure states), which reads `local_payout_accounts.recipient_code` with the service role and branches `_apply_payment`, `_release_escrow`, `_settle_after_dispute` for Local Taskers. Stage 7C-1 must also add `coordinator_submit_code`.

## 15. Dependencies the next stage must preserve
Keep `local_payout_accounts` unreadable by browser roles; keep one active account per person; 7C must pay ONLY to the active row's `recipient_code` and must refuse to queue a payout when there is none; never add a path that writes this table other than `local_payout_save`; keep the name rule in `local_payout_names_match`; keep `PAYOUT_LIVE_APPROVED` gating for any transfer code.

## 16. Manual actions for the project owner
1. SQL editor: run `stage-7b-core.sql` twice (second run: no errors). Then run `stage-7b-tests.sql` in full; an error box starting "STAGE 7B TESTS" and ending "RESULT: ALL PASS" is NORMAL (it undoes itself). Paste it back if any line says FAIL. Note: the test creates throwaway Local Taskers through the real `create_local_tasker`; if it errors on a column of your real tables, send me the message.
2. Supabase, Edge Functions: set secret `PAYSTACK_SECRET_KEY` to your Paystack TEST secret key (never paste it in chat). Deploy `local-payout-account` with Verify JWT ON.
3. Copy the changed files into the site (list in section 5), then as an active coordinator open a Local Tasker whose profile has a full name of at least two names, open "Payout account", and try a Paystack TEST account. Tell me exactly what the page says (including the error code if any), since this is the first real Paystack call.
4. Decide whether Paystack Transfers issues (O1) are resolved before 7C.

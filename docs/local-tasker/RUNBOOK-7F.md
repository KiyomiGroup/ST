# Runbook: Stage 7F (coordinators use the tasker wallet and withdrawals)

Everything below is for you, the owner. Use only the Supabase SQL editor, the Supabase dashboard and the website files. Nothing here is applied yet; nothing was ever run by the AI.

## READ FIRST: money and keys
- Your Paystack keys are LIVE (decision D-7I-1) and there are real users (D-7I-2). The 7F brief said "test mode only". So **the first coordinator withdrawal you make will be a real bank transfer**, with real fees. No transfer was ever tested by the AI (result: NOT TESTED). Withdraw the smallest allowed amount to your own account first, and only when you are ready for that.
- Stage 7F changes the checks inside your money functions (`withdrawal_create` and the four `bank_account_*` functions). Make sure a recent database backup exists before step 3 (Supabase dashboard, Database, Backups; menu names UNVERIFIED).

## What must already be true (the SQL checks this itself and stops safely if not)
1. The withdrawal SQL is applied: `w2a-tables.sql`, `w2b-create.sql`, `w2c-settle.sql`, `w2d-accounts.sql` (folder `sql/withdrawals/`), plus the later "clearing" (CR-2) SQL you already use. If `withdrawal_create` or a `bank_account_*` function does not exist, `stage-7f-core.sql` stops with a message and changes nothing.
2. The new `process-withdrawal` (W3c) and `paystack-webhook` (W4b) are deployed (stage W7b). Until then the live function is the OLD one and the wallet cannot withdraw for anyone.
3. Stage 7E is applied if you want commission to arrive in a coordinator's wallet.

## Steps (in this order)
1. Make sure the backup above exists.
2. Supabase, SQL Editor, New query. Paste the WHOLE of `sql/local-tasker/stage-7f-core.sql`. Run.
   - Success: no red error, and a result table with 5 rows marked `patched`. In each, `uses_helper` is true and `still_has_old_line` is false. Any rows marked `READ ONLY: still mentions public.taskers` are other wallet functions that still check the taskers table; they were NOT changed. Send me that list only if it shows a function you expected to work for coordinators.
   - If it stops with an error that starts `7F:`, nothing was changed. Send the message back.
   - Safe to run twice.
3. New query. Paste the WHOLE of `sql/local-tasker/stage-7f-tests.sql`. Run.
   - Normal result is a red error box that starts `STAGE 7F TESTS` and ends `RESULT: ALL PASS`. It rolls everything back on purpose; it leaves nothing behind and moves no money.
   - A `SKIP:` line means a check could not run (not a pass). An `INFO:` line is a finding to read, for example a coordinator with no `public.users` row that could not save an account (23503).
   - This test file has never been run. If it fails with a SQL error rather than `FAIL` lines, send me the error text.
4. Deploy the function (stage W7b, dashboard "Via Editor"): paste `docs/local-tasker/7f/process-withdrawal.index.ts` as the `process-withdrawal` function (JWT verification ON, same as W3c). Use THIS file, not the W7a one: it is the W7a file with the one line changed. If it is deployed before step 2, taskers still work (it falls back to the old check) and coordinators are refused until step 2 is done.
5. Upload the website files (merge, do not overwrite whole folders): `wallet.html`, `css/wallet.css`, `js/wallet-data.js`, `js/coordinator-wallet-tile.js`, `coordinator-dashboard.html`, `components/coordinator-nav.html`. These are built on top of the 7I versions of the dashboard and nav (already in your latest upload).
6. Look (no money): log in as an active coordinator. The Overview shows a Wallet panel; the menu has a Wallet link; the wallet page shows "Wallet & Earnings"; "Bank details" opens. A customer who opens `wallet.html` still sees the customer wallet only.
7. Only when ready for a REAL transfer: add your own bank account (the name is confirmed by Paystack), then withdraw the minimum.

## Check that no coordinator has a taskers row (should return 0)
```sql
select count(*) from public.taskers t where t.user_id::text in (select c.user_id::text from public.coordinators c);
```

## Undo
- SQL: run `sql/local-tasker/stage-7f-rollback.sql` (puts the one line back, drops the helper; deletes no rows). A coordinator keeps any bank account or withdrawal already made; they just cannot start a new one.
- Website: put the previous versions of the six files back.
- Function: re-deploy the W7a `process-withdrawal`.

## Send back only if something is wrong
The exact text of any red error, or a screenshot of a page that looks wrong.

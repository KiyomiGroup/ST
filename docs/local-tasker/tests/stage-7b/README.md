# Stage 7B tests (all on SCRATCH or MOCKED systems; none ran against your Supabase or Paystack)

1. SQL on a scratch Postgres (PGlite, Postgres 18 in WASM): `npm i @electric-sql/pglite`, then `node run-scratch.mjs <repo-root>`. Loads the 4C-1 scaffold (stand-ins), 7B core twice, tests twice, rollback, reinstall, tests again. Expected: 43 PASS each time.
2. Edge Function logic with a FAKE database and STUBBED Paystack: `node --experimental-strip-types test-edge.mjs <repo-root>/supabase/functions/local-payout-account/index.ts`. Expected: 37 PASS, 0 FAIL.
3. Page in a browser with a MOCKED Supabase (needs Python Playwright + Chromium): `ST_REPO_ROOT=<repo-root> ST_SHOTS=/tmp/shots python3 run-7b.py`. Expected last line: `TOTAL 56 FAILED 0`. Screenshots at 1440 and 390 are in `shots/`.
4. In your real project: `sql/local-tasker/stage-7b-tests.sql` (see handoff section 16).

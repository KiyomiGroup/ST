# Stage 3A browser tests (mocked Supabase)

68 checks for the coordinator pages (sign-in, overview, My Local Taskers list and profile; Stages 3A to 4A-1). Supabase is replaced by `fake-supabase.js`, so this proves the page logic only, NOT the real database or Auth.

Run (needs Python Playwright + Chromium): `ST_REPO_ROOT=/path/to/ST-Real-Main ST_SHOTS=/tmp/shots python3 run.py` from this folder.
Expected last line: `TOTAL 68 FAILED 0`.

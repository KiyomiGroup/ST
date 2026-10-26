# Stage 3A browser tests (mocked Supabase)

143 checks for the coordinator pages (sign-in, overview, My Local Taskers list, profile, Add form with consent; Stages 3A to 4A-2). Supabase is replaced by `fake-supabase.js`, so this proves the page logic only, NOT the real database or Auth.

Run (needs Python Playwright + Chromium): `ST_REPO_ROOT=/path/to/ST-Real-Main ST_SHOTS=/tmp/shots python3 run.py` from this folder.
Expected last line: `TOTAL 143 FAILED 0`.

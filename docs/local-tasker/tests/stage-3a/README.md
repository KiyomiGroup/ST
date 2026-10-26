# Stage 3A browser tests (mocked Supabase)

47 checks for coordinator-login.html and coordinator-dashboard.html. Supabase is replaced by `fake-supabase.js`, so this proves the page logic only, NOT the real database or Auth.

Run (needs Python Playwright + Chromium): `ST_REPO_ROOT=/path/to/ST-Real-Main ST_SHOTS=/tmp/shots python3 run.py` from this folder.
Expected last line: `TOTAL 47 FAILED 0`.

# Stage 3A browser tests (mocked Supabase)

307 checks for the coordinator pages (sign-in, overview, My Local Taskers list, profile, Add form with consent; Stages 3A to 4B-2; needs Pillow for the photo tests). Supabase is replaced by `fake-supabase.js`, so this proves the page logic only, NOT the real database or Auth.

Run (needs Python Playwright + Chromium): `ST_REPO_ROOT=/path/to/ST-Real-Main ST_SHOTS=/tmp/shots python3 run.py` from this folder.
Expected last line: `TOTAL 307 FAILED 0`.

Stage 4C-1 adds `run-4c1.py` (57 checks for the preview and publish page and the Publishing card; same `fake-supabase.js`). Run it the same way: `ST_REPO_ROOT=/path/to/ST-Real-Main ST_SHOTS=/tmp/shots python3 run-4c1.py`. Expected last line: `TOTAL 57 FAILED 0`.

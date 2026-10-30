#!/bin/bash
# SCRATCH Postgres 16 run for stage 6B (NOT Supabase). Usage: run-scratch.sh <repo-root>
# Loads the 5D-3b scratch scaffold, the 6A stand-in party policies, then 6A core and 6B core, runs the 6B tests (twice), rollback, reinstall.
set +e
R="$1"; D=$(mktemp -d); PGB=/usr/lib/postgresql/16/bin
chown postgres "$D"; su postgres -c "$PGB/initdb -D $D/data -A trust >/dev/null"
su postgres -c "$PGB/pg_ctl -D $D/data -o '-p 55433 -k $D' -l $D/log -w start >/dev/null"
P="psql -h $D -p 55433 -U postgres -v ON_ERROR_STOP=1 -q"
su postgres -c "$PGB/createdb -h $D -p 55433 t"
# files are fed through stdin so the postgres user does not need read access to the repo path
run() { su postgres -c "$P -d t" < "$1" 2>&1; }
run "$R/docs/local-tasker/tests/stage-5d3b/scratch-scaffold.sql" | grep -v NOTICE | head -20
run "$R/docs/local-tasker/tests/stage-6a/scratch-extra.sql"
run "$R/docs/local-tasker/tests/stage-6b/scratch-extra.sql"
echo "== 6A core"; run "$R/sql/local-tasker/stage-6a-core.sql" | grep -v NOTICE
echo "== 6B core (1st)"; run "$R/sql/local-tasker/stage-6b-core.sql" | grep -v NOTICE
echo "== 6B core (2nd, re-run)"; run "$R/sql/local-tasker/stage-6b-core.sql" | grep -v NOTICE
echo "== 6B tests"; run "$R/sql/local-tasker/stage-6b-tests.sql" | grep -v NOTICE
echo "== 6B tests (again)"; run "$R/sql/local-tasker/stage-6b-tests.sql" | grep -v NOTICE | tail -2
echo "== rollback"; run "$R/sql/local-tasker/stage-6b-rollback.sql" | grep -v NOTICE
echo "== core (after rollback)"; run "$R/sql/local-tasker/stage-6b-core.sql" | grep -v NOTICE
echo "== tests (after reinstall)"; run "$R/sql/local-tasker/stage-6b-tests.sql" | grep -v NOTICE | tail -2
echo "== 6A tests still pass"; run "$R/sql/local-tasker/stage-6a-tests.sql" | grep -v NOTICE | tail -2
echo "== REALISTIC: add imitation of the real project (unread trigger + card on thread open), 6B tests twice"
run "$R/docs/local-tasker/tests/stage-6b/scratch-realistic.sql"; run "$R/sql/local-tasker/stage-6b-tests.sql" | grep -v NOTICE | grep -E "FAIL|RESULT|SKIP"; run "$R/sql/local-tasker/stage-6b-tests.sql" | grep -v NOTICE | grep -E "FAIL|RESULT"
su postgres -c "$PGB/pg_ctl -D $D/data -m immediate stop >/dev/null" || true

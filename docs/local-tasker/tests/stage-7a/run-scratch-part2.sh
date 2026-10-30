#!/bin/bash
# SCRATCH Postgres 16 run for stage 7A part 2 (NOT Supabase). Usage: run-scratch-part2.sh <repo-root> <csv-originals-dir>
# <csv-originals-dir> holds orig_pi.sql and orig_re.sql: the owner's REAL _prepare_intent and _release_escrow, exported from CSV query 31.
set +e
R="$1"; O="$2"; D=$(mktemp -d); PGB=/usr/lib/postgresql/16/bin
chown postgres "$D"; su postgres -c "$PGB/initdb -D $D/data -A trust >/dev/null"
su postgres -c "$PGB/pg_ctl -D $D/data -o '-p 55439 -k $D' -l $D/log -w start >/dev/null"
P="psql -h $D -p 55439 -U postgres -v ON_ERROR_STOP=1 -q"
su postgres -c "$PGB/createdb -h $D -p 55439 t"
run() { su postgres -c "$P -d t" < "$1" 2>&1; }
T="$R/docs/local-tasker/tests"
run "$T/stage-5d3b/scratch-scaffold.sql" | grep -v NOTICE | head -5   # (copy the 5D-3b scaffold next to this repo first: it is in the owner's repo)
run "$T/stage-7a/scratch-scaffold-part2.sql" | grep -v NOTICE
run "$R/sql/local-tasker/stage-7a-core.sql" | grep -v NOTICE
run "$O/orig_pi.sql" | grep -v NOTICE; run "$O/orig_re.sql" | grep -v NOTICE; run "$T/stage-7a/real-apply-payment.sql" | grep -v NOTICE
echo "== BEFORE part 2 (the ORIGINAL bodies): the Local Tasker checks are EXPECTED to FAIL"; run "$R/sql/local-tasker/stage-7a2-tests.sql" | grep -v NOTICE | grep "FAIL\|RESULT\|SKIP"
echo "== part 2 core (1st)"; run "$R/sql/local-tasker/stage-7a2-core.sql" | grep -v NOTICE
echo "== part 2 core (2nd, re-run)"; run "$R/sql/local-tasker/stage-7a2-core.sql" | grep -v NOTICE
echo "== part 2 tests"; run "$R/sql/local-tasker/stage-7a2-tests.sql" | grep -v NOTICE
echo "== part 2 tests (again)"; run "$R/sql/local-tasker/stage-7a2-tests.sql" | grep -v NOTICE | tail -2
echo "== part 1 tests still pass"; run "$R/sql/local-tasker/stage-7a-tests.sql" | grep -v NOTICE | tail -2
echo "== rollback"; run "$R/sql/local-tasker/stage-7a2-rollback.sql" | grep -v NOTICE
echo "== tests after rollback (Local Tasker checks EXPECTED to FAIL again)"; run "$R/sql/local-tasker/stage-7a2-tests.sql" | grep -v NOTICE | grep "FAIL\|RESULT"
echo "== core (after rollback)"; run "$R/sql/local-tasker/stage-7a2-core.sql" | grep -v NOTICE
echo "== tests (after reinstall)"; run "$R/sql/local-tasker/stage-7a2-tests.sql" | grep -v NOTICE | tail -2
su postgres -c "$PGB/pg_ctl -D $D/data -m immediate stop >/dev/null" || true

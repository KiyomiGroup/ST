#!/bin/bash
# SCRATCH Postgres 16 run for stage 6A. Usage: run-scratch.sh <repo-root-with-5d3b-scaffold> <6a-root>
set +e
R5="$1"; R6="$2"; D=$(mktemp -d); PGB=/usr/lib/postgresql/16/bin
chown postgres "$D"; su postgres -c "$PGB/initdb -D $D/data -A trust >/dev/null"
su postgres -c "$PGB/pg_ctl -D $D/data -o '-p 55432 -k $D' -l $D/log -w start >/dev/null"
P="psql -h $D -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
su postgres -c "$PGB/createdb -h $D -p 55432 t"
run() { su postgres -c "$P -d t -f $1" 2>&1; }
run "$R5/docs/local-tasker/tests/stage-5d3b/scratch-scaffold.sql" | grep -v NOTICE | head -20
run "$R6/docs/local-tasker/tests/stage-6a/scratch-extra.sql"
echo "== core (1st)"; run "$R6/sql/local-tasker/stage-6a-core.sql" | grep -v NOTICE
echo "== core (2nd, re-run)"; run "$R6/sql/local-tasker/stage-6a-core.sql" | grep -v NOTICE
echo "== tests"; su postgres -c "$P -d t -f $R6/sql/local-tasker/stage-6a-tests.sql" 2>&1 | grep -v NOTICE
echo "== rollback"; run "$R6/sql/local-tasker/stage-6a-rollback.sql" | grep -v NOTICE
echo "== core (after rollback)"; run "$R6/sql/local-tasker/stage-6a-core.sql" | grep -v NOTICE
echo "== tests (after reinstall)"; su postgres -c "$P -d t -f $R6/sql/local-tasker/stage-6a-tests.sql" 2>&1 | grep -v NOTICE | tail -3
su postgres -c "$PGB/pg_ctl -D $D/data -m immediate stop >/dev/null" || true

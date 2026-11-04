#!/bin/bash
# SCRATCH Postgres 16 run for stage 6D-1 (NOT Supabase). Usage: run-scratch.sh <repo-root>
set +e
R="$1"; D=$(mktemp -d); PGB=/usr/lib/postgresql/16/bin
chown postgres "$D"; su postgres -c "$PGB/initdb -D $D/data -A trust >/dev/null"
su postgres -c "$PGB/pg_ctl -D $D/data -o '-p 55434 -k $D' -l $D/log -w start >/dev/null"
P="psql -h $D -p 55434 -U postgres -v ON_ERROR_STOP=1 -q"
su postgres -c "$PGB/createdb -h $D -p 55434 t"
run() { su postgres -c "$P -d t" < "$1" 2>&1; }
run "$R/docs/local-tasker/tests/stage-5d3b/scratch-scaffold.sql" | grep -v NOTICE | head -20
run "$R/docs/local-tasker/tests/stage-6a/scratch-extra.sql"
run "$R/docs/local-tasker/tests/stage-6d1/scratch-extra.sql"
echo "== 6A core"; run "$R/sql/local-tasker/stage-6a-core.sql" | grep -v NOTICE
echo "== 6B core"; run "$R/sql/local-tasker/stage-6b-core.sql" | grep -v NOTICE
echo "== 6D-1 core (1st)"; run "$R/sql/local-tasker/stage-6d1-core.sql" | grep -v NOTICE
echo "== 6D-1 core (2nd, re-run)"; run "$R/sql/local-tasker/stage-6d1-core.sql" | grep -v NOTICE
echo "== 6D-1 tests"; run "$R/sql/local-tasker/stage-6d1-tests.sql" | grep -v NOTICE
echo "== 6D-1 tests (again)"; run "$R/sql/local-tasker/stage-6d1-tests.sql" | grep -v NOTICE | tail -2
echo "== rollback"; run "$R/sql/local-tasker/stage-6d1-rollback.sql" | grep -v NOTICE
echo "== functions gone?"; su postgres -c "$P -d t -tAc \"select count(*) from pg_proc where proname in ('coordinator_chat_cards','coordinator_chat_activity')\""
echo "== core (after rollback)"; run "$R/sql/local-tasker/stage-6d1-core.sql" | grep -v NOTICE
echo "== tests (after reinstall)"; run "$R/sql/local-tasker/stage-6d1-tests.sql" | grep -v NOTICE | tail -2
su postgres -c "$PGB/pg_ctl -D $D/data -m immediate stop >/dev/null" || true

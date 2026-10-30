#!/bin/bash
# SCRATCH Postgres 16 run for stage 7A (NOT Supabase). Usage: run-scratch.sh <repo-root>
# Loads the 7A scaffold, core (twice), tests (twice), rollback, reinstall, tests again.
set +e
R="$1"; D=$(mktemp -d); PGB=/usr/lib/postgresql/16/bin
chown postgres "$D"; su postgres -c "$PGB/initdb -D $D/data -A trust >/dev/null"
su postgres -c "$PGB/pg_ctl -D $D/data -o '-p 55437 -k $D' -l $D/log -w start >/dev/null"
P="psql -h $D -p 55437 -U postgres -v ON_ERROR_STOP=1 -q"
su postgres -c "$PGB/createdb -h $D -p 55437 t"
run() { su postgres -c "$P -d t" < "$1" 2>&1; }
run "$R/docs/local-tasker/tests/stage-7a/scratch-scaffold.sql" | grep -v NOTICE | head -20
echo "== core (1st)"; run "$R/sql/local-tasker/stage-7a-core.sql" | grep -v NOTICE
echo "== core (2nd, re-run)"; run "$R/sql/local-tasker/stage-7a-core.sql" | grep -v NOTICE
echo "== tests"; run "$R/sql/local-tasker/stage-7a-tests.sql" | grep -v NOTICE
echo "== tests (again)"; run "$R/sql/local-tasker/stage-7a-tests.sql" | grep -v NOTICE | tail -2
echo "== rollback"; run "$R/sql/local-tasker/stage-7a-rollback.sql" | grep -v NOTICE
echo "== functions gone?"; su postgres -c "$P -d t -tA -c \"select count(*) from pg_proc where proname in ('is_local_tasker_user','platform_fee_rate_for_tasker','booking_fee_rates')\""
echo "== core (after rollback)"; run "$R/sql/local-tasker/stage-7a-core.sql" | grep -v NOTICE
echo "== tests (after reinstall)"; run "$R/sql/local-tasker/stage-7a-tests.sql" | grep -v NOTICE | tail -2
echo "== introspect query runs"; su postgres -c "$P -d t -tA -c 'select count(*) from (' " >/dev/null 2>&1
su postgres -c "$PGB/pg_ctl -D $D/data -m immediate stop >/dev/null" || true

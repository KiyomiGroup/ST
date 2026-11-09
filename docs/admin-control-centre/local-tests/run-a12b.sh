#!/bin/bash
# LOCAL ONLY. Usage: run-a12b.sh <repo root>. Needs a scratch Postgres 16 on /var/tmp port 5544 (initdb as a non-root user, e.g. pgtest).
R=${1:-.}; T=$R/docs/admin-control-centre/local-tests; P="psql -h /var/tmp -p 5544 -U pgtest -d postgres -X -q -v ON_ERROR_STOP=1"
psql -h /var/tmp -p 5544 -U pgtest -d postgres -X -q -c "drop schema public cascade; create schema public; drop schema if exists auth cascade;" >/dev/null 2>&1
$P -f $T/standin.sql >/dev/null 2>&1 && $P -f $T/a9-standin.sql >/dev/null && $P -f $T/a10-standin.sql >/dev/null && $P -f $T/a12b-standin.sql >/dev/null && $P -f $R/sql/admin/a1-admin-core.sql >/dev/null 2>&1 \
 && $P -f $R/sql/coordinator-onboarding/f6-admin-reassign.sql >/dev/null && $P -f $R/sql/admin/a13-disputes.sql >/dev/null 2>&1 \
 && $P -f $R/sql/admin/a9-coordinators.sql >/dev/null && $P -f $R/sql/admin/a10-local-taskers.sql >/dev/null && $P -f $R/sql/admin/a12a-bookings.sql >/dev/null && $P -f $R/sql/admin/a12b-local-booking-ops.sql | tail -2 && echo "loaded" || { echo LOAD FAILED; exit 1; }
$P -f $R/sql/admin/a12b-local-booking-ops.sql >/dev/null && echo "second run ok"
psql -h /var/tmp -p 5544 -U pgtest -d postgres -X -q -f $T/a12b-local-tests.sql

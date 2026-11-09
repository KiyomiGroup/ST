#!/bin/bash
# LOCAL ONLY. Usage: run-a9.sh <repo root>. Needs a scratch Postgres 16 on /var/tmp port 5544 (initdb as a non-root user).
R=${1:-.}; T=$R/docs/admin-control-centre/local-tests; P="psql -h /var/tmp -p 5544 -U pgtest -d postgres -X -q -v ON_ERROR_STOP=1"
$P -f $T/standin.sql >/dev/null 2>&1 && $P -f $T/a9-standin.sql >/dev/null && $P -f $R/sql/admin/a1-admin-core.sql >/dev/null 2>&1 \
 && $P -f $R/sql/coordinator-onboarding/f6-admin-reassign.sql >/dev/null && $P -f $R/sql/admin/a13-disputes.sql >/dev/null 2>&1 \
 && $P -f $R/sql/admin/a9-coordinators.sql >/dev/null && echo "loaded" || { echo LOAD FAILED; exit 1; }
psql -h /var/tmp -p 5544 -U pgtest -d postgres -X -q -f $T/a9-local-tests.sql

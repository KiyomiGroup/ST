#!/bin/bash
# LOCAL ONLY. Usage: run-a16.sh <repo root>. Needs a scratch Postgres 16 on /var/tmp port 5544 (initdb as a non-root user, e.g. pgtest).
R=${1:-.}; T=$R/docs/admin-control-centre/local-tests; P="psql -h /var/tmp -p 5544 -U pgtest -d postgres -X -q -v ON_ERROR_STOP=1"
$P -f $T/a16-standin.sql >/dev/null || { echo STANDIN FAILED; exit 1; }
$P -f $R/sql/admin/a16-revenue.sql | tail -3 || exit 1
echo "--- second run (must be safe)"; $P -f $R/sql/admin/a16-revenue.sql | tail -2
psql -h /var/tmp -p 5544 -U pgtest -d postgres -X -q -f $T/a16-local-tests.sql

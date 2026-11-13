#!/bin/bash
# LOCAL ONLY. Usage: run-a27.sh <repo root>. Needs a scratch Postgres 16 on /var/tmp port 5544 (initdb as a non-root user, e.g. pgtest).
# Builds a stand-in database with deliberate security problems and checks that a27-security-checks.sql reports each one, shows no secret value, and writes nothing.
R=${1:-.}; T=$R/docs/admin-control-centre/local-tests; P="psql -h /var/tmp -p 5544 -U pgtest -d postgres -X -q -v ON_ERROR_STOP=1"
$P -f $T/a27-standin.sql >/dev/null 2>&1 || { echo STANDIN FAILED; exit 1; }
OUT=$($P --csv -f $R/sql/admin/a27-security-checks.sql) || { echo QUERY FAILED; exit 1; }
fail=0
chk() { if echo "$OUT" | grep -q -F "$1"; then echo "pass: $2"; else echo "FAIL: $2"; fail=1; fi; }
chk "A1 admin function runnable by the signed-out role (anon),admin_bad_public,RISK" "anon-executable admin function found"
chk "admin_bad_public,RISK" "PUBLIC default grant found (A2)"
chk "admin_bad_nopath" "definer without search_path found"
chk "admin_not_definer,CHECK" "non-definer admin function found"
chk "_a99_helper,CHECK" "helper open to signed-in users found"
chk "notes,RISK" "table without row level security found"
chk "v_open,RISK" "owner-rights view readable by anon found"
chk "anyone_write_taskers" "open write policy found"
chk "users.dob" "private column readable found"
chk "notes.push_trg" "secret in trigger found (name only)"
chk "gift-card-deliveries  [SECRET-IN-TEXT" "secret in cron job found (name only)"
chk "leaky_fn" "token in function source found (name only)"
chk "E3 active admins with NO verified authenticator (MFA) factor,00000000,RISK" "admin without MFA found"
chk "F2 rows in subscription_card_authorizations (rule R-C says no saved cards; expect 0),1,CHECK" "saved-card rows found"
chk "F4 payment_intents.purpose still allows topup (rule R-W: the site takes no top-ups),yes,CHECK" "topup constraint found"
chk "H1 admin_audit_log blocks UPDATE, DELETE and TRUNCATE by trigger\",0 trigger(s),RISK" "missing audit trigger found"
for s in "AUTH_secretvalue" "eyJhbGci" "Bearer abc" "x-cron-secret: abc"; do if echo "$OUT" | grep -q -F "$s"; then echo "FAIL: secret text leaked: $s"; fail=1; else echo "pass: no leak of $s"; fi; done
B=$($P -At -c "select count(*) from public.notes")  # still empty: the query wrote nothing
[ "$B" = "0" ] && echo "pass: wrote nothing" || { echo "FAIL: data changed"; fail=1; }
echo "--- second run gives the same result"; OUT2=$($P --csv -f $R/sql/admin/a27-security-checks.sql); [ "$OUT" = "$OUT2" ] && echo "pass: repeatable" || { echo "FAIL: not repeatable"; fail=1; }
[ $fail = 0 ] && echo "ALL A27 CHECKS PASS" || echo "SOME FAILED"

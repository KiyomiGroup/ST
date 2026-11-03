# Stage 7F: checks the ONE-LINE patch of stage-7f-core.sql against the real W2b / W2d function text in sql/withdrawals/.
# It does NOT run SQL (no Postgres needed): it proves the line to be replaced occurs exactly once in each of the five functions,
# in no other function of those files, that the replacement leaves everything else byte-identical, and that the rollback restores it exactly.
# Usage (from the repo root):  python3 docs/local-tasker/tests/stage-7f/sql-patch-check.py
import re, sys
OLD = "if not exists (select 1 from public.taskers t where t.user_id::text = p_user::text) then"
NEW = "if not public.is_wallet_owner(p_user) then"
FIVE = ['withdrawal_create', 'bank_account_add', 'bank_account_set_default', 'bank_account_remove', 'bank_account_set_recipient']
text = open('sql/withdrawals/w2b-create.sql').read() + "\n" + open('sql/withdrawals/w2d-accounts.sql').read()
core = open('sql/local-tasker/stage-7f-core.sql').read(); roll = open('sql/local-tasker/stage-7f-rollback.sql').read()
fn = {}
for c in re.split(r'(?=create or replace function public\.)', text):
    m = re.match(r'create or replace function public\.(\w+)', c)
    if m: fn[m.group(1)] = c
bad = 0
def check(name, ok, x=''):
    global bad
    print(('PASS ' if ok else 'FAIL ') + name + (' | ' + str(x) if x else '')); bad += (not ok)
for n in FIVE:
    c = fn.get(n); check(n + ': function found in W2b/W2d', c is not None)
    if c is None: continue
    check(n + ': the old line occurs exactly once', c.count(OLD) == 1, c.count(OLD))
    p = c.replace(OLD, NEW)
    check(n + ': after the patch the old line is gone and the new one is there once', p.count(OLD) == 0 and p.count(NEW) == 1)
    check(n + ': undoing the patch gives back the original text exactly', p.replace(NEW, OLD) == c)
    check(n + ': only that one line differs', [l for l in zip(c.split('\n'), p.split('\n')) if l[0] != l[1]].__len__() == 1)
others = [k for k, v in fn.items() if k not in FIVE and OLD in v]
check('no other function in W2b/W2d carries the line (nothing else would be silently left taskers-only)', not others, others)
check('stage-7f-core.sql uses the same two lines', OLD in core and NEW in core)
check('stage-7f-rollback.sql restores the same line', OLD in roll and NEW in roll)
check('core names exactly the five functions', all(("'" + n + "'") in core for n in FIVE))
print('\n%d failed' % bad); sys.exit(1 if bad else 0)

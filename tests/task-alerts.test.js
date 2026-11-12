/* Stage 6f: the daily "new tasks for you" email. category_group() in sql/categories/n2-task-alerts.sql must give the same answer as
   STCat.resolve() in js/categories.js. Run: node --test tests/task-alerts.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const win = {};
const catSrc = fs.readFileSync(path.join(ROOT, 'js', 'categories.js'), 'utf8');
vm.runInNewContext(catSrc, { window: win });
const C = win.STCat;
const sql = fs.readFileSync(path.join(ROOT, 'sql', 'categories', 'n2-task-alerts.sql'), 'utf8');
const key = v => String(v || '').toLowerCase().replace(/[^a-z]/g, '');

/* the (key, group) pairs written in the SQL function */
const block = sql.slice(sql.indexOf('from (values'), sql.indexOf(') as m(k, grp)'));
const MAP = {};
for (const m of block.matchAll(/\('([a-z]+)', '([a-z_]+)'\)/g)) MAP[m[1]] = m[2];
/* a plain-JS copy of the SQL function body, to compare against resolve() */
function sqlGroup(v) {
  const raw = String(v == null ? '' : v).trim().toLowerCase();
  if (!raw) return 'other';
  const k = raw.replace(/[^a-z]/g, '');
  if (MAP[k]) return MAP[k];
  const m = sql.match(/if raw in \(([^)]*)\) then return raw;/);
  const direct = m[1].split(',').map(x => x.trim().replace(/'/g, ''));
  return direct.includes(raw) ? raw : 'other';
}

test('every alias, category value and short name in categories.js is in the SQL map', () => {
  const aliases = [...catSrc.match(/var ALIASES = \{([\s\S]*?)\n  \};/)[1].matchAll(/([a-z]+):\s*'[a-z_]+'/g)].map(m => m[1]);
  assert.ok(aliases.length > 80, 'alias list not found');
  const keys = new Set(aliases);
  C.serviceList.forEach(c => { keys.add(key(c.value)); keys.add(key(c.short)); });
  const missing = [...keys].filter(k => k && !MAP[k]);
  assert.deepStrictEqual(missing, [], 'add these to category_group(): ' + missing.join(', '));
});

test('SQL map and STCat.resolve agree on every key and on real-looking saved values', () => {
  const samples = Object.keys(MAP).concat(
    C.serviceList.map(c => c.value), C.serviceList.map(c => c.label), C.serviceList.map(c => c.short),
    ['Plumber', ' Barber ', 'Home & Furniture', 'IT & Tech', 'it_tech', 'Food & Catering', 'Beauty & Personal Care', 'Moving & Delivery',
     'Gardening & Outdoor', 'something random', '', null, undefined, 'Cleaning Services', 'SALES']);
  const bad = samples.filter(v => sqlGroup(v) !== C.resolve(v).value);
  assert.deepStrictEqual(bad, [], 'SQL and JS disagree for: ' + JSON.stringify(bad));
});

test('the SQL map only names real categories', () => {
  const real = new Set(C.serviceList.map(c => c.value));
  const wrong = Object.entries(MAP).filter(([, g]) => !real.has(g));
  assert.deepStrictEqual(wrong, []);
  const direct = sql.match(/if raw in \(([^)]*)\) then return raw;/)[1].split(',').map(x => x.trim().replace(/'/g, ''));
  assert.deepStrictEqual(direct.sort(), [...real].sort(), 'the "raw in (...)" list must be exactly the 26 category values');
});

test('the digest is safe to ship: no browser access, one email per tasker, respects the notification switches', () => {
  assert.match(sql, /revoke all on function public\.send_task_alert_digests/);
  assert.match(sql, /revoke all on function public\._task_alert_candidates/);
  assert.match(sql, /'task_digest'/);                                    /* type contains "task", so the bell opens Find Tasks */
  assert.match(sql, /New tasks you might be interested in/);
  assert.doesNotMatch(sql, /[^\x00-\x7F]/, 'non-ASCII character in the SQL (use chr(); the SQL editor garbles symbols)');
  assert.match(sql, /not public\.is_local_tasker/);                       /* nobody logs in as a Local Tasker */
  assert.match(sql, /v\.user_id is distinct from l\.poster/);              /* never told about your own task */
  assert.match(sql, /task_alert_log/);                                     /* never twice */
  assert.match(sql, /'0 7 \* \* \*'/);                                     /* 08:00 Lagos */
});

test('Post a Task no longer sends the old one-email-per-task alert', () => {
  const db = fs.readFileSync(path.join(ROOT, 'js', 'db.js'), 'utf8');
  assert.doesNotMatch(db, /await _notifyTaskersOfNewTask\(/);
});

// SCRATCH run for stage 7B on PGlite (Postgres 18 compiled to WASM), NOT Supabase.
// Usage: node run-scratch.mjs <repo-root>   (needs: npm i @electric-sql/pglite)
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const R = process.argv[2] || '.';
const T = R + '/docs/local-tasker/tests/stage-7b/', S = R + '/sql/local-tasker/';
const db = new PGlite();
async function run(label, file) {
  try { await db.exec(fs.readFileSync(file, 'utf8')); console.log('OK    ' + label); return null; }
  catch (e) { const m = String(e.message || e).split('\n')[0]; console.log('RAISED ' + label + ': ' + m); return String(e.message || e); }
}
async function tests(label) {
  const m = await run(label, S + 'stage-7b-tests.sql');
  const out = (m || '').split('\n').slice(0, 80);
  const lines = out.filter(l => /^(PASS|FAIL|SKIP|NOTE|RESULT)/.test(l));
  console.log('   ' + lines.filter(l => l.startsWith('PASS')).length + ' PASS, ' + lines.filter(l => l.startsWith('FAIL')).length + ' FAIL');
  lines.filter(l => !l.startsWith('PASS')).forEach(l => console.log('   ' + l));
}
await run('4C-1 scaffold', R + '/docs/local-tasker/tests/stage-4c1/scratch-scaffold.sql');
await run('grants', T + 'scratch-after-scaffold.sql');
await run('7B core (1st)', S + 'stage-7b-core.sql');
await run('7B core (2nd, re-run)', S + 'stage-7b-core.sql');
await tests('7B tests (1st)');
await tests('7B tests (2nd)');
await run('7B rollback', S + 'stage-7b-rollback.sql');
const g = await db.query("select to_regclass('public.local_payout_accounts') a, to_regproc('public.local_payout_save') f");
console.log('   after rollback: table ' + g.rows[0].a + ', function ' + g.rows[0].f);
await run('7B core (reinstall)', S + 'stage-7b-core.sql');
await tests('7B tests (after reinstall)');

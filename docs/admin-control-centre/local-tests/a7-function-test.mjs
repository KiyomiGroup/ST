// LOCAL ONLY (A7): runs the logic of supabase/functions/admin-account-action/index.ts in Node with FAKE Supabase clients.
// Proves the order of steps and what is refused; NOT Deno, NOT real Auth, NOT the SQL.  Run (Node 22.6+):
//   node --experimental-strip-types a7-function-test.mjs <repo root>
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2] || '.');
let src = fs.readFileSync(path.join(root, 'supabase/functions/admin-account-action/index.ts'), 'utf8');
src = src.replace(/^import .*createClient.*$/m, '').replace(/Deno\.serve\([\s\S]*$/, '');
globalThis.Deno = { env: { get: () => undefined } };
const tmp = path.join(os.tmpdir(), 'admin-account-action-under-test.ts'); fs.writeFileSync(tmp, src);
const { handleAction } = await import(pathToFileURL(tmp).href);
const results = []; const chk = (ok, t) => results.push([!!ok, t]);
const CID = '33333333-3333-4333-8333-333333333333';
const REASON = 'Repeated abusive messages to Taskers';
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
function world(o = {}) {
  const log = []; let banCalls = 0;
  const caller = { admin_customer_account_check: () => o.chk ?? { ok: true }, admin_customer_account_record: () => o.rec ?? { ok: true } };
  const createClient = (url, key, opts) => {
    const isService = key === 'service';
    return {
      auth: { getUser: async (t) => (t === 'good' ? { data: { user: { id: 'caller' } }, error: null } : { data: null, error: { message: 'bad' } }),
              admin: { updateUserById: async (id, attrs) => { banCalls += 1; log.push(['ban', id, attrs]); const fail = banCalls === 1 ? o.banFail : o.undoFail; return fail ? { data: null, error: { status: 500, message: 'secret-detail' } } : { data: {}, error: null }; } } },
      rpc: async (n, a) => { log.push([isService ? 'service' : 'caller', n, a, opts?.global?.headers?.Authorization]); const f = caller[n]; return f ? { data: f(a), error: null } : { data: null, error: { code: 'XX', message: 'no ' + n } }; },
    };
  };
  return { log, deps: { env: (n) => (o.noEnv ? undefined : ENV[n]), createClient } };
}
const req = (body, o = {}) => new Request('https://x/f', { method: o.method || 'POST', headers: { authorization: o.auth ?? 'Bearer good', origin: 'https://streettasker.com' }, body: o.method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
const run = async (body, o = {}) => { const w = world(o.world); const r = await handleAction(req(body, o), w.deps); return { status: r.status, body: await r.json().catch(() => null), log: w.log, headers: r.headers }; };
const B = { user_id: CID, action: 'suspend', reason: REASON };

let r = await run(B);
chk(r.status === 200 && r.body.ok && r.body.action === 'suspend', '1 suspend happy path: 200');
chk(JSON.stringify(r.log.map((x) => x[1])) === JSON.stringify(['admin_customer_account_check', CID, 'admin_customer_account_record']), '2 order: check, ban, record');
chk(r.log.find((x) => x[0] === 'ban')[2].ban_duration === '876000h', '3 suspend bans for a very long time');
chk(r.log.filter((x) => x[0] === 'caller').every((x) => x[3] === 'Bearer good'), '4 check and record use the CALLER token');
const rec = r.log.find((x) => x[1] === 'admin_customer_account_record')[2];
chk(rec.p_id === CID && rec.p_action === 'suspend' && rec.p_reason === REASON, '5 record gets id, action and reason');
r = await run({ ...B, action: 'restore' }); chk(r.status === 200 && r.log.find((x) => x[0] === 'ban')[2].ban_duration === 'none', '6 restore lifts the ban');
r = await run(B, { auth: '' }); chk(r.status === 401 && !r.log.length, '7 no token: 401, nothing run');
r = await run(B, { auth: 'Bearer bad' }); chk(r.status === 401 && !r.log.length, '8 bad token: 401');
r = await run({ ...B, user_id: 'x' }); chk(r.status === 400 && !r.log.length, '9 bad id: 400');
r = await run({ ...B, action: 'delete' }); chk(r.status === 400 && !r.log.length, '10 any action other than suspend or restore: 400');
r = await run({ ...B, reason: 'short' }); chk(r.status === 400 && !r.log.length, '11 short reason: 400, nothing run');
r = await run('nope'); chk(r.status === 400, '12 not JSON: 400');
r = await run(B, { method: 'GET' }); chk(r.status === 405, '13 GET: 405');
r = await run(B, { world: { noEnv: true } }); chk(r.status === 500 && r.body.error === 'server_misconfigured', '14 missing secrets: 500');
r = await run(B, { world: { chk: { ok: false, error: 'This login is also a Tasker.' } } });
chk(r.status === 409 && /Tasker/.test(r.body.message) && !r.log.some((x) => x[0] === 'ban' || x[1] === 'admin_customer_account_record'), '15 check refuses: NO ban, nothing recorded');
r = await run(B, { world: { banFail: true } });
chk(r.status === 502 && !r.log.some((x) => x[1] === 'admin_customer_account_record') && !JSON.stringify(r.body).includes('secret-detail'), '16 ban fails: 502, nothing recorded, no leak');
r = await run(B, { world: { rec: { ok: false, error: 'Could not record the change.' } } });
chk(r.status === 409 && r.log.filter((x) => x[0] === 'ban').length === 2 && r.log.filter((x) => x[0] === 'ban')[1][2].ban_duration === 'none' && /Nothing was changed/.test(r.body.message), '17 record fails: the ban is UNDONE and the message says nothing changed');
r = await run({ ...B, action: 'restore' }, { world: { rec: { ok: false, error: 'x' } } });
chk(r.log.filter((x) => x[0] === 'ban')[1][2].ban_duration === '876000h', '18 restore record fails: the customer is blocked again');
r = await run(B, { world: { rec: { ok: false, error: 'x' }, undoFail: true } });
chk(r.status === 409 && /could not be undone/.test(r.body.message) && !JSON.stringify(r.body).includes('secret-detail'), '19 undo also fails: the person is told to check Supabase Users');
r = await run({ ...B, email: 'evil@example.com', role: 'admin' }); chk(r.status === 200 && !JSON.stringify(r.log).includes('evil'), '20 extra body fields are ignored');
const bad = results.filter((x) => !x[0]);
for (const [ok, t] of results) console.log((ok ? 'PASS ' : 'FAIL ') + t);
console.log(`RESULT: ${bad.length ? bad.length + ' FAILED' : 'ALL PASS'} (${results.length} checks)`);
process.exit(bad.length ? 1 : 0);

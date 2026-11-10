// LOCAL ONLY (A5e): runs the logic of supabase/functions/admin-invite/index.ts in Node with FAKE Supabase clients.
// Proves the order of steps and what is refused; NOT Deno, NOT real Auth, NOT the SQL.  Run (Node 22.6+):
//   node --experimental-strip-types a5e-function-test.mjs <repo root>
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2] || '.');
let src = fs.readFileSync(path.join(root, 'supabase/functions/admin-invite/index.ts'), 'utf8');
src = src.replace(/^import .*createClient.*$/m, '').replace(/Deno\.serve\([\s\S]*$/, '');
globalThis.Deno = { env: { get: () => undefined } };
const tmp = path.join(os.tmpdir(), 'admin-invite-under-test.ts'); fs.writeFileSync(tmp, src);
const { handleInvite } = await import(pathToFileURL(tmp).href);

const results = []; const chk = (ok, t) => results.push([!!ok, t]);
const AID = '11111111-1111-4111-8111-111111111111';
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
function world(o = {}) {
  const log = [];
  const callerRpc = { admin_invite_precheck: () => o.pre ?? { ok: true, email: 'new@example.com', roles: ['content'] },
                      admin_invite_finish: () => o.fin ?? { ok: true, user_id: 'new-id' } };
  const serviceRpc = { admin_invite_auth_lookup: () => o.lookup ?? { exists: false, user_id: null, confirmed: false, site_account: false, is_admin: false } };
  const createClient = (url, key, opts) => {
    const isService = key === 'service';
    return {
      auth: { getUser: async (t) => (t === 'good' ? { data: { user: { id: 'caller' } }, error: null } : { data: null, error: { message: 'bad' } }),
              admin: { inviteUserByEmail: async (email, op) => { log.push(['invite', email, op]); return o.inviteFail ? { data: null, error: { status: 500, message: 'smtp' } } : { data: { user: { id: 'new-id' } }, error: null }; } } },
      rpc: async (n, a) => { log.push([isService ? 'service' : 'caller', n, a, opts?.global?.headers?.Authorization]);
        const f = (isService ? serviceRpc : callerRpc)[n]; return f ? { data: f(a), error: null } : { data: null, error: { code: 'XX', message: 'no ' + n } }; },
    };
  };
  return { log, deps: { env: (n) => (o.noEnv ? undefined : ENV[n]), createClient } };
}
const req = (body, o = {}) => new Request('https://x/f', { method: o.method || 'POST', headers: { authorization: o.auth ?? 'Bearer good', origin: o.origin ?? 'https://streettasker.com' }, body: o.method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
const run = async (body, o = {}, w = world(o.world)) => { const r = await handleInvite(req(body, o), w.deps); return { status: r.status, body: await r.json().catch(() => null), log: w.log, headers: r.headers }; };

let r = await run({ approval_id: AID });
chk(r.status === 200 && r.body.ok && r.body.email === 'new@example.com' && r.body.email_sent === true && r.body.existing_login === false, '1 happy path: 200, email sent');
const order = r.log.map((x) => x[1]);
chk(JSON.stringify(order) === JSON.stringify(['admin_invite_precheck', 'admin_invite_auth_lookup', 'invite', 'admin_invite_finish']) || JSON.stringify(order) === JSON.stringify(['admin_invite_precheck', 'admin_invite_auth_lookup', 'new@example.com', 'admin_invite_finish']), '2 order: precheck, lookup, create login, finish');
chk(r.log.filter((x) => x[0] === 'caller').every((x) => x[3] === 'Bearer good'), '3 precheck and finish run with the CALLER token (so the database sees the caller)');
chk(r.log.find((x) => x[1] === 'admin_invite_finish')[2].p_user === 'new-id' && r.log.find((x) => x[1] === 'admin_invite_finish')[2].p_approval === AID, '4 finish gets the approval id and the new login id');
const inv = r.log.find((x) => x[0] === 'invite');
chk(inv[1] === 'new@example.com' && inv[2].redirectTo === 'https://streettasker.com/admin/accept-invite.html', '5 the email comes from the APPROVED request; redirect is the accept page on an allowed origin');
r = await run({ approval_id: AID, email: 'evil@example.com', roles: ['super_admin'] });
chk(r.log.find((x) => x[0] === 'invite')[1] === 'new@example.com', '6 an email or roles in the body are ignored');
r = await run({ approval_id: AID }, { origin: 'https://evil.example' });
chk(r.log.find((x) => x[0] === 'invite')[2].redirectTo === 'https://streettasker.com/admin/accept-invite.html' && r.headers.get('access-control-allow-origin') === 'https://streettasker.com', '7 a foreign origin gets the default origin, never itself');
r = await run({ approval_id: AID }, { auth: '' }); chk(r.status === 401 && !r.log.length, '8 no token: 401, nothing run');
r = await run({ approval_id: AID }, { auth: 'Bearer bad' }); chk(r.status === 401 && !r.log.length, '9 bad token: 401, nothing run');
r = await run('not json'); chk(r.status === 400, '10 not JSON: 400');
r = await run({ approval_id: 'abc' }); chk(r.status === 400 && !r.log.length, '11 bad approval id: 400, nothing run');
r = await run({ approval_id: AID }, { method: 'GET' }); chk(r.status === 405, '12 GET: 405');
r = await run({ approval_id: AID }, { world: { noEnv: true } }); chk(r.status === 500 && r.body.error === 'server_misconfigured', '13 missing secrets: 500, no detail leaked');
r = await run({ approval_id: AID }, { world: { pre: { ok: false, error: 'That invite has not been approved (status: pending).' } } });
chk(r.status === 409 && /not been approved/.test(r.body.message) && !r.log.some((x) => x[0] === 'invite' || x[1] === 'admin_invite_finish'), '14 precheck refuses: message shown, NO login created, finish not called');
r = await run({ approval_id: AID }, { world: { lookup: { exists: true, user_id: 'u9', confirmed: true, site_account: true, is_admin: false } } });
chk(r.status === 409 && !r.log.some((x) => x[0] === 'invite' || x[1] === 'admin_invite_finish'), '15 email has a site account: refused, no login created');
r = await run({ approval_id: AID }, { world: { lookup: { exists: true, user_id: 'u9', confirmed: false, site_account: false, is_admin: false } } });
chk(r.status === 200 && r.body.email_sent === false && r.body.existing_login === true && !r.log.some((x) => x[0] === 'invite') && r.log.find((x) => x[1] === 'admin_invite_finish')[2].p_user === 'u9', '16 existing bare login: reused, no email, finish gets that login');
r = await run({ approval_id: AID }, { world: { inviteFail: true } });
chk(r.status === 502 && r.body.error === 'invite_failed' && !r.log.some((x) => x[1] === 'admin_invite_finish') && !JSON.stringify(r.body).includes('smtp'), '17 email send fails: 502, approval NOT used (finish not called), error text not leaked');
r = await run({ approval_id: AID }, { world: { fin: { ok: false, error: 'That approval has expired.' } } });
chk(r.status === 409 && /expired/.test(r.body.message) && /no admin access/.test(r.body.message), '18 finish refuses after the login was made: says the login has no admin access');
r = await run({ approval_id: AID }); chk(r.headers.get('cache-control') === 'no-store', '19 responses are not cached');
const bad = results.filter((x) => !x[0]);
for (const [ok, t] of results) console.log((ok ? 'PASS ' : 'FAIL ') + t);
console.log(`RESULT: ${bad.length ? bad.length + ' FAILED' : 'ALL PASS'} (${results.length} checks)`);
process.exit(bad.length ? 1 : 0);

// Stage 7B: Edge Function logic test against a FAKE database and a STUBBED Paystack. Not Deno, not Supabase, not real Paystack.
// Run: node --experimental-strip-types test-edge.mjs <path-to>/supabase/functions/local-payout-account/index.ts
import { pathToFileURL } from 'url';
const mod = await import(pathToFileURL(process.argv[2] || './index.ts').href);
const { handle, _resetCache } = mod;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS: ' + m); } else { fail++; console.log('FAIL: ' + m); } };

const ACCT = '0123456789', TASKER = '11111111-2222-4333-8444-555555555555', COORD = 'aaaaaaaa-2222-4333-8444-555555555555';
const logs = []; const origErr = console.error; console.error = (...a) => logs.push(a.join(' '));

function make(o = {}) {
  const calls = { rpc: [], fetch: [] };
  const deps = {
    paystackKey: o.key ?? 'sk_test_abc', liveApproved: false, extraOrigins: [],
    userIdFromToken: async (t) => (t === 'good' ? COORD : null),
    now: () => 0,
    rpc: async (name, args) => {
      calls.rpc.push([name, args]);
      if (o.rpc && o.rpc[name]) return o.rpc[name](args);
      if (name === 'is_active_coordinator') return { data: o.notCoord ? false : true, error: null };
      if (name === 'local_payout_begin') return { data: { ok: true, registered_name_ok: o.nameOk !== false }, error: null };
      if (name === 'local_payout_check_name') return { data: o.matched !== false, error: null };
      if (name === 'local_payout_save') return { data: { changed: true }, error: null };
      return { data: null, error: { message: 'unexpected ' + name } };
    },
    fetchImpl: async (url, init) => {
      calls.fetch.push([String(url), init]);
      const u = String(url);
      if (o.fetch) { const r = o.fetch(u, init); if (r) return r; }
      const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
      if (u.includes('/bank/resolve')) return J({ status: true, data: { account_name: o.resolved ?? 'BABA ALABI ADEBAYO', account_number: ACCT } });
      if (u.includes('/transferrecipient')) return J({ status: true, data: { recipient_code: 'RCP_abc123def456', details: { account_number: ACCT, bank_name: 'GTB' } } }, 201);
      if (u.includes('/bank?')) return J({ status: true, data: [{ name: 'Guaranty Trust Bank', code: '058', active: true }, { name: 'Zenith Bank', code: '057', active: true }, { name: 'Dead Bank', code: '999', active: false }], meta: { next: null } });
      return J({ status: false }, 404);
    },
  };
  return { deps, calls };
}
const post = (body, token = 'good', method = 'POST') => new Request('https://x/fn', { method, headers: { authorization: token ? 'Bearer ' + token : '', 'content-type': 'application/json', origin: 'https://streettasker.com' }, body: method === 'GET' ? undefined : JSON.stringify(body) });
const go = async (m, body, token) => { const r = await handle(post(body, token), m.deps); const t = await r.text(); return { s: r.status, t, j: JSON.parse(t) }; };
const base = { action: 'resolve', tasker_id: TASKER, bank_code: '058', account_number: ACCT };
const save = (extra = {}) => ({ action: 'save', tasker_id: TASKER, bank_code: '058', account_number: ACCT, consent: { authorized: true, ownership: true, method: 'phone', evidence_ref: 'form 1' }, ...extra });
const savedCall = (m) => m.calls.rpc.find((c) => c[0] === 'local_payout_save');

// access
let m = make(); _resetCache();
ok((await handle(post({}, 'good', 'GET'), m.deps)).status === 405, 'GET is refused (405)');
ok((await go(m, base, '')).s === 401, 'no token is refused (401)');
ok((await go(m, base, 'bad')).s === 401, 'a bad token is refused (401)');
m = make({ notCoord: true }); let r = await go(m, base);
ok(r.s === 403 && !m.calls.fetch.length, 'a non-coordinator is refused (403) before Paystack is touched');
m = make({ key: 'sk_live_zzz' }); r = await go(m, base);
ok(r.s === 503 && r.j.error === 'live_not_approved' && !m.calls.fetch.length && !m.calls.rpc.length, 'a LIVE key is refused when live payouts are not approved');
const resp = await handle(post({}, 'good', 'POST'), make().deps); ok(resp.headers.get('access-control-allow-origin') === 'https://streettasker.com', 'CORS answers the site origin, not *');
const odd = new Request('https://x/fn', { method: 'POST', headers: { authorization: 'Bearer good', origin: 'https://evil.example' }, body: '{}' });
ok((await handle(odd, make().deps)).headers.get('access-control-allow-origin') === 'https://streettasker.com', 'an unknown origin is not echoed back');

// banks
m = make(); _resetCache(); r = await go(m, { action: 'banks' });
ok(r.s === 200 && r.j.banks.length === 2 && r.j.banks[0].name === 'Guaranty Trust Bank' && !r.t.includes('Dead Bank'), 'banks lists active banks only, sorted');
await go(m, { action: 'banks' }); ok(m.calls.fetch.filter((c) => c[0].includes('/bank?')).length === 1, 'the bank list is cached (one Paystack call for two requests)');

// validation
m = make(); r = await go(m, { ...base, account_number: '12345' }); ok(r.s === 400 && !m.calls.rpc.some((c) => c[0] === 'local_payout_begin'), 'a 5-digit account number is refused before anything else');
r = await go(m, { ...base, account_number: '01234567AB' }); ok(r.s === 400, 'letters in the account number are refused');
r = await go(m, { ...base, tasker_id: 'nope' }); ok(r.s === 400, 'a bad Local Tasker id is refused');
r = await go(m, { ...base, bank_code: '9' }); ok(r.s === 400, 'a bad bank code is refused');
m = make(); r = await go(m, { ...base, bank_code: '777' }); ok(r.s === 400 && r.j.message.includes('not on the list') && !m.calls.fetch.some((c) => c[0].includes('/bank/resolve')), 'a bank code not on Paystack\'s list never reaches resolve');

// resolve
m = make(); _resetCache(); r = await go(m, base);
ok(r.s === 200 && r.j.matched === true && r.j.account_name === 'BABA ALABI ADEBAYO', 'resolve with a matching name returns the name');
ok(!r.t.includes(ACCT), 'the resolve response never contains the account number');
m = make({ matched: false, resolved: 'CHIKA OKORO OBI' }); _resetCache(); r = await go(m, base);
ok(r.s === 200 && r.j.matched === false && !r.t.includes('CHIKA') && !r.t.includes(ACCT), 'a non-matching account reveals neither whose it is nor the number');
m = make({ nameOk: false }); _resetCache(); r = await go(m, base);
ok(r.s === 422 && r.j.error === 'registered_name_incomplete' && !m.calls.fetch.length, 'a one-word registered name stops before Paystack is asked');
m = make({ fetch: (u) => (u.includes('/bank/resolve') ? new Response(JSON.stringify({ status: false, message: 'Could not resolve account name' }), { status: 422 }) : null) }); _resetCache(); r = await go(m, base);
ok(r.s === 422 && r.j.error === 'account_not_found', 'Paystack saying it cannot resolve gives account_not_found');
m = make({ fetch: (u) => (u.includes('/bank/resolve') ? new Response('{}', { status: 500 }) : null) }); _resetCache(); r = await go(m, save());
ok(r.s === 502 && r.j.error === 'paystack_unavailable' && !savedCall(m), 'Paystack down: 502, nothing saved');
m = make({ fetch: (u) => { if (u.includes('/bank/resolve')) throw new Error('network'); return null; } }); _resetCache(); r = await go(m, save());
ok(r.s === 502 && !savedCall(m), 'a network failure: 502, nothing saved');
m = make({ fetch: (u) => (u.includes('/bank/resolve') ? new Response('{"status":false,"message":"Invalid key"}', { status: 401 }) : null) }); _resetCache(); r = await go(m, save());
ok(r.s === 502 && r.j.error === 'paystack_unavailable' && !savedCall(m), 'a rejected Paystack key is reported as unavailable, not as a bad account');

// database errors
m = make({ rpc: { local_payout_begin: () => ({ data: null, error: { code: 'P0001', message: 'x', hint: 'not_found' } }) } }); r = await go(m, base); ok(r.s === 404 && !m.calls.fetch.length, 'not_found from the database: 404 and Paystack never called');
m = make({ rpc: { local_payout_begin: () => ({ data: null, error: { code: 'P0001', message: 'x', hint: 'rate_limited' } }) } }); r = await go(m, base); ok(r.s === 429, 'rate_limited from the database: 429');
m = make({ rpc: { local_payout_begin: () => ({ data: null, error: { code: '23505', message: 'dup 0123456789' } }) } }); r = await go(m, base); ok(r.s === 500 && !r.t.includes('0123456789'), 'an unexpected database error is hidden');

// save
m = make(); _resetCache(); r = await go(m, save({ consent: { authorized: true, ownership: false, method: 'phone' } })); ok(r.s === 400 && !m.calls.rpc.some((c) => c[0] === 'local_payout_begin'), 'save needs BOTH confirmations');
r = await go(m, save({ consent: { authorized: true, ownership: true } })); ok(r.s === 400 && r.j.error === 'consent_required', 'save needs the consent method');
m = make(); _resetCache(); r = await go(m, save({ account_name: 'EVIL NAME', bank_name: 'Evil Bank', recipient_code: 'RCP_evil000000' }));
const sc = savedCall(m);
ok(r.s === 200 && r.j.ok && r.j.changed === true && r.j.account_mask === '******6789' && r.j.bank_name === 'Guaranty Trust Bank', 'save succeeds and answers with the mask only');
ok(sc && sc[1].p_resolved_name === 'BABA ALABI ADEBAYO' && sc[1].p_bank_name === 'Guaranty Trust Bank' && sc[1].p_recipient_code === 'RCP_abc123def456', 'the name, bank and recipient come from the SERVER side; browser-sent values are ignored');
ok(sc && sc[1].p_last4 === '6789' && !JSON.stringify(m.calls.rpc).includes(ACCT), 'only the last four digits ever reach the database; the full number appears in no rpc argument');
ok(!r.t.includes(ACCT) && !r.t.includes('RCP_'), 'the save response holds neither the number nor the recipient code');
const rec = m.calls.fetch.find((c) => c[0].includes('/transferrecipient')); const recBody = JSON.parse(rec[1].body);
ok(recBody.name === 'BABA ALABI ADEBAYO' && recBody.type === 'nuban' && recBody.currency === 'NGN' && recBody.account_number === ACCT, 'the recipient is created with the bank\'s resolved name');
m = make({ matched: false }); _resetCache(); r = await go(m, save());
ok(r.s === 422 && r.j.error === 'name_mismatch' && !m.calls.fetch.some((c) => c[0].includes('/transferrecipient')) && !savedCall(m), 'a name mismatch creates no recipient and saves nothing');
m = make({ fetch: (u) => (u.includes('/transferrecipient') ? new Response('{"status":false}', { status: 422 }) : null) }); _resetCache(); r = await go(m, save());
ok(r.s === 502 && r.j.error === 'recipient_failed' && !savedCall(m), 'a failed recipient creation saves nothing');
m = make({ fetch: (u) => (u.includes('/transferrecipient') ? new Response(JSON.stringify({ status: true, data: { recipient_code: 'RCP_abc123def456', details: { account_number: '0000009999' } } }), { status: 201 }) : null) }); _resetCache(); r = await go(m, save());
ok(r.s === 502 && !savedCall(m), 'a recipient for a different account than the one asked saves nothing');
m = make({ rpc: { local_payout_save: () => ({ data: null, error: { code: 'P0001', message: 'no match', hint: 'name_mismatch' } }) } }); _resetCache(); r = await go(m, save());
ok(r.s === 422 && r.j.error === 'name_mismatch', 'the database name check is a second lock (its refusal is passed on)');
ok(!logs.join('\n').includes(ACCT) && !logs.join('\n').includes('BABA'), 'nothing logged contains the account number or the name');
console.error = origErr;
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);

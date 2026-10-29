// Node check of js/messages-local.js with a MOCKED Supabase client. Usage: node run-6a-js.js <path to js/messages-local.js>
const L = require(require('path').resolve(process.argv[2]));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS: ' + m); } else { fail++; console.log('FAIL: ' + m); } };
(async () => {
  const calls = [];
  const sb = { rpc: async (n, a) => { calls.push([n, a]); return { data: [
    { thread_id: 'T1', coordinator_assigned: true, coordinator_name: '<b>Ada</b>' },
    { thread_id: 'T3', coordinator_assigned: false, coordinator_name: null } ], error: null }; } };
  const th = [{ id: 'T1', context_type: 'booking' }, { id: 'T2', context_type: 'booking' }, { id: 'T3', context_type: 'booking' }, { id: 'T4', context_type: 'application' }, { id: 'T1', context_type: 'booking' }];
  await L.load(th, sb);
  ok(calls.length === 1 && calls[0][0] === 'local_thread_labels' && JSON.stringify(calls[0][1].p_threads) === '["T1","T2","T3"]', 'one rpc, booking threads only, no duplicates');
  ok(L.contactName(th[0], 'Tasker') === '<b>Ada</b>', 'Local Tasker thread shows the coordinator name as plain text (the caller uses textContent)');
  ok(L.contactName(th[1], 'Tasker') === 'Tasker' && !L.isLocal(th[1]), 'a regular thread keeps the normal name');
  ok(L.contactName(th[2], 'Tasker') === 'StreetTasker coordinator', 'no coordinator assigned: generic coordinator wording');
  ok(L.contactRole(th[0]) === 'Coordinator' && L.contactRole(th[1]) === '', 'role label only for Local Tasker threads');
  const bad = [{ id: 'X', context_type: 'booking' }];
  await L.load(bad, { rpc: async () => { throw new Error('net'); } });
  ok(!L.isLocal(bad[0]), 'a failing call leaves the thread unchanged and does not throw');
  await L.load(bad, { rpc: async () => ({ data: null, error: { message: 'no' } }) });
  ok(!L.isLocal(bad[0]), 'an rpc error leaves the thread unchanged');
  const none = []; ok((await L.load(none, sb)) === none && calls.length === 1, 'empty list makes no call');
  console.log(fail ? 'RESULT: FAILURES' : 'RESULT: ALL PASS (' + pass + ')'); process.exit(fail ? 1 : 0);
})();

const test = require('node:test');
const assert = require('node:assert');
const psi = require('../js/post-service-invite.js');

const first = { hasService: false, tourStatus: 'new', signIn: 'A' };

test('first visit, no service: show', () => assert.strictEqual(psi.decide(null, first).show, true));
test('has a service: never show', () => assert.strictEqual(psi.decide(null, { ...first, hasService: true }).show, false));
test('service status unknown: do not guess', () => assert.strictEqual(psi.decide(null, { ...first, hasService: null }).show, false));
test('tour already seen and no record: not a first visit', () => assert.strictEqual(psi.decide(null, { ...first, tourStatus: 'completed' }).show, false));
test('tour replay: never show', () => assert.strictEqual(psi.decide(null, { ...first, replay: true }).show, false));
test('declined, same sign-in: stay hidden', () => assert.strictEqual(psi.decide({ status: 'declined', signIn: 'A', declines: 1 }, first).show, false));
test('declined, new sign-in, still no service: come back', () => assert.strictEqual(psi.decide({ status: 'declined', signIn: 'A', declines: 1 }, { ...first, signIn: 'B', tourStatus: 'skipped' }).show, true));
test('declined, new sign-in, posted a service: stay hidden', () => assert.strictEqual(psi.decide({ status: 'declined', signIn: 'A', declines: 1 }, { ...first, signIn: 'B', hasService: true }).show, false));
test('declined twice: never again', () => assert.strictEqual(psi.decide({ status: 'declined', signIn: 'B', declines: 2 }, { ...first, signIn: 'C' }).show, false));
test('accepted: never reminded here', () => assert.strictEqual(psi.decide({ status: 'accepted', signIn: 'A', declines: 0 }, { ...first, signIn: 'B' }).show, false));
test('remember counts declines', () => {
  const a = psi.remember(null, 'declined', 'A');
  assert.deepStrictEqual(a, { status: 'declined', signIn: 'A', declines: 1 });
  assert.strictEqual(psi.remember(a, 'declined', 'B').declines, 2);
  assert.strictEqual(psi.remember(a, 'accepted', 'B').status, 'accepted');
});

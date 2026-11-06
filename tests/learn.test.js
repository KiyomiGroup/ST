/* Unit tests for js/learn-content.js (Help / Learn).   Run:  node --test tests/learn.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/learn-content.js');
const home = require('../js/onboarding-tours-home.js');

test('every topic has a unique id, a title, a summary and steps', () => {
  const ids = new Set();
  C.TOPICS.forEach((t) => {
    assert.ok(t.id && t.title && t.summary && t.steps.length, t.id);
    assert.ok(['both', 'customer', 'tasker'].includes(t.role), t.id);
    assert.ok(!ids.has(t.id), 'repeated id ' + t.id); ids.add(t.id);
  });
});
test('the spec topics are all present', () => {
  const ids = C.TOPICS.map((t) => t.id);
  ['getting-started', 'customer-guide', 'tasker-guide', 'posting-tasks', 'booking-services', 'finding-tasks', 'chat-offers', 'payments', 'managing-bookings']
    .forEach((id) => assert.ok(ids.includes(id), id));
  assert.ok(C.FAQ.length >= 5);
});
test('topicsFor shows shared topics plus the role, and everything to guests', () => {
  const c = C.topicsFor('customer').map((t) => t.id), k = C.topicsFor('tasker').map((t) => t.id);
  assert.ok(c.includes('posting-tasks') && !c.includes('finding-tasks') && c.includes('payments'));
  assert.ok(k.includes('finding-tasks') && !k.includes('posting-tasks') && k.includes('payments'));
  assert.equal(C.topicsFor(null).length, C.TOPICS.length);
});
test('tourIdsFor keeps only registered tours that fit the role', () => {
  const topic = C.TOPICS.find((t) => t.id === 'getting-started');
  const reg = new Set([home.CUSTOMER_ID, home.TASKER_ID]);
  const roleOf = (id) => (id === home.CUSTOMER_ID ? 'customer' : 'tasker');
  assert.deepEqual(C.tourIdsFor(topic, 'customer', (id) => reg.has(id), roleOf), [home.CUSTOMER_ID]);
  assert.deepEqual(C.tourIdsFor(topic, 'tasker', (id) => reg.has(id), roleOf), [home.TASKER_ID]);
  const later = C.TOPICS.find((t) => t.id === 'posting-tasks');
  assert.deepEqual(C.tourIdsFor(later, 'customer', (id) => reg.has(id), roleOf), [], 'tours not built yet are not offered');
});
test('button and status labels follow the saved status', () => {
  assert.equal(C.actionLabel('new'), 'Start tour');
  assert.equal(C.actionLabel('in_progress'), 'Restart tour');
  assert.equal(C.actionLabel('skipped'), 'Replay tour');
  assert.equal(C.actionLabel('completed'), 'Replay tour');
  assert.equal(C.statusLabel('skipped'), 'Skipped');
  assert.equal(C.statusLabel('whatever'), 'Not started');
});

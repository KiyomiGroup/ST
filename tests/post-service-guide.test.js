const test = require('node:test');
const assert = require('node:assert');
const g = require('../js/post-service-guide.js');

const ids = ['name', 'category', 'cf-a', 'method', 'price', 'photo'];

test('nextIndex moves on and stays on the last page', () => {
  assert.strictEqual(g.nextIndex(ids, 'name'), 1);
  assert.strictEqual(g.nextIndex(ids, 'photo'), 5);
});
test('nextIndex copes with a page that disappeared (category changed)', () => {
  assert.strictEqual(g.nextIndex(ids, 'cf-gone', 2), 2);   /* was on index 2, so the page after it is the one now at index 2 */
});
test('prevIndex moves back and stops at the first page', () => {
  assert.strictEqual(g.prevIndex(ids, 'price'), 3);
  assert.strictEqual(g.prevIndex(ids, 'name'), 0);
});
test('progress counts from question 1', () => {
  assert.deepStrictEqual(g.progress(0, 10), { n: 1, total: 10, pct: 0 });
  assert.strictEqual(g.progress(5, 10).pct, 50);
});
test('a name-only draft is saved unpublished with safe blanks', () => {
  const d = g.draftPayload({ userId: 'u1', name: '  Home   cleaning ' });
  assert.strictEqual(d.service_name, 'Home cleaning');
  assert.strictEqual(d.available, false);
  assert.strictEqual(d.price, 0);
  assert.strictEqual(d.category, 'other');
  assert.strictEqual(d.subcategory, null);
  assert.deepStrictEqual(d.details, {});
  assert.strictEqual(d.location, '');
});
test('an empty draft still gets a name', () => assert.strictEqual(g.draftPayload({ userId: 'u1', name: '' }).service_name, 'Untitled service'));
test('subcategory only kept for a real category', () => {
  assert.strictEqual(g.draftPayload({ userId: 'u', category: 'handyman', subcategory: 'Plumbing' }).subcategory, 'Plumbing');
  assert.strictEqual(g.draftPayload({ userId: 'u', category: 'other', subcategory: 'x' }).subcategory, null);
});

/* Pricing methods (Categories Stage 6a). Run: node --test tests/pricing-methods.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../js/pricing-methods.js');

test('the eleven methods: the nine from the Category Directory plus Price range and Per visit', () => {
  const keys = P.METHODS.map(m => m.key);
  assert.strictEqual(new Set(keys).size, keys.length);
  ['fixed', 'hourly', 'daily', 'item', 'session', 'unit', 'from', 'negotiable', 'quote', 'range', 'visit'].forEach(k => assert.ok(keys.includes(k), k));
  P.METHODS.forEach(m => { assert.ok(m.label && m.hint && m.cardLabel && m.unit); assert.ok(['one', 'range', 'optional', 'none'].includes(m.amount)); });
});

test('old rows (no price_type) read the way they always did', () => {
  assert.strictEqual(P.describe({ price: 15000, rate_unit: '/job' }).label, 'Starting From');
  assert.strictEqual(P.describe({ price: 15000, rate_unit: '/job' }).text, '\u20a615,000');
  assert.strictEqual(P.describe({ price: 5000, rate_unit: '/hour' }).text, '\u20a65,000/hour');
  assert.strictEqual(P.describe({ price: 20000, price_max: 30000, rate_unit: '/job' }).label, 'Price range');
  assert.strictEqual(P.describe({ price: 20000, price_max: 30000, rate_unit: '/job' }).amount, '\u20a620,000\u2013\u20a630,000');
  assert.strictEqual(P.describe({ price: 0 }).amount, 'Ask for a quote');
  assert.strictEqual(P.describe(null).amount, 'Ask for a quote');
});

test('new rows: each method shows its own label and unit', () => {
  assert.deepStrictEqual({ l: P.describe({ price: 25000, rate_unit: '/job', price_type: 'fixed' }).label, t: P.describe({ price: 25000, rate_unit: '/job', price_type: 'fixed' }).text }, { l: 'Fixed price', t: '\u20a625,000' });
  assert.strictEqual(P.describe({ price: 30000, rate_unit: '/day', price_type: 'daily' }).text, '\u20a630,000/day');
  assert.strictEqual(P.describe({ price: 2000, rate_unit: '/item', price_type: 'item' }).label, 'Per item');
  assert.strictEqual(P.describe({ price: 10000, rate_unit: '/session', price_type: 'session' }).text, '\u20a610,000/session');
  const u = P.describe({ price: 5000, rate_unit: '/unit', price_type: 'unit', price_unit_label: 'square metre' });
  assert.strictEqual(u.label, 'Per square metre'); assert.strictEqual(u.text, '\u20a65,000/square metre');
  assert.strictEqual(P.describe({ price: 15000, rate_unit: '/job', price_type: 'from' }).label, 'Starting From');
  assert.strictEqual(P.describe({ price: 0, price_type: 'negotiable' }).amount, 'Negotiable');
  assert.strictEqual(P.describe({ price: 8000, price_type: 'negotiable', rate_unit: '/job' }).text, '\u20a68,000');
  assert.strictEqual(P.describe({ price: 0, price_type: 'quote' }).label, 'Custom quotation');
  assert.strictEqual(P.describe({ price: 999, price_type: 'quote' }).amount, 'Ask for a quote', 'a custom quotation never shows a price');
});

test('check: each method asks for the right amounts', () => {
  assert.ok(P.check('fixed', '', ''));
  assert.strictEqual(P.check('fixed', 25000, ''), '');
  assert.ok(P.check('hourly', 0, ''));
  assert.ok(P.check('range', 10, 5)); assert.ok(P.check('range', 10, 10)); assert.strictEqual(P.check('range', 10, 20), '');
  assert.ok(P.check('unit', 5000, '', '')); assert.ok(P.check('unit', 5000, '', 'x'.repeat(31)));
  assert.strictEqual(P.check('unit', 5000, '', 'square metre'), '');
  assert.strictEqual(P.check('negotiable', '', ''), ''); assert.strictEqual(P.check('negotiable', 5000, ''), ''); assert.ok(P.check('negotiable', -4, ''));
  assert.strictEqual(P.check('quote', '', ''), '');
  assert.ok(P.check('nonsense', 1, 1));
});

test('toRow: what gets saved', () => {
  assert.deepStrictEqual(Object.assign({}, P.toRow('hourly', '5000', '', '')), { price: 5000, price_max: null, rate_unit: '/hour', price_type: 'hourly', price_unit_label: null });
  assert.deepStrictEqual(Object.assign({}, P.toRow('range', '10000', '20000', '')), { price: 10000, price_max: 20000, rate_unit: '/job', price_type: 'range', price_unit_label: null });
  assert.strictEqual(P.toRow('fixed', '10000', '20000', '').price_max, null, 'a stray "To" is dropped for a single price');
  assert.deepStrictEqual(Object.assign({}, P.toRow('quote', '9', '9', '')), { price: 0, price_max: null, rate_unit: '/job', price_type: 'quote', price_unit_label: null });
  assert.strictEqual(P.toRow('unit', '5000', '', '  square   metre ').price_unit_label, 'square metre');
  assert.strictEqual(P.toRow('negotiable', '', '', '').price, 0);
  assert.strictEqual(P.toRow('bad', 1, 1), null);
  /* every saved row reads back as the same method */
  P.METHODS.forEach(m => { const r = P.toRow(m.key, 7000, 9000, 'sack'); assert.strictEqual(P.typeOf(r), m.key); });
});

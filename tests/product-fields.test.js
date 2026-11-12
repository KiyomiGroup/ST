/* Sales upgrade (Categories Stage 6b). Run: node --test tests/product-fields.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../js/product-fields.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const win = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'categories.js'), 'utf8'), { window: win });
const C = win.STCat;

test('every Sales subcategory belongs to exactly one product group, and the groups name no stranger', () => {
  const subs = (C.subsOf ? C.subsOf('sales') : []).filter(n => !/^Other \(not listed\)$/.test(n));   /* the catch-all gets the default question set */
  assert.ok(subs.length >= 20, 'Sales subcategories found');
  const seen = {};
  Object.keys(S.GROUPS).forEach(g => S.GROUPS[g].subs.forEach(n => { seen[n] = (seen[n] || 0) + 1; assert.ok(subs.includes(n), g + ' names an unknown subcategory: ' + n); }));
  subs.forEach(n => assert.strictEqual(seen[n], 1, n + ' must be in exactly one group'));
});

test('only questions that fit the product are offered', () => {
  assert.deepStrictEqual(Array.from(S.fieldsFor('Phones & Accessories')), ['condition', 'brand', 'model', 'colour']);
  assert.ok(S.fieldsFor('Fashion & Clothing').includes('size'));
  assert.ok(!S.fieldsFor('Phones & Accessories').includes('size'));
  assert.ok(S.fieldsFor('Food & Groceries').includes('expiry'));
  assert.ok(!S.fieldsFor('Food & Groceries').includes('condition'), 'food is not "fairly used"');
  assert.deepStrictEqual(Array.from(S.fieldsFor('')), ['condition']);
  assert.deepStrictEqual(Array.from(S.fieldsFor('Something new')), ['condition']);
});

test('check: price, original price, quantity, condition, expiry', () => {
  const sub = 'Phones & Accessories';
  assert.ok(S.check({ price: 0 }, sub));
  assert.strictEqual(S.check({ price: 5000 }, sub), '');
  assert.ok(S.check({ price: 5000, was_price: 4000 }, sub), 'original must be higher');
  assert.ok(S.check({ price: 5000, was_price: 5000 }, sub));
  assert.strictEqual(S.check({ price: 5000, was_price: 6000 }, sub), '');
  assert.ok(S.check({ price: 5000, quantity: -1 }, sub)); assert.ok(S.check({ price: 5000, quantity: 1.5 }, sub)); assert.ok(S.check({ price: 5000, quantity: 100000 }, sub));
  assert.strictEqual(S.check({ price: 5000, quantity: 0 }, sub), '');
  assert.ok(S.check({ price: 5000, condition: 'Used a lot' }, sub));
  assert.strictEqual(S.check({ price: 5000, condition: 'Refurbished' }, sub), '');
  assert.ok(S.check({ price: 50, expiry_date: 'next year' }, 'Food & Groceries'));
  assert.strictEqual(S.check({ price: 50, expiry_date: '2027-03-01' }, 'Food & Groceries'), '');
  assert.strictEqual(S.check({ price: 50, expiry_date: 'garbage' }, 'Phones & Accessories'), '', 'an expiry that is not asked for is ignored');
  assert.ok(S.check({ price: 50, stock_status: 'whatever' }, sub));
});

test('toRow keeps only what fits and cleans text', () => {
  const r = S.toRow({ price: 9, condition: 'Brand New', brand: '  Tecno   Mobile ', model: 'Spark', colour: 'Black', size: 'XL', expiry_date: '2027-01-01', quantity: '4', was_price: '12000', negotiable: true, stock_status: 'paused' }, 'Phones & Accessories');
  assert.deepStrictEqual(Object.assign({}, r), { condition: 'Brand New', brand: 'Tecno Mobile', model: 'Spark', colour: 'Black', size: null, expiry_date: null, quantity: 4, stock_status: 'paused', negotiable: true, was_price: 12000 });
  const f = S.toRow({ price: 9, brand: 'X', condition: 'Brand New', expiry_date: '2027-01-01' }, 'Food & Groceries');
  assert.strictEqual(f.condition, null); assert.strictEqual(f.expiry_date, '2027-01-01'); assert.strictEqual(f.stock_status, 'in_stock'); assert.strictEqual(f.quantity, null); assert.strictEqual(f.negotiable, false);
  assert.strictEqual(S.toRow({ brand: 'a'.repeat(99) }, 'Furniture').brand.length, 40);
});

test('stock: what a customer can order', () => {
  assert.ok(S.canOrder({})); assert.ok(S.canOrder({ stock_status: 'in_stock', quantity: 3 }));
  assert.ok(!S.canOrder({ stock_status: 'sold' })); assert.ok(!S.canOrder({ stock_status: 'paused' })); assert.ok(!S.canOrder({ stock_status: 'out_of_stock' }));
  assert.ok(!S.canOrder({ stock_status: 'in_stock', quantity: 0 }), 'quantity 0 counts as out of stock');
  assert.strictEqual(S.stockLabel({ quantity: 0 }), 'Out of stock'); assert.strictEqual(S.stockLabel({ stock_status: 'sold' }), 'Sold'); assert.strictEqual(S.stockLabel(null), 'In stock');
  assert.strictEqual(S.maxQty({ quantity: 3 }), 3); assert.strictEqual(S.maxQty({ quantity: 500 }), 50); assert.strictEqual(S.maxQty({ quantity: null }), 50); assert.strictEqual(S.maxQty({}), 50);
});

test('badges and price parts', () => {
  assert.deepStrictEqual(Array.from(S.badges({ condition: 'Fairly Used', brand: 'HP', model: 'Pavilion', colour: 'Silver', size: 'M' }, 'Computers & Electronics')), ['Fairly Used', 'HP', 'Pavilion', 'Silver']);
  assert.deepStrictEqual(Array.from(S.badges({ expiry_date: '2027-02-02', brand: 'Milo' }, 'Drinks & Beverages')), ['Milo', 'Expires 2027-02-02']);
  assert.deepStrictEqual(Object.assign({}, S.priceParts({ price: 8000, was_price: 10000, negotiable: true })), { now: '\u20a68,000', was: '\u20a610,000', negotiable: true });
  assert.strictEqual(S.priceParts({ price: 8000, was_price: 7000 }).was, '', 'a "was" price that is not higher is not shown');
});

test('delivery and pickup', () => {
  assert.ok(S.checkFulfilment({})); assert.ok(S.checkFulfilment({ delivery: false, pickup: false }));
  assert.strictEqual(S.checkFulfilment({ pickup: true }), ''); assert.strictEqual(S.checkFulfilment({ delivery: true }), '');
  assert.ok(S.checkFulfilment({ delivery: true, delivery_fee: -5 })); assert.ok(S.checkFulfilment({ delivery: true, delivery_fee: 'abc' })); assert.ok(S.checkFulfilment({ delivery: true, delivery_time: 'someday' }));
  assert.strictEqual(S.checkFulfilment({ pickup: true, delivery_fee: 'abc' }), '', 'fee is ignored when there is no delivery');
  assert.deepStrictEqual(Object.assign({}, S.toDetails({ delivery: true, pickup: true, delivery_fee: '2000', delivery_time: '1-2 days' })), { _v: 1, delivery: true, pickup: true, delivery_fee: 2000, delivery_time: '1-2 days' });
  assert.deepStrictEqual(Object.assign({}, S.toDetails({ pickup: true, delivery_fee: '2000', delivery_time: '1-2 days' })), { _v: 1, delivery: false, pickup: true, delivery_fee: null, delivery_time: null });
  assert.strictEqual(S.toDetails({ delivery: true, delivery_fee: '0' }).delivery_fee, 0);
  assert.strictEqual(S.toDetails({ delivery: true, delivery_fee: '' }).delivery_fee, null);
  const t = x => S.describeFulfilment(x).map(l => l.label + ': ' + l.text);
  assert.deepStrictEqual(t({ delivery: true, pickup: true, delivery_fee: 2000, delivery_time: '1-2 days' }), ['How you get it: Delivery and Pickup', 'Delivery fee: \u20a62,000', 'Delivery time: 1-2 days']);
  assert.deepStrictEqual(t({ delivery: true, pickup: false, delivery_fee: 0 }), ['How you get it: Delivery', 'Delivery fee: Free']);
  assert.deepStrictEqual(t({ delivery: true, delivery_fee: null }), ['How you get it: Delivery', 'Delivery fee: Agreed in the chat']);
  assert.deepStrictEqual(t({ pickup: true, delivery: false }), ['How you get it: Pickup']);
  assert.deepStrictEqual(t({}), []); assert.deepStrictEqual(t(null), []); assert.deepStrictEqual(t({ _v: 1 }), []);
  assert.deepStrictEqual(Array.from(S.cardBadges({ delivery: true, pickup: true })), ['Delivery available', 'Pickup available']);
  assert.deepStrictEqual(Array.from(S.cardBadges({ delivery: true, delivery_fee: 0 })), ['Free delivery']);
  assert.deepStrictEqual(Array.from(S.cardBadges(null)), []);
});

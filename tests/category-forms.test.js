/* Category forms (Stage 3): the schemas are sound, and the engine shows, checks and saves the right answers.
   Run: node --test tests/category-forms.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const win = {};
const ctx = { window: win };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'categories.js'), 'utf8'), ctx);
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'category-forms.js'), 'utf8'), ctx);
const S = win.STCat, F = win.STCatForms;
const PILOT = ['cleaning', 'handyman', 'logistics'];
const OTHER = F.OTHER_SUB;
const plain = (x) => JSON.parse(JSON.stringify(x));   /* objects from the vm sandbox have a different prototype */

function subNames(cat) { return S.get(cat).subs.map(s => s.name); }
function keys(cat, sub, vals) { return F.fieldsFor(cat, sub, vals).map(f => f.key); }
function groupList(schema, spec) { return typeof spec === 'string' ? (schema.groups[spec.slice(1)] || null) : spec; }

test('the three pilot categories have a form; the others do not yet', () => {
  PILOT.forEach(c => assert.ok(F.has(c), c));
  ['sales', 'other', 'fashion', 'security', 'health'].forEach(c => assert.ok(!F.has(c), c + ' should not have a form yet'));
});

test('every subcategory named in a schema really exists in that category', () => {
  PILOT.forEach(cat => {
    const schema = F.SCHEMAS[cat], real = subNames(cat);
    Object.keys(schema.groups || {}).forEach(g => schema.groups[g].forEach(n => assert.ok(real.includes(n), cat + ' group ' + g + ': "' + n + '" is not a ' + cat + ' subcategory')));
    schema.fields.forEach(f => ['subs', 'notSubs'].forEach(k => {
      if (!f[k]) return;
      const list = groupList(schema, f[k]);
      assert.ok(list, cat + '.' + f.key + ' uses an unknown group ' + f[k]);
      list.forEach(n => assert.ok(real.includes(n), cat + '.' + f.key + ': "' + n + '" is not a ' + cat + ' subcategory'));
    }));
  });
});

test('every field is well formed: unique key, label, known type, options where needed, "when" points at an earlier field', () => {
  const TYPES = ['select', 'multi', 'yesno', 'text', 'textarea', 'number'];
  PILOT.forEach(cat => {
    const seen = [];
    F.SCHEMAS[cat].fields.forEach(f => {
      assert.match(f.key, /^[a-z][a-z0-9_]*$/, f.key);
      assert.ok(!seen.includes(f.key), cat + ' repeats ' + f.key);
      assert.ok(f.label && f.label.length > 3, f.key + ' needs a label');
      assert.ok(TYPES.includes(f.type), f.key + ' has type ' + f.type);
      if (f.type === 'select' || f.type === 'multi') {
        assert.ok(Array.isArray(f.options) && f.options.length >= 2, f.key + ' needs options');
        assert.strictEqual(new Set(f.options).size, f.options.length, f.key + ' repeats an option');
      }
      if (f.when) assert.ok(seen.includes(f.when.key), f.key + ' depends on ' + f.when.key + ', which must come before it');
      seen.push(f.key);
    });
  });
});

test('every subcategory of every pilot category, plus Other, gets at least one question', () => {
  PILOT.forEach(cat => subNames(cat).concat([OTHER]).forEach(sub => {
    assert.ok(keys(cat, sub, {}).length >= 2, cat + ' / ' + sub + ' would show almost nothing');
  }));
});

test('questions follow the type of work: a plumber is not asked about carpets', () => {
  assert.ok(keys('handyman', 'Plumbing').includes('plumbing_jobs'));
  assert.ok(!keys('handyman', 'Painting').includes('plumbing_jobs'));
  assert.ok(keys('handyman', 'Painting').includes('paint_types'));
  assert.ok(keys('handyman', 'Refrigerator Repair').includes('brands'));
  assert.ok(!keys('handyman', 'Plumbing').includes('brands'));
  assert.ok(!keys('handyman', 'Pest Control').includes('materials'));
  assert.ok(keys('cleaning', 'Office Cleaning').includes('property_types'));
  assert.ok(!keys('cleaning', 'Office Cleaning').includes('max_size'));
  assert.ok(keys('cleaning', 'House Cleaning').includes('max_size'));
  assert.ok(!keys('cleaning', 'Carpet Cleaning').includes('property_types'));
  assert.ok(keys('cleaning', 'Carpet Cleaning').includes('equipment'));
  assert.ok(keys('cleaning', 'Mold Remediation').includes('protective_gear'));
  assert.ok(keys('cleaning', 'Waste Removal').includes('disposal_included'));
});

test('Moving & Delivery changes shape a lot between a rider, a crew, a warehouse and a freight agent', () => {
  const rider = keys('logistics', 'Dispatch Rider'), crew = keys('logistics', 'House Moving');
  const wh = keys('logistics', 'Warehousing'), fr = keys('logistics', 'International Freight Forwarding');
  assert.ok(rider.includes('vehicle') && rider.includes('same_day') && !rider.includes('crew_size'));
  assert.ok(crew.includes('crew_size') && crew.includes('packing_materials') && crew.includes('goods_cover') && !crew.includes('same_day'));
  assert.ok(wh.includes('storage_size') && !wh.includes('vehicle') && !wh.includes('coverage'));
  assert.ok(fr.includes('freight_modes') && fr.includes('customs') && !fr.includes('vehicle'));
  assert.ok(keys('logistics', 'Van & Truck Hire').includes('hire_mode'));
  assert.ok(!keys('logistics', 'Loading & Unloading').includes('vehicle'));
});

test('"when" fields appear only after the question they depend on is answered', () => {
  assert.ok(!keys('handyman', 'Plumbing', {}).includes('callout_amount'));
  assert.ok(!keys('handyman', 'Plumbing', { callout_fee: false }).includes('callout_amount'));
  assert.ok(keys('handyman', 'Plumbing', { callout_fee: true }).includes('callout_amount'));
});

test('required answers are enforced, and only for questions that are showing', () => {
  const r = F.validate('cleaning', 'Office Cleaning', {});
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(Object.keys(r.errors).sort(), ['property_types', 'supplies', 'team_size']);
  assert.ok(!('max_size' in r.errors));   /* an office is not asked "largest home" */
});

test('a full, valid Cleaning answer saves clean, versioned and flat', () => {
  const r = F.validate('cleaning', 'Office Cleaning', { supplies: 'Either', team_size: '3', property_types: ['Office', 'Shop / commercial space'], recurring: true, eco_products: false });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepStrictEqual(plain(r.clean), { supplies: 'Either', team_size: 3, property_types: ['Office', 'Shop / commercial space'], recurring: true, eco_products: false, _v: 1 });
});

test('answers for questions that are not showing are dropped when you change the type of work', () => {
  const vals = { supplies: 'Either', team_size: 2, property_types: ['Office'], max_size: '3 to 4 bedrooms', equipment: ['Steam cleaner'] };
  const r = F.validate('cleaning', 'Office Cleaning', vals);
  assert.ok(r.ok);
  assert.ok(!('max_size' in r.clean) && !('equipment' in r.clean));
});

test('the call-out fee amount is dropped when the fee answer goes back to No', () => {
  const base = { tools: true, materials: 'Either', plumbing_jobs: ['Leaks & pipe repair'], callout_fee: true, callout_amount: 5000 };
  assert.strictEqual(F.validate('handyman', 'Plumbing', base).clean.callout_amount, 5000);
  const off = F.validate('handyman', 'Plumbing', Object.assign({}, base, { callout_fee: false }));
  assert.ok(off.ok && !('callout_amount' in off.clean));
  const missing = F.validate('handyman', 'Plumbing', Object.assign({}, base, { callout_amount: undefined }));
  assert.ok(!missing.ok && missing.errors.callout_amount);
});

test('bad values are rejected: unknown option, decimals, out of range, too long, not a yes/no', () => {
  const ok = { supplies: 'Either', team_size: 2, property_types: ['Office'] };
  const bad = (patch) => F.validate('cleaning', 'Office Cleaning', Object.assign({}, ok, patch));
  assert.ok(bad({ supplies: 'Whatever' }).errors.supplies);
  assert.ok(bad({ team_size: 2.5 }).errors.team_size);
  assert.ok(bad({ team_size: 0 }).errors.team_size);
  assert.ok(bad({ team_size: 51 }).errors.team_size);
  assert.ok(bad({ team_size: 'abc' }).errors.team_size);
  assert.ok(bad({ property_types: ['Spaceship'] }).errors.property_types);
  assert.ok(bad({ recurring: 'yes' }).errors.recurring);
  const long = F.validate('handyman', 'Refrigerator Repair', { tools: true, materials: 'Either', brands: 'x'.repeat(121), callout_fee: false });
  assert.ok(long.errors.brands);
});

test('multi answers keep the options order and drop unknown values', () => {
  const r = F.validate('cleaning', 'Office Cleaning', { supplies: 'Either', team_size: 1, property_types: ['Shop / commercial space', 'Nope', 'Office'] });
  assert.deepStrictEqual(plain(r.clean.property_types), ['Office', 'Shop / commercial space']);
});

test('text is trimmed and spaces collapsed', () => {
  const r = F.validate('handyman', 'Generator Repair', { tools: true, materials: 'Either', brands: '  LG,   Mikano  ', generator_types: ['Diesel'], callout_fee: false });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.strictEqual(r.clean.brands, 'LG, Mikano');
});

test('categories without a form save nothing (null) and never block', () => {
  const r = F.validate('fashion', 'Tailoring', { anything: 1 });
  assert.ok(r.ok && r.clean === null);
  assert.ok(F.validate('sales', 'Phones & Accessories', {}).ok);
});

test('Other (not listed) in a pilot category still gets the shared questions', () => {
  const r = F.validate('logistics', OTHER, { vehicle: 'Van', coverage: 'Within my city', max_load_kg: 300 });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.strictEqual(r.clean.vehicle, 'Van');
});

test('describe turns saved answers into readable lines for customers', () => {
  const lines = F.describe('cleaning', 'Office Cleaning', { supplies: 'Either', team_size: 3, property_types: ['Office', 'Shop / commercial space'], recurring: true, _v: 1 });
  assert.deepStrictEqual(plain(lines).map(l => l.text), ['Either', '3 people', 'Office, Shop / commercial space', 'Yes']);
  assert.strictEqual(lines[3].label, 'Do you offer weekly or monthly visits');
  assert.deepStrictEqual(plain(F.describe('fashion', 'Tailoring', { a: 1 })), []);
  assert.deepStrictEqual(plain(F.describe('cleaning', 'Office Cleaning', null)), []);
});

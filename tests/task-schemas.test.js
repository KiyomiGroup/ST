/* Poster questions for Post a Task (Categories Stage 6c). Run: node --test tests/task-schemas.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const F = require('../js/category-forms.js');
const P = require('../js/task-schemas.js');
const win = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'categories.js'), 'utf8'), { window: win });
const C = win.STCat;
const plain = x => JSON.parse(JSON.stringify(x));

test.afterEach(() => F.useAudience('tasker'));

test('the Poster audience is registered, and switching back restores the Tasker wording', () => {
  assert.ok(F.AUDIENCES.poster && F.AUDIENCES.tasker);
  F.useAudience('poster');
  assert.deepStrictEqual(plain(F.fieldsFor('cleaning', 'Deep Cleaning', {}).map(f => f.key)).slice(0, 2), ['supplies', 'property_type']);
  F.useAudience('tasker');
  assert.deepStrictEqual(plain(F.fieldsFor('cleaning', 'Deep Cleaning', {}).map(f => f.key)).slice(0, 2), ['supplies', 'team_size']);
  assert.strictEqual(F.useAudience('nonsense'), 'tasker');
});

test('a category with no Poster schema has no questions yet, and Post a Service is unaffected', () => {
  F.useAudience('poster');
  assert.ok(!F.has('pet')); assert.deepStrictEqual(plain(F.fieldsFor('pet', 'Dog Walking', {})), []);
  F.useAudience('tasker');
  assert.ok(F.has('pet'));
});

test('every Poster schema is well formed and shares its groups with the Tasker side', () => {
  Object.keys(P).forEach(cat => {
    const s = P[cat], w = F.SCHEMAS[cat];
    assert.ok(w, cat + ' has a Tasker schema'); assert.strictEqual(s.groups, w.groups, cat + ' shares groups');
    const keys = new Set(), allSubs = new Set(C.subsOf(cat));
    s.fields.forEach(f => {
      assert.ok(!keys.has(f.key), 'duplicate ' + cat + '.' + f.key); keys.add(f.key);
      assert.ok(/^[a-z][a-z0-9_]*$/.test(f.key));
      assert.ok(f.label && !/\byou offer\b|\bI bring\b/i.test(f.label + (f.options || []).join(' ')), cat + '.' + f.key + ' still sounds like a Tasker');
      assert.ok(['select', 'multi', 'yesno', 'text', 'textarea', 'number'].includes(f.type));
      if (f.type === 'select' || f.type === 'multi') { assert.ok(f.options.length >= 2); assert.strictEqual(new Set(f.options).size, f.options.length); }
      [f.subs, f.notSubs].forEach(r => {
        if (!r) return;
        if (typeof r === 'string') assert.ok(s.groups[r.slice(1)], cat + '.' + f.key + ' names unknown group ' + r);
        else r.forEach(n => assert.ok(allSubs.has(n), cat + '.' + f.key + ' names unknown subcategory ' + n));
      });
    });
  });
});

test('Poster answers validate, clean and describe like Tasker answers do', () => {
  F.useAudience('poster');
  const bad = F.validate('cleaning', 'Deep Cleaning', {});
  assert.ok(!bad.ok); assert.ok(bad.errors.supplies && bad.errors.property_type && bad.errors.home_size);
  const ok = F.validate('cleaning', 'Deep Cleaning', { supplies: 'I will provide them', property_type: 'Office', home_size: '3 to 4 bedrooms', cleaners_wanted: 2 });
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.deepStrictEqual(plain(ok.clean), { _v: 1, supplies: 'I will provide them', property_type: 'Office', home_size: '3 to 4 bedrooms', cleaners_wanted: 2 });
  const lines = plain(F.describe('cleaning', 'Deep Cleaning', ok.clean));
  assert.deepStrictEqual(lines.map(l => l.label), ['Who brings the cleaning supplies', 'What place needs cleaning', 'How big is the home', 'How many cleaners do you need']);
  assert.ok(!F.validate('cleaning', 'Deep Cleaning', { supplies: 'Client provides', property_type: 'Office', home_size: '3 to 4 bedrooms' }).ok, 'a Tasker option is not accepted on the Poster side');
});

test('pilot questions per category (required ones appear only for the type of work they fit)', () => {
  F.useAudience('poster');
  const req = (cat, sub) => plain(F.fieldsFor(cat, sub, {}).filter(f => f.required).map(f => f.key));
  assert.deepStrictEqual(req('handyman', 'Plumbing'), ['materials', 'plumbing_jobs']);
  assert.deepStrictEqual(req('handyman', 'Pest Control'), ['pest_targets']);
  assert.deepStrictEqual(req('logistics', 'House Moving'), ['vehicle_needed', 'coverage']);
  assert.deepStrictEqual(req('logistics', 'International Freight Forwarding'), ['freight_modes', 'customs']);
  assert.deepStrictEqual(req('logistics', 'Warehousing'), ['storage_size']);
  assert.ok(F.fieldsFor('logistics', 'Local Delivery', {}).some(f => f.key === 'same_day'));
  assert.ok(!F.fieldsFor('logistics', 'House Moving', {}).some(f => f.key === 'same_day'));
});

test('filters work for Poster answers too (used by Find Tasks later)', () => {
  F.useAudience('poster');
  const fs_ = plain(F.facets('cleaning', 'Deep Cleaning')).map(f => f.key);
  assert.ok(fs_.includes('supplies') && fs_.includes('property_type'));
  assert.ok(F.matchFacets({ supplies: 'I will provide them' }, { supplies: ['I will provide them'] }));
});

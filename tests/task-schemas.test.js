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

test('a category with no Poster schema has no questions (only Sales and Other), and Post a Service is unaffected', () => {
  F.useAudience('poster');
  ['sales', 'other'].forEach(cat => { assert.ok(!F.has(cat), cat + ' has no Poster questions'); assert.deepStrictEqual(plain(F.fieldsFor(cat, 'Anything', {})), []); });
  assert.ok(F.has('pet'));
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

/* ── Stage 6d, batch A ─────────────────────────────────────────────────────────────────────── */
const BATCH_A = ['home_furniture', 'landscaping', 'automotive', 'grooming', 'fashion'];

test('batch A: every type of work (and Other) has at least two Poster questions, and none mixes in Tasker wording', () => {
  F.useAudience('poster');
  BATCH_A.forEach(cat => {
    assert.ok(F.has(cat), cat + ' has Poster questions');
    C.subsOf(cat).concat([F.OTHER_SUB]).forEach(sub => {
      const fields = F.fieldsFor(cat, sub, {});
      assert.ok(fields.length >= 2, cat + ' / ' + sub + ' has ' + fields.length + ' questions');
    });
  });
});

test('batch A: a Poster schema asks the same keys as the Tasker one for each type of work (so a later match is possible)', () => {
  BATCH_A.forEach(cat => {
    const tasker = new Set(F.SCHEMAS.hasOwnProperty(cat) ? F.SCHEMAS[cat].fields.map(f => f.key) : []);
    P[cat].fields.forEach(f => assert.ok(tasker.has(f.key), cat + '.' + f.key + ' has no Tasker twin'));
    const poster = new Set(P[cat].fields.map(f => f.key));
    tasker.forEach(k => assert.ok(poster.has(k), cat + '.' + k + ' is missing on the Poster side'));
  });
});

test('batch A: required questions follow the type of work', () => {
  F.useAudience('poster');
  const req = (cat, sub) => plain(F.fieldsFor(cat, sub, {}).filter(f => f.required).map(f => f.key));
  assert.deepStrictEqual(req('home_furniture', 'TV Installation'), ['tools', 'wall_types', 'tv_size']);
  assert.deepStrictEqual(req('home_furniture', 'Interior Decoration'), ['materials', 'design_services']);
  assert.deepStrictEqual(req('landscaping', 'Tree Trimming'), ['equipment', 'property_types', 'tree_height', 'safety_gear', 'waste_removal']);
  assert.deepStrictEqual(req('automotive', 'Vehicle Towing'), ['vehicle_types', 'towing_truck', 'coverage', 'response_time']);
  assert.deepStrictEqual(req('grooming', 'Hair Braiding'), ['service_location', 'clients', 'products', 'hair_types', 'braid_styles']);
  assert.deepStrictEqual(req('fashion', 'Shoe Repair'), ['shoe_jobs']);
  assert.deepStrictEqual(req('fashion', 'Bridal Wear'), ['fabric_by', 'garment_types']);
});

test('batch A: a Tasker option is refused on the Poster side and a Poster option is accepted', () => {
  F.useAudience('poster');
  const base = { equipment: 'The tasker brings them', materials: 'I will supply them', property_types: 'Home garden', max_area: 'Up to 100 sqm', waste_removal: true };
  const ok = F.validate('landscaping', 'Gardening', base);
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.ok(!F.validate('landscaping', 'Gardening', Object.assign({}, base, { equipment: 'I bring them' })).ok);
  assert.ok(!F.validate('landscaping', 'Gardening', Object.assign({}, base, { property_types: ['Home gardens'] })).ok, 'a one-answer question on the Poster side');
});

test('batch A: filters offer short fixed lists for tasks', () => {
  F.useAudience('poster');
  const keys = (c, sub) => plain(F.facets(c, sub)).map(f => f.key);
  assert.ok(keys('automotive', 'Car Mechanic').includes('vehicle_types'));
  assert.ok(keys('grooming', '').includes('service_location'), 'category-level filter');
  assert.ok(F.facets('grooming', 'Barbing').some(f => f.key === 'barber_services'));
  assert.ok(F.facets('fashion', 'Embroidery').length >= 1);
});

/* ── Stage 6e, batches B, C and D ──────────────────────────────────────────────────────────── */
const BATCH_B = ['creative', 'it_tech', 'business', 'education', 'pet'];
const BATCH_C = ['events', 'hospitality', 'assistance', 'construction', 'marketing', 'laundry'];
const BATCH_D = ['professional', 'security', 'health', 'legal', 'financial'];
const NEW_6E = BATCH_B.concat(BATCH_C, BATCH_D);
/* Tasker questions that have no Poster twin on purpose: a Poster holds no licence, certificate, vet number, or driving-school number */
const NO_TWIN = ['licence_body', 'licence_number', 'has_certification', 'certification_details', 'vet_registration'];
/* Poster-only questions: "I want someone registered / certified" */
const POSTER_ONLY = ['must_be_registered', 'must_be_certified'];

test('6e: all 24 categories that have Tasker questions now have Poster questions; only Sales and Other do not', () => {
  const sc = Object.keys(F.SCHEMAS).sort();
  assert.deepStrictEqual(Object.keys(P).sort(), sc);
  assert.strictEqual(sc.length, 24);
  NEW_6E.forEach(c => assert.ok(P[c], c));
});

test('6e: every type of work (and Other) has at least two Poster questions', () => {
  F.useAudience('poster');
  Object.keys(P).forEach(cat => {
    C.subsOf(cat).concat([F.OTHER_SUB]).forEach(sub => {
      assert.ok(F.fieldsFor(cat, sub, {}).length >= 2, cat + ' / ' + sub + ' has ' + F.fieldsFor(cat, sub, {}).length);
    });
  });
});

test('6e: Poster and Tasker ask the same keys (so a task can be matched to a service later)', () => {
  NEW_6E.forEach(cat => {
    const tasker = F.SCHEMAS[cat].fields.map(f => f.key).filter(k => !NO_TWIN.includes(k) && !(k === 'licence_number'));
    const poster = P[cat].fields.map(f => f.key);
    new Set(tasker).forEach(k => assert.ok(poster.includes(k), cat + '.' + k + ' is missing on the Poster side'));
    poster.filter(k => !POSTER_ONLY.includes(k)).forEach(k => assert.ok(F.SCHEMAS[cat].fields.some(f => f.key === k), cat + '.' + k + ' has no Tasker twin'));
  });
});

test('6e: every Poster question is reworded (none still carries the Tasker label) and no option sounds like a Tasker', () => {
  NEW_6E.forEach(cat => {
    P[cat].fields.forEach(f => {
      const w = F.SCHEMAS[cat].fields.find(x => x.key === f.key);
      if (!w) return;
      assert.notStrictEqual(f.label, w.label, cat + '.' + f.key + ' still has the Tasker label: ' + f.label);
      assert.ok(!/\byou (offer|do|give|use|work|take|teach|cook|bake|install|supply|can|hold|run|write|handle|cover|treat|translate|record|perform|play|sell|stock|repair)\b/i.test(f.label), cat + '.' + f.key + ' sounds like a Tasker: ' + f.label);
      (f.options || []).forEach(o => assert.ok(!/^(client|customer) (supplies|provides|pays)|^I (supply|bring|cook|come|pick|visit|handle)\b/i.test(o), cat + '.' + f.key + ' option sounds like a Tasker: ' + o));
    });
  });
});

test('6e: Poster-only registration questions replace the Tasker licence fields, and nothing asks a Poster for a licence number', () => {
  BATCH_D.forEach(cat => {
    const keys = P[cat].fields.map(f => f.key);
    NO_TWIN.forEach(k => assert.ok(!keys.includes(k), cat + ' must not ask the Poster for ' + k));
    assert.ok(keys.includes('must_be_registered'), cat);
  });
  F.useAudience('poster');
  const reg = (cat, sub) => F.fieldsFor(cat, sub, {}).map(f => f.key);
  assert.ok(reg('health', 'Physiotherapy').includes('must_be_registered') && !reg('health', 'Physiotherapy').includes('must_be_certified'));
  assert.ok(reg('health', 'Yoga Instruction').includes('must_be_certified') && !reg('health', 'Yoga Instruction').includes('must_be_registered'));
  assert.ok(reg('legal', F.OTHER_SUB).includes('must_be_registered'), 'legal asks it for every type of work');
  assert.ok(reg('pet', 'Veterinary Care').includes('must_be_registered') && !reg('pet', 'Dog Walking').includes('must_be_registered'));
  assert.ok(!reg('education', 'Driving Lessons').includes('licence_number') && !reg('construction', 'Roofing').includes('licence_number'));
});

test('6e: what defines the job is required, Tasker promises are optional wishes', () => {
  F.useAudience('poster');
  const req = (cat, sub) => plain(F.fieldsFor(cat, sub, {}).filter(f => f.required).map(f => f.key));
  assert.deepStrictEqual(req('creative', 'Logo Design'), [], 'software, rounds, turnaround and files are wishes');
  assert.deepStrictEqual(req('creative', 'Video Editing'), ['video_types']);
  assert.deepStrictEqual(req('it_tech', 'Laptop Repair'), ['service_mode', 'laptop_repairs', 'brands', 'parts']);
  assert.deepStrictEqual(req('business', 'Data Entry'), ['work_mode', 'data_entry_types']);
  assert.deepStrictEqual(req('education', 'Driving Lessons'), ['lesson_modes', 'class_size', 'transmission', 'provides_car']);
  assert.deepStrictEqual(req('pet', 'Dog Walking'), ['pet_types', 'max_pets', 'walk_length']);
  assert.deepStrictEqual(req('events', 'Photography'), ['event_types', 'coverage', 'shoot_types']);
  assert.deepStrictEqual(req('construction', 'Roofing'), ['tools', 'materials', 'job_size', 'roof_types']);
  assert.deepStrictEqual(req('laundry', 'Dry Cleaning'), ['pickup', 'turnaround', 'dry_clean_items']);
  assert.deepStrictEqual(req('financial', 'Tax Preparation'), ['work_mode', 'client_types', 'tax_types']);
});

test('6e: one-answer questions on the Poster side (one place, one person, one pet)', () => {
  const type = (cat, key) => P[cat].fields.find(f => f.key === key).type;
  assert.strictEqual(type('education', 'levels'), 'select');
  assert.strictEqual(type('pet', 'pet_types'), 'select');
  assert.strictEqual(type('events', 'event_types'), 'select');
  assert.strictEqual(type('health', 'client_groups'), 'select');
  assert.strictEqual(type('financial', 'client_types'), 'select');
  assert.strictEqual(F.SCHEMAS.pet.fields.find(f => f.key === 'pet_types').type, 'multi', 'the Tasker side is unchanged');
});

test('6e: the dog-size question only shows for a dog, and answers validate', () => {
  F.useAudience('poster');
  const keys = v => F.fieldsFor('pet', 'Dog Walking', v).map(f => f.key);
  assert.ok(!keys({ pet_types: 'Cat' }).includes('dog_sizes'));
  assert.ok(keys({ pet_types: 'Dog' }).includes('dog_sizes'));
  const ok = F.validate('pet', 'Dog Walking', { pet_types: 'Dog', dog_sizes: 'Large', max_pets: 2, walk_length: '30 to 60 minutes' });
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.ok(!F.validate('pet', 'Dog Walking', { pet_types: 'Dog', max_pets: 2, walk_length: '30 to 60 minutes' }).ok, 'size is needed for a dog');
  const cat = F.validate('pet', 'Dog Walking', { pet_types: 'Cat', dog_sizes: 'Large', max_pets: 1, walk_length: 'Up to 30 minutes' });
  assert.ok(cat.ok && !('dog_sizes' in cat.clean), 'a hidden answer is dropped');
});

test('6e: a Tasker option is refused on the Poster side, a Poster option accepted', () => {
  F.useAudience('poster');
  const good = { event_types: 'Weddings', coverage: 'In my own city', max_guests: 150, shoot_types: ['Weddings'] };
  assert.ok(F.validate('events', 'Photography', good).ok);
  assert.ok(!F.validate('events', 'Photography', Object.assign({}, good, { coverage: 'Within my city' })).ok);
  assert.ok(!F.validate('events', 'Photography', Object.assign({}, good, { event_types: ['Weddings'] })).ok, 'one-answer question');
});

test('6e: describe() and facets() work for the new Poster categories', () => {
  F.useAudience('poster');
  const lines = plain(F.describe('laundry', 'Dry Cleaning', { pickup: 'Either', turnaround: 'Next day', dry_clean_items: ['Suits & jackets'] }));
  assert.deepStrictEqual(lines.map(l => l.label), ['How will the laundry get there and back', 'How soon do you need it back', 'What needs dry cleaning']);
  assert.ok(F.facets('pet', 'Dog Walking').some(f => f.key === 'pet_types'));
  assert.ok(F.facets('events', 'Photography').some(f => f.key === 'event_types'));
});

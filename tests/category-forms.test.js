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
const PILOT = ['cleaning', 'handyman', 'logistics', 'home_furniture', 'landscaping', 'automotive', 'grooming', 'fashion', 'creative', 'it_tech', 'business', 'education', 'pet', 'events', 'hospitality', 'assistance', 'construction', 'marketing', 'laundry', 'professional', 'security', 'health', 'legal', 'financial'];
const OTHER = F.OTHER_SUB;
const plain = (x) => JSON.parse(JSON.stringify(x));   /* objects from the vm sandbox have a different prototype */

function subNames(cat) { return S.get(cat).subs.map(s => s.name); }
function keys(cat, sub, vals) { return F.fieldsFor(cat, sub, vals).map(f => f.key); }
function groupList(schema, spec) { return typeof spec === 'string' ? (schema.groups[spec.slice(1)] || null) : spec; }

test('the three pilot categories have a form; the others do not yet', () => {
  PILOT.forEach(c => assert.ok(F.has(c), c));
  ['sales', 'other'].forEach(c => assert.ok(!F.has(c), c + ' should not have a form yet'));
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
  const r = F.validate('sales', 'Phones & Accessories', { anything: 1 });
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

/* ── Stage 4, batch A: Home & Furniture, Gardening, Automotive, Beauty, Fashion ── */
const BATCH_A = ['home_furniture', 'landscaping', 'automotive', 'grooming', 'fashion', 'creative', 'it_tech', 'business', 'education', 'pet', 'events', 'hospitality', 'assistance', 'construction', 'marketing', 'laundry', 'professional', 'security', 'health', 'legal', 'financial'];

test('batch A: every subcategory (and Other) is asked at least two questions', () => {
  BATCH_A.forEach(cat => subNames(cat).concat([OTHER]).forEach(sub => {
    assert.ok(keys(cat, sub).length >= 2, cat + ' / ' + sub + ' has fewer than two questions');
  }));
});

test('batch A: questions follow the type of work', () => {
  assert.ok(keys('home_furniture', 'TV Installation').includes('tv_size'));
  assert.ok(!keys('home_furniture', 'Wall Mounting').includes('tv_size'));
  assert.ok(!keys('home_furniture', 'Interior Design').includes('tools'));
  assert.ok(keys('landscaping', 'Tree Trimming').includes('safety_gear'));
  assert.ok(!keys('landscaping', 'Lawn Mowing').includes('tree_height'));
  assert.ok(!keys('landscaping', 'Garden Design').includes('equipment'));
  assert.ok(keys('automotive', 'Vehicle Towing').includes('towing_truck'));
  assert.ok(!keys('automotive', 'Vehicle Towing').includes('service_location'));
  assert.ok(!keys('automotive', 'Car Wash').includes('towing_truck'));
  assert.ok(!keys('automotive', 'Motorcycle Repair').includes('vehicle_types'));
  assert.ok(keys('grooming', 'Hair Braiding').includes('braid_styles'));
  assert.ok(!keys('grooming', 'Barbing').includes('braid_styles'));
  assert.ok(keys('grooming', 'Makeup Artistry').includes('group_bookings'));
  assert.ok(keys('fashion', 'Shoe Repair').includes('shoe_jobs'));
  assert.ok(!keys('fashion', 'Shoe Repair').includes('fabric_by'));
  assert.ok(keys('fashion', 'Bridal Wear').includes('fittings'));
});

test('batch A: a full valid answer saves clean, versioned and flat; a missing required answer blocks', () => {
  const ok = F.validate('fashion', 'Bridal Wear', { fabric_by: 'Either', turnaround_days: 21, garment_types: ["Women's wear"], fittings: 'Two fittings', measure_home: true, shoe_jobs: ['Resoling'] });
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  const c = plain(ok.clean);
  assert.strictEqual(c._v, 1);
  assert.strictEqual(c.shoe_jobs, undefined);   /* hidden for Bridal Wear, so dropped */
  const bad = F.validate('automotive', 'Vehicle Towing', { vehicle_types: ['Cars'], towing_truck: 'Flatbed', coverage: 'Within my city', response_time: 'Within 1 hour' });
  assert.ok(bad.ok, JSON.stringify(bad.errors));
  const missing = F.validate('grooming', 'Hair Braiding', { service_location: 'Both', clients: ['Women'], products: 'Either', sterilise: true, hair_types: ['Locs'] });
  assert.ok(!missing.ok && missing.errors.braid_styles);
});

test('batch A: changing the type of work inside a category keeps shared answers and drops the rest', () => {
  const vals = { tools: true, materials: 'Either', furniture_types: ['Sofas & chairs'] };
  const r = F.validate('home_furniture', 'Upholstery', vals);
  assert.ok(r.ok, JSON.stringify(r.errors));
  const r2 = F.validate('home_furniture', 'Wall Mounting', { tools: true, wall_types: ['Concrete or block'], furniture_types: ['Sofas & chairs'] });
  assert.ok(r2.ok, JSON.stringify(r2.errors));
  assert.strictEqual(plain(r2.clean).furniture_types, undefined);
});

/* ── Stage 4, batch B: Design & Creative, Technology & IT, Business & Admin, Education, Pet Services ── */
const BATCH_B = ['creative', 'it_tech', 'business', 'education', 'pet', 'events', 'hospitality', 'assistance', 'construction', 'marketing', 'laundry', 'professional', 'security', 'health', 'legal', 'financial'];

test('batch B: every subcategory (and Other) is asked at least two questions', () => {
  BATCH_B.forEach(cat => subNames(cat).concat([OTHER]).forEach(sub => {
    assert.ok(keys(cat, sub).length >= 2, cat + ' / ' + sub + ' has fewer than two questions');
  }));
});

test('batch B: questions follow the type of work', () => {
  assert.ok(keys('creative', 'Voiceover Recording').includes('voice_languages'));
  assert.ok(!keys('creative', 'Voiceover Recording').includes('software'));
  assert.ok(!keys('creative', 'Logo Design').includes('voice_types'));
  assert.ok(keys('it_tech', 'Website Development').includes('web_types'));
  assert.ok(!keys('it_tech', 'Website Development').includes('service_mode'));
  assert.ok(keys('it_tech', 'Phone Repair').includes('backs_up_data'));
  assert.ok(!keys('it_tech', 'Network Installation').includes('laptop_repairs'));
  assert.ok(keys('business', 'Transcription').includes('typing_speed'));
  assert.ok(!keys('business', 'Market Research').includes('typing_speed'));
  assert.ok(keys('business', 'Business Registration').includes('registration_types'));
  assert.ok(keys('education', 'Driving Lessons').includes('provides_car'));
  assert.ok(!keys('education', 'Online Tutoring').includes('lesson_modes'));
  assert.ok(keys('education', 'Exam Preparation').includes('exams'));
  assert.ok(keys('pet', 'Dog Walking').includes('walk_length'));
  assert.ok(!keys('pet', 'Aquarium Maintenance').includes('pet_types'));
  assert.ok(keys('pet', 'Mobile Vet Care').includes('vet_registration'));
  assert.ok(!keys('pet', 'Pet Grooming').includes('vet_registration'));
});

test('batch B: a vet must give a registration number; a full valid answer saves flat and drops hidden answers', () => {
  const vals = { pet_types: ['Dogs'], vet_services: ['Vaccinations'], coverage: 'Within my city' };
  const bad = F.validate('pet', 'Mobile Vet Care', vals);
  assert.ok(!bad.ok && bad.errors.vet_registration);
  const ok = F.validate('pet', 'Mobile Vet Care', Object.assign({ vet_registration: 'VCN 12345', walk_length: 'Over 1 hour' }, vals));
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  const c = plain(ok.clean);
  assert.strictEqual(c._v, 1);
  assert.strictEqual(c.walk_length, undefined);
  const edu = F.validate('education', 'Mathematics Lessons', { lesson_modes: ['Online'], class_size: 'Small groups', levels: ['University'] });
  assert.ok(edu.ok, JSON.stringify(edu.errors));
});

/* ── Stage 4, batch C: Events, Food & Catering, Personal Assistance, Building & Construction, Marketing, Laundry ── */
const BATCH_C = ['events', 'hospitality', 'assistance', 'construction', 'marketing', 'laundry', 'professional', 'security', 'health', 'legal', 'financial'];

test('batch C: every subcategory (and Other) is asked at least two questions', () => {
  BATCH_C.forEach(cat => subNames(cat).concat([OTHER]).forEach(sub => {
    assert.ok(keys(cat, sub).length >= 2, cat + ' / ' + sub + ' has fewer than two questions');
  }));
});

test('batch C: questions follow the type of work', () => {
  assert.ok(keys('events', 'Venue Rental').includes('venue_capacity'));
  assert.ok(!keys('events', 'Venue Rental').includes('team_size'));
  assert.ok(keys('events', 'DJs').includes('music_genres'));
  assert.ok(!keys('events', 'Photography').includes('music_genres'));
  assert.ok(keys('hospitality', 'Cake Making').includes('custom_designs'));
  assert.ok(!keys('hospitality', 'Bartending').includes('kitchen_type'));
  assert.ok(keys('hospitality', 'Food Delivery').includes('insulated'));
  assert.ok(keys('assistance', 'Queue Assistance').includes('max_wait_hours'));
  assert.ok(!keys('assistance', 'Local Guide').includes('transport'));
  assert.ok(keys('assistance', 'Document Submission').includes('with_letter'));
  assert.ok(keys('construction', 'Roofing').includes('safety_gear'));
  assert.ok(!keys('construction', 'Tiling').includes('safety_gear'));
  assert.ok(!keys('construction', 'General Labour').includes('materials'));
  assert.ok(keys('construction', 'Demolition').includes('removes_debris'));
  assert.ok(keys('marketing', 'Digital Advertising').includes('ad_spend'));
  assert.ok(!keys('marketing', 'Promotions & Street Marketing').includes('work_mode'));
  assert.ok(keys('laundry', 'Laundry Pickup & Delivery').includes('coverage'));
  assert.ok(!keys('laundry', 'Laundry Pickup & Delivery').includes('pickup'));
  assert.ok(keys('laundry', 'Dry Cleaning').includes('onsite_machines'));
});

test('batch C: required answers are enforced and hidden answers are dropped', () => {
  const bad = F.validate('construction', 'Roofing', { tools: true, crew_size: 3, materials: 'Either', job_size: 'A whole house', roof_types: ['Aluminium sheets'] });
  assert.ok(!bad.ok && bad.errors.safety_gear);
  const ok = F.validate('construction', 'Roofing', { tools: true, crew_size: 3, materials: 'Either', job_size: 'A whole house', roof_types: ['Aluminium sheets'], safety_gear: true, tile_types: ['Floor tiles'] });
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  const c = plain(ok.clean);
  assert.strictEqual(c._v, 1);
  assert.strictEqual(c.tile_types, undefined);
  const q = F.validate('assistance', 'Queue Assistance', { availability_days: ['Weekdays'], queue_places: ['Banks'], max_wait_hours: 30 });
  assert.ok(!q.ok && q.errors.max_wait_hours);
  const n = F.validate('laundry', 'Bulk & Business Laundry', { pickup: 'Both', turnaround: 'Next day', methods: ['Machine wash'], business_customers: ['Hotels & guest houses'], max_kg_per_day: 200 });
  assert.ok(n.ok, JSON.stringify(n.errors));
});

/* ── Stage 4d: regulated categories (questions only, no publishing hold) ── */
const BATCH_D = ['professional', 'security', 'health', 'legal', 'financial'];

test('batch D: every subcategory (and Other) is asked at least two questions', () => {
  BATCH_D.forEach(cat => subNames(cat).concat([OTHER]).forEach(sub => {
    assert.ok(keys(cat, sub).length >= 2, cat + ' / ' + sub + ' has fewer than two questions');
  }));
});

test('batch D: licensed work must give a registration, unlicensed work gets an optional certificate question', () => {
  ['Architecture', 'Engineering Consultancy'].forEach(s => assert.ok(keys('professional', s).includes('licence_number'), s));
  assert.ok(!keys('professional', 'Translation').includes('licence_number'));
  assert.ok(keys('professional', 'Translation').includes('has_certification'));
  assert.ok(keys('security', 'Security Guard Services').includes('licence_number'));
  assert.ok(!keys('security', 'CCTV Installation').includes('licence_number'));
  assert.ok(keys('health', 'Physiotherapy').includes('licence_number'));
  assert.ok(!keys('health', 'Yoga Instruction').includes('licence_number'));
  subNames('legal').concat([OTHER]).forEach(s => assert.ok(keys('legal', s).includes('licence_number'), 'legal ' + s));
  assert.ok(keys('financial', 'Tax Preparation').includes('licence_number'));
  assert.ok(!keys('financial', 'Bookkeeping').includes('licence_number'));
  assert.ok(keys('pet', 'Veterinary Care').includes('vet_registration'));
  assert.ok(keys('education', 'Driving Lessons').includes('licence_number'));
  assert.ok(keys('construction', 'Electrical Installation').includes('licence_number'));
  assert.ok(!keys('construction', 'Tiling').includes('licence_number'));
});

test('batch D: a missing licence blocks Legal and Physiotherapy; the optional certificate follow-up only shows after Yes', () => {
  const base = { consult_mode: 'Online', contract_types: ['NDAs'] };
  const bad = F.validate('legal', 'Contract Drafting & Review', base);
  assert.ok(!bad.ok && bad.errors.licence_number && bad.errors.licence_body);
  const ok = F.validate('legal', 'Contract Drafting & Review', Object.assign({ licence_body: 'Bar association', licence_number: 'SCN12345' }, base));
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.ok(!keys('health', 'Yoga Instruction', {}).includes('certification_details'));
  assert.ok(keys('health', 'Yoga Instruction', { has_certification: true }).includes('certification_details'));
  const y = F.validate('health', 'Yoga Instruction', { service_location: 'Online', client_groups: ['Adults'], session_types: ['Classes'], yoga_styles: ['Hatha'], has_certification: false, certification_details: 'x' });
  assert.ok(y.ok, JSON.stringify(y.errors));
  assert.strictEqual(plain(y.clean).certification_details, undefined);
  const p = F.validate('health', 'Physiotherapy', { service_location: 'Online', client_groups: ['Adults'], physio_conditions: ['Joint pain'] });
  assert.ok(!p.ok && p.errors.licence_number);
});

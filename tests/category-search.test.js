/* STCat list + search: every category has a home for its services, and typing finds the right one.
   Run: node --test tests/category-search.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const win = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'categories.js'), 'utf8'), { window: win });
const S = win.STCat;

test('26 categories, Other last, Sales only on the service side', () => {
  assert.strictEqual(S.serviceList.length, 26);
  assert.strictEqual(S.serviceList[S.serviceList.length - 1].value, 'other');
  assert.ok(S.serviceList.some(c => c.value === 'sales'));
  assert.ok(!S.list.some(c => c.value === 'sales'));
});

test('every subcategory lives in one category only', () => {
  const seen = {};
  S.serviceList.forEach(c => c.subs.forEach(s => {
    const k = s.name.toLowerCase();
    assert.ok(!seen[k], s.name + ' is in both ' + seen[k] + ' and ' + c.value);
    seen[k] = c.value;
  }));
});

test('every saved value from before still resolves to the right group', () => {
  const OLD = ['cleaning','laundry','grooming','automotive','handyman','landscaping','hospitality','business','it_tech','creative','logistics','health','pet','education','financial','legal','events','sales','other'];
  OLD.forEach(v => assert.strictEqual(S.resolve(v).value, v));
  [['electrician','handyman'],['plumber','handyman'],['barber','grooming'],['mechanic','automotive'],['carpentry','construction'],['security','security'],['tailor','fashion']]
    .forEach(([old, want]) => assert.strictEqual(S.resolve(old).value, want, old));
  assert.strictEqual(S.resolve('something weird').value, 'other');
});

test('every category has an icon', () => {
  S.serviceList.forEach(c => assert.ok(S.icons[c.value], 'no icon for ' + c.value));
});

test('subsOf ends with Other (not listed); Other itself has none', () => {
  const l = S.subsOf('handyman');
  assert.strictEqual(l[l.length - 1], S.OTHER_SUB);
  assert.strictEqual(S.subsOf('other').length, 0);
});

const FIND = [
  ['plumber', 'handyman', 'Plumbing'],
  ['plumbing', 'handyman', 'Plumbing'],
  ['electrician', 'handyman', 'Electrical Repairs'],
  ['barber', 'grooming', 'Barbing'],
  ['tailor', 'fashion', 'Tailoring'],
  ['cctv', 'security', 'CCTV Installation'],
  ['phone repair', 'it_tech', 'Phone Repair'],
  ['dog walking', 'pet', 'Dog Walking'],
  ['braids', 'grooming', 'Hair Braiding'],
  ['dispatch', 'logistics', 'Dispatch Rider'],
  ['logo', 'creative', 'Logo Design'],
  ['cake', 'hospitality', 'Cake Making'],
  ['lawyer', 'legal', 'Legal Consultation'],
  ['accountant', 'financial', 'Accounting'],
  ['jamb', 'education', 'Exam Preparation'],
  ['fridge', 'handyman', 'Refrigerator Repair'],
  ['solar', 'handyman', 'Solar Installation & Repairs'],
];
for (const [q, cat, sub] of FIND) {
  test('search "' + q + '" finds ' + sub, () => {
    const r = S.search(q);
    assert.ok(r.length, 'no results');
    assert.strictEqual(r[0].value, cat);
    assert.ok(r.slice(0, 3).some(x => x.sub === sub), sub + ' not in the top 3');
  });
}

test('search by category name returns the category first', () => {
  const r = S.search('cleaning');
  assert.strictEqual(r[0].value, 'cleaning');
  assert.strictEqual(r[0].sub, null);
});

test('search is case-insensitive and ignores extra spaces', () => {
  assert.strictEqual(S.search('  PLUMBER ')[0].sub, 'Plumbing');
});

test('nothing found gives an empty list; empty query too', () => {
  assert.strictEqual(S.search('qqzzxx').length, 0);
  assert.strictEqual(S.search('').length, 0);
});

test('sellers:false hides Sales', () => {
  assert.ok(S.search('phones').some(r => r.value === 'sales'));
  assert.ok(!S.search('phones', { sellers: false }).some(r => r.value === 'sales'));
});

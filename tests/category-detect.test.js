/* STCat.detect: "Other" tasks that clearly belong to a category are filed under it. Run: node --test tests/category-detect.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const win = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'categories.js'), 'utf8'), { window: win });
const detect = win.STCat.detect;

const CLEAR = [
  ['Deep clean my 3-bedroom flat', '', 'cleaning'],
  ['Need a plumber', 'Kitchen sink is leaking badly', 'handyman'],
  ['Fix my generator', '', 'handyman'],
  ['Haircut at home', '', 'grooming'],
  ['Braid my hair for a wedding', '', 'grooming'],
  ['Car brake pads replacement', '', 'automotive'],
  ['Mechanic for my Toyota Camry', 'engine is knocking', 'automotive'],
  ['Mow the lawn and trim hedges', '', 'landscaping'],
  ['Catering for 50 guests', 'jollof rice and small chops', 'hospitality'],
  ['Build a website for my shop', '', 'it_tech'],
  ['Laptop screen repair', '', 'it_tech'],
  ['Design a logo and flyer', '', 'creative'],
  ['Move my belongings to Ikeja', 'I need a truck', 'logistics'],
  ['Dispatch rider to deliver parcels', '', 'logistics'],
  ['Personal trainer for weight loss', '', 'health'],
  ['Walk my dog every morning', '', 'pet'],
  ['Maths and English tutor for JSS3', '', 'education'],
  ['Accountant to do my tax return', '', 'financial'],
  ['Lawyer to review tenancy agreement', '', 'legal'],
  ['Wedding photographer', '', 'events'],
  ['Catering for my wedding', '', 'hospitality'],   /* two categories: the one mentioned first wins */
];
for (const [title, desc, want] of CLEAR) {
  test('detects ' + want + ': ' + title, () => assert.strictEqual(detect(title, desc), want));
}

const UNCLEAR = [
  ['Help me with something', ''],
  ['Need a favour', 'will explain later'],
  ['Category question', 'what is the best category'],       /* "cat" must not match "category" */
  ['Buy a card for my friend', 'a birthday card'],           /* "car" must not match "card"; one description mention is not enough */
  ['', ''],
];
for (const [title, desc] of UNCLEAR) {
  test('stays Other: ' + (title || '(empty)'), () => assert.strictEqual(detect(title, desc), null));
}

test('one passing mention in the description alone is not enough', () => {
  assert.strictEqual(detect('Small job', 'near the garden gate'), null);
});

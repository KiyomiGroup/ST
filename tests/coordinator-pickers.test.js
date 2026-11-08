/* Local Tasker form pickers: areas suggestions and availability text. Run: node --test tests/coordinator-pickers.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const win = {};
const read = f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
vm.runInNewContext(read('ng-places.js'), { window: win });
vm.runInNewContext(read('coordinator-pickers.js'), { window: win });
const P = win.STCoPick;
const plain = v => JSON.parse(JSON.stringify(v));   /* objects from the vm context have another prototype */

test('suggests listed places from a few letters', () => {
  assert.strictEqual(P._suggest('yab', [])[0], 'Yaba, Lagos');
  assert.ok(P._suggest('lekki', []).includes('Lekki Phase 1, Lagos'));
  assert.strictEqual(P._suggest('ikeja', [])[0], 'Ikeja, Lagos');
});
test('Lagos comes before the same name elsewhere', () => {
  assert.strictEqual(P._suggest('surulere', [])[0], 'Surulere, Lagos');
});
test('a typo ranks the right place first', () => {
  assert.strictEqual(P._suggest('ikja', [])[0], 'Ikeja, Lagos');
  assert.strictEqual(P._suggest('surulre', [])[0], 'Surulere, Lagos');
  assert.strictEqual(P._suggest('yabba', [])[0], 'Yaba, Lagos');
});
test('a typo still finds the place', () => {
  assert.ok(P._suggest('ikja', []).includes('Ikeja, Lagos'));
  assert.ok(P._suggest('surulre', []).includes('Surulere, Lagos'));
  assert.ok(P._suggest('yabba', []).includes('Yaba, Lagos'));
});
test('already added places are left out; nonsense finds nothing', () => {
  assert.ok(!P._suggest('yaba', ['Yaba, Lagos']).includes('Yaba, Lagos'));
  assert.strictEqual(P._suggest('qzxqzx', []).length, 0);
  assert.strictEqual(P._suggest('', []).length, 0);
});

test('areas: new format round trip', () => {
  const list = P._parseAreas('Yaba, Lagos; Surulere, Lagos');
  assert.deepStrictEqual(plain(list.map(a => a.label)), ['Yaba, Lagos', 'Surulere, Lagos']);
  assert.ok(list.every(a => a.matched));
  assert.strictEqual(P._areasToText(list), 'Yaba, Lagos; Surulere, Lagos');
});
test('areas: older free text is matched to listed places, unknown parts are kept and marked', () => {
  const list = P._parseAreas('Sabo, Yaba, Ebute Metta');
  assert.deepStrictEqual(plain(list.map(a => a.label)), ['Sabo', 'Yaba, Lagos', 'Ebute Metta, Lagos']);
  assert.deepStrictEqual(plain(list.map(a => a.matched)), [false, true, true]);
});
test('areas: older text that already has the city is not split in two', () => {
  assert.deepStrictEqual(plain(P._parseAreas('Yaba, Lagos, Ikeja, Lagos').map(a => a.label)), ['Yaba, Lagos', 'Ikeja, Lagos']);
  assert.strictEqual(P._parseAreas('').length, 0);
});

test('availability: text round trip', () => {
  const st = { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], times: ['Morning', 'Evening'], anyTime: false, sameDay: true, note: 'Not on Friday prayers' };
  const text = P._availToText(st);
  assert.strictEqual(text, 'Days: Weekdays \u00b7 Times: Morning, Evening \u00b7 Same-day jobs OK \u00b7 Note: Not on Friday prayers');
  assert.deepStrictEqual(plain(P._textToAvail(text)), st);
});
test('availability: single days, weekends, every day, any time', () => {
  assert.strictEqual(P._availToText({ days: ['Wed', 'Mon'], times: [], anyTime: true, sameDay: false, note: '' }), 'Days: Mon, Wed \u00b7 Times: Any time');
  assert.strictEqual(P._availToText({ days: ['Sat', 'Sun'], times: [], anyTime: false, sameDay: false, note: '' }), 'Days: Weekends');
  assert.strictEqual(P._availToText({ days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], times: [], anyTime: false, sameDay: false, note: '' }), 'Days: Every day');
  assert.strictEqual(P._availToText({ days: [], times: [], anyTime: false, sameDay: false, note: '' }), '');
});
test('availability: a note that itself contains a dot and "Note:" survives', () => {
  const st = { days: ['Sat'], times: [], anyTime: false, sameDay: false, note: 'Call first \u00b7 Note: gate code needed' };
  assert.deepStrictEqual(plain(P._textToAvail(P._availToText(st))), st);
});
test('availability: older free text becomes the note', () => {
  const st = P._textToAvail('Available weekends after 2pm');
  assert.strictEqual(st.note, 'Available weekends after 2pm');
  assert.strictEqual(st.days.length, 0);
});
test('availability text always fits the 500 character column', () => {
  const st = { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], times: ['Morning', 'Afternoon', 'Evening'], anyTime: false, sameDay: true, note: 'x'.repeat(900) };
  assert.ok(P._availToText(st).length <= 500);
});

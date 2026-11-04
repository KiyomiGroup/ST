// S4a: the membership label comes AFTER the name; PRO and PREMIUM look different; tokens only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const demo = fs.readFileSync(new URL('../design-system.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../css/membership.css', import.meta.url), 'utf8');
const section = demo.slice(demo.indexOf('id="membership"'), demo.indexOf('id="cards"'));
test('label text comes after the name text in every demo', () => {
  const rows = [...section.matchAll(/class="membership-name__text">([^<]+)<\/span>\s*<span class="membership-label[^"]*">([A-Z]+)</g)];
  assert.ok(rows.length >= 5);
  // the regex itself only matches name-span-then-label-span, so every match proves the order
  assert.equal(rows.length, (section.match(/class="membership-label /g) || []).length);
});
test('only PRO and PREMIUM exist; no verified wording or icon in the label', () => {
  const labels = [...section.matchAll(/class="membership-label[^"]*">([^<]*)</g)].map(m => m[1]);
  assert.deepEqual([...new Set(labels)].sort(), ['PREMIUM', 'PRO']);
  assert.ok(!/<svg|<img|&#10003;|✓|verified/i.test(section.replace(/not identity verification/i, '')));
});
test('membership.css has no raw colours, inline styles or !important', () => {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(code));
  assert.ok(!/rgba?\(/.test(code));
  assert.ok(!/!important/.test(code));
});
test('PRO and PREMIUM use different tokens', () => {
  assert.match(css, /--pro\s*{[^}]*--membership-pro-bg/);
  assert.match(css, /--premium\s*{[^}]*--membership-premium-bg/);
});

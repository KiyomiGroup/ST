// S4c: comparison table comes from plan data; prose sections hold no numbers and make no booking promises.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = read('subscription.html'), js = read('js/pricing-plans.js'), css = read('css/subscription.css');
const prose = html.slice(html.indexOf('id="compare"'), html.indexOf('id="faq"'));   // S4d: FAQ and CTA have their own test (s4d-faq-cta.test.mjs)
test('sections 3, 4 and 5 are present with the brief headings', () => {
  for (const t of ['Compare plans side by side', 'Why upgrade?', 'How visibility works',
    'More monthly offers', 'More service listings', 'Better visibility', 'Featured placement', 'Advanced analytics', 'Business growth tools',
    'Standard search placement', 'Premium recommendations']) assert.ok(prose.includes(t), t);
});
test('no number, price or plan name is written in the new prose', () => {
  const text = prose.replace(/<[^>]+>/g, ' ');
  assert.ok(!/\d/.test(text), 'no digits in prose');
  assert.ok(!/\u20A6/.test(text), 'no naira');
  assert.ok(!/\b(Free|Starter|Professional|Business|PRO|PREMIUM)\b(?! growth)/.test(text.replace('Business growth tools', '')), 'no plan names in prose');
});
test('says plainly that nothing is guaranteed; makes no booking promise', () => {
  assert.match(prose, /No plan guarantees bookings, customers or income/);
  assert.ok(!/guaranteed (bookings|customers|income|jobs)|more bookings|get hired|will earn/i.test(prose));
  assert.match(prose, /Relevance still comes first/);
});
test('table is built from the plan rows, one column per plan, no hardcoded plan keys except the popular label', () => {
  assert.match(js, /function buildCompare\(plans\)/);
  assert.match(js, /buildCompare\(plans\);/);
  assert.equal([...js.matchAll(/'(free|starter|business)'/g)].length, 0);
});
test('table is hidden until plans load; scroll wrapper is keyboard reachable', () => {
  assert.match(html, /id="compare"[^>]*hidden/);
  assert.match(html, /class="sub-table-wrap" tabindex="0"/);
});
test('no raw colours, rgb, inline styles or !important in css/html', () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(c) && !/rgba?\(/.test(c) && !/!important/.test(c) && !/style\s*=/.test(html));
});

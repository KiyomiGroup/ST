// S4b: the pricing page holds no price, limit or old plan; styles use tokens only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = read('subscription.html'), js = read('js/pricing-plans.js'), css = read('css/subscription.css');
test('no naira amount or plan number is written in the page or script', () => {
  assert.ok(!/\u20A6\s?\d/.test(html), 'no naira amount in html');
  assert.ok(!/\b(3,?000|10,?000|30,?000|9,?999|29,?999)\b/.test(html + js), 'no price');
  assert.ok(!/\b(20|50|100|600) offers/i.test(html + js), 'no offer limit');
});
test('old script, mock state, modals, inline styles and browser writes are gone from the page', () => {
  assert.ok(!/subscription\.js/.test(html.replace('pricing-plans.js', '')));
  assert.ok(!/style\s*=/.test(html));
  assert.ok(!/modal|slot-meter|recordSubscriptionChoice|\.upsert\(/.test(html + js));
  assert.ok(!/\.from\('subscriptions'\)/.test(js));
});
test('reads plans and own plan only through the two RPCs', () => {
  const calls = [...js.matchAll(/rpc\('([a-z_]+)'\)/g)].map(m => m[1]).sort();
  assert.deepEqual(calls, ['get_my_entitlements', 'get_public_plans']);
});
test('hero text is the brief wording', () => {
  assert.match(html, /Grow Your Business With StreetTasker\./);
  assert.match(html, /Choose a plan that helps you reach more customers, showcase your services and grow your business on StreetTasker\./);
});
test('css has no raw colours, rgb, inline or !important', () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(c) && !/rgba?\(/.test(c) && !/!important/.test(c));
});

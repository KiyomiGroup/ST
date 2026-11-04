// S4e: My Subscription page is read-only, number-free, token-only; state logic is right.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = read('my-subscription.html'), js = read('js/my-subscription.js'), css = read('css/my-subscription.css'), nav = read('components/navbar.html');
const sandbox = { window: {}, document: { getElementById: () => null }, localStorage: {}, console };
vm.createContext(sandbox); vm.runInContext(js, sandbox);
const state = sandbox.window.StMySub.describeState;
test('state logic covers free, active, past due (also in grace), cancelling, expired', () => {
  assert.equal(state({ is_paid: false }, null), 'free');
  assert.equal(state({ is_paid: false }, { plan: 'x' }), 'expired');
  assert.equal(state({ is_paid: true, status: 'active', in_grace: false }), 'active');
  assert.equal(state({ is_paid: true, status: 'active', in_grace: true }), 'past_due');
  assert.equal(state({ is_paid: true, status: 'past_due' }), 'past_due');
  assert.equal(state({ is_paid: true, status: 'cancelling', cancel_at_period_end: true }), 'cancelling');
  assert.equal(state({ is_paid: true, status: 'active', cancel_at_period_end: true }), 'cancelling');
});
test('read-only: no write call, no payment call, no top-up, no wallet', () => {
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|payment-init|payment-verify|topup|wallet|onChoose/i.test(js + html));
  const rpcs = [...js.matchAll(/rpc\('([a-z_]+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(rpcs, ['get_my_entitlements', 'get_public_plans']);
});
test('no number, price or plan name is written in the page or script (all from the database)', () => {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
  assert.ok(!/\d/.test(text.replace('S4e', '')), 'no digits in page text');
  assert.ok(!/₦\s*\d/.test(js), 'no hardcoded price');
  assert.equal([...js.matchAll(/'(starter|professional|business)'/g)].length, 0);
  assert.ok(!/\b(Starter|Professional|Business)\b/.test(text));
});
test('signed-out goes to login; customers are sent away; page is noindex', () => {
  assert.match(js, /login\.html\?next=my-subscription\.html/);
  assert.match(js, /role === 'customer'/);
  assert.match(html, /name="robots" content="noindex"/);
});
test('progress uses the native element (no inline style); no raw colours, rgb, inline style or !important', () => {
  assert.match(js, /el\('progress'/);
  const c = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(c) && !/rgba?\(/.test(c) && !/!important/.test(c));
  assert.ok(!/style\s*=|\.style\./.test(html + js));
});
test('navbar Subscription links (menu and drawer) now open my-subscription.html; no other nav link changed', () => {
  assert.equal([...nav.matchAll(/href="my-subscription\.html"/g)].length, 2);
  assert.equal([...nav.matchAll(/href="subscription\.html"/g)].length, 0);
});
test('mentions the grace period and nothing deleted without numbers; says verification is not tied to plan', () => {
  assert.match(js, /short grace period/);
  assert.match(js, /Nothing is deleted/);
  assert.match(html, /identity verification, whatever their plan/);
});

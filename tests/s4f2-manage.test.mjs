// S4f-2: manage buttons call only the four server functions, no money, no numbers or plan names written in the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = read('my-subscription.html'), js = read('js/my-subscription.js'), css = read('css/my-subscription.css');
test('only the four manage functions are called, and the chooser uses db.js', () => {
  const rpcs = [...js.matchAll(/callRpc\('([a-z_]+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set(rpcs)].sort(), ['cancel_subscription', 'schedule_downgrade', 'undo_cancel']);
  assert.match(js, /window\.ST\.db\.chooseActiveListings\(/);
});
test('no direct write, payment, top-up or wallet code; no plan activation in the browser', () => {
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|payment-init|payment-verify|topup|wallet|onChoose|Paystack/i.test(js + html));
});
test('every error code the server can answer has a message', () => {
  for (const c of ['not_signed_in', 'no_paid_plan', 'payment_overdue', 'cancel_pending', 'plan_required', 'plan_not_found', 'not_a_downgrade', 'period_over']) assert.match(js, new RegExp(c + ':'));
});
test('downgrade lists only cheaper plans; cancel and downgrade are dialogs with a Go back; no digits or plan names in page text or script strings', () => {
  assert.match(js, /price_kobo\) < Number\(e\.price_kobo\)/);
  assert.match(html, /id="mysubModalBack"/);
  const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
  assert.ok(!/\d/.test(text.replace('S4e', '')));
  assert.equal([...js.matchAll(/'(starter|professional|business)'/g)].length, 0);
});
test('css: tokens only, no inline style', () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(c) && !/rgba?\(/.test(c) && !/!important/.test(c));
  assert.ok(!/style\s*=|\.style\./.test(html + js));
});

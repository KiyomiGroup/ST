// S4d: FAQ (nine answers), final CTA, old script retired. Prose carries no numbers, prices or plan names.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = read('subscription.html'), js = read('js/pricing-plans.js'), css = read('css/subscription.css');
const faqHtml = html.slice(html.indexOf('id="faq"'), html.indexOf('</main>'));
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, "'");
const QUESTIONS = ['Can I start with a free plan?', 'What happens when my offers run out?', 'Can I change my subscription?',
  'What happens to my listings if I downgrade?', 'Does featured placement guarantee bookings?', 'Can I cancel my subscription?',
  'How does monthly renewal work?', 'Is identity verification included?', 'What is the difference between PRO and PREMIUM membership?'];
test('the nine FAQ questions are present, in the brief order, each with an answer', () => {
  let at = -1;
  for (const q of QUESTIONS) { const i = faqHtml.indexOf(q); assert.ok(i > at, q); at = i; }
  assert.equal([...faqHtml.matchAll(/<details class="sub-faq-item">/g)].length, 9);
  assert.equal([...faqHtml.matchAll(/<p class="sub-faq-a">/g)].length, 9);
});
test('FAQ is native details/summary (keyboard and screen-reader friendly, no script needed)', () => {
  assert.equal([...faqHtml.matchAll(/<summary class="sub-faq-q">/g)].length, 9);
  assert.ok(!/onclick|addEventListener\('click'/.test(faqHtml));
});
test('FAQ and CTA prose hold no digits, prices or plan names (only the PRO / PREMIUM question)', () => {
  const t = text(faqHtml).replace('What is the difference between PRO and PREMIUM membership?', '');
  assert.ok(!/\d/.test(t), 'no digits');
  assert.ok(!/₦/.test(t), 'no naira');
  const noLabels = t.replace(/\bPRO\b|\bPREMIUM\b/g, '');
  assert.ok(!/\b(Starter|Professional|Business)\b/.test(noLabels), 'no plan names');
  assert.ok(!/\bPRO\b/.test(t.replace(/PREMIUM is the higher level/, '')) , 'PRO only in the PRO/PREMIUM question');
});
test('no booking or income promise; featured placement answer says no guarantee', () => {
  assert.match(faqHtml, /No\. Featured placement gives your services more exposure/);
  assert.match(faqHtml, /no plan guarantees bookings, customers or income/);
  assert.ok(!/guaranteed (bookings|customers|income|jobs)|more bookings|get hired|will earn/i.test(faqHtml));
});
test('answers match the owner rules: Paystack only, no wallet payment, verification is not paid, downgrade is scheduled, nothing deleted', () => {
  assert.match(faqHtml, /paid with Paystack only/);
  assert.match(faqHtml, /Wallet balance cannot be used to pay for a subscription/);
  assert.ok(!/top.?up/i.test(faqHtml), 'no top-up wording');
  assert.match(faqHtml, /Identity verification is not a paid feature/);
  assert.match(faqHtml, /scheduled for the end of your current billing period/);
  assert.match(faqHtml, /Nothing is deleted/);
  assert.match(faqHtml, /keep your plan(&rsquo;|')s benefits until the end of the period/);
});
test('final CTA offers Free or choosing a plan', () => {
  assert.match(faqHtml, /id="finalStartFree" href="signup\.html">Start free</);
  assert.match(faqHtml, /href="#plans">Choose a plan</);
  assert.match(faqHtml, /Start with Free and upgrade when you are ready, or choose the plan that suits your business/);
});
test('script: label sentence comes from plan rows; Start free hidden when signed in; hooks exported', () => {
  assert.match(js, /function buildFaqLabels\(plans\)/);
  assert.match(js, /buildFaqLabels\(plans\);/);
  assert.match(js, /b\.hidden = !!\(ctx && ctx\.signedIn\)/);
  assert.equal([...js.matchAll(/'(free|starter|business)'/g)].length, 0);
});
test('old script is retired: file gone, no page loads it, no browser write of a plan', () => {
  assert.ok(!fs.existsSync(new URL('../js/subscription.js', import.meta.url)));
  assert.ok(!/js\/subscription\.js/.test(html));
  assert.ok(!/recordSubscriptionChoice|\.upsert\(|MOCK_|bookingLimit/.test(html + js));
});
test('no raw colours, rgb, inline styles or !important in css/html', () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(c) && !/rgba?\(/.test(c) && !/!important/.test(c) && !/style\s*=/.test(html));
});

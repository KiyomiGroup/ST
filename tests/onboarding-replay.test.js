/* Replay links and the phone card position.   Run:  node --test tests/onboarding-replay.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { replayPlan, readReplayParam, placeTooltip } = require('../js/onboarding.js');

const steps = [{ id: 'a', title: 'A', description: 'a' }];
test('replayPlan starts here when the tour belongs to this page, otherwise goes to its page', () => {
  assert.deepEqual(replayPlan({ id: 't', page: 'home-feed.html', steps }, 'home-feed.html'), { mode: 'here' });
  assert.deepEqual(replayPlan({ id: 't', steps }, 'learn.html'), { mode: 'here' });
  assert.deepEqual(replayPlan({ id: 'customer-home', page: 'home-feed.html', steps }, 'learn.html'), { mode: 'goto', url: 'home-feed.html?tour=customer-home' });
  assert.deepEqual(replayPlan({ id: 't', page: 'x.html', steps: [{ id: 'a', title: 'A', description: 'a', page: 'y.html' }] }, 'x.html'), { mode: 'goto', url: 'y.html?tour=t' });
  assert.deepEqual(replayPlan(null, 'x.html'), { mode: 'none' });
});
test('readReplayParam accepts plain ids only', () => {
  assert.equal(readReplayParam('?tour=customer-home'), 'customer-home');
  assert.equal(readReplayParam('?a=1&tour=tasker-home&b=2'), 'tasker-home');
  assert.equal(readReplayParam(''), null);
  assert.equal(readReplayParam('?tour=<script>'), null);
  assert.equal(readReplayParam('?mytour=x'), null);
});

const phone = { vp: { width: 390, height: 800 }, tip: { width: 366, height: 140 }, gap: 12, edge: 12, mobileMax: 768 };
test('phone card sits at the bottom edge with no tab bar', () => {
  const p = placeTooltip({ ...phone, target: { top: 100, left: 20, width: 100, height: 40 } });
  assert.equal(p.mode, 'sheet'); assert.equal(p.top, 800 - 140 - 12);
});
test('phone card sits above the tab bar instead of covering it', () => {
  const p = placeTooltip({ ...phone, insetBottom: 97, target: { top: 100, left: 20, width: 100, height: 40 } });
  assert.equal(p.top, 800 - 97 - 140 - 12);
});
test('a target on the tab bar keeps the card above the bar, the bar stays visible', () => {
  const p = placeTooltip({ ...phone, insetBottom: 97, target: { top: 715, left: 30, width: 60, height: 60 } });
  assert.equal(p.top, 800 - 97 - 140 - 12);
});
test('a target behind the card moves the card to the top', () => {
  const p = placeTooltip({ ...phone, insetBottom: 97, target: { top: 560, left: 20, width: 200, height: 60 } });
  assert.equal(p.top, 12);
});

/* Tests for js/onboarding-tours-chat.js (onboarding Stage 7).   Run:  node --test tests/onboarding-tours-chat.test.js
   Checks the three chat tutorials are valid, hold the right roles, never start by themselves, that the pages that host them
   load the engine and this file, that every selector they point at exists in messages.html, and that customer copy never
   mentions the platform fee. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateTour, decideAutoStart } = require('../js/onboarding.js');
const mod = require('../js/onboarding-tours-chat.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const byId = Object.fromEntries(mod.TOURS.map((t) => [t.id, t]));

test('three valid tours with the reserved ids', () => {
  assert.equal(mod.TOURS.length, 3);
  mod.TOURS.forEach((t) => assert.deepEqual(validateTour(t), [], t.id));
  assert.deepEqual(Object.values(mod.IDS).sort(), ['customer-chat', 'payments-guide', 'tasker-chat']);
  assert.equal(new Set(mod.TOURS.map((t) => t.id)).size, 3);
});

test('roles, page, and never automatic', () => {
  assert.equal(byId['customer-chat'].role, 'customer');
  assert.equal(byId['tasker-chat'].role, 'tasker');
  assert.equal(byId['payments-guide'].role, 'any');
  mod.TOURS.forEach((t) => {
    assert.equal(t.auto, false, t.id);
    assert.equal(t.page, 'messages.html', t.id);
  });
});

test('no tour restarts by itself, and a chat tour is not offered to the other role', () => {
  mod.TOURS.forEach((t) => {
    ['customer', 'tasker'].forEach((role) => {
      assert.equal(decideAutoStart(undefined, t, { role, page: t.page }).start, false, t.id + ' ' + role);
    });
  });
  assert.equal(decideAutoStart(undefined, byId['customer-chat'], { role: 'tasker', page: 'messages.html' }).reason, 'other-role');
  assert.equal(decideAutoStart(undefined, byId['tasker-chat'], { role: 'customer', page: 'messages.html' }).reason, 'other-role');
});

test('every host page loads the engine, its styles and this file (engine first)', () => {
  ['messages.html', 'learn.html'].forEach((f) => {
    const h = read(f);
    assert.ok(h.includes('css/onboarding.css'), f + ' css');
    const a = h.indexOf('js/onboarding.js'), b = h.indexOf('js/onboarding-tours-chat.js');
    assert.ok(a > -1 && b > a, f + ' scripts');
  });
});

test('the Actions guide is in both chat tours and points at the Actions button', () => {
  ['customer-chat', 'tasker-chat'].forEach((id) => {
    const steps = byId[id].steps;
    const a = steps.find((s) => s.id === 'actions');
    assert.ok(a && [].concat(a.target).includes('#requestBtn'), id + ' actions step');
    assert.ok(steps.some((s) => s.id === 'actions-inside'), id + ' actions-inside step');
  });
});

test('the steps follow the docked next-step panel flow', () => {
  const text = (id) => byId[id].steps.map((s) => s.title + ' ' + (s.description || '')).join(' ').toLowerCase();
  assert.match(text('tasker-chat'), /propose one price/);
  assert.match(text('tasker-chat'), /ask for their location/);
  assert.match(text('tasker-chat'), /release code/);
  assert.match(text('customer-chat'), /share location/);
  assert.match(text('customer-chat'), /only after the job is done/);
  assert.ok(byId['customer-chat'].steps.some((s) => [].concat(s.target || []).includes('#jrDock')));
  assert.ok(byId['tasker-chat'].steps.some((s) => [].concat(s.target || []).includes('#jrDock')));
});

/* every selector must exist in messages.html or the scripts that draw into it */
function sources() {
  const extra = ['js/messages-dock.js', 'js/messages-requests.js', 'js/messages-list.js'];
  return read('messages.html') + extra.map((f) => (fs.existsSync(path.join(ROOT, f)) ? read(f) : '')).join('\n');
}
test('every selector a step uses exists in messages.html or the scripts that draw it', () => {
  const src = sources();
  mod.TOURS.forEach((t) => {
    t.steps.forEach((s) => {
      if (!s.target) return;
      const ok = [].concat(s.target).some((sel) => {
        const need = [];
        (sel.match(/#[A-Za-z][\w-]*/g) || []).forEach((m) => need.push([`id="${m.slice(1)}"`, `id='${m.slice(1)}'`]));
        (sel.match(/\[data-tour='([\w-]+)'\]/g) || []).forEach((m) => need.push([`data-tour="${m.match(/'([\w-]+)'/)[1]}"`]));
        return need.every((alts) => alts.some((a) => src.includes(a)));
      });
      assert.ok(ok, `${t.id} / ${s.id}: none of ${JSON.stringify(s.target)} found in messages.html`);
    });
  });
});

test('customer copy never mentions the platform fee, and neither does the shared payments tour', () => {
  ['customer-chat', 'payments-guide'].forEach((id) => {
    byId[id].steps.forEach((s) => {
      assert.doesNotMatch((s.title + ' ' + s.description).toLowerCase(), /\bfee\b|commission|service charge|12%/, id + ' / ' + s.id);
    });
  });
});

test('no step asks for money or sends anything: no onNext, navigate or interact', () => {
  mod.TOURS.forEach((t) => t.steps.forEach((s) => {
    assert.equal(s.onNext, undefined, t.id + ' / ' + s.id);
    assert.equal(s.navigate, undefined, t.id + ' / ' + s.id);
    assert.equal(s.interact, undefined, t.id + ' / ' + s.id);
  }));
});

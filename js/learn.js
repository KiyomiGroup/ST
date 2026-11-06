/* ============================================================
   Help / Learn page (learn.html): guides, FAQ and the tour list with replay.

   - Guides and FAQ come from js/learn-content.js (plain data). Anyone can read them, signed in or not.
   - Tours come from the engine's registry (ST.onboarding.list). Only the signed-in person's own role can start them;
     the Customers / Taskers tabs only change which guides are shown.
   - Start / Replay calls ST.onboarding.replay(id): the tour starts on its own page (see js/onboarding.js).
   - Deep links: learn.html#payments opens that guide.
   No inline styles; classes live in css/learn.css.
   ============================================================ */
(function () {
  'use strict';

  var ST = window.ST || {};
  var C = ST.learnContent, OB = ST.onboarding;
  if (!C) return;

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  var state = { me: null, tab: 'customer' };   // me: { id, role } or null (not signed in)

  var CHEVRON = '<svg class="ln-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

  function item(id, title, sub) {
    var d = el('details', 'ln-item'); if (id) d.id = id;
    var s = el('summary'); var t = el('span');
    t.appendChild(el('span', 'ln-item-title', title));
    if (sub) t.appendChild(el('span', 'ln-item-sub', sub));
    s.appendChild(t); s.insertAdjacentHTML('beforeend', CHEVRON);
    var body = el('div', 'ln-item-body');
    d.append(s, body);
    return { d: d, body: body };
  }

  function tourButton(id, status, label) {
    var b = el('button', 'btn btn-primary btn-sm ln-btn', label || C.actionLabel(status));
    b.type = 'button'; b.setAttribute('data-tour-id', id);
    b.addEventListener('click', function () {
      b.disabled = true;
      var p = OB ? OB.replay(id) : Promise.resolve(false);
      p.then(function (ok) {
        if (ok) return;
        b.disabled = false;
        var s = $('lnToursState'); s.hidden = false;
        s.textContent = 'That tour could not start right now. Please try again in a moment.';
      }).catch(function () { b.disabled = false; });
    });
    return b;
  }

  /* ── tours ── */
  function renderTours() {
    var list = $('lnTours'), note = $('lnToursState');
    list.textContent = ''; note.hidden = true;
    if (!state.me) {
      note.hidden = false; note.textContent = '';
      note.append('Log in to take the guided tours. ');
      var a = el('a', null, 'Log in'); a.href = 'login.html'; note.appendChild(a);
      return Promise.resolve();
    }
    if (state.tab !== state.me.role) {
      note.hidden = false;
      note.textContent = 'These tours are for ' + state.tab + ' accounts. Switch account from the menu to take them.';
      return Promise.resolve();
    }
    return OB.list(state.me.role).then(function (tours) {
      if (!tours.length) { note.hidden = false; note.textContent = 'No tours are available yet.'; return; }
      tours.forEach(function (t) {
        var li = el('li', 'ln-tour');
        var info = el('div');
        info.appendChild(el('h3', 'ln-tour-name', t.title));
        if (t.description) info.appendChild(el('p', 'ln-tour-desc', t.description));
        var meta = el('div', 'ln-tour-meta');
        var st = el('span', 'ln-status', C.statusLabel(t.status)); st.setAttribute('data-status', t.status);
        meta.append(st, el('span', null, t.steps + ' steps'));
        info.appendChild(meta);
        li.append(info, tourButton(t.id, t.status));
        list.appendChild(li);
      });
    }).catch(function () { note.hidden = false; note.textContent = 'Tours could not be loaded right now.'; });
  }

  /* ── guides ── */
  function renderGuides() {
    var host = $('lnGuides'); host.textContent = '';
    var statusById = {};
    var pending = state.me && OB && state.tab === state.me.role ? OB.list(state.me.role) : Promise.resolve([]);
    return pending.then(function (tours) {
      tours.forEach(function (t) { statusById[t.id] = t.status; });
      C.topicsFor(state.tab).forEach(function (topic) {
        var it = item(topic.id, topic.title, topic.summary);
        var ol = el('ol', 'ln-steps');
        topic.steps.forEach(function (s) { ol.appendChild(el('li', null, s)); });
        it.body.appendChild(ol);
        if (topic.tips && topic.tips.length) {
          var ul = el('ul', 'ln-tips');
          topic.tips.forEach(function (t) { ul.appendChild(el('li', null, t)); });
          it.body.appendChild(ul);
        }
        if (state.me && state.tab === state.me.role) {
          var ids = C.tourIdsFor(topic, state.me.role, function (id) { return !!OB.get(id); }, function (id) { return OB.get(id).role; });
          if (ids.length) it.body.appendChild(tourButton(ids[0], statusById[ids[0]] || 'new', 'Take the tour'));
        }
        host.appendChild(it.d);
      });
    });
  }

  function renderFaq() {
    var host = $('lnFaq'); host.textContent = '';
    C.FAQ.forEach(function (f) {
      var it = item(null, f.q);
      it.body.appendChild(el('p', null, f.a));
      host.appendChild(it.d);
    });
  }

  function openFromHash() {
    var id = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    if (!id) return;
    var d = $(id);
    if (d && d.tagName === 'DETAILS') { d.open = true; try { d.scrollIntoView({ block: 'start' }); } catch (e) {} }
  }

  /* ── tabs (arrow keys move between them) ── */
  function selectTab(role, focus) {
    state.tab = role;
    ['customer', 'tasker'].forEach(function (r) {
      var b = $(r === 'customer' ? 'lnTabCustomer' : 'lnTabTasker');
      var on = r === role; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    return Promise.all([renderTours(), renderGuides()]);
  }
  function bindTabs() {
    var tabs = [$('lnTabCustomer'), $('lnTabTasker')];
    tabs.forEach(function (b) {
      b.addEventListener('click', function () { selectTab(b.getAttribute('data-role')); });
      b.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        var next = (e.key === 'ArrowLeft' || e.key === 'Home') ? tabs[0] : tabs[1];
        selectTab(next.getAttribute('data-role'), true);
      });
    });
  }

  function init() {
    bindTabs(); renderFaq();
    var who = OB ? OB.ready().catch(function () { return null; }) : Promise.resolve(null);
    who.then(function (w) {
      state.me = w && w.id ? { id: w.id, role: w.role === 'tasker' ? 'tasker' : 'customer' } : null;
      return selectTab(state.me ? state.me.role : 'customer');
    }).then(openFromHash);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

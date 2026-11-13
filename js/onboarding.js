/* ============================================================
   StreetTasker guided tours — one reusable engine.

   Tours are plain objects registered once and started by id:

     ST.onboarding.register({
       id: 'customer-home', role: 'customer', version: 1, auto: true, page: 'home-feed.html',
       title: 'Getting started',
       steps: [
         { id: 'welcome', title: 'Welcome to StreetTasker!', description: '…' },                  // no target = centred card
         { id: 'post-task', target: ["[data-tour='post-task']", "[data-tour='post-task-m']"],        // first visible match wins
           title: 'Post a Task', description: '…', placement: 'bottom' }
       ]
     });
     ST.onboarding.autoStart('customer-home');      // first visit only
     ST.onboarding.start('customer-home');          // replay on this page
     ST.onboarding.replay('customer-home');         // replay from any page (Help / Learn): goes to the tour's page first
     ST.onboarding.consumeReplay();                 // host pages call this on load: starts the tour named in ?tour=<id>

   Step options: id, title, description (string or fn), target (selector or list of selectors), placement
   (auto|top|bottom|left|right), fallback ('center' shows the card when the target never appears; default skips the
   step), optional, timeout (ms to wait for the target), interact ({ event: 'click', gate: true }: the highlighted
   element can be used, Next waits for it), beforeShow(ctx) (open a menu, wait for data), onEnter(ctx),
   onNext(ctx) (return false to stay), navigate (url to go to when Next is pressed; the tour resumes there),
   page (file name the step belongs to, for tours that cross pages), hint.

   Progress is saved per signed-in user and role: in public.user_tour_progress (sql/onboarding-progress.sql), with a
   localStorage copy that keeps working if that table is not installed yet.

   Two parts in this file: `pure` (no DOM, unit-tested in tests/onboarding.test.js) and the browser runtime.
   ============================================================ */
(function (root, factory) {
  var built = factory();
  if (typeof module === 'object' && module.exports) { module.exports = built.pure; }
  else { root.ST = root.ST || {}; root.ST.onboarding = built.create(root); }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var ROLES = ['customer', 'tasker', 'any'];
  var PLACEMENTS = ['auto', 'top', 'bottom', 'left', 'right'];
  var STATUSES = ['in_progress', 'completed', 'skipped'];
  /* How long a step waits for its target when the step sets no timeout. Menus and nav items are in the page already or never
     will be, so a missing one is skipped quickly; steps that wait for data set their own timeout. */
  var DEFAULT_WAIT_MS = 700;
  var HIDDEN_WAIT_MS = 200;   /* the element exists but is not visible: hidden for this screen size, so do not wait long */

  /* ════════════════ pure core ════════════════ */

  /* Returns a list of problems with a tour definition (empty list = fine). */
  function validateTour(def) {
    var p = [];
    if (!def || typeof def !== 'object') return ['tour is not an object'];
    if (!def.id || typeof def.id !== 'string') p.push('tour needs a string id');
    if (ROLES.indexOf(def.role) === -1) p.push('role must be one of ' + ROLES.join(', '));
    if (!Array.isArray(def.steps) || !def.steps.length) { p.push('tour needs at least one step'); return p; }
    var seen = {};
    def.steps.forEach(function (s, i) {
      var at = 'step ' + (i + 1) + (s && s.id ? ' (' + s.id + ')' : '');
      if (!s || typeof s !== 'object') { p.push(at + ' is not an object'); return; }
      if (!s.id || typeof s.id !== 'string') p.push(at + ' needs a string id');
      else if (seen[s.id]) p.push(at + ' repeats an id');
      else seen[s.id] = true;
      if (!s.title || typeof s.title !== 'string') p.push(at + ' needs a title');
      if (!s.description || (typeof s.description !== 'string' && typeof s.description !== 'function')) p.push(at + ' needs a description');
      if (s.target != null && typeof s.target !== 'string' && !Array.isArray(s.target)) p.push(at + ' target must be a selector or a list of selectors');
      if (s.placement && PLACEMENTS.indexOf(s.placement) === -1) p.push(at + ' has an unknown placement');
    });
    return p;
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  /* Where to put the tooltip.
       target  { top, left, width, height } of the highlight (already padded) or null for a centred card
       tip     { width, height }
       vp      { width, height }
     Returns { mode: 'center' | 'sheet' | 'float', side, left, top, arrow }
     'sheet' = phones: a full-width card pinned to the bottom or top edge, whichever does not cover the target.
     insetBottom (optional): height of anything fixed to the bottom of the screen, such as the mobile tab bar. A card
     pinned to the bottom edge sits above it instead of covering it. */
  function placeTooltip(o) {
    var vp = o.vp, tip = o.tip, t = o.target, gap = o.gap == null ? 12 : o.gap, edge = o.edge == null ? 12 : o.edge;
    var mobileMax = o.mobileMax == null ? 768 : o.mobileMax;
    var maxLeft = Math.max(edge, vp.width - tip.width - edge), maxTop = Math.max(edge, vp.height - tip.height - edge);

    if (!t) return { mode: 'center', side: 'none', left: clamp((vp.width - tip.width) / 2, edge, maxLeft), top: clamp((vp.height - tip.height) / 2, edge, maxTop), arrow: null };

    if (vp.width <= mobileMax) {
      var inset = Math.max(0, o.insetBottom || 0);
      var bottomTop = Math.max(edge, vp.height - inset - tip.height - edge), topTop = edge;
      var targetBottom = t.top + t.height, coversBottom = targetBottom + gap > bottomTop && t.top < bottomTop + tip.height;
      var top = !coversBottom ? bottomTop : (t.top - gap >= topTop + tip.height ? topTop : bottomTop);
      return { mode: 'sheet', side: 'none', left: edge, top: top, arrow: null };
    }

    var space = { bottom: vp.height - (t.top + t.height), top: t.top, right: vp.width - (t.left + t.width), left: t.left };
    var fits = {
      bottom: space.bottom >= tip.height + gap + edge, top: space.top >= tip.height + gap + edge,
      right: space.right >= tip.width + gap + edge, left: space.left >= tip.width + gap + edge
    };
    var opposite = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' };
    var order;
    if (o.pref && o.pref !== 'auto') {
      order = [o.pref, opposite[o.pref]].concat(['bottom', 'top', 'right', 'left'].filter(function (s) { return s !== o.pref && s !== opposite[o.pref]; }));
    } else {
      order = ['bottom', 'top', 'right', 'left'].sort(function (a, b) { return space[b] - space[a]; });
    }
    var side = null;
    for (var i = 0; i < order.length; i++) { if (fits[order[i]]) { side = order[i]; break; } }
    var squeezed = !side;
    if (!side) side = order.slice().sort(function (a, b) { return space[b] - space[a]; })[0];

    var cx = t.left + t.width / 2, cy = t.top + t.height / 2, left, topPos, arrow;
    if (side === 'bottom' || side === 'top') {
      left = clamp(cx - tip.width / 2, edge, maxLeft);
      topPos = side === 'bottom' ? t.top + t.height + gap : t.top - gap - tip.height;
      arrow = clamp(cx - left, 20, tip.width - 20);
    } else {
      topPos = clamp(cy - tip.height / 2, edge, maxTop);
      left = side === 'right' ? t.left + t.width + gap : t.left - gap - tip.width;
      arrow = clamp(cy - topPos, 20, tip.height - 20);
    }
    left = clamp(left, edge, maxLeft); topPos = clamp(topPos, edge, maxTop);
    return { mode: 'float', side: squeezed ? 'none' : side, left: left, top: topPos, arrow: squeezed ? null : arrow };
  }

  /* Should this tour start by itself on this page for this person?
       record  saved progress for (role, tour) or undefined
       ctx     { role, page }   page = file name such as 'home-feed.html'
     Skipped and completed tours never restart on their own; the person restarts them from Help / Learn. */
  function decideAutoStart(record, tour, ctx) {
    if (!tour) return { start: false, reason: 'unknown-tour' };
    if (tour.role !== 'any' && tour.role !== ctx.role) return { start: false, reason: 'other-role' };
    if (record && record.status === 'completed') return { start: false, reason: 'completed' };
    if (record && record.status === 'skipped') return { start: false, reason: 'skipped' };
    if (record && record.status === 'in_progress') {
      var idx = clamp(record.step || 0, 0, tour.steps.length - 1), st = tour.steps[idx];
      var pg = st.page || tour.page;
      if (pg && pg !== ctx.page) return { start: false, reason: 'other-page' };
      return { start: true, step: idx, resume: true };
    }
    if (!tour.auto) return { start: false, reason: 'not-automatic' };
    if (tour.page && tour.page !== ctx.page) return { start: false, reason: 'other-page' };
    return { start: true, step: 0, resume: false };
  }

  /* Progress store. `remote` is { fetchAll(uid), upsert(uid, rec), remove(uid, role, tourId) } (may be null) and
     `storage` is localStorage-like. If the remote throws (table not installed, offline) the local copy carries on. */
  function createStore(opts) {
    var remote = opts.remote || null, storage = opts.storage || null, now = opts.now || function () { return Date.now(); };
    var uid = null, cache = {}, remoteDown = false;
    function key(role, id) { return role + ':' + id; }
    function lsKey() { return 'st_tours:' + uid; }
    function readLocal() { try { return storage ? JSON.parse(storage.getItem(lsKey()) || '{}') || {} : {}; } catch (e) { return {}; } }
    function writeLocal() { try { if (storage) storage.setItem(lsKey(), JSON.stringify(cache)); } catch (e) {} }
    function pushRemote(rec) {
      if (!remote || remoteDown) return Promise.resolve(false);
      return Promise.resolve().then(function () { return remote.upsert(uid, rec); }).then(function () { return true; }, function () { remoteDown = true; return false; });
    }
    return {
      load: function (userId) {
        uid = userId; cache = readLocal();
        if (!remote) return Promise.resolve(cache);
        return Promise.resolve().then(function () { return remote.fetchAll(uid); }).then(function (rows) {
          var pushUp = [];
          var byKey = {}; (rows || []).forEach(function (r) { byKey[key(r.role, r.tourId)] = r; });
          Object.keys(byKey).forEach(function (k) {
            var r = byKey[k], l = cache[k];
            if (!l || (r.updatedAt || 0) >= (l.updatedAt || 0)) cache[k] = r;
          });
          Object.keys(cache).forEach(function (k) { if (!byKey[k] || (cache[k].updatedAt || 0) > (byKey[k].updatedAt || 0)) pushUp.push(cache[k]); });
          writeLocal();
          return Promise.all(pushUp.map(pushRemote)).then(function () { return cache; });
        }, function () { remoteDown = true; return cache; });
      },
      get: function (role, id) { return cache[key(role, id)]; },
      /* patch: { status, step, version }. The local copy is written before anything is sent, so a refresh keeps it. */
      save: function (role, id, patch) {
        var prev = cache[key(role, id)] || {};
        var rec = {
          role: role, tourId: id,
          status: patch.status || prev.status || 'in_progress',
          step: patch.step != null ? patch.step : (prev.step || 0),
          version: patch.version != null ? patch.version : (prev.version || 1),
          updatedAt: now(),
          completedAt: (patch.status || prev.status) === 'completed' ? (prev.completedAt || now()) : null
        };
        cache[key(role, id)] = rec; writeLocal();
        return pushRemote(rec).then(function () { return rec; });
      },
      reset: function (role, id) {
        delete cache[key(role, id)]; writeLocal();
        if (!remote || remoteDown) return Promise.resolve();
        return Promise.resolve().then(function () { return remote.remove(uid, role, id); }).then(function () {}, function () { remoteDown = true; });
      },
      all: function () { return Object.keys(cache).map(function (k) { return cache[k]; }); },
      isRemoteDown: function () { return remoteDown; }
    };
  }

  /* Replay from Help / Learn. A tour lives on one page (tour.page). From any other page the person is sent there with
       ?tour=<id> and the page starts it on arrival (api.consumeReplay). Returns { mode: 'here' } or { mode: 'goto', url }. */
  function replayPlan(tour, currentPage) {
    if (!tour) return { mode: 'none' };
    var pg = (tour.steps[0] && tour.steps[0].page) || tour.page;
    if (!pg || pg === currentPage) return { mode: 'here' };
    return { mode: 'goto', url: pg + '?tour=' + encodeURIComponent(tour.id) };
  }
  /* Reads ?tour=<id> from a location.search string; only plain ids are accepted. */
  function readReplayParam(search) {
    var m = /(?:^|[?&])tour=([A-Za-z0-9_-]{1,64})(?:&|$)/.exec(search || '');
    return m ? m[1] : null;
  }

  var pure = { validateTour: validateTour, placeTooltip: placeTooltip, decideAutoStart: decideAutoStart, createStore: createStore, replayPlan: replayPlan, readReplayParam: readReplayParam, STATUSES: STATUSES };

  /* ════════════════ browser runtime ════════════════ */

  function create(win) {
    var doc = win.document;
    var registry = {}, listeners = [], store = null, readyPromise = null, injected = null, active = null;

    function log() { try { win.console && win.console.warn.apply(win.console, ['[tour]'].concat([].slice.call(arguments))); } catch (e) {} }
    function pageName() { var p = (win.location.pathname || '').split('/').pop(); return p || 'index.html'; }
    function reducedMotion() { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    function emit(evt) { listeners.slice().forEach(function (fn) { try { fn(evt); } catch (e) {} }); }

    /* Real remote: the signed-in person's rows in public.user_tour_progress */
    function supabaseRemote() {
      var sb = win.supabase;
      if (!sb || !sb.from) return null;
      var T = 'user_tour_progress';
      function fail(error) { if (error) throw error; }
      return {
        fetchAll: function (uid) {
          return sb.from(T).select('role,tour_id,status,step_index,tour_version,updated_at,completed_at').eq('user_id', uid)
            .then(function (res) {
              fail(res.error);
              return (res.data || []).map(function (r) {
                return { role: r.role, tourId: r.tour_id, status: r.status, step: r.step_index, version: r.tour_version,
                         updatedAt: Date.parse(r.updated_at) || 0, completedAt: r.completed_at ? Date.parse(r.completed_at) : null };
              });
            });
        },
        upsert: function (uid, rec) {
          return sb.from(T).upsert({
            user_id: uid, role: rec.role, tour_id: rec.tourId, status: rec.status, step_index: rec.step, tour_version: rec.version,
            updated_at: new Date(rec.updatedAt).toISOString(), completed_at: rec.completedAt ? new Date(rec.completedAt).toISOString() : null
          }, { onConflict: 'user_id,role,tour_id' }).then(function (res) { fail(res.error); });
        },
        remove: function (uid, role, tourId) {
          return sb.from(T).delete().eq('user_id', uid).eq('role', role).eq('tour_id', tourId).then(function (res) { fail(res.error); });
        }
      };
    }

    /* Who is signed in, and as what. Tests and the demo page can inject both with configure(). */
    function identify() {
      if (injected) return Promise.resolve(injected);
      var auth = win.ST && win.ST.auth;
      if (!auth || !auth.getCurrentUser) return Promise.resolve(null);
      return auth.getCurrentUser().then(function (user) {
        if (!user) return null;
        return auth.getUserRole(user).then(function (role) { return { id: user.id, role: role === 'tasker' ? 'tasker' : 'customer' }; });
      }).catch(function () { return null; });
    }

    var who = null;
    function ready() {
      if (readyPromise) return readyPromise;
      readyPromise = identify().then(function (w) {
        who = w;
        if (!w) return null;
        store = createStore({ remote: w.remote === undefined ? supabaseRemote() : w.remote, storage: w.storage === undefined ? win.localStorage : w.storage });
        return store.load(w.id).then(function () { return w; });
      });
      return readyPromise;
    }

    /* ── element lookup ── */
    function isVisible(el) {
      if (!el || !el.isConnected) return false;
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      var cs = win.getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none';
    }
    function findTarget(step) {
      var list = step.target == null ? [] : (Array.isArray(step.target) ? step.target : [step.target]);
      for (var i = 0; i < list.length; i++) {
        var nodes;
        try { nodes = doc.querySelectorAll(list[i]); } catch (e) { log('bad selector', list[i]); continue; }
        for (var j = 0; j < nodes.length; j++) if (isVisible(nodes[j])) return nodes[j];
      }
      return null;
    }
    /* Is any element for this step in the page at all (even if hidden)? A nav item that exists but is not showing is hidden by the
       screen size (phones), not still loading, so its step is skipped almost at once. */
    function inPage(step) {
      var list = step.target == null ? [] : (Array.isArray(step.target) ? step.target : [step.target]);
      for (var i = 0; i < list.length; i++) { try { if (doc.querySelector(list[i])) return true; } catch (e) {} }
      return false;
    }
    /* Resolves with the element as soon as it is visible, or null after the timeout. Handles menus and cards that load late. */
    function waitForTarget(step, isCurrent) {
      return new Promise(function (resolve) {
        var done = false, mo = null, timer = null, poll = null;
        function finish(el) { if (done) return; done = true; if (mo) mo.disconnect(); win.clearTimeout(timer); win.clearInterval(poll); resolve(el); }
        function check() { if (!isCurrent()) return finish(null); var el = findTarget(step); if (el) finish(el); }
        check(); if (done) return;
        try { mo = new win.MutationObserver(check); mo.observe(doc.body, { childList: true, subtree: true, attributes: true }); } catch (e) {}
        poll = win.setInterval(check, 150);
        timer = win.setTimeout(function () { finish(null); }, step.timeout || (inPage(step) ? HIDDEN_WAIT_MS : DEFAULT_WAIT_MS));
      });
    }

    /* ── DOM ── */
    function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function setBox(node, x, y, w, h) {
      node.style.setProperty('--x', x + 'px'); node.style.setProperty('--y', y + 'px');
      node.style.setProperty('--w', Math.max(0, w) + 'px'); node.style.setProperty('--h', Math.max(0, h) + 'px');
    }
    function pad() { var v = parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue('--tour-pad')); return isNaN(v) ? 8 : v; }
    function cssNum(name, fallback) {
      var raw = win.getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
      var n = parseFloat(raw); if (isNaN(n)) return fallback;
      return /rem$/.test(raw) ? n * 16 : n;
    }

    function buildUI() {
      var ui = { root: el('div', 'st-tour') };
      ui.root.setAttribute('data-st-tour-root', '');
      ui.top = el('div', 'st-tour-panel'); ui.bottom = el('div', 'st-tour-panel'); ui.left = el('div', 'st-tour-panel'); ui.right = el('div', 'st-tour-panel');
      ui.cover = el('div', 'st-tour-hole-cover'); ui.ring = el('div', 'st-tour-ring');
      ui.tip = el('div', 'st-tour-tip'); ui.tip.setAttribute('role', 'dialog'); ui.tip.setAttribute('aria-modal', 'true'); ui.tip.tabIndex = -1;
      ui.arrow = el('div', 'st-tour-arrow'); ui.arrow.setAttribute('aria-hidden', 'true');
      ui.count = el('span', 'st-tour-step'); ui.title = el('h2', 'st-tour-title'); ui.title.id = 'stTourTitle';
      ui.head = el('div', 'st-tour-head');
      ui.close = el('button', 'st-tour-close'); ui.close.type = 'button'; ui.close.setAttribute('aria-label', 'Skip tour');
      ui.close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
      ui.head.append(ui.title, ui.close);
      ui.body = el('p', 'st-tour-body'); ui.body.id = 'stTourBody'; ui.hint = el('p', 'st-tour-hint');
      ui.progress = el('div', 'st-tour-progress'); ui.progress.setAttribute('role', 'progressbar'); ui.progress.setAttribute('aria-valuemin', '0'); ui.progress.appendChild(el('span'));
      ui.actions = el('div', 'st-tour-actions');
      ui.skip = el('button', 'btn btn-sm st-tour-btn st-tour-skip', 'Skip'); ui.skip.type = 'button'; ui.skip.setAttribute('aria-label', 'Skip tour');
      ui.back = el('button', 'btn btn-sm st-tour-btn', 'Back'); ui.back.type = 'button';
      ui.next = el('button', 'btn btn-primary btn-sm', 'Next step'); ui.next.type = 'button';
      ui.buttons = el('div', 'st-tour-buttons'); ui.buttons.append(ui.back, ui.skip, ui.next);
      ui.actions.append(ui.count, ui.buttons);
      ui.tip.setAttribute('aria-labelledby', 'stTourTitle'); ui.tip.setAttribute('aria-describedby', 'stTourBody');
      ui.scroll = el('div', 'st-tour-scroll');   /* scrolls on short screens; the pointer sits outside it so it is not clipped */
      ui.scroll.append(ui.head, ui.body, ui.hint, ui.actions);   /* ui.progress stays detached: it only carries the aria values */
      ui.tip.append(ui.arrow, ui.scroll);
      ui.root.append(ui.top, ui.bottom, ui.left, ui.right, ui.cover, ui.ring, ui.tip);
      return ui;
    }

    /* Everything on the page except the highlighted element is made inert while a step is look-only, so Tab and Enter
       cannot reach (or submit) anything behind the dim wash. */
    function applyInert(ui, targetEl, allowTarget) {
      var kids = doc.body.children;
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k === ui.root) continue;
        var keep = allowTarget && targetEl && k.contains(targetEl);
        if (keep) { if (k.hasAttribute('data-st-tour-inert')) { k.removeAttribute('inert'); k.removeAttribute('data-st-tour-inert'); } }
        else if (!k.hasAttribute('inert')) { k.setAttribute('inert', ''); k.setAttribute('data-st-tour-inert', ''); }
      }
    }
    function clearInert() {
      var marked = doc.querySelectorAll('[data-st-tour-inert]');
      for (var i = 0; i < marked.length; i++) { marked[i].removeAttribute('inert'); marked[i].removeAttribute('data-st-tour-inert'); }
    }

    function layout(run) {
      if (!run || run.closed) return;
      var ui = run.ui, vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight, box = null;
      if (run.el) {
        if (!run.el.isConnected) { var again = findTarget(run.step); if (again) run.el = again; }
        if (run.el.isConnected) {
          var r = run.el.getBoundingClientRect(), p = pad();
          box = { left: Math.round(r.left - p), top: Math.round(r.top - p), width: Math.round(r.width + 2 * p), height: Math.round(r.height + 2 * p) };
        }
      }
      var hx = box ? box.left : vw / 2, hy = box ? box.top : vh / 2, hw = box ? box.width : 0, hh = box ? box.height : 0;
      var x0 = clampN(hx, 0, vw), y0 = clampN(hy, 0, vh), x1 = clampN(hx + hw, 0, vw), y1 = clampN(hy + hh, 0, vh);
      setBox(ui.top, 0, 0, vw, y0); setBox(ui.bottom, 0, y1, vw, vh - y1);
      setBox(ui.left, 0, y0, x0, y1 - y0); setBox(ui.right, x1, y0, vw - x1, y1 - y0);
      setBox(ui.cover, x0, y0, x1 - x0, y1 - y0); ui.cover.hidden = !box || run.interactive;
      setBox(ui.ring, hx, hy, hw, hh); ui.ring.classList.toggle('is-empty', !box);

      var tipW = Math.min(cssNum('--tour-tip-width', 340), vw - 2 * cssNum('--tour-edge', 12));
      if (vw <= 768) tipW = vw - 2 * cssNum('--tour-edge', 12);
      ui.tip.style.setProperty('--tip-w', tipW + 'px');
      /* The floating tab bar on phones: keep the card above it (it is only there while it is displayed) */
      var inset = 0, bn = vw <= 768 ? doc.querySelector('.st-bottom-nav') : null;
      if (bn) {
        var bcs = win.getComputedStyle(bn), br = bn.getBoundingClientRect();
        if (bcs.display !== 'none' && bcs.visibility !== 'hidden' && br.height > 0) inset = Math.max(0, vh - br.top);
      }
      ui.tip.style.setProperty('--tour-inset', inset + 'px');
      var tipH = ui.tip.offsetHeight;
      var spot = placeTooltip({
        target: box, tip: { width: tipW, height: tipH }, vp: { width: vw, height: vh }, pref: run.step.placement || 'auto',
        gap: cssNum('--tour-tip-gap', 12), edge: cssNum('--tour-edge', 12), mobileMax: 768, insetBottom: inset
      });
      ui.tip.style.setProperty('--tip-x', Math.round(spot.left) + 'px'); ui.tip.style.setProperty('--tip-y', Math.round(spot.top) + 'px');
      ui.tip.setAttribute('data-side', spot.side); ui.tip.setAttribute('data-mode', spot.mode);
      if (spot.arrow != null) ui.tip.style.setProperty('--arrow', Math.round(spot.arrow) + 'px'); else ui.tip.style.removeProperty('--arrow');
      run.lastSig = sig(box, tipH);
    }
    function clampN(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    function sig(box, h) { return box ? [box.left, box.top, box.width, box.height, h].join(',') : 'none:' + h; }
    function scheduleLayout(run) {
      if (run.raf) return;
      run.raf = win.requestAnimationFrame(function () { run.raf = 0; layout(run); });
    }

    /* ── running a tour ── */
    function run(tour, startIndex, role) {
      var ui = buildUI();
      var r = {
        tour: tour, role: role, ui: ui, index: startIndex, step: null, el: null, seq: 0, shown: 0, closed: false,
        interactive: false, gated: false, raf: 0, lost: 0, lastSig: '', unbind: [], previousFocus: doc.activeElement, dir: 1
      };
      active = r;
      doc.body.appendChild(ui.root);
      doc.documentElement.classList.add('st-tour-lock');   /* the page does not scroll under the dim wash; the tour scrolls to each step itself */

      function onKey(e) {
        if (r.closed) return;
        var inTip = ui.tip.contains(e.target), neutral = e.target === doc.body || e.target === doc.documentElement;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); skip(); return; }
        if ((e.key === 'ArrowRight') && (inTip || neutral)) { e.preventDefault(); goNext(); return; }
        if ((e.key === 'ArrowLeft') && (inTip || neutral)) { e.preventDefault(); goBack(); return; }
        if (e.key === 'Enter' && !inTip && !r.interactive) { e.preventDefault(); e.stopPropagation(); return; }   /* no accidental form submits */
        if (e.key === 'Tab' && !r.interactive) {
          var f = [ui.close, ui.back, ui.skip, ui.next].filter(function (b) { return !b.hidden && b.getAttribute('aria-disabled') !== 'true'; });
          if (!f.length) { e.preventDefault(); return; }
          var i = f.indexOf(doc.activeElement);
          if (e.shiftKey) { if (i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } }
          else if (i === -1 || i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        }
      }
      function onViewport() { scheduleLayout(r); }
      doc.addEventListener('keydown', onKey, true);
      win.addEventListener('resize', onViewport); win.addEventListener('scroll', onViewport, true);
      r.ticker = win.setInterval(function () {
        if (r.closed || !r.step) return;
        if (r.el && !r.el.isConnected) {
          var again = findTarget(r.step);
          if (again) { r.el = again; r.lost = 0; } else if (++r.lost > 12) { r.lost = 0; if (r.step.fallback !== 'center') { goTo(r.index + r.dir, r.dir); return; } r.el = null; }
        }
        layout(r);
      }, 250);
      r.unbind.push(function () {
        doc.removeEventListener('keydown', onKey, true); win.removeEventListener('resize', onViewport); win.removeEventListener('scroll', onViewport, true);
        win.clearInterval(r.ticker); if (r.raf) win.cancelAnimationFrame(r.raf);
      });

      ui.next.addEventListener('click', function () { goNext(); });
      ui.back.addEventListener('click', function () { goBack(); });
      ui.skip.addEventListener('click', function () { skip(); });
      ui.close.addEventListener('click', function () { skip(); });

      function persist(patch) { return store.save(role, tour.id, Object.assign({ version: tour.version || 1 }, patch)); }

      function setGate(on) {
        r.gated = on; ui.next.setAttribute('aria-disabled', on ? 'true' : 'false');
      }

      function goTo(i, dir) {
        r.dir = dir || 1;
        if (i < 0) { i = 0; r.dir = 1; }
        if (i >= tour.steps.length) { finish(); return; }
        showStep(i);
      }
      function goNext() {
        if (r.closed || r.gated || r.busy || r.loading) return;
        var step = r.step; r.busy = true;
        Promise.resolve().then(function () { return step && step.onNext ? step.onNext(ctxOf()) : undefined; }).then(function (res) {
          r.busy = false;
          if (res === false) return;
          if (step && step.navigate && step.navigate !== pageName() && step.navigate !== win.location.pathname) {
            var nextIndex = r.index + 1;
            if (nextIndex >= tour.steps.length) { finish(); return; }
            persist({ status: 'in_progress', step: nextIndex });
            win.location.assign(step.navigate); return;
          }
          goTo(r.index + 1, 1);
        }, function () { r.busy = false; goTo(r.index + 1, 1); });
      }
      function goBack() { if (r.closed || r.busy || r.loading) return; goTo(r.index - 1, -1); }
      function ctxOf() { return { tour: tour, step: r.step, index: r.index, role: role, el: r.el, engine: api }; }

      function showStep(i) {
        var token = ++r.seq, step = tour.steps[i];
        r.index = i; r.step = step; r.interactive = false;
        r.loading = true;   /* the old card stays on screen (no blank flash) but Next / Back wait until this step is ready */
        Promise.resolve().then(function () { return step.beforeShow ? step.beforeShow({ tour: tour, step: step, index: i, role: role, engine: api }) : undefined; })
          .catch(function (e) { log('beforeShow failed in', step.id, e); })
          .then(function () { return step.target ? waitForTarget(step, function () { return token === r.seq && !r.closed; }) : null; })
          .then(function (found) {
            if (token !== r.seq || r.closed) return;
            r.loading = false;
            if (step.target && !found && step.fallback !== 'center') {
              log('target not found, skipping step', tour.id + '/' + step.id);
              if (r.dir < 0 && i === 0) { goTo(1, 1); return; }
              if (i + r.dir < 0) { goTo(i + 1, 1); return; }
              goTo(i + r.dir, r.dir); return;
            }
            r.el = found || null; r.lost = 0; r.shown++;
            r.interactive = !!(step.interact && r.el);
            renderStep(step, i);
            if (r.el) {
              var rect = r.el.getBoundingClientRect(), vh = doc.documentElement.clientHeight;
              if (rect.top < 0 || rect.bottom > vh) { try { r.el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { r.el.scrollIntoView(); } }
            }
            applyInert(ui, r.el, r.interactive);
            layout(r);
            ui.tip.classList.add('is-shown');
            persist({ status: 'in_progress', step: i });
            try { if (step.onEnter) step.onEnter(ctxOf()); } catch (e) { log('onEnter failed in', step.id, e); }
            ui.tip.focus({ preventScroll: true });
            scheduleLayout(r);
          });
      }

      function renderStep(step, i) {
        var total = tour.steps.length, last = i === total - 1;
        ui.count.textContent = (i + 1) + '/' + total; ui.count.setAttribute('aria-label', 'Step ' + (i + 1) + ' of ' + total);
        ui.title.textContent = step.title;
        ui.body.textContent = typeof step.description === 'function' ? step.description(ctxOf()) : step.description;
        ui.hint.textContent = step.hint || (r.interactive && step.interact.gate ? 'Try it to continue.' : ''); ui.hint.hidden = !ui.hint.textContent;
        ui.progress.setAttribute('aria-valuemax', String(total)); ui.progress.setAttribute('aria-valuenow', String(i + 1));
        ui.progress.style.setProperty('--progress', Math.round(((i + 1) / total) * 100) + '%');
        ui.back.hidden = i === 0; ui.skip.hidden = last; ui.close.hidden = last;
        ui.next.textContent = last ? 'Finish' : 'Next step';
        setGate(false);
        r.gateOff && r.gateOff(); r.gateOff = null;
        if (r.interactive) {
          var ev = step.interact.event || 'click', done = false;
          var handler = function () {
            if (done) return; done = true; setGate(false);
            if (step.interact.advance !== false) win.setTimeout(function () { if (!r.closed && r.step === step) goNext(); }, step.interact.delay == null ? 350 : step.interact.delay);
          };
          r.el.addEventListener(ev, handler, true);
          r.gateOff = function () { r.el && r.el.removeEventListener(ev, handler, true); };
          if (step.interact.gate) setGate(true);
        }
      }

      function teardown() {
        if (r.closed) return; r.closed = true; r.seq++;
        r.gateOff && r.gateOff();
        r.unbind.forEach(function (fn) { fn(); });
        clearInert(); doc.documentElement.classList.remove('st-tour-lock'); if (ui.root.parentNode) ui.root.parentNode.removeChild(ui.root);
        if (active === r) active = null;
        var pf = r.previousFocus; if (pf && pf.isConnected && pf.focus) { try { pf.focus({ preventScroll: true }); } catch (e) {} }
      }
      function finish() {
        var shown = r.shown; teardown();
        if (!shown) { abortSilently(); return; }
        store.save(role, tour.id, { status: 'completed', step: tour.steps.length - 1, version: tour.version || 1 });
        emit({ type: 'completed', tourId: tour.id, role: role });
      }
      function skip() {
        var idx = r.index; teardown();
        store.save(role, tour.id, { status: 'skipped', step: idx, version: tour.version || 1 });
        emit({ type: 'skipped', tourId: tour.id, role: role });
      }
      function abortSilently() {
        /* No step could be shown (every target missing): leave no trace so the tour tries again next visit */
        var prior = r.priorRecord;
        if (prior) store.save(role, tour.id, prior); else store.reset(role, tour.id);
        emit({ type: 'aborted', tourId: tour.id, role: role });
      }
      r.priorRecord = store.get(role, tour.id) ? Object.assign({}, store.get(role, tour.id)) : null;
      r.close = function () { teardown(); emit({ type: 'closed', tourId: tour.id, role: role }); };
      emit({ type: 'started', tourId: tour.id, role: role, step: startIndex });
      showStep(startIndex);
      return r;
    }

    /* ── public API ── */
    var api = {
      /* Tests and demo pages: api.configure({ id: 'u1', role: 'customer', remote: null, storage: fakeStorage }) */
      configure: function (w) { injected = w; readyPromise = null; store = null; if (active) active.close(); },
      register: function (def) {
        var problems = validateTour(def);
        if (problems.length) { log('tour not registered:', def && def.id, problems); return false; }
        registry[def.id] = def; return true;
      },
      registerAll: function (list) { return (list || []).map(api.register); },
      ready: ready,
      isActive: function () { return !!active; },
      activeTourId: function () { return active ? active.tour.id : null; },
      onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
      get: function (id) { return registry[id] || null; },

      /* Tours for a role with their saved status, for the Help / Learn page */
      list: function (role) {
        return ready().then(function () {
          return Object.keys(registry).map(function (id) { return registry[id]; })
            .filter(function (t) { return !role || t.role === 'any' || t.role === role; })
            .map(function (t) {
              var rec = store ? store.get(t.role === 'any' ? 'any' : t.role, t.id) : null;
              return { id: t.id, role: t.role, title: t.title || t.id, description: t.description || '', steps: t.steps.length, status: rec ? rec.status : 'new', step: rec ? rec.step : 0, page: t.page || null };
            });
        });
      },
      status: function (id) {
        return ready().then(function () { var t = registry[id]; if (!t || !store) return null; var rec = store.get(t.role, id); return rec ? rec.status : 'new'; });
      },

      /* Starts a tour (replay or from a button). Resolves true if it began. */
      start: function (id, opts) {
        opts = opts || {};
        return ready().then(function (w) {
          var tour = registry[id];
          if (!w || !store) return false;
          if (!tour) { log('unknown tour', id); return false; }
          if (active) { log('another tour is running:', active.tour.id); return false; }
          var role = tour.role === 'any' ? 'any' : tour.role;
          if (tour.role !== 'any' && tour.role !== w.role && !opts.force) { log('tour is for another role:', id); return false; }
          var from = opts.fromStep != null ? clamp(opts.fromStep, 0, tour.steps.length - 1) : 0;
          run(tour, from, role); return true;
        });
      },

      /* Replay button (Help / Learn): starts the tour here if it belongs to this page, otherwise goes to its page, which
         starts it on arrival through consumeReplay(). Resolves true if it started or navigated. */
      replay: function (id) {
        return ready().then(function (w) {
          var tour = registry[id];
          if (!w || !store || !tour) return false;
          var plan = replayPlan(tour, pageName());
          if (plan.mode === 'goto') { win.location.assign(plan.url); return true; }
          return api.start(id);
        });
      },
      /* Pages that host tours call this once on load (after the role is known). If the address carries ?tour=<id> for a
         tour on this page and this person's role, it removes the parameter, starts that tour from step 1 and resolves
         true. Anything else resolves false, so it is safe to call on every visit. */
      consumeReplay: function () {
        var id = readReplayParam(win.location.search);
        if (!id) return Promise.resolve(false);
        try {
          var u = new win.URL(win.location.href); u.searchParams.delete('tour');
          win.history.replaceState(win.history.state, '', u.pathname + (u.search || '') + u.hash);
        } catch (e) {}
        var tour = registry[id];
        if (!tour) return Promise.resolve(false);
        var plan = replayPlan(tour, pageName());
        if (plan.mode !== 'here') return Promise.resolve(false);
        return api.start(id);
      },

      /* Starts a tour by itself only when this person has not seen it (or is part-way through). */
      autoStart: function (id) {
        return ready().then(function (w) {
          var tour = registry[id];
          if (!w || !store || !tour || active) return false;
          var role = tour.role === 'any' ? 'any' : tour.role;
          var d = decideAutoStart(store.get(role, id), tour, { role: w.role, page: pageName() });
          if (!d.start) return false;
          run(tour, d.step, role); return true;
        });
      },
      /* Would this tour start by itself right now? Resolves { start, resume, ... } without starting anything, so a page can
         ask the person first (the mascot prompt). resume: true means they are part-way through, so no need to ask again. */
      autoStartDecision: function (id) {
        return ready().then(function (w) {
          var tour = registry[id];
          if (!w || !store || !tour || active) return { start: false, reason: 'unavailable' };
          return decideAutoStart(store.get(tour.role === 'any' ? 'any' : tour.role, id), tour, { role: w.role, page: pageName() });
        });
      },
      /* The person said no to a tour: record it as skipped so it never starts by itself again (Help / Learn can still replay it). */
      markSkipped: function (id) {
        return ready().then(function (w) {
          var tour = registry[id];
          if (!w || !store || !tour) return false;
          var role = tour.role === 'any' ? 'any' : tour.role;
          return store.save(role, id, { status: 'skipped', step: 0, version: tour.version }).then(function () { emit({ type: 'skipped', tourId: id, role: role }); return true; });
        });
      },
      /* Tries tours in order; at most one starts. Use this on pages that hold more than one automatic tour. */
      autoStartFirst: function (ids) {
        return (ids || []).reduce(function (p, id) { return p.then(function (started) { return started || api.autoStart(id); }); }, Promise.resolve(false));
      },
      reset: function (id) {
        return ready().then(function (w) { var t = registry[id]; if (!w || !store || !t) return false; return store.reset(t.role === 'any' ? 'any' : t.role, id).then(function () { emit({ type: 'reset', tourId: id }); return true; }); });
      },
      stop: function () { if (active) active.close(); }
    };
    return api;
  }

  return { pure: pure, create: create };
});

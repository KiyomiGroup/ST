/* ============================================================
   STREETTASKER — cards-compact.js   (stage M11)
   The compact horizontal card system used by the tasker and customer homepages (M12b, M13b).
   Components:  STCompact.row         scroller with header, View All, arrows, swipe, keyboard, loading/empty/error states
                STCompact.taskCard    task: title, budget, location, posted time, offers, Urgent badge, distance
                STCompact.taskerCard  tasker: photo, name, rating badge, subscription label, main service, location / distance
                STCompact.categoryCard  service category tile
                STCompact.referralStrip placeholder strip (hidden until the referral stages)
                STCompact.skeleton    one placeholder card ('task' | 'tasker' | 'category')
   Rules kept: nothing invented (a missing field is not drawn); no distance unless a real number is passed;
   the Urgent badge only shows when the caller passes urgent: true (the caller decides from real data);
   ratings come ONLY from js/rating-badge.js (<span data-rating-user>), never from taskers.rating;
   every piece of text is set with textContent; no inline styles. Styles: css/cards-compact.css.
   Needs on the page: css/cards-compact.css, js/rating-badge.js (for ratings), js/membership-labels.js (optional, for PRO / PREMIUM).
   ============================================================ */
(function (root) {
  'use strict';

  var doc = root.document;
  var NS = 'http://www.w3.org/2000/svg';

  /* ── small helpers ── */
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = String(text);
    return n;
  }
  function icon(name) {
    /* Reuse the site icons from js/ui.js when present; they are fixed strings, not user text. */
    var span = el('span', 'cc-ico');
    span.setAttribute('aria-hidden', 'true');
    var svg = root.ST_ICON && root.ST_ICON[name];
    if (svg) span.innerHTML = svg;
    return span;
  }
  function ngn(n) { return '\u20A6' + Number(n || 0).toLocaleString('en-NG'); }
  function ago(iso) {
    if (!iso) return '';
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return '';
    var mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    if (mins < 1440) return Math.floor(mins / 60) + 'h ago';
    return Math.floor(mins / 1440) + 'd ago';
  }
  function initials(name) {
    var s = String(name || '').replace(/[^a-zA-Z ]/g, '').trim().split(' ').filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    return s || 'ST';
  }
  function km(v) { return (typeof v === 'number' && isFinite(v) && v >= 0) ? v.toFixed(1) + ' km' : ''; }
  function safeHref(h) {
    /* Only same-site relative links or http(s). Anything else (javascript:, data:) is dropped. */
    var s = String(h || '');
    return (/^(https?:\/\/|\/|[a-z0-9_\-./]+\.html|\?|#)/i.test(s) && !/^\s*(javascript|data|vbscript):/i.test(s)) ? s : '';
  }
  function isUuid(s) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '')); }
  var uid = 0;

  /* ── Skeletons ── */
  function skeleton(kind) {
    var k = kind === 'tasker' || kind === 'category' ? kind : 'task';
    var card = el('div', 'cc-card cc-card--' + k + ' cc-skel');
    card.setAttribute('aria-hidden', 'true');
    var lines = k === 'category' ? ['cc-skel-circle', 'cc-skel-line cc-skel-line--w60'] : (k === 'tasker' ? ['cc-skel-circle', 'cc-skel-line cc-skel-line--w70', 'cc-skel-line cc-skel-line--w50', 'cc-skel-line cc-skel-line--w60'] : ['cc-skel-line cc-skel-line--w40', 'cc-skel-line', 'cc-skel-line cc-skel-line--w70', 'cc-skel-line cc-skel-line--w50']);
    lines.forEach(function (c) { card.appendChild(el('span', c)); });
    return card;
  }

  /* ── Task card ──
     t: { id, title, budget, location, created_at, offers_count, distance_km, href }
     opts: { urgent: true }  (caller decides; never read from a browser-writable column here) */
  function taskCard(t, opts) {
    t = t || {};
    opts = opts || {};
    var href = safeHref(t.href) || (t.id != null && t.id !== '' ? 'task-details.html?id=' + encodeURIComponent(t.id) : '');
    var card = el('article', 'cc-card cc-card--task');
    if (t.id != null) card.setAttribute('data-task-id', String(t.id));

    var top = el('div', 'cc-top');
    if (opts.urgent === true) {
      var u = el('span', 'cc-badge cc-badge--urgent');
      u.appendChild(icon('bolt'));
      u.appendChild(doc.createTextNode('Urgent'));
      top.appendChild(u);
    }
    var posted = ago(t.created_at);
    if (posted) top.appendChild(el('span', 'cc-posted', 'Posted ' + posted));
    if (top.childNodes.length) card.appendChild(top);

    var h = el('h3', 'cc-title');
    var title = t.title || 'Untitled task';
    if (href) { var a = el('a', 'cc-link', title); a.href = href; h.appendChild(a); } else { h.textContent = title; }
    card.appendChild(h);

    var meta = el('ul', 'cc-meta');
    if (t.location) { var li = el('li'); li.appendChild(icon('pin')); li.appendChild(el('span', '', t.location)); meta.appendChild(li); }
    var d = km(t.distance_km);
    if (d) { var li2 = el('li'); li2.appendChild(el('span', 'cc-dist', d + ' away')); meta.appendChild(li2); }
    if (meta.childNodes.length) card.appendChild(meta);

    var foot = el('div', 'cc-foot');
    var price = el('div', 'cc-price');
    price.appendChild(el('span', 'cc-label', 'Budget'));
    price.appendChild(el('span', 'cc-amount', Number(t.budget) > 0 ? ngn(t.budget) : 'Open budget'));
    foot.appendChild(price);
    var n = Number(t.offers_count);
    if (isFinite(n) && n > 0) foot.appendChild(el('span', 'cc-note', n + ' offer' + (n === 1 ? '' : 's')));
    card.appendChild(foot);
    return card;
  }

  /* ── Tasker card ──
     s: { id, user_id, provider_name, service_name, location, distance_km, photo, verified, isLocal, href }
     The rating is a data-rating-user span: js/rating-badge.js fills it from rating_summary, or leaves it empty. */
  function taskerCard(s, opts) {
    s = s || {};
    var href = safeHref(s.href) || (s.id != null && s.id !== '' ? 'tasker-profile.html?id=' + encodeURIComponent(s.id) : '');
    var card = el('article', 'cc-card cc-card--tasker');
    var name = s.provider_name || 'Tasker';

    var av = el('div', 'cc-avatar');
    av.appendChild(el('span', 'cc-avatar-init', initials(name)));
    var photo = safeHref(s.photo);
    if (photo) {
      var img = el('img');
      img.src = photo; img.alt = ''; img.loading = 'lazy';
      img.addEventListener('error', function () { if (img.parentNode) img.parentNode.removeChild(img); });
      av.appendChild(img);
    }
    card.appendChild(av);

    var h = el('h3', 'cc-title cc-name');
    var nameNode = href ? (function () { var a = el('a', 'cc-link', name); a.href = href; return a; })() : el('span', '', name);
    h.appendChild(nameNode);
    if (s.verified) { var v = el('span', 'cc-verified'); v.setAttribute('title', 'Verified'); v.appendChild(icon('verified')); h.appendChild(v); }
    card.appendChild(h);

    var line = el('div', 'cc-line');
    if (isUuid(s.user_id)) {
      var r = el('span');
      r.setAttribute('data-rating-user', String(s.user_id));
      r.setAttribute('data-rating-role', 'tasker');
      line.appendChild(r);
    }
    /* PRO / PREMIUM: fixed words from js/membership-labels.js; never for Local Taskers. */
    if (root.STMembership && !s.isLocal && s.user_id) {
      var tmp = el('span'); tmp.innerHTML = root.STMembership.html(s.user_id, { small: true });
      while (tmp.firstChild) line.appendChild(tmp.firstChild);
    }
    if (line.childNodes.length) card.appendChild(line);

    if (s.service_name) card.appendChild(el('p', 'cc-role', s.service_name));
    var where = el('p', 'cc-loc');
    var d = km(s.distance_km);
    var txt = [s.location || '', d ? d + ' away' : ''].filter(Boolean).join(' \u00B7 ');
    if (txt) { where.appendChild(icon('pin')); where.appendChild(el('span', '', txt)); card.appendChild(where); }
    /* No lookup here: row.stSetItems decorates the whole row at once, so ratings are fetched in ONE batch, not one call per card. */
    return card;
  }

  /* ── Category card ── c: { label, emoji, href, count } ── */
  function categoryCard(c) {
    c = c || {};
    var href = safeHref(c.href);
    var card = el(href ? 'a' : 'div', 'cc-card cc-card--category');
    if (href) card.href = href;
    var bubble = el('span', 'cc-cat-icon'); bubble.setAttribute('aria-hidden', 'true');
    bubble.textContent = c.emoji || '\uD83D\uDEE0\uFE0F';
    card.appendChild(bubble);
    card.appendChild(el('span', 'cc-cat-label', c.label || 'Category'));
    var n = Number(c.count);
    if (isFinite(n) && n > 0) card.appendChild(el('span', 'cc-cat-count', n + (n === 1 ? ' service' : ' services')));
    return card;
  }

  /* ── Referral strip (placeholder) ──
     Not shown unless the caller passes show: true. M15 supplies the real text and link. */
  function referralStrip(o) {
    o = o || {};
    var strip = el('section', 'cc-referral');
    strip.setAttribute('aria-label', o.title || 'Referral');
    if (o.show !== true) strip.hidden = true;
    var body = el('div', 'cc-referral-body');
    body.appendChild(el('h3', 'cc-referral-title', o.title || ''));
    if (o.text) body.appendChild(el('p', 'cc-referral-text', o.text));
    strip.appendChild(body);
    var href = safeHref(o.href);
    if (href && o.cta) { var a = el('a', 'cc-referral-cta', o.cta); a.href = href; strip.appendChild(a); }
    return strip;
  }

  /* ── Row (the scroller) ──
     o: { title, viewAllHref, viewAllLabel, ariaLabel, skeleton: 'task'|'tasker'|'category', skeletonCount,
          emptyText, errorText, hideWhenEmpty, items: [Node], state }
     Returns the section element with:  el.stSetItems(nodes), el.stSetState('loading'|'ready'|'empty'|'error'), el.stOnRetry(fn)
     Empty: the whole section is hidden by default (the homepage rule); pass hideWhenEmpty: false to show emptyText instead. */
  function row(o) {
    o = o || {};
    var id = 'ccrow' + (++uid);
    var sec = el('section', 'cc-row');
    sec.setAttribute('aria-labelledby', id + '-t');
    if (o.ariaLabel) sec.setAttribute('aria-label', o.ariaLabel);

    var head = el('div', 'cc-head');
    var h = el('h2', 'cc-head-title', o.title || ''); h.id = id + '-t';
    head.appendChild(h);
    var tools = el('div', 'cc-head-tools');
    var href = safeHref(o.viewAllHref);
    if (href) { var va = el('a', 'cc-viewall', o.viewAllLabel || 'View All'); va.href = href; tools.appendChild(va); }
    var prev = el('button', 'cc-arrow'); prev.type = 'button'; prev.setAttribute('aria-label', 'Scroll left'); prev.appendChild(icon('left'));
    var next = el('button', 'cc-arrow'); next.type = 'button'; next.setAttribute('aria-label', 'Scroll right'); next.appendChild(icon('right'));
    tools.appendChild(prev); tools.appendChild(next);
    head.appendChild(tools);
    sec.appendChild(head);

    var view = el('div', 'cc-viewport');
    var track = el('div', 'cc-track');
    track.setAttribute('role', 'list');
    track.tabIndex = 0;
    track.setAttribute('aria-label', o.title || 'Cards');
    view.appendChild(track);
    sec.appendChild(view);

    var msg = el('div', 'cc-msg'); msg.setAttribute('role', 'status'); msg.hidden = true;
    var msgText = el('p', 'cc-msg-text');
    var retry = el('button', 'cc-retry', 'Try again'); retry.type = 'button'; retry.hidden = true;
    msg.appendChild(msgText); msg.appendChild(retry);
    sec.appendChild(msg);

    var retryFn = null;
    retry.addEventListener('click', function () { if (retryFn) retryFn(); });

    function updateArrows() {
      var max = track.scrollWidth - track.clientWidth;
      var rtl = getComputedStyle(track).direction === 'rtl';
      var pos = Math.abs(track.scrollLeft);
      prev.disabled = pos <= 1;
      next.disabled = pos >= max - 1;
      var scrollable = max > 1;
      sec.classList.toggle('is-scrollable', scrollable);
      if (rtl) { var t = prev.disabled; prev.disabled = next.disabled; next.disabled = t; }
    }
    function step(dir) {
      var first = track.firstElementChild;
      var w = first ? first.getBoundingClientRect().width : track.clientWidth / 2;
      var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var amount = Math.max(1, Math.floor(track.clientWidth / (w + gap))) * (w + gap);
      track.scrollBy({ left: dir * amount, behavior: reduce ? 'auto' : 'smooth' });
    }
    prev.addEventListener('click', function () { step(-1); });
    next.addEventListener('click', function () { step(1); });
    track.addEventListener('scroll', function () { root.requestAnimationFrame(updateArrows); }, { passive: true });
    track.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'Home') { e.preventDefault(); track.scrollTo({ left: 0 }); }
      else if (e.key === 'End') { e.preventDefault(); track.scrollTo({ left: track.scrollWidth }); }
    });
    if (root.ResizeObserver) { new root.ResizeObserver(updateArrows).observe(track); }
    else { root.addEventListener('resize', updateArrows); }

    function clear() { while (track.firstChild) track.removeChild(track.firstChild); }
    function setState(state) {
      sec.setAttribute('data-state', state);
      msg.hidden = true; retry.hidden = true; view.hidden = false; sec.hidden = false;
      track.removeAttribute('aria-busy');
      if (state === 'loading') {
        clear();
        track.setAttribute('aria-busy', 'true');
        var n = Number(o.skeletonCount) > 0 ? Number(o.skeletonCount) : 4;
        for (var i = 0; i < n; i++) { var s = skeleton(o.skeleton); s.setAttribute('role', 'listitem'); track.appendChild(s); }
      } else if (state === 'empty') {
        clear();
        if (o.hideWhenEmpty === false) { view.hidden = true; msgText.textContent = o.emptyText || 'Nothing here yet.'; msg.hidden = false; }
        else { sec.hidden = true; }
      } else if (state === 'error') {
        clear();
        view.hidden = true; msgText.textContent = o.errorText || 'We could not load this. Please try again.'; msg.hidden = false;
        retry.hidden = !retryFn;
      }
      root.requestAnimationFrame(updateArrows);
    }
    function setItems(nodes) {
      clear();
      var list = (nodes || []).filter(Boolean);
      if (!list.length) { setState('empty'); return; }
      list.forEach(function (n) { n.setAttribute('role', 'listitem'); track.appendChild(n); });
      sec.setAttribute('data-state', 'ready');
      msg.hidden = true; view.hidden = false; sec.hidden = false;
      track.removeAttribute('aria-busy');
      if (root.STRating && root.STRating.decorate) { try { root.STRating.decorate(track); } catch (e) { /* badges stay empty */ } }
      root.requestAnimationFrame(updateArrows);
    }
    sec.stSetItems = setItems;
    sec.stSetState = setState;
    sec.stOnRetry = function (fn) { retryFn = typeof fn === 'function' ? fn : null; };

    if (o.items && o.items.length) setItems(o.items);
    else setState(o.state || 'loading');
    return sec;
  }

  root.STCompact = { row: row, taskCard: taskCard, taskerCard: taskerCard, categoryCard: categoryCard, referralStrip: referralStrip, skeleton: skeleton };
  if (typeof module !== 'undefined' && module.exports) { module.exports = root.STCompact; }
})(typeof window !== 'undefined' ? window : this);

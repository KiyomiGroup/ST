/* ============================================================
   STREET TASKER: local-tasker-public.js  (Local Tasker stage 4C-2)
   Customer-side helper. For a page's user ids it asks the database
   (local_tasker_public_info, callable by visitors) which of them are
   PUBLISHED Local Taskers, and turns their photo paths into short-lived
   signed links (the bucket is private; decision D46).
   Needs: supabaseClient.js (window.supabase). Safe to load before it is used.
   Never throws: if anything fails the page simply shows no Local Tasker
   label (the person still appears as a normal listing). The label comes
   ONLY from the database function, never from a column (decision D50).
   ============================================================ */
(function () {
  'use strict';
  var BUCKET = 'local-tasker-photos';
  var TTL = 3600;                     /* signed links last one hour */
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var info = {};                      /* user id -> { coverUrl, avatarUrl } for published Local Taskers */
  var asked = {};                     /* user id -> true once the database answered for it */

  function sb() { return window.supabase || null; }

  /* paths -> { path: signedUrl } (missing or failed links are simply absent) */
  async function sign(paths) {
    var out = {};
    var list = Array.from(new Set((paths || []).filter(Boolean)));
    if (!list.length || !sb()) return out;
    try {
      var r = await sb().storage.from(BUCKET).createSignedUrls(list, TTL);
      (r.data || []).forEach(function (x) { if (x && x.path && x.signedUrl && !x.error) out[x.path] = x.signedUrl; });
    } catch (e) { /* no pictures: the card shows initials */ }
    return out;
  }

  /* user id -> avatar storage path, for published Local Taskers who have a profile picture. Never throws. */
  async function avatarPaths(ids) {
    var out = {};
    if (!ids.length || !sb()) return out;
    try {
      var r = await sb().rpc('local_tasker_public_avatars', { p_ids: ids });
      if (!r.error) (r.data || []).forEach(function (x) { if (x && x.avatar_path) out[String(x.user_id)] = x.avatar_path; });
    } catch (e) { /* no pictures: the card shows the StreetTasker mark */ }
    return out;
  }

  /* Ask once for any ids not asked yet (100 per call, the database limit). */
  async function load(ids) {
    if (!sb()) return;
    var todo = Array.from(new Set((ids || []).map(String).filter(function (x) { return UUID.test(x) && !asked[x]; })));
    for (var i = 0; i < todo.length; i += 100) {
      var chunk = todo.slice(i, i + 100);
      try {
        var r = await sb().rpc('local_tasker_public_info', { p_ids: chunk });
        if (r.error) continue;                 /* not asked: a later call may retry */
        var rows = r.data || [];
        var av = await avatarPaths(rows.map(function (x) { return String(x.user_id); }));   /* profile pictures (kind avatar); empty if the function is not installed */
        var urls = await sign(rows.map(function (x) { return x.cover_path; }).concat(Object.keys(av).map(function (k) { return av[k]; })));
        chunk.forEach(function (id) { asked[id] = true; });
        rows.forEach(function (x) { var id = String(x.user_id); info[id] = { coverUrl: urls[x.cover_path] || null, avatarUrl: (av[id] && urls[av[id]]) || null }; });
      } catch (e) { /* leave the chunk unasked */ }
    }
  }

  /* Give published Local Taskers their cover photo on any list of cards. rows: objects; idKeys: fields that hold the person's user id (first one
     present is used); photoKeys: fields to fill with the signed cover link. Rows that are not published Local Taskers are left alone. Never throws. */
  async function decorate(rows, idKeys, photoKeys, opts) {
    try {
      var list = rows || [];
      function idOf(r) { for (var i = 0; i < idKeys.length; i++) { if (r && r[idKeys[i]]) return String(r[idKeys[i]]); } return ''; }
      await load(list.map(idOf));
      list.forEach(function (r) {
        var id = idOf(r);
        if (!id || !info[id]) return;
        r.isLocal = true;
        if (opts && opts.service) {   /* B5: a service card shows the service's own image, else the category placeholder (never the cover photo) */
          if (!r.photo && typeof window.stTaskPhUrl === 'function') r.photo = window.stTaskPhUrl(r.category, r.id || r.service_id);
          return;
        }
        var url = info[id].avatarUrl || '';   /* the person's profile picture; never the cover or the service photo */
        photoKeys.forEach(function (k) { r[k] = url; });
      });
    } catch (e) { /* cards keep their own photo or the placeholder */ }
    return rows;
  }

  /* Photos of ONE published person: [{ url, caption, isCover }] */
  async function photos(id) {
    if (!sb() || !UUID.test(String(id))) return [];
    try {
      var r = await sb().rpc('local_tasker_public_photos', { p_tasker: String(id) });
      if (r.error) return [];
      var rows = r.data || [];
      var urls = await sign(rows.map(function (x) { return x.path; }));
      return rows.filter(function (x) { return urls[x.path]; })
        .map(function (x) { return { url: urls[x.path], caption: x.caption || '', isCover: !!x.is_cover }; });
    } catch (e) { return []; }
  }

  /* Public cards for local-taskers.html: published people only. */
  async function cards(limit) {
    if (!sb()) return [];
    try {
      var r = await sb().rpc('local_tasker_public_cards', { p_limit: limit || 12 });
      if (r.error) return [];
      var rows = r.data || [];
      var av = await avatarPaths(rows.map(function (x) { return String(x.user_id); }));
      var urls = await sign(rows.map(function (x) { return x.cover_path; }).concat(Object.keys(av).map(function (k) { return av[k]; })));
      return rows.map(function (x) {
        return {
          user_id: String(x.user_id), name: x.display_name || '', service: x.service_name || '',
          category: x.category || '', location: x.location || '', price: Number(x.price) || 0,
          rate_unit: x.rate_unit || '/job', specialties: x.specialties || [], coverUrl: urls[x.cover_path] || null, avatarUrl: (av[String(x.user_id)] && urls[av[String(x.user_id)]]) || null
        };
      });
    } catch (e) { return []; }
  }


  /* ── "Meet Local Taskers" grid, shared by index.html and local-taskers.html ─────────────
     Real PUBLISHED Local Taskers replace the static sample cards. The sample cards stay ONLY when nobody
     is published or the lookup fails. Everything is inserted as text, never as HTML. */
  var PHONE_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.7 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .7-.2 1z"/></svg>';
  var PIN_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  function initials(n) { return String(n || '').replace(/[^a-zA-Z ]/g, '').trim().split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase() || 'LT'; }
  function ngn(n) { return '\u20A6' + Number(n || 0).toLocaleString('en-NG'); }
  function el(tag, cls, txt) { var x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; }

  function gridCard(c) {
    var art = el('div', 'lt-tasker-card lt-tasker-card--live');
    var photo = el('div', 'lt-tasker-photo lt-tasker-photo--live');
    if (c.avatarUrl) {
      var img = el('img', 'lt-tasker-img'); img.src = c.avatarUrl; img.alt = ''; img.loading = 'lazy';
      img.addEventListener('error', function () { img.remove(); });
      photo.appendChild(img);
    }
    photo.appendChild(el('span', 'lt-tasker-initials', initials(c.name)));
    var body = el('div', 'lt-tasker-body');
    body.appendChild(el('div', 'lt-tasker-name', c.name));
    body.appendChild(el('div', 'lt-tasker-spec', c.service));
    /* One tag in the body (not on the photo) so it also shows in the phone layout, where the photo is a small circle. */
    var tag = el('span', 'lt-live-tag'); tag.innerHTML = PHONE_SVG + ' '; tag.appendChild(document.createTextNode('Phone Assisted'));
    body.appendChild(tag);
    if (c.location) { var loc = el('div', 'lt-tasker-loc'); loc.innerHTML = PIN_SVG + ' '; loc.appendChild(document.createTextNode(c.location)); body.appendChild(loc); }
    body.appendChild(el('div', 'lt-tasker-rating', c.price ? 'From ' + ngn(c.price) + c.rate_unit : 'Ask for a quote'));
    var a = el('a', 'btn btn-outline btn-sm btn-full', 'View Profile'); a.href = 'tasker-profile.html?id=' + encodeURIComponent(c.user_id);
    body.appendChild(a);
    art.appendChild(photo); art.appendChild(body);
    return art;
  }

  /* opts: { grid, chips, note } elements. Safe to call once per page. */
  function mountGrid(opts) {
    var grid = opts && opts.grid, chips = opts && opts.chips, note = opts && opts.note, live = null;
    if (!grid) return Promise.resolve(0);
    function show(filter) {
      var f = String(filter || '').toLowerCase();
      var rows = live.filter(function (c) { return !f || (c.service + ' ' + c.category + ' ' + c.specialties.join(' ')).toLowerCase().indexOf(f) !== -1; });
      grid.textContent = '';
      rows.forEach(function (c) { grid.appendChild(gridCard(c)); });
      if (note) { note.hidden = rows.length > 0; note.textContent = rows.length ? '' : 'No Local Taskers in this craft yet. Please check again soon.'; }
    }
    if (chips) chips.addEventListener('click', function (e) {
      var chip = e.target.closest('.filter-chip');
      if (!chip || !chips.contains(chip)) return;
      chips.querySelectorAll('.filter-chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      if (live) show(chip.textContent.trim() === 'All Crafts' ? '' : chip.textContent.trim());
    });
    return cards(12).then(function (rows) {
      live = rows; show('');                 /* nobody published: the grid is empty and the note says so */
      return rows.length;
    });
  }

  /* ── Profile pictures on cards ──────────────────────────────────────────────────────────────────────
     Cards (js/ui.js) mark the spot with data-avatar-user / data-avatar-kind. Here the picture is put in.
       kind "photo" (the big picture on a tasker card): a Local Tasker shows their profile picture, never the service or cover photo.
                    If they have no picture yet, the StreetTasker mark stays. Other taskers are not touched.
       kind "chip"  (the small round picture beside the name on a service card): a Local Tasker's profile picture; for anyone else the
                    picture on their account (users.avatar_url) if it can be read. No picture: the StreetTasker mark stays. */
  var UUID36 = UUID, userAv = {}, userAsked = {};
  function safeUrl(u) { return typeof u === 'string' && /^https:\/\//i.test(u) ? u : null; }
  async function loadUserAvatars(ids) {
    var todo = ids.filter(function (x) { return !userAsked[x]; });
    for (var i = 0; i < todo.length; i += 100) {
      var chunk = todo.slice(i, i + 100);
      chunk.forEach(function (x) { userAsked[x] = true; });          /* asked once, even if it fails */
      try {
        var r = await sb().from('users').select('id, avatar_url').in('id', chunk);
        if (!r.error) (r.data || []).forEach(function (u) { var s = safeUrl(u.avatar_url); if (s) userAv[String(u.id)] = s; });
      } catch (e) { /* no picture: the mark stays */ }
    }
  }
  function putImg(node, url) {
    var img = document.createElement('img');
    img.src = url; img.alt = ''; img.loading = 'lazy';
    img.addEventListener('error', function () { if (img.parentNode) img.parentNode.removeChild(img); });
    node.appendChild(img);
  }
  var fillBusy = false, fillAgain = false;
  async function fillAvatars() {
    if (fillBusy) { fillAgain = true; return; }
    fillBusy = true;
    try {
      if (!sb()) return;
      var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-avatar-user]:not([data-avatar-done])'));
      if (!nodes.length) return;
      var ids = Array.from(new Set(nodes.map(function (n) { return String(n.getAttribute('data-avatar-user')).toLowerCase(); }))).filter(function (x) { return UUID36.test(x); });
      await load(ids);
      var chipOthers = Array.from(new Set(nodes.filter(function (n) { return n.getAttribute('data-avatar-kind') === 'chip'; }).map(function (n) { return String(n.getAttribute('data-avatar-user')).toLowerCase(); })))
        .filter(function (x) { return UUID36.test(x) && !info[x]; });
      if (chipOthers.length) await loadUserAvatars(chipOthers);
      nodes.forEach(function (n) {
        n.setAttribute('data-avatar-done', '1');
        var uid = String(n.getAttribute('data-avatar-user')).toLowerCase(), kind = n.getAttribute('data-avatar-kind'), url = null;
        if (info[uid]) {
          url = info[uid].avatarUrl || null;
          if (kind === 'photo') Array.prototype.slice.call(n.querySelectorAll('img:not(.st-logo-ph)')).forEach(function (im) { im.remove(); });
        } else if (kind === 'chip') { url = userAv[uid] || null; }
        if (url) putImg(n, url);
      });
    } catch (e) { /* cards keep the StreetTasker mark */ }
    finally { fillBusy = false; if (fillAgain) { fillAgain = false; schedule(); } }
  }
  var fillTimer = null;
  function schedule() { clearTimeout(fillTimer); fillTimer = setTimeout(fillAvatars, 120); }
  function startFill() {
    schedule();
    try { new MutationObserver(function () { if (document.querySelector('[data-avatar-user]:not([data-avatar-done])')) schedule(); }).observe(document.body, { childList: true, subtree: true }); } catch (e) { /* no live updates */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startFill); else startFill();

  window.STLocal = {
    LABEL: 'Local Tasker',
    LABEL_PHONE: 'Phone Assisted',
    /* Plain-text note shown on a Local Tasker's profile. No fee, donation or percentage is stated here. */
    NOTE: 'This is a Local Tasker. A StreetTasker coordinator talks to them by phone to confirm your job, so skilled people who are not online can still take work. Making room for people without a smartphone is part of how StreetTasker is built.',
    load: load,
    decorate: decorate,
    isLocal: function (id) { return !!info[String(id)]; },
    coverUrl: function (id) { return (info[String(id)] && info[String(id)].coverUrl) || null; },
    avatarUrl: function (id) { return (info[String(id)] && info[String(id)].avatarUrl) || null; },
    fillAvatars: fillAvatars,
    photos: photos,
    cards: cards,
    mountGrid: mountGrid
  };
})();

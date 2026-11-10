/* ============================================================
   STREETTASKER — service-details.js
   Service details page (service-details.html?id=<services.id>).
   Shows what the tasker wrote about THIS service (name, description, price, place, photo, skills), who offers it,
   and a Book service button. Booking itself is the tasker profile's booking pop-up, opened for this service
   (tasker-profile.html?id=<tasker>&book=<service>). Only live services show (available = true, and Local Taskers
   only once published). All text is set as text or escaped.
   Needs: supabaseClient.js, sanitize.js (escapeHtml), auth.js, db.js.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var NAIRA = '\u20a6';
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function text(v) { return String(v == null ? '' : v).trim(); }
  function paras(s) { return text(s).split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean); }
  function initials(name) {
    var s = String(name || '').replace(/[^a-zA-Z ]/g, '').trim().split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    return s || 'T';
  }
  function missing() { $('sdLoading').hidden = true; $('sdContent').hidden = true; $('sdMissing').hidden = false; }

  async function loadService(id) {
    var sb = window.supabase;
    var FULL = 'id, user_id, service_name, category, price, price_max, rate_unit, description, location, photo, specialties, available';
    var BASE = 'id, user_id, service_name, category, price, price_max, rate_unit, description, location, photo, available';
    var r = await sb.from('services').select(FULL).eq('id', id).maybeSingle();
    if (r.error) r = await sb.from('services').select(BASE).eq('id', id).maybeSingle();   /* specialties column not in this database yet */
    return r.data || null;
  }

  async function loadProvider(uid) {
    var out = { name: '', location: '', photo: '' };
    if (!uid) return out;
    try {
      var t = await window.supabase.from('taskers').select('name, business_name, location, photo_url').eq('user_id', String(uid)).maybeSingle();
      if (t.data) { out.name = text(t.data.business_name) || text(t.data.name); out.location = text(t.data.location); out.photo = text(t.data.photo_url); }
    } catch (e) { /* fall through to the account name */ }
    if (!out.name) {
      try {
        var u = await window.supabase.from('users').select('name').eq('id', String(uid)).maybeSingle();
        if (u.data) out.name = text(u.data.name);
      } catch (e2) { /* no name */ }
    }
    return out;
  }

  function render(svc, prov, isOwner, me) {
    var title = text(svc.service_name) || 'Service';
    document.title = title + ' — StreetTasker';
    $('sdTitle').textContent = title;
    $('sdCat').textContent = text(svc.category).replace(/[_-]+/g, ' ') || 'Service';
    var loc = text(svc.location);
    $('sdLoc').textContent = loc ? 'Available around ' + loc : ''; $('sdLoc').hidden = !loc;

    var photo = text(svc.photo);
    if (/^https?:\/\//i.test(photo)) { $('sdPhoto').src = photo; $('sdPhoto').alt = title; $('sdMedia').hidden = false; }

    var price = Number(svc.price), unit = text(svc.rate_unit).replace(/^\//, '');
    var priceEl = $('sdPrice'); priceEl.textContent = '';
    var priceMax = Number(svc.price_max);
    var rateLbl = document.querySelector('.sd-rate-label'); if (rateLbl) rateLbl.textContent = priceMax > Number(svc.price) ? 'Price range' : 'Starting from';
    if (price > 0) {
      var priceTxt = NAIRA + price.toLocaleString('en-NG') + (priceMax > price ? ' \u2013 ' + NAIRA + priceMax.toLocaleString('en-NG') : '');
      priceEl.appendChild(document.createTextNode(priceTxt));
      if (unit) { var sm = document.createElement('small'); sm.textContent = ' per ' + unit; priceEl.appendChild(sm); }
    } else { priceEl.textContent = 'Ask for a quote'; }

    var desc = $('sdDesc'); desc.textContent = '';
    var ps = paras(svc.description);
    (ps.length ? ps : ['The tasker has not added more details about this service yet.']).forEach(function (p) {
      var el = document.createElement('p'); el.textContent = p; desc.appendChild(el);
    });

    var tags = Array.isArray(svc.specialties) ? svc.specialties.map(text).filter(Boolean) : [];
    var tagBox = $('sdTags'); tagBox.textContent = '';
    tags.forEach(function (t) { var s = document.createElement('span'); s.className = 'sd-tag'; s.textContent = t; tagBox.appendChild(s); });
    tagBox.hidden = !tags.length;

    var pname = prov.name || 'Service provider';
    $('sdProvName').textContent = pname;
    $('sdProvLoc').textContent = prov.location || loc;
    var av = $('sdProvAvatar'); av.textContent = '';
    if (prov.photo && /^https?:\/\//i.test(prov.photo)) {
      var img = document.createElement('img'); img.alt = ''; img.src = prov.photo;
      img.addEventListener('error', function () { av.textContent = initials(pname); });
      av.appendChild(img);
    } else { av.textContent = initials(pname); }

    var uid = String(svc.user_id || '');
    $('sdProvLink').href = uid ? 'tasker-profile.html?id=' + encodeURIComponent(uid) : 'find-taskers.html';
    var book = $('sdBook');
    if (isOwner) { book.textContent = 'Edit my services'; book.href = 'my-services.html'; }
    else { book.textContent = 'Book service'; book.href = uid ? 'tasker-profile.html?id=' + encodeURIComponent(uid) + '&book=' + encodeURIComponent(String(svc.id)) : 'find-taskers.html'; }

    /* A tasker looking at another tasker's service is pointed to their own My Services page */
    $('sdOwn').hidden = true;
    if (!isOwner && me) {
      try {
        var A = window.ST && window.ST.auth;
        if (A && A.checkCustomerOnly) A.checkCustomerOnly(me).then(function (c) { $('sdOwn').hidden = !(c && c.loggedIn && c.ok === false); }).catch(function () {});
      } catch (e) { /* link stays hidden */ }
    }

    /* Stage 4: a Sales service lists its products (name, price, photo). Nothing shows for other categories. */
    $('sdProducts').hidden = true;
    if (String(svc.category) === 'sales') {
      $('sdBook').textContent = isOwner ? 'Edit my services' : 'Order now';
      if (!isOwner && uid) $('sdBook').href = 'tasker-profile.html?id=' + encodeURIComponent(uid) + '&order=' + encodeURIComponent(String(svc.id));
      loadProducts(svc.id);
    }

    $('sdLoading').hidden = true; $('sdMissing').hidden = true; $('sdContent').hidden = false;
  }

  async function loadProducts(serviceId) {
    try {
      var r = await window.supabase.from('service_products').select('position, name, price, image_url').eq('service_id', serviceId).order('position');
      var rows = (r && r.data) || [];
      var list = $('sdProdList'); list.textContent = '';
      rows.forEach(function (p) {
        var li = document.createElement('li'); li.className = 'sd-prod';
        var img = text(p.image_url);
        var thumb = document.createElement('span'); thumb.className = 'sd-prod-img';
        if (/^https?:\/\//i.test(img)) { var im = document.createElement('img'); im.alt = ''; im.loading = 'lazy'; im.src = img; im.addEventListener('error', function () { im.remove(); }); thumb.appendChild(im); }
        var nm = document.createElement('strong'); nm.className = 'sd-prod-name'; nm.textContent = text(p.name);
        var pr = document.createElement('span'); pr.className = 'sd-prod-price'; pr.textContent = NAIRA + Number(p.price).toLocaleString('en-NG');
        li.appendChild(thumb); li.appendChild(nm); li.appendChild(pr); list.appendChild(li);
      });
      $('sdProducts').hidden = !rows.length;
    } catch (e) { /* products stay hidden */ }
  }

  async function init() {
    var id = new URLSearchParams(window.location.search).get('id');
    if (!id || !(UUID_RE.test(id) || /^\d+$/.test(id))) return missing();
    try {
      var svc = await loadService(id);
      var me = null;
      try { var s = await window.supabase.auth.getSession(); me = s.data.session && s.data.session.user; } catch (e) { /* signed out */ }
      var isOwner = !!(me && svc && String(svc.user_id) === String(me.id));
      if (!svc) {
        /* Older cards can carry a tasker's id instead of a service id: send that person to their profile */
        try {
          var tk = await window.supabase.from('taskers').select('user_id').eq('id', String(id)).maybeSingle();
          if (tk.data && tk.data.user_id) { window.location.replace('tasker-profile.html?id=' + encodeURIComponent(String(tk.data.user_id))); return; }
        } catch (e) { /* not a tasker id either */ }
        return missing();
      }
      if (svc.available === false && !isOwner) return missing();
      /* Local Taskers show only once published */
      if (!isOwner && window.ST && ST.db && ST.db.hideUnpublishedLocal) {
        var visible = await ST.db.hideUnpublishedLocal([svc], 'user_id');
        if (!visible.length) return missing();
      }
      render(svc, await loadProvider(svc.user_id), isOwner, me);
    } catch (err) {
      console.error('[service-details]', err);
      missing();
    }
  }

  init();
})();

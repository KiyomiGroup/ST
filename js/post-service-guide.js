/* ============================================================
   StreetTasker: guided "Post a service" (post-service.html?guide=1).

   One question per page, like signing up. It does NOT have its own form: it shows one part of the real form at a
   time (name, category + what you offer, each category question, how you charge, price, location, about,
   availability, specialties, photo), so validation, the category picker, pricing, Sales products and the final save
   are exactly the normal page's. The last page posts the service through the normal submit.

   Each page has Continue and Skip, and below them "Save to draft". Skip never loses anything: when the last page is
   reached, any required question that was skipped sends the person back to it. Draft saves are partial (a service
   with only a name is fine); the normal page picks that draft up too (it opens the latest unpublished one).

   Needs, from post-service.html: the form ids, getRateValues(), readProducts(), readFulfilmentRaw(), isSales(),
   saveProducts(), showToast(). After a guided post the page's save redirects through window.psgAfterPost (home-feed.html).
   Pure helpers (no DOM) are unit-tested in tests/post-service-guide.test.js.
   Styles: css/post-service-guide.css.
   ============================================================ */
(function (root, factory) {
  var built = factory();
  if (typeof module === 'object' && module.exports) { module.exports = built.pure; }
  else if (/[?&]guide=1(&|$)/.test(root.location.search || '')) { built.run(root); }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ════════════════ pure core ════════════════ */

  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  /* Index of the page after `id` in a page list (stays on the last page). `fallback` is used if `id` is gone. */
  function nextIndex(ids, id, fallback) {
    var i = ids.indexOf(id);
    if (i === -1) i = Math.min(Math.max(fallback || 0, 0), ids.length - 1) - 1;
    return Math.min(i + 1, ids.length - 1);
  }
  function prevIndex(ids, id, fallback) {
    var i = ids.indexOf(id);
    if (i === -1) i = Math.min(Math.max(fallback || 0, 0), ids.length - 1) + 1;
    return Math.max(i - 1, 0);
  }

  /* Progress as { n, total, pct } for page index i of total pages. */
  function progress(i, total) {
    total = Math.max(total, 1);
    return { n: i + 1, total: total, pct: Math.round((i / total) * 100) };
  }

  /* Whole-service values to save for a partial draft. Missing required columns get safe blanks. */
  function draftPayload(v) {
    return {
      user_id: v.userId,
      service_name: clean(v.name) || 'Untitled service',
      category: v.category || 'other',
      subcategory: v.category && v.category !== 'other' ? (v.subcategory || null) : null,
      details: v.details || {},
      price: v.price > 0 ? v.price : 0,
      rate_unit: v.rateUnit || '/job',
      price_max: v.priceMax > 0 ? v.priceMax : null,
      price_type: v.priceType || null,
      price_unit_label: v.unitLabel || null,
      location: clean(v.location),
      description: String(v.description || '').trim(),
      photo: v.photo || null,
      available: false,
      specialties: v.specialties || [],
      availability_status: v.availability || 'available_this_week'
    };
  }

  var pure = { nextIndex: nextIndex, prevIndex: prevIndex, progress: progress, draftPayload: draftPayload, clean: clean };

  /* ════════════════ browser runtime ════════════════ */

  function run(win) {
    var doc = win.document;
    function q(sel, ctx) { return (ctx || doc).querySelector(sel); }
    function qa(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
    function val(id) { var n = doc.getElementById(id); return n ? String(n.value || '') : ''; }
    function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

    var form = doc.getElementById('serviceForm');
    if (!form) return;
    doc.body.classList.add('psg-on');

    var current = null, currentIndex = 0, busy = false, allowSubmit = false;

    /* After a guided post the normal save sends the person to the homepage (the first-visit tour starts there about 5 seconds later) */
    win.psgAfterPost = function () { return 'home-feed.html'; };

    /* ── the pages ────────────────────────────────────────────────────────────────────────────── */
    function labelOf(group) {
      var l = q('.pt-label', group); if (!l) return 'Next question';
      var c = l.cloneNode(true);
      qa('.pt-req, .pt-hint, .pt-label-aside', c).forEach(function (n) { n.remove(); });
      return pure.clean(c.textContent) || 'Next question';
    }
    function isSales() { return typeof win.isSales === 'function' && win.isSales(); }

    function pages() {
      var P = [];
      P.push({ id: 'name', el: q('.ps-group-name'), nolabel: true, req: true,
        title: 'What is the name of your service?', sub: 'A clear, specific name works best, for example “Professional home & deep cleaning”.',
        focus: '#svcName', ok: function () { return val('svcName').trim() ? '' : 'Enter a name for your service.'; } });

      P.push({ id: 'category', el: q('.ps-group-category'), nolabel: true, req: true,
        title: 'What type of work do you offer?', sub: 'Choose a category, then pick what you offer under it.',
        ok: function () {
          var c = val('svcCategory'); if (!c) return 'Choose a category.';
          if (c !== 'other' && !val('svcSubcategory').trim()) return 'Now choose what you offer under this category.';
          return '';
        } });

      var details = doc.getElementById('secDetails');
      if (details && !details.hidden) {
        qa('#catFields .cf-group').forEach(function (g) {
          if (g.hidden) return;
          var key = g.getAttribute('data-cf');
          P.push({ id: 'cf-' + key, el: g, nolabel: true, req: !!q('.pt-req', g), title: labelOf(g), sub: '',
            ok: function () { return cfError(key); } });
        });
      }

      if (isSales()) {
        P.push({ id: 'products', el: q('#secProducts > .pt-group'), req: true,
          title: 'What products do you sell?', sub: 'Add up to 6 products with a price and a photo. Customers order and pay in chat.',
          ok: function () {
            var r = win.readProducts();
            if (r.error) return r.error;
            return r.items.length ? '' : 'Add at least one product with a name and a price.';
          } });
        P.push({ id: 'fulfil', el: q('#secFulfil > .pt-group'), req: false,
          title: 'How do customers get their order?', sub: 'Delivery and pickup. You can leave this and agree it in chat.',
          ok: function () { return win.STProducts ? (win.STProducts.checkFulfilment(win.readFulfilmentRaw()) || '') : ''; } });
      } else {
        P.push({ id: 'method', el: q('.ps-rate-mode'), nolabel: true, req: true,
          title: 'How do you charge?', sub: 'Pick the way that fits your work. You can change it later.',
          ok: function () { return ''; } });
        var amount = q('.ps-rate-amount');
        if (!(amount && amount.hidden)) {
          P.push({ id: 'price', el: q('.ps-rate-grid'), req: true,
            title: 'What is your price?', sub: 'In naira. Customers see exactly what you enter.',
            focus: '#svcPrice',
            ok: function () {
              var rv = win.getRateValues();
              if (rv.problem) return rv.problem;
              return rv.numericValue > 0 ? '' : 'Enter your price.';
            } });
        }
      }

      P.push({ id: 'location', el: q('.ps-group-location'), nolabel: true, req: true,
        title: 'Where are you based?', sub: 'So customers near you can find you.', focus: '#svcLocation',
        ok: function () { return val('svcLocation').trim() ? '' : 'Enter your location.'; } });
      P.push({ id: 'about', el: q('.ps-group-about'), nolabel: true, req: true,
        title: 'Tell customers about your service', sub: 'What is covered, how you work, and any requirements. At least 20 characters.', focus: '#svcDescription',
        ok: function () { return val('svcDescription').trim().length >= 20 ? '' : 'Write at least 20 characters about your service.'; } });
      P.push({ id: 'availability', el: q('.ps-group-avail'), nolabel: true, req: false,
        title: 'When are you available?', sub: 'You can change this any time.', ok: function () { return ''; } });
      P.push({ id: 'specialties', el: q('.ps-group-spec'), nolabel: true, req: false,
        title: 'Any specialties?', sub: 'Separate them with commas, for example “Wiring, Solar panels”.', focus: '#svcSpecialties', ok: function () { return ''; } });
      P.push({ id: 'photo', el: q('.ps-group-photo'), nolabel: true, req: false,
        title: 'Add a photo of your work', sub: 'Photos of you at work get more bookings. JPG, PNG or WebP, up to 5 MB.', ok: function () { return ''; } });
      return P.filter(function (p) { return p.el; });
    }

    /* The category questions: ask the real checker, but only keep the message for this one question */
    function cfError(key) {
      if (!win.STCatForms) return '';
      var r = win.STCatForms.check();
      qa('#catFields .cf-group').forEach(function (g) {
        if (g.getAttribute('data-cf') === key) return;
        var e = q('.pt-error', g); if (e) e.textContent = '';
        qa('.has-error', g).forEach(function (n) { n.classList.remove('has-error'); });
      });
      var e2 = q('#cf-' + key + '-e');
      return e2 && e2.textContent ? e2.textContent : (r.ok ? '' : '');
    }

    /* ── showing one part of the form ─────────────────────────────────────────────────────────── */
    function focusPart(node, nolabel) {
      qa('.psg-hide').forEach(function (n) { n.classList.remove('psg-hide'); });
      qa('.psg-path').forEach(function (n) { n.classList.remove('psg-path', 'psg-nolabel'); });
      var n = node;
      while (n && n !== form) {
        n.classList.add('psg-path');
        var parent = n.parentNode;
        Array.prototype.forEach.call(parent.children, function (c) { if (c !== n) c.classList.add('psg-hide'); });
        n = parent;
      }
      node.classList.toggle('psg-nolabel', !!nolabel);
    }

    /* ── the guide chrome ─────────────────────────────────────────────────────────────────────── */
    var host = q('.pt-main'), ui = {};
    function build() {
      var head = el('div', 'psg-head');
      ui.back = el('button', 'btn btn-text psg-back', 'Back'); ui.back.type = 'button';
      ui.count = el('span', 'psg-count');
      var full = el('a', 'btn btn-text psg-full', 'Fill form myself'); full.href = 'post-service.html';
      head.append(ui.back, ui.count, full);
      var track = el('div', 'psg-track'); track.setAttribute('aria-hidden', 'true');
      ui.fill = el('div', 'psg-fill'); track.appendChild(ui.fill);

      var qbox = el('div', 'psg-q');
      ui.title = el('h1', 'psg-title'); ui.title.tabIndex = -1;
      ui.sub = el('p', 'psg-sub');
      ui.opt = el('span', 'psg-opt', 'Optional');
      qbox.append(ui.title, ui.sub);

      var bar = el('div', 'psg-bar');
      ui.err = el('p', 'psg-err'); ui.err.setAttribute('role', 'alert'); ui.err.hidden = true;
      var row = el('div', 'psg-actions');
      ui.next = el('button', 'btn btn-primary btn-lg psg-next', 'Continue'); ui.next.type = 'button';
      ui.skip = el('button', 'btn btn-outline btn-lg psg-skip', 'Skip'); ui.skip.type = 'button';
      row.append(ui.next, ui.skip);
      ui.draft = el('button', 'btn btn-text psg-draft', 'Save to draft'); ui.draft.type = 'button';
      bar.append(ui.err, row, ui.draft);

      host.insertBefore(qbox, host.firstChild);
      host.insertBefore(track, host.firstChild);
      host.insertBefore(head, host.firstChild);
      var wrap = q('#formCard') || form;
      wrap.appendChild(bar);
      ui.bar = bar;

      ui.next.addEventListener('click', onNext);
      ui.skip.addEventListener('click', onSkip);
      ui.back.addEventListener('click', onBack);
      ui.draft.addEventListener('click', onDraft);
    }

    function setError(msg) { ui.err.textContent = msg || ''; ui.err.hidden = !msg; }

    function show(index, id) {
      var P = pages(), page = id ? P.filter(function (p) { return p.id === id; })[0] : P[Math.min(Math.max(index, 0), P.length - 1)];
      if (!page) page = P[0];
      var idx = P.indexOf(page);
      current = page.id; currentIndex = idx;
      focusPart(page.el, page.nolabel);
      var pr = pure.progress(idx, P.length);
      ui.count.textContent = 'Question ' + pr.n + ' of ' + pr.total;
      ui.fill.style.width = pr.pct + '%';
      ui.title.textContent = page.title;
      ui.sub.textContent = page.sub || '';
      ui.sub.hidden = !page.sub;
      ui.title.classList.toggle('is-optional', !page.req);
      if (!page.req) { if (!ui.opt.parentNode) ui.title.parentNode.insertBefore(ui.opt, ui.title); } else if (ui.opt.parentNode) ui.opt.remove();
      var last = idx === P.length - 1;
      ui.next.textContent = last ? 'Post my service' : 'Continue';
      ui.skip.textContent = last ? 'Skip and post' : 'Skip';
      ui.back.hidden = idx === 0;
      setError('');
      win.scrollTo({ top: 0, behavior: 'auto' });
      var f = page.focus && q(page.focus);
      if (f && f.focus) { try { f.focus({ preventScroll: true }); } catch (e) {} } else { ui.title.focus({ preventScroll: true }); }
    }

    /* ── moving ───────────────────────────────────────────────────────────────────────────────── */
    function ids() { return pages().map(function (p) { return p.id; }); }

    function advance() {
      var P = ids();
      if (P.indexOf(current) === P.length - 1) { return finish(); }
      show(pure.nextIndex(P, current, currentIndex));
    }

    function onNext() {
      if (busy) return;
      var page = pages().filter(function (p) { return p.id === current; })[0];
      var problem = page ? page.ok() : '';
      if (problem) { setError(problem); return; }
      advance();
    }
    function onSkip() { if (!busy) advance(); }
    function onBack() { if (!busy) show(pure.prevIndex(ids(), current, currentIndex)); }

    /* Last page: every required question must be answered. Skipped ones send the person back to them. */
    function finish() {
      var P = pages();
      for (var i = 0; i < P.length; i++) {
        if (!P[i].req) continue;
        var problem = P[i].ok();
        if (problem) { show(i); setError(problem + ' This one is needed to post your service.'); return; }
      }
      busy = true; ui.next.disabled = ui.skip.disabled = ui.draft.disabled = true;
      ui.next.textContent = 'Posting…';
      allowSubmit = true; win.saveAsDraft = false;
      try { form.requestSubmit(); } catch (e) { form.dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true })); }
      allowSubmit = false;
      /* The normal save redirects on success. If it fails it shows its message at the top; let the person try again. */
      win.setTimeout(function () {
        var savedOk = /live|draft/i.test((q('.toast, .st-toast') || {}).textContent || '');
        if (!savedOk) { busy = false; ui.next.disabled = ui.skip.disabled = ui.draft.disabled = false; ui.next.textContent = 'Post my service'; }
      }, 4000);
    }

    /* Enter in a field means Continue; the normal submit only runs from "Post my service" */
    doc.addEventListener('submit', function (ev) {
      if (ev.target !== form || allowSubmit) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      onNext();
    }, true);

    /* ── Save to draft (partial) ──────────────────────────────────────────────────────────────── */
    async function onDraft() {
      if (busy) return;
      busy = true; ui.draft.disabled = true; var label = ui.draft.textContent; ui.draft.textContent = 'Saving…';
      setError('');
      try {
        var sess = await win.supabase.auth.getSession();
        var user = sess.data.session && sess.data.session.user;
        if (!user) throw new Error('Session expired. Please log in again.');

        var category = val('svcCategory');
        var other = (val('svcCategoryOther') || '').trim();
        if (category === 'other' && other) category = other.toLowerCase().replace(/\s+/g, '_');
        var rv = isSales() ? win.getRateValues() : win.getRateValues();
        var photoUrl = win.uploadedPhotoUrl || null;
        var file = doc.getElementById('photoFile') && doc.getElementById('photoFile').files[0];
        if (file) {
          try {
            var ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
            var path = 'services/' + Date.now() + '.' + ext;
            var up = await win.supabase.storage.from('service-images').upload(path, file, { cacheControl: '3600', upsert: true });
            if (!up.error) { photoUrl = win.supabase.storage.from('service-images').getPublicUrl(path).data.publicUrl; win.uploadedPhotoUrl = photoUrl; }
          } catch (e) { /* the photo is optional in a draft */ }
        }
        var payload = pure.draftPayload({
          userId: user.id, name: val('svcName'), category: category, subcategory: val('svcSubcategory').trim(),
          details: isSales() ? (win.STProducts.toDetails(win.readFulfilmentRaw())) : ((win.STCatForms && win.STCatForms.collect()) || {}),
          price: rv.numericValue, rateUnit: rv.rateUnit, priceMax: rv.isRange ? rv.maxValue : null,
          priceType: isSales() ? null : rv.priceType, unitLabel: isSales() ? null : rv.unitLabel,
          location: val('svcLocation'), description: val('svcDescription'), photo: photoUrl,
          specialties: val('svcSpecialties').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
          availability: val('svcAvailability')
        });

        function write(p) {
          return win.savedServiceId
            ? win.supabase.from('services').update(p).eq('id', win.savedServiceId).select('id').single()
            : win.supabase.from('services').insert(p).select('id').single();
        }
        var res = await write(payload);
        /* columns the Categories SQL has not added yet: save without them */
        for (var a = 0; a < 4 && res.error && (res.error.code === '42703' || res.error.code === 'PGRST204'); a++) {
          var gone = false;
          ['subcategory', 'details', 'price_type', 'price_unit_label', 'specialties', 'availability_status', 'price_max'].forEach(function (c) {
            if (new RegExp(c).test(res.error.message || '') && Object.prototype.hasOwnProperty.call(payload, c)) { delete payload[c]; gone = true; }
          });
          if (!gone) break;
          res = await write(payload);
        }
        if (res.error) throw res.error;
        win.savedServiceId = res.data && res.data.id;
        if (isSales() && win.savedServiceId && !win.readProducts().error && win.readProducts().items.length) {
          try { await win.saveProducts(win.savedServiceId, user.id); } catch (e) { /* products stay in the form; the final post saves them */ }
        }
        win.showToast('Draft saved. You can finish it any time from My Services.');
      } catch (err) {
        var msg = (win.ST && win.ST.db && win.ST.db.isListingError && win.ST.db.isListingError(err)) ? win.ST.db.listingErrorMessage(err) : (err && err.message);
        setError(msg || 'Could not save the draft. Please try again.');
      } finally {
        busy = false; ui.draft.disabled = false; ui.draft.textContent = label;
      }
    }

    /* ── start ────────────────────────────────────────────────────────────────────────────────── */
    build();
    show(0);
    /* The normal page loads the latest draft after sign-in check: when it is done, redraw this page with the saved answers */
    var ready = win.psgReady || Promise.resolve();
    Promise.resolve(ready).then(function () { show(0); }).catch(function () {});
    win.addEventListener('pageshow', function () { if (!current) show(0); });
  }

  return { pure: pure, run: run };
});

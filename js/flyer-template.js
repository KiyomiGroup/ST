/* StreetTasker promotional flyer: the template (Tasker "My Promotional Flyer").
   Stage 2: design only. It turns ONE plain data object into the flyer, with no network calls and no page-specific code, so the Tasker profile
   page, the preview page and later formats (A4, PNG, sticker, business card) all use the same drawing.

     STFlyer.render(host, data, opts)  -> { el, ready, qrOk }   draws the flyer into host (replaces what is there)
     STFlyer.setWidth(el, px)                                    scales a drawn flyer to px wide on screen (it is drawn in mm, scaled by --u)
     STFlyer.refit(el)                                           re-fits the text at the current on-screen size (small previews)
     STFlyer.print(el, 'a5' | 'a4')                              prints a clone of el on its own sheet (Save as PDF), same idea as the gift card
     STFlyer.normalise(data)                                     the cleaning rules (used by render, exposed for tests)

   data: { name, profession, location, services: [..], photoUrl, qrUrl }
   Every text goes in with textContent (never innerHTML). The only innerHTML is the fixed artwork below and the QR svg, which is generated here
   from our own link by js/vendor/qrcode.min.js, exactly like the gift card's QR. */
(function (root) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SITE = 'streettasker.com';
  var ASSETS = 'images/flyer/';
  var TEMPLATES = {};   /* name -> function (clean data) -> element. Add a sticker or card here later. */

  /* Words on the flyer. One place, so a claim can be changed without touching the layout.
     Each benefit must stay true to what StreetTasker really offers (escrow is on the profile page; reviews are on every profile). */
  var COPY = {
    tagline: 'Discover \u2022 Connect \u2022 Get it done',
    servicesTitle: 'My Services Include:',
    headline: ['Need my', 'services?'],
    leadBefore: 'Scan the QR code to view my profile and connect with me on ',
    leadBrand: 'StreetTasker',
    leadAfter: '.',
    scan: 'Scan to connect',
    benefits: [
      { icon: 'shield', lines: ['Rated &', 'Reviewed Taskers'] },
      { icon: 'bolt', lines: ['Fast & Easy', 'Booking'] },
      { icon: 'handshake', lines: ['Escrow-Protected', 'Payments'] }
    ],
    footerTagline: 'Discover skilled people. Get tasks done.',
    fallbackName: 'StreetTasker Tasker',
    fallbackProfession: 'Local Tasker'
  };

  /* Lucide-style 24px line icons (same family as the gift card sprite) */
  var ICONS = {
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    handshake: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>'
  };

  /* Paper decoration, drawn in canvas millimetres (154 x 216). Colours come from css/flyer.css classes. */
  var BACKGROUND =
    '<path class="fl-w-light" d="M96 0C110 17 138 28 154 29L154 0Z"/>' +
    '<path class="fl-w-main" d="M108 0C118 12 140 19 154 19L154 0Z"/>' +
    '<path class="fl-w-light" d="M0 186C28 180 54 191 86 195L86 216L0 216Z"/>' +
    '<path class="fl-w-main" d="M0 194C40 187 72 203 110 200C132 198 146 190 154 185L154 216L0 216Z"/>';

  function ns(tag, cls) { var e = document.createElementNS(SVG_NS, tag); if (cls) e.setAttribute('class', cls); return e; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function icon(name) {
    var s = ns('svg', 'fl-ico');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name];   /* fixed strings above, never user text */
    return s;
  }
  function str(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function clip(s, n) { return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '\u2026' : s; }

  /* The rules for missing or messy profile data. The flyer never shows an empty label or a broken block. */
  function normalise(d) {
    d = d || {};
    var seen = {}, services = [];
    (Array.isArray(d.services) ? d.services : []).forEach(function (s) {
      var t = clip(str(s), 42), k = t.toLowerCase();
      if (t && !seen[k] && services.length < 3) { seen[k] = 1; services.push(t); }
    });
    return {
      name: clip(str(d.name), 60) || COPY.fallbackName,
      profession: clip(str(d.profession), 40) || COPY.fallbackProfession,
      location: clip(str(d.location), 70),
      services: services,
      photoUrl: str(d.photoUrl),
      qrUrl: str(d.qrUrl)
    };
  }

  /* The QR code for the flyer: higher error correction (Q) than the gift card, because flyers get folded, taped and scuffed. */
  function qrMarkup(url) {
    if (!url || typeof root.qrcode !== 'function') return '';
    try {
      var qr = root.qrcode(0, 'Q'); qr.addData(url); qr.make();
      var svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      return svg.replace('<svg', '<svg shape-rendering="crispEdges"');
    } catch (e) { return ''; }
  }

  /* Shrinks one text element (the size lives in its --fs, in mm) until it fits its box.
     Text does not wrap in exactly the same places at every zoom, so a shrunk element gets 4% extra room. */
  function fit(node, min) {
    var max = parseFloat(node.getAttribute('data-fs')) || 4, fs = max, guard = 80;
    var xOnly = node.getAttribute('data-axis') === 'x';   /* one-line text: only width counts (line-height below 1 makes scrollHeight lie) */
    function over() { return node.scrollWidth > node.clientWidth + 1 || (!xOnly && node.scrollHeight > node.clientHeight + 1); }
    node.style.setProperty('--fs', fs);
    while (guard-- > 0 && fs > min && over()) { fs = Math.round((fs - 0.2) * 10) / 10; node.style.setProperty('--fs', fs); }
    if (fs < max) { fs = Math.max(min, Math.round(fs * 0.96 * 10) / 10); node.style.setProperty('--fs', fs); }
  }
  /* Measured at a fixed, print-like size (4px per mm), then put back to whatever the screen preview uses. */
  function fitAll(flyer) {
    var prev = flyer.style.getPropertyValue('--u');
    flyer.style.setProperty('--u', '4px');
    var nodes = flyer.querySelectorAll('[data-fs]');
    for (var i = 0; i < nodes.length; i++) fit(nodes[i], parseFloat(nodes[i].getAttribute('data-min')) || 2.6);
    if (prev) flyer.style.setProperty('--u', prev); else flyer.style.removeProperty('--u');
  }

  /* Fits again at the flyer's CURRENT size. Small previews (a phone) wrap text in different places than the 4 px per mm measurement above,
     so a screen preview calls this after setWidth. Call it only on a flyer that is on screen. */
  function refit(flyer) {
    var nodes = flyer.querySelectorAll('[data-fs]');
    for (var i = 0; i < nodes.length; i++) fit(nodes[i], parseFloat(nodes[i].getAttribute('data-min')) || 2.6);
  }

  /* ── Template: the A5 portrait flyer ── */
  TEMPLATES.flyer = function (c, state) {
    var f = el('div', 'fl');
    f.setAttribute('data-template', 'flyer');

    var bg = ns('svg', 'fl-bg');
    bg.setAttribute('viewBox', '0 0 154 216'); bg.setAttribute('preserveAspectRatio', 'none'); bg.setAttribute('aria-hidden', 'true');
    bg.innerHTML = BACKGROUND;
    f.appendChild(bg);

    var t = el('div', 'fl-trim');
    f.appendChild(t);

    /* A. Header */
    var logo = el('img', 'fl-logo'); logo.src = ASSETS + 'logo-wordmark.png'; logo.alt = 'StreetTasker';
    t.appendChild(logo);
    t.appendChild(el('p', 'fl-tag', COPY.tagline));

    /* B. Photo */
    var frame = el('div', 'fl-photo-frame'), ph = el('div', 'fl-photo'), img = el('img');
    img.alt = ''; img.decoding = 'sync';
    state.ready.push(new Promise(function (resolve) {
      var triedFallback = false;
      function useFallback() { if (triedFallback) { resolve(); return; } triedFallback = true; img.removeAttribute('crossorigin'); img.src = ASSETS + 'photo-fallback.svg'; }
      img.onload = function () { resolve(); };
      img.onerror = useFallback;
      if (c.photoUrl) { img.crossOrigin = 'anonymous'; img.src = c.photoUrl; } else { useFallback(); }
    }));
    ph.appendChild(img); frame.appendChild(ph); t.appendChild(frame);


    /* B. Details */
    var info = el('div', 'fl-info');
    var name = el('p', 'fl-name', c.name); name.setAttribute('data-fs', '7'); name.setAttribute('data-min', '3.6');
    info.appendChild(name);

    var job = el('div', 'fl-job'); job.appendChild(icon('wrench'));
    var jt = el('span', 'fl-job-text', c.profession); jt.setAttribute('data-fs', '4.6'); jt.setAttribute('data-axis', 'x'); jt.setAttribute('data-min', '3.4');
    job.appendChild(jt); info.appendChild(job);

    if (c.location) {
      var where = el('div', 'fl-where'); where.appendChild(icon('pin'));
      var wt = el('span', 'fl-where-text', c.location); wt.setAttribute('data-fs', '4.2'); wt.setAttribute('data-min', '2.8');
      where.appendChild(wt); info.appendChild(where);
    }
    if (c.services.length) {
      var block = el('div', 'fl-svc-block');
      block.appendChild(el('p', 'fl-svc-title', COPY.servicesTitle));
      var ul = el('ul', 'fl-svc-list');
      c.services.forEach(function (s) {
        var li = el('li', 'fl-svc'); li.appendChild(icon('check'));
        var st = el('span', 'fl-svc-text', s); st.setAttribute('data-fs', '4.2'); st.setAttribute('data-axis', 'x'); st.setAttribute('data-min', '3.4');
        li.appendChild(st); ul.appendChild(li);
      });
      block.appendChild(ul); info.appendChild(block);
    }
    t.appendChild(info);

    /* C. Message */
    var h = el('h2', 'fl-headline');
    COPY.headline.forEach(function (line) { var s = el('span', null, line); s.setAttribute('data-fs', '14.6'); s.setAttribute('data-min', '9'); s.setAttribute('data-axis', 'x'); h.appendChild(s); });
    t.appendChild(h);
    var lead = el('p', 'fl-lead');
    lead.appendChild(document.createTextNode(COPY.leadBefore));
    lead.appendChild(el('span', 'fl-hl', COPY.leadBrand));
    lead.appendChild(document.createTextNode(COPY.leadAfter));
    t.appendChild(lead);

    /* D. QR */
    var qr = el('div', 'fl-qr'), card = el('div', 'fl-qr-card'), code = el('div', 'fl-qr-code');
    var markup = qrMarkup(c.qrUrl);
    state.qrOk = !!markup;
    if (markup) code.innerHTML = markup;   /* generated here from our own link */
    card.appendChild(code); qr.appendChild(card);
    var label = el('div', 'fl-qr-label'); label.appendChild(el('span', null, COPY.scan));
    qr.appendChild(label); t.appendChild(qr);

    /* E. Benefits */
    var ben = el('ul', 'fl-benefits');
    COPY.benefits.forEach(function (b) {
      var li = el('li', 'fl-benefit'); li.appendChild(icon(b.icon));
      var tx = el('span'); tx.appendChild(document.createTextNode(b.lines[0])); tx.appendChild(document.createElement('br')); tx.appendChild(document.createTextNode(b.lines[1]));
      li.appendChild(tx); ben.appendChild(li);
    });
    t.appendChild(ben);

    /* F. Footer */
    var url = el('div', 'fl-url'); url.appendChild(icon('globe')); url.appendChild(el('span', null, SITE));
    t.appendChild(url);
    t.appendChild(el('p', 'fl-foot', COPY.footerTagline));

    return f;
  };

  function render(host, data, opts) {
    opts = opts || {};
    var build = TEMPLATES[opts.template || 'flyer'];
    var state = { ready: [], qrOk: false };
    var flyer = build(normalise(data), state);
    host.textContent = '';
    host.appendChild(flyer);
    /* Ask for the exact brand fonts the flyer uses (a browser only loads a font once something asks for it), then wait for all fonts. */
    var fontsReady = Promise.resolve();
    if (document.fonts && document.fonts.load) {
      fontsReady = Promise.all(['800 16px Manrope', '500 16px Inter', '600 16px Inter', '700 16px Inter', '800 16px Inter'].map(function (f) {
        return document.fonts.load(f).catch(function () {});
      })).then(function () { return document.fonts.ready; });
    }
    var ready = Promise.all(state.ready.concat([fontsReady])).then(function () { fitAll(flyer); return flyer; });
    return { el: flyer, ready: ready, qrOk: state.qrOk };
  }

  /* Screen preview: the flyer is drawn in mm, so one number scales it. */
  function setWidth(flyer, px) { flyer.style.setProperty('--u', (px / 154) + 'px'); }

  /* Print / Save as PDF. Prints a CLONE (already fitted) on a sheet of exactly the paper size, so the page on screen is untouched.
     A5: trim size 148 x 210 mm, the artwork's bleed is cropped away. A4: the whole flyer scaled to fill the sheet. */
  var PAPERS = {
    a5: { w: 148, h: 210, k: 1 },
    a4: { w: 210, h: 297, k: 297 / 210 }
  };
  function print(flyer, paper) {
    var p = PAPERS[paper] || PAPERS.a5, bleed = 3 * p.k;
    var sheet = el('div', 'fl-sheet'), copy = flyer.cloneNode(true);
    copy.style.setProperty('--u', p.k + 'mm');
    sheet.style.setProperty('--fl-sheet-w', p.w + 'mm'); sheet.style.setProperty('--fl-sheet-h', p.h + 'mm');
    sheet.style.setProperty('--fl-sheet-x', ((p.w - 148 * p.k) / 2 - bleed) + 'mm'); sheet.style.setProperty('--fl-sheet-y', (-bleed) + 'mm');
    sheet.appendChild(copy);
    var page = el('style'); page.textContent = '@page { size: ' + p.w + 'mm ' + p.h + 'mm; margin: 0; }';
    document.head.appendChild(page); document.body.appendChild(sheet); document.body.classList.add('fl-printing');
    var done = false;
    function cleanup() {
      if (done) return; done = true;
      document.body.classList.remove('fl-printing');
      if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
      if (page.parentNode) page.parentNode.removeChild(page);
      root.removeEventListener('afterprint', cleanup);
    }
    root.addEventListener('afterprint', cleanup);
    setTimeout(function () { try { root.print(); } catch (e) { cleanup(); } }, 50);
  }

  /* PNG: draws a fresh flyer off screen at 10 px per mm, crops the 3 mm bleed away (so the picture is the A5 trim size, 1480 x 2100 px,
     about 254 dpi) and resolves { blob, photoDropped }. Needs js/vendor/html-to-image.min.js (window.htmlToImage).
     The photo is fetched first and passed in as a data link: if the photo's server does not allow that (CORS), the PNG is made with the
     no-photo avatar and photoDropped is true, so the page can tell the person instead of silently leaving the photo out. */
  var PNG_PX_PER_MM = 10;
  function readAsDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader(); r.onload = function () { resolve(String(r.result)); }; r.onerror = function () { reject(r.error); }; r.readAsDataURL(blob);
    });
  }
  function inlineImage(img) {
    var src = img.currentSrc || img.src;
    var swap = /^data:/.test(src) ? Promise.resolve() : fetch(src).then(function (r) {
      if (!r.ok) throw new Error('img ' + r.status);
      return r.blob();
    }).then(readAsDataUrl).then(function (url) {
      return new Promise(function (resolve) { img.onload = resolve; img.onerror = resolve; img.src = url; });
    });
    return swap.catch(function () {}).then(function () { return img.decode ? img.decode().catch(function () {}) : null; });
  }
  function png(data) {
    var lib = root.htmlToImage;
    if (!lib || typeof lib.toCanvas !== 'function') return Promise.reject(new Error('png-unavailable'));
    var u = PNG_PX_PER_MM, d = Object.assign({}, data), photoDropped = false;
    var photo = d.photoUrl ? fetch(d.photoUrl, { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('photo ' + r.status);
      return r.blob();
    }).then(readAsDataUrl).then(function (url) { d.photoUrl = url; }).catch(function () { d.photoUrl = ''; photoDropped = true; }) : Promise.resolve();
    return photo.then(function () {
      var host = el('div', 'fl-offscreen'), cleanup = function () { if (host.parentNode) host.parentNode.removeChild(host); };
      document.body.appendChild(host);
      var r = render(host, d);
      setWidth(r.el, 154 * u);   /* before r.ready, so the text is fitted at this size */
      return r.ready.then(function () {
        /* html-to-image does not carry a CSS fill (fill: var(--fl-green)) onto SVG paths: the waves came out black. Write the colour on each path. */
        Array.prototype.forEach.call(r.el.querySelectorAll('.fl-bg path'), function (p) { p.setAttribute('fill', getComputedStyle(p).fill); });
        /* Phones (iOS Safari above all) often leave out images that were not already inline when the picture is taken, which is how the
           logo went missing. So: turn every picture into a data link first, wait until each is decoded, and take the picture twice
           (the first pass warms the browser up and is thrown away). */
        var imgs = Array.prototype.slice.call(r.el.querySelectorAll('img'));
        return Promise.all(imgs.map(inlineImage)).then(function () {
          var opts = { pixelRatio: 1, width: 154 * u, height: 216 * u };
          return lib.toCanvas(r.el, opts).then(function () { return lib.toCanvas(r.el, opts); });
        });
      }).then(function (full) {
        var out = document.createElement('canvas'); out.width = 148 * u; out.height = 210 * u;
        out.getContext('2d').drawImage(full, -3 * u, -3 * u);
        return new Promise(function (resolve, reject) {
          out.toBlob(function (blob) { blob ? resolve({ blob: blob, photoDropped: photoDropped }) : reject(new Error('png-empty')); }, 'image/png');
        });
      }).then(function (res) { cleanup(); return res; }, function (e) { cleanup(); throw e; });
    });
  }

  root.STFlyer = { render: render, setWidth: setWidth, refit: refit, print: print, png: png, normalise: normalise, templates: TEMPLATES, copy: COPY };
})(window);

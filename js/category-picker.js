/* ============================================================
   STREETTASKER — category-picker.js
   A searchable category picker (a sheet on phones, a dialog on desktop) for Post a Service.
   Needs js/categories.js (STCat). Styles: css/category-picker.css.

   It keeps TWO plain form fields as the source of truth, so the page's existing save and draft code keeps working:
     <select id="svcCategory">     the category value (cleaning, handyman, ...)
     <input type="hidden" id="svcSubcategory">   the subcategory name (Plumbing, ...)
   Choosing in the sheet writes both and fires a normal "change" event on the select.

   STCatPicker.init({ select, sub, mount, other, title, sellers })
   STCatPicker.sync()          re-read the two fields (after a draft is loaded) and redraw the button
   STCatPicker.setSub(name)    set the subcategory field (then call sync)
   STCatPicker.open()
   ============================================================ */
(function (root) {
  'use strict';
  var S = root.STCat;
  if (!S) return;

  var O = null, selEl = null, subEl = null, otherEl = null, trigger = null;
  var overlay = null, sheet = null, searchEl = null, bodyEl = null, backBtn = null, titleEl = null, clearBtn = null, statusEl = null;
  var view = 'browse', viewCat = null, results = [], active = -1, lastFocus = null;

  var SVG = {
    chevron: '<svg class="cp-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>',
    back:    '<svg class="cp-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>',
    close:   '<svg class="cp-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    search:  '<svg class="cp-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    check:   '<svg class="cp-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>'
  };

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cats() { return O.sellers === false ? S.list : S.serviceList; }

  /* ── the button the tasker sees on the form ─────────────────────────────────────────────────── */
  function renderTrigger() {
    if (!trigger) return;
    var v = selEl.value, sub = subEl ? subEl.value : '';
    var txt;
    if (!v) {
      txt = '<span class="cp-trigger-placeholder">Choose a category</span>';
      trigger.classList.remove('has-value', 'needs-sub');
    } else {
      var c = S.get(v);
      var tail = '';
      if (sub) tail = '<span class="cp-trigger-sub">' + esc(sub) + '</span>';
      else if (c.value !== 'other') tail = '<span class="cp-trigger-sub cp-trigger-need">Now choose what you offer</span>';
      txt = '<span class="cp-trigger-icon">' + S.iconHtml(c.value) + '</span><span class="cp-trigger-text"><span class="cp-trigger-cat">' + esc(c.label) + '</span>' + tail + '</span>';
      trigger.classList.add('has-value');
      trigger.classList.toggle('needs-sub', !sub && c.value !== 'other');
    }
    trigger.innerHTML = txt + SVG.chevron;
  }

  /* ── the sheet ─────────────────────────────────────────────────────────────────────────────── */
  function build() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'cp-overlay'; overlay.hidden = true;
    overlay.innerHTML =
      '<div class="cp-sheet" id="cpSheet" role="dialog" aria-modal="true" aria-labelledby="cpTitle" tabindex="-1">' +
        '<div class="cp-head">' +
          '<button type="button" class="cp-iconbtn" id="cpBack" aria-label="Back to all categories" hidden>' + SVG.back + '</button>' +
          '<h2 class="cp-title" id="cpTitle"></h2>' +
          '<button type="button" class="cp-iconbtn" id="cpClose" aria-label="Close">' + SVG.close + '</button>' +
        '</div>' +
        '<div class="cp-search">' + SVG.search +
          '<input type="search" id="cpSearch" class="cp-search-input" role="combobox" aria-expanded="false" aria-controls="cpList" aria-autocomplete="list" ' +
            'placeholder="Search, e.g. plumber, braids, tailor" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="60" aria-label="Search categories and services" />' +
          '<button type="button" class="cp-iconbtn cp-clear" id="cpClear" aria-label="Clear search" hidden>' + SVG.close + '</button>' +
        '</div>' +
        '<p class="cp-status" id="cpStatus" role="status" aria-live="polite"></p>' +
        '<div class="cp-body" id="cpBody"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    sheet = el('cpSheet'); searchEl = el('cpSearch'); bodyEl = el('cpBody'); backBtn = el('cpBack'); titleEl = el('cpTitle'); clearBtn = el('cpClear'); statusEl = el('cpStatus');

    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    el('cpClose').addEventListener('click', close);
    backBtn.addEventListener('click', function () { searchEl.value = ''; showBrowse(); searchEl.focus(); });
    clearBtn.addEventListener('click', function () { searchEl.value = ''; onQuery(); searchEl.focus(); });
    searchEl.addEventListener('input', onQuery);
    searchEl.addEventListener('keydown', onSearchKey);
    bodyEl.addEventListener('click', onBodyClick);
    overlay.addEventListener('keydown', onSheetKey);
  }

  function setTitle(t) { titleEl.textContent = t; }
  function say(t) { if (statusEl) statusEl.textContent = t || ''; }

  /* browse: popular + every category */
  function showBrowse() {
    view = 'browse'; viewCat = null; active = -1; results = [];
    backBtn.hidden = true; setTitle(O.title);
    searchEl.setAttribute('aria-expanded', 'false');
    var all = cats();
    var pop = S.popular.map(function (v) { return S.get(v); }).filter(function (c) { return all.indexOf(c) !== -1; });
    var h = '<p class="cp-section">Popular</p><div class="cp-chips">' + pop.map(function (c) {
      return '<button type="button" class="cp-chip" data-cat="' + esc(c.value) + '">' + S.iconHtml(c.value) + '<span>' + esc(c.short) + '</span></button>';
    }).join('') + '</div>';
    h += '<p class="cp-section">All categories</p><ul class="cp-grid">' + all.map(function (c) {
      var n = c.value === 'other' ? 'Describe your own' : (c.subs.length + ' types of work');
      return '<li><button type="button" class="cp-cat' + (selEl.value === c.value ? ' is-active' : '') + '" data-cat="' + esc(c.value) + '">' +
        S.iconHtml(c.value) + '<span class="cp-cat-text"><span class="cp-cat-name">' + esc(c.label) + '</span><span class="cp-cat-meta">' + n + '</span></span></button></li>';
    }).join('') + '</ul>';
    bodyEl.innerHTML = h; bodyEl.scrollTop = 0; say('');
  }

  /* one category: pick what you offer */
  function showSubs(value) {
    var c = S.get(value);
    view = 'subs'; viewCat = c; active = -1;
    backBtn.hidden = false; setTitle(c.label);
    searchEl.setAttribute('aria-expanded', 'false');
    var current = selEl.value === c.value ? (subEl ? subEl.value : '') : '';
    var h = '<p class="cp-section">What do you offer?</p><ul class="cp-list">' + S.subsOf(c.value).map(function (name) {
      var other = name === S.OTHER_SUB;
      return '<li><button type="button" class="cp-row' + (other ? ' cp-row--other' : '') + (current === name ? ' is-active' : '') + '" data-cat="' + esc(c.value) + '" data-sub="' + esc(name) + '">' +
        '<span class="cp-row-main">' + esc(name) + (other ? '<span class="cp-row-note">Mine is not on the list</span>' : '') + '</span>' + (current === name ? SVG.check : '') + '</button></li>';
    }).join('') + '</ul>';
    bodyEl.innerHTML = h; bodyEl.scrollTop = 0; say(c.label + ': choose what you offer.');
  }

  /* typed search */
  function showResults(q) {
    view = 'results'; viewCat = null; active = -1;
    results = S.search(q, { sellers: O.sellers !== false });
    backBtn.hidden = true; setTitle(O.title);
    searchEl.setAttribute('aria-expanded', results.length ? 'true' : 'false');
    var h = '';
    if (results.length) {
      h += '<ul class="cp-list" id="cpList" role="listbox" aria-label="Matches">' + results.map(function (r, i) {
        return '<li role="presentation"><button type="button" class="cp-row cp-opt" role="option" id="cpOpt' + i + '" aria-selected="false" data-i="' + i + '" tabindex="-1">' +
          S.iconHtml(r.value) + '<span class="cp-row-main">' + esc(r.sub || r.label) + '<span class="cp-row-note">' + (r.sub ? 'in ' + esc(r.label) : 'Category') + '</span></span></button></li>';
      }).join('') + '</ul>';
    } else {
      h += '<p class="cp-empty">Nothing matches &ldquo;' + esc(q) + '&rdquo;.</p>';
    }
    h += '<button type="button" class="cp-row cp-row--cant" data-cant="1"><span class="cp-row-main">Can&rsquo;t find it?<span class="cp-row-note">Use &ldquo;Other&rdquo; and describe your service in your own words</span></span></button>';
    bodyEl.innerHTML = h; bodyEl.scrollTop = 0;
    var touch = root.matchMedia && root.matchMedia('(pointer: coarse)').matches;
    say(results.length ? results.length + (results.length === 1 ? ' match' : ' matches') + (touch ? '.' : '. Use the arrow keys, then Enter.') : 'No matches.');
  }

  function onQuery() {
    var q = searchEl.value.trim();
    clearBtn.hidden = !searchEl.value;
    if (!q) { showBrowse(); return; }
    showResults(q);
  }

  function setActive(i) {
    var opts = bodyEl.querySelectorAll('.cp-opt');
    if (!opts.length) return;
    active = (i + opts.length) % opts.length;
    for (var k = 0; k < opts.length; k++) { var on = k === active; opts[k].classList.toggle('is-kbd', on); opts[k].setAttribute('aria-selected', on ? 'true' : 'false'); }
    searchEl.setAttribute('aria-activedescendant', 'cpOpt' + active);
    opts[active].scrollIntoView({ block: 'nearest' });
  }

  function onSearchKey(e) {
    if (view !== 'results') { if (e.key === 'Enter') e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active < 0 ? -1 : active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results.length) pickResult(active >= 0 ? active : 0); }
  }

  function onSheetKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (searchEl.value) { searchEl.value = ''; onQuery(); } else close();
      return;
    }
    if (e.key !== 'Tab') return;
    var f = sheet.querySelectorAll('button:not([hidden]):not([tabindex="-1"]), input');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function onBodyClick(e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    if (b.getAttribute('data-cant')) { commit('other', '', searchEl.value.trim()); return; }
    if (b.hasAttribute('data-i')) { pickResult(parseInt(b.getAttribute('data-i'), 10)); return; }
    var cat = b.getAttribute('data-cat'), sub = b.getAttribute('data-sub');
    if (!cat) return;
    if (sub) { commit(cat, sub); return; }
    if (cat === 'other') { commit('other', '', ''); return; }
    searchEl.value = ''; clearBtn.hidden = true;
    showSubs(cat);
  }

  function pickResult(i) {
    var r = results[i]; if (!r) return;
    if (r.sub) { commit(r.value, r.sub); return; }
    searchEl.value = ''; clearBtn.hidden = true;
    showSubs(r.value);
  }

  /* write the two fields, tell the page, close */
  function commit(value, sub, otherText) {
    selEl.value = value;
    if (subEl) subEl.value = value === 'other' ? '' : (sub || '');
    if (value === 'other' && otherEl && otherText) otherEl.value = otherText.slice(0, parseInt(otherEl.getAttribute('maxlength') || '60', 10));
    selEl.dispatchEvent(new Event('change', { bubbles: true }));
    renderTrigger();
    close(true);
    if (value === 'other' && otherEl) { try { otherEl.focus(); } catch (x) { /* ignore */ } }
    if (typeof O.onChange === 'function') O.onChange(value, subEl ? subEl.value : '');
  }

  function open() {
    build();
    lastFocus = document.activeElement;
    searchEl.value = ''; clearBtn.hidden = true;
    if (selEl.value && selEl.value !== 'other' && S.get(selEl.value).value !== 'other') {
      showSubs(selEl.value);              /* editing: open on their category so the type is one tap away */
    } else { showBrowse(); }
    overlay.hidden = false;
    document.documentElement.classList.add('cp-lock');
    trigger.setAttribute('aria-expanded', 'true');
    var touch = root.matchMedia && root.matchMedia('(pointer: coarse)').matches;
    if (touch) sheet.focus(); else searchEl.focus();   /* no keyboard popping up over the list on phones */
  }

  function close(keepFocus) {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.documentElement.classList.remove('cp-lock');
    trigger.setAttribute('aria-expanded', 'false');
    if (keepFocus !== true && lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (x) { /* ignore */ } }
    else if (keepFocus === true && trigger) { try { trigger.focus(); } catch (y) { /* ignore */ } }
  }

  function init(opts) {
    O = opts || {};
    O.title = O.title || 'What type of work do you want to offer?';
    selEl = el(O.select || 'svcCategory'); subEl = el(O.sub || 'svcSubcategory'); otherEl = el(O.other || 'svcCategoryOther');
    var mount = el(O.mount || 'catPicker');
    if (!selEl || !mount) return;
    /* the hidden <select> always carries every category, in the shared order */
    selEl.innerHTML = '<option value="">Select a category...</option>' + cats().map(function (c) { return '<option value="' + esc(c.value) + '">' + esc(c.label) + '</option>'; }).join('');
    mount.innerHTML = '<button type="button" class="cp-trigger" id="cpTrigger" aria-haspopup="dialog" aria-expanded="false" aria-controls="cpSheet"></button>';
    trigger = el('cpTrigger');
    trigger.addEventListener('click', open);
    selEl.addEventListener('change', renderTrigger);
    renderTrigger();
  }

  root.STCatPicker = {
    init: init, open: open, close: close, sync: renderTrigger,
    setSub: function (name) { if (subEl) subEl.value = name || ''; renderTrigger(); }
  };
})(window);

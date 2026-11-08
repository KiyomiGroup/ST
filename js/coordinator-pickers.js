/* ============================================================
   StreetTasker — coordinator-pickers.js
   Two pickers for the Local Tasker profile form (Add page and Edit page):

   1. AREAS SERVED. The coordinator types a few letters and picks from suggestions; the choice becomes a chip.
      The saved text is the SAME place names customers pick on the search pages ("Yaba, Lagos"), so a customer's
      location matches the Local Tasker, and a typo can never be saved: only a listed place can be added.
      A near-miss ("ikja") still finds the right place ("Ikeja, Lagos").
      Saved as: "Yaba, Lagos; Surulere, Lagos" (names joined with a semicolon), 300 characters at most, 12 areas at most.
      Older free text ("Sabo, Yaba, Ebute Metta") is read as well: each part is matched to a listed place; a part
      that matches nothing is kept as a chip marked "check" so nothing is lost silently.

   2. AVAILABILITY. Tappable options (days, times of day, same-day jobs) plus one short optional note, instead of
      a blank text box. Saved as readable text: "Days: Weekdays · Times: Morning, Evening · Same-day jobs OK · Note: ...".
      Older free text is kept as the note.

   Each picker keeps a hidden input (#coFAreas, #coFNotes) in step, so the pages' own read / validate / save code
   works unchanged. window.STCoPick.fillAreas(text) / fillAvailability(text) load saved values (Edit page).
   All text goes in with textContent. Tokens/classes only (css/coordinator-intake.css).
   ============================================================ */
'use strict';

(function (root) {
  var AREA_SEP = '; ', AREA_MAX_LEN = 300, AREA_MAX = 12;
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], WEEKEND = ['Sat', 'Sun'];
  var TIMES = [['Morning', 'Morning (6am to 12pm)'], ['Afternoon', 'Afternoon (12pm to 5pm)'], ['Evening', 'Evening (5pm to 9pm)']];
  var NOTE_MAX = 400;
  var POPULAR = ['Lekki Phase 1, Lagos', 'Ikeja, Lagos', 'Yaba, Lagos', 'Surulere, Lagos', 'Victoria Island, Lagos', 'Ajah, Lagos', 'Ikorodu, Lagos', 'Gbagada, Lagos'];
  /* Names the customer-side location search has that js/ng-places.js does not */
  var EXTRA_PLACES = ['Lekki, Lagos', 'GRA, Port Harcourt', 'Trans Amadi, Port Harcourt', 'Bodija, Ibadan', 'Ring Road, Ibadan', 'GRA, Enugu', 'Independence Layout, Enugu'];

  /* ── Places ─────────────────────────────────────────────── */
  var PLACES = null, BY_KEY = null;

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function build(list) {
    var seen = {}, out = [];
    list.forEach(function (label) {
      var key = norm(label);
      if (!key || seen[key]) return;
      seen[key] = true;
      var name = norm(String(label).split(',')[0]);
      out.push({ label: String(label), key: key, name: name, words: key.split(' '), lagos: /(^|,\s*)lagos( state)?$/i.test(label) });
    });
    return out;
  }
  function places() {
    if (PLACES) return PLACES;
    var base = (root.NG_PLACES || []).concat(EXTRA_PLACES);
    PLACES = build(base);
    BY_KEY = {};
    PLACES.forEach(function (p) { BY_KEY[p.key] = p; });
    return PLACES;
  }

  /* Edit distance, cut short once it is above the limit */
  function lev(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i; var rowMin = cur[0];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > limit) return limit + 1;
      var t = prev; prev = cur; cur = t;
    }
    return prev[b.length];
  }

  /* 0 exact name, 1 name starts with, 2 a word starts with, 3 contains, 4 and up a near miss (a whole name or word that is
     one or two letters off ranks above one that only matches the start of the name), -1 no match */
  function score(p, q) {
    if (p.name === q) return 0;
    if (p.name.indexOf(q) === 0) return 1;
    for (var i = 0; i < p.words.length; i++) if (p.words[i].indexOf(q) === 0) return 2;
    if (p.key.indexOf(q) >= 0) return 3;
    if (q.length < 3) return -1;
    var limit = q.length <= 4 ? 1 : 2, whole = limit + 1, start = limit + 1, d, n;
    d = lev(q, p.name, limit); if (d < whole) whole = d;
    for (i = 0; i < p.words.length; i++) { d = lev(q, p.words[i], limit); if (d < whole) whole = d; }
    for (n = q.length - 1; n <= q.length + 1; n++) {
      if (n < 2) continue;
      d = lev(q, p.name.slice(0, n), limit); if (d < start) start = d;
    }
    if (whole <= limit) return 4 + whole * 2;
    if (start <= limit) return 5 + start * 2;
    return -1;
  }

  /* chosen = labels already added (left out of the results). Returns [{ label, s }] best first. */
  function suggestRows(query, chosen, max) {
    var q = norm(query), taken = {};
    (chosen || []).forEach(function (c) { taken[norm(c)] = true; });
    if (!q) return [];
    var rows = [];
    places().forEach(function (p) {
      if (taken[p.key]) return;
      var s = score(p, q);
      if (s >= 0) rows.push({ p: p, s: s });
    });
    rows.sort(function (a, b) {
      return (a.s - b.s) || ((b.p.lagos ? 1 : 0) - (a.p.lagos ? 1 : 0)) || (a.p.label.length - b.p.label.length) || (a.p.label < b.p.label ? -1 : 1);
    });
    return rows.slice(0, max || 8).map(function (r) { return { label: r.p.label, s: r.s }; });
  }
  function suggest(query, chosen, max) { return suggestRows(query, chosen, max).map(function (r) { return r.label; }); }

  /* ── Areas: saved text <-> list ─────────────────────────── */
  function areasToText(list) { return list.map(function (a) { return a.label; }).join(AREA_SEP); }

  /* Saved text -> [{ label, matched }]. New format (semicolons) is exact; older free text is matched part by part. */
  function parseAreas(text) {
    var raw = String(text || '').trim();
    if (!raw) return [];
    places();
    var out = [], seen = {};
    function add(label, matched) { var k = norm(label); if (!k || seen[k]) return; seen[k] = true; out.push({ label: label, matched: matched }); }
    function lookup(token) {
      var k = norm(token);
      if (BY_KEY[k]) return BY_KEY[k].label;
      var hit = null;
      PLACES.forEach(function (p) { if (p.name === k && (!hit || (p.lagos && !hit.lagos))) hit = p; });
      return hit ? hit.label : null;
    }
    if (raw.indexOf(';') >= 0) {
      raw.split(';').forEach(function (part) {
        part = part.trim(); if (!part) return;
        var hit = BY_KEY[norm(part)];
        add(hit ? hit.label : part, !!hit);
      });
      return out;
    }
    var tokens = raw.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    for (var i = 0; i < tokens.length; i++) {
      if (i + 1 < tokens.length) {
        var pair = BY_KEY[norm(tokens[i] + ', ' + tokens[i + 1])];
        if (pair) { add(pair.label, true); i++; continue; }
      }
      var found = lookup(tokens[i]);
      add(found || tokens[i], !!found);
    }
    return out;
  }

  /* ── Availability: saved text <-> state ─────────────────── */
  function sameSet(a, b) { return a.length === b.length && a.every(function (x) { return b.indexOf(x) >= 0; }); }

  function availToText(st) {
    var parts = [];
    var days = DAYS.filter(function (d) { return st.days.indexOf(d) >= 0; });
    if (days.length) {
      var label = days.length === 7 ? 'Every day' : sameSet(days, WEEKDAYS) ? 'Weekdays' : sameSet(days, WEEKEND) ? 'Weekends' : days.join(', ');
      parts.push('Days: ' + label);
    }
    if (st.anyTime) parts.push('Times: Any time');
    else {
      var times = TIMES.map(function (t) { return t[0]; }).filter(function (t) { return st.times.indexOf(t) >= 0; });
      if (times.length) parts.push('Times: ' + times.join(', '));
    }
    if (st.sameDay) parts.push('Same-day jobs OK');
    var note = String(st.note || '').trim().slice(0, NOTE_MAX);
    if (note) parts.push('Note: ' + note);
    return parts.join(' \u00b7 ');
  }

  function textToAvail(text) {
    var st = { days: [], times: [], anyTime: false, sameDay: false, note: '' };
    var raw = String(text || '').trim();
    if (!raw) return st;
    var ours = /^(Days: |Times: |Same-day jobs OK|Note: )/.test(raw);
    if (!ours) { st.note = raw.slice(0, NOTE_MAX); return st; }
    var idx = raw.indexOf('Note: ');
    var head = raw, note = '';
    if (idx === 0 || (idx > 0 && raw.slice(idx - 3, idx) === ' \u00b7 ')) {
      head = idx === 0 ? '' : raw.slice(0, idx - 3);
      note = raw.slice(idx + 6);
    }
    st.note = note;
    head.split(' \u00b7 ').forEach(function (part) {
      if (part.indexOf('Days: ') === 0) {
        var v = part.slice(6).trim();
        if (v === 'Every day') st.days = DAYS.slice();
        else if (v === 'Weekdays') st.days = WEEKDAYS.slice();
        else if (v === 'Weekends') st.days = WEEKEND.slice();
        else st.days = v.split(',').map(function (d) { return d.trim(); }).filter(function (d) { return DAYS.indexOf(d) >= 0; });
      } else if (part.indexOf('Times: ') === 0) {
        var t = part.slice(7).trim();
        if (t === 'Any time') st.anyTime = true;
        else st.times = t.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return TIMES.some(function (tt) { return tt[0] === x; }); });
      } else if (part === 'Same-day jobs OK') st.sameDay = true;
    });
    return st;
  }

  /* ── DOM helpers ────────────────────────────────────────── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fire(input) { input.dispatchEvent(new Event('input', { bubbles: true })); }

  var areasApi = null, availApi = null;

  /* ── Areas picker ───────────────────────────────────────── */
  function mountAreas(hidden, mount) {
    var chosen = [];            /* [{ label, matched }] */
    var results = [], active = -1, open = false;

    var wrap = el('div', 'co-pick');
    var chips = el('div', 'co-pick-chips'); chips.id = 'coAreasChips';
    var field = el('div', 'co-pick-field');
    var input = el('input', 'form-input');
    input.type = 'text'; input.id = 'coFAreasSearch'; input.autocomplete = 'off'; input.maxLength = 40;
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', 'coAreasList'); input.setAttribute('aria-describedby', 'coAreasNote');
    input.placeholder = 'Start typing an area, for example Yaba';
    var list = el('ul', 'co-pick-list'); list.id = 'coAreasList'; list.setAttribute('role', 'listbox'); list.hidden = true;
    var note = el('p', 'form-helper', ''); note.id = 'coAreasNote'; note.setAttribute('role', 'status');
    var quick = el('div', 'co-pick-quick');
    field.appendChild(input); field.appendChild(list);
    wrap.appendChild(chips); wrap.appendChild(field); wrap.appendChild(note); wrap.appendChild(quick);
    mount.appendChild(wrap);

    var DEFAULT_NOTE = 'Pick each area from the list so customers nearby can find them. Up to ' + AREA_MAX + ' areas.';
    function say(msg) { note.textContent = msg || DEFAULT_NOTE; }
    say('');

    function sync(quiet) {
      hidden.value = areasToText(chosen);
      if (!quiet) fire(hidden);
    }

    function drawChips() {
      chips.textContent = '';
      chosen.forEach(function (a, i) {
        var chip = el('span', 'co-pick-chip' + (a.matched ? '' : ' co-pick-chip--check'));
        chip.appendChild(el('span', 'co-pick-chip-text', a.label));
        if (!a.matched) chip.title = 'This is not in the list of places. Remove it and pick the nearest place from the list.';
        var x = el('button', 'co-pick-x', '\u00d7'); x.type = 'button';
        x.setAttribute('aria-label', 'Remove ' + a.label);
        x.addEventListener('click', function () { chosen.splice(i, 1); drawChips(); drawQuick(); sync(); input.focus(); say(''); });
        chip.appendChild(x);
        chips.appendChild(chip);
      });
      var unmatched = chosen.some(function (a) { return !a.matched; });
      if (unmatched) say('Yellow areas are not in the list. Remove them and pick the nearest listed place, so customers can find this person.');
    }

    function drawQuick() {
      quick.textContent = '';
      places();
      var taken = {}; chosen.forEach(function (a) { taken[norm(a.label)] = true; });
      var shown = POPULAR.filter(function (l) { return BY_KEY[norm(l)] && !taken[norm(l)]; }).slice(0, 6);
      if (!shown.length || chosen.length >= AREA_MAX) { quick.hidden = true; return; }
      quick.hidden = false;
      quick.appendChild(el('span', 'co-pick-quick-label', 'Quick add:'));
      shown.forEach(function (l) {
        var b = el('button', 'co-pick-quick-btn', l.replace(/, Lagos$/, '')); b.type = 'button';
        b.setAttribute('aria-label', 'Add ' + l);
        b.addEventListener('click', function () { add(l); });
        quick.appendChild(b);
      });
    }

    function add(label) {
      var k = norm(label);
      if (chosen.some(function (a) { return norm(a.label) === k; })) { say(label + ' is already added.'); return; }
      if (chosen.length >= AREA_MAX) { say('That is the most areas we can save (' + AREA_MAX + '). Remove one to add another.'); return; }
      var next = chosen.concat([{ label: label, matched: true }]);
      if (areasToText(next).length > AREA_MAX_LEN) { say('That is the most that fits. Remove one to add another.'); return; }
      chosen = next;
      input.value = ''; close();
      drawChips(); drawQuick(); sync();
      say('Added ' + label + '.');
    }

    function close() {
      open = false; active = -1; list.hidden = true; list.textContent = '';
      input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
    }

    function setActive(i) {
      active = i;
      Array.prototype.forEach.call(list.children, function (li, n) {
        var on = (n === i); li.classList.toggle('is-active', on); li.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) { input.setAttribute('aria-activedescendant', li.id); if (li.scrollIntoView) li.scrollIntoView({ block: 'nearest' }); }
      });
    }

    function render() {
      var q = input.value.trim();
      list.textContent = '';
      if (!q) { close(); return; }
      var rows = suggestRows(q, chosen.map(function (a) { return a.label; }), 8);
      results = rows.map(function (r) { return r.label; });
      open = true; list.hidden = false; input.setAttribute('aria-expanded', 'true');
      if (!rows.length) {
        var none = el('li', 'co-pick-empty', 'No place found. Check the spelling, or type the bigger area it is in.');
        none.setAttribute('role', 'presentation');
        list.appendChild(none); active = -1;
        return;
      }
      var fuzzy = rows[0].s >= 4;      /* a near miss: never pick it for them, they must choose */
      if (fuzzy) {
        var hint = el('li', 'co-pick-empty', 'Did you mean one of these?');
        hint.setAttribute('role', 'presentation'); list.appendChild(hint);
      }
      results.forEach(function (label, i) {
        var li = el('li', 'co-pick-opt', label); li.id = 'coAreasOpt' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false');
        li.addEventListener('click', function () { add(label); input.focus(); });
        list.appendChild(li);
      });
      if (fuzzy) { active = -1; input.removeAttribute('aria-activedescendant'); } else setActive(0);
    }

    list.addEventListener('mousedown', function (e) { e.preventDefault(); });   /* keep focus in the box so the list does not close first */
    input.addEventListener('input', render);
    input.addEventListener('focus', function () { if (input.value.trim()) render(); });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) render(); else if (results.length) setActive(active < 0 ? 0 : (active + 1) % results.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (open && results.length) setActive(active < 0 ? results.length - 1 : (active - 1 + results.length) % results.length); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (open && results[active]) add(results[active]);
        else if (input.value.trim()) say(results.length ? 'Choose one of the suggestions below.' : 'Pick a place from the list. If you cannot find it, type the bigger area it is in.');
      }
      else if (e.key === 'Escape') { if (open) { e.preventDefault(); close(); } }
    });

    function fill(text) {
      chosen = parseAreas(text);
      drawChips(); drawQuick(); sync(true);
      if (!chosen.some(function (a) { return !a.matched; })) say('');
    }
    drawChips(); drawQuick();
    return { fill: fill, get: function () { return hidden.value; } };
  }

  /* ── Availability picker ────────────────────────────────── */
  function mountAvailability(hidden, mount) {
    var st = { days: [], times: [], anyTime: false, sameDay: false, note: '' };
    var wrap = el('div', 'co-pick');
    var boxes = {};   /* key -> checkbox */

    function group(legendText) {
      var fs = el('fieldset', 'co-opt-group'); fs.appendChild(el('legend', 'co-opt-legend', legendText));
      var row = el('div', 'co-opts'); fs.appendChild(row); wrap.appendChild(fs);
      return row;
    }
    function option(row, key, label) {
      var lab = el('label', 'co-opt'); var cb = el('input'); cb.type = 'checkbox'; cb.value = key;
      lab.appendChild(cb); lab.appendChild(el('span', '', label)); row.appendChild(lab);
      boxes[key] = cb; return cb;
    }
    function quickBtn(row, label, fn) {
      var b = el('button', 'co-pick-quick-btn', label); b.type = 'button'; b.addEventListener('click', fn); row.appendChild(b);
    }

    var dayRow = group('Days they can work');
    DAYS.forEach(function (d) { option(dayRow, 'd:' + d, d); });
    var quickRow = el('div', 'co-pick-quick');
    quickBtn(quickRow, 'Weekdays', function () { setDays(WEEKDAYS); });
    quickBtn(quickRow, 'Weekends', function () { setDays(WEEKEND); });
    quickBtn(quickRow, 'Every day', function () { setDays(DAYS); });
    quickBtn(quickRow, 'Clear days', function () { setDays([]); });
    dayRow.parentNode.appendChild(quickRow);

    var timeRow = group('Times of day');
    TIMES.forEach(function (t) { option(timeRow, 't:' + t[0], t[1]); });
    option(timeRow, 't:any', 'Any time');

    var moreRow = group('Short notice');
    option(moreRow, 'sameDay', 'Can take same-day jobs');

    var noteGroup = el('div', 'form-group');
    var noteLab = el('label', 'form-label', 'Anything else? (optional)'); noteLab.setAttribute('for', 'coFAvailNote');
    var noteIn = el('input', 'form-input'); noteIn.type = 'text'; noteIn.id = 'coFAvailNote'; noteIn.maxLength = NOTE_MAX; noteIn.autocomplete = 'off';
    noteIn.placeholder = 'For example: not available during Friday prayers';
    noteGroup.appendChild(noteLab); noteGroup.appendChild(noteIn); wrap.appendChild(noteGroup);
    mount.appendChild(wrap);

    function setDays(list) { st.days = list.slice(); paint(); sync(); }
    function paint() {
      DAYS.forEach(function (d) { boxes['d:' + d].checked = st.days.indexOf(d) >= 0; });
      TIMES.forEach(function (t) { boxes['t:' + t[0]].checked = !st.anyTime && st.times.indexOf(t[0]) >= 0; });
      boxes['t:any'].checked = st.anyTime;
      boxes.sameDay.checked = st.sameDay;
      noteIn.value = st.note;
    }
    function sync(quiet) { hidden.value = availToText(st); if (!quiet) fire(hidden); }

    Object.keys(boxes).forEach(function (key) {
      boxes[key].addEventListener('change', function () {
        var on = boxes[key].checked;
        if (key.indexOf('d:') === 0) {
          var d = key.slice(2); st.days = st.days.filter(function (x) { return x !== d; }); if (on) st.days.push(d);
        } else if (key === 't:any') {
          st.anyTime = on; if (on) st.times = [];
        } else if (key.indexOf('t:') === 0) {
          var t = key.slice(2); st.times = st.times.filter(function (x) { return x !== t; }); if (on) { st.times.push(t); st.anyTime = false; }
        } else if (key === 'sameDay') st.sameDay = on;
        paint(); sync();
      });
    });
    noteIn.addEventListener('input', function (e) { e.stopPropagation(); st.note = noteIn.value; sync(); });

    function fill(text) { st = textToAvail(text); paint(); sync(true); }
    paint();
    return { fill: fill, get: function () { return hidden.value; } };
  }

  /* ── Public ─────────────────────────────────────────────── */
  function init() {
    var ah = document.getElementById('coFAreas'), am = document.getElementById('coAreasMount');
    if (ah && am && !areasApi) areasApi = mountAreas(ah, am);
    var nh = document.getElementById('coFNotes'), nm = document.getElementById('coAvailMount');
    if (nh && nm && !availApi) availApi = mountAvailability(nh, nm);
  }

  root.STCoPick = {
    fillAreas: function (t) { init(); if (areasApi) areasApi.fill(t); },
    fillAvailability: function (t) { init(); if (availApi) availApi.fill(t); },
    /* exposed for tests */
    _suggest: suggest, _parseAreas: parseAreas, _areasToText: areasToText, _availToText: availToText, _textToAvail: textToAvail
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);

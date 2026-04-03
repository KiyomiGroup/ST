/* ============================================================
   STREET TASKER — location.js  (v5 — Precise Location)

   THREE MODES per input:
   'precise'  Taskers & task posters — requires street-level.
   'area'     Filter bars — neighbourhood is enough.
   'any'      Browse/search — no restriction.
   ============================================================ */
'use strict';

const NOMINATIM_BASE    = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const NOMINATIM_UA      = 'StreetTasker/1.0 (streettasker.com)';
const _debounceTimers   = {};
const _nominatimCache   = {};

const _NIGERIA = [
  'Abuja','Abeokuta','Ado-Ekiti','Akure','Asaba','Awka','Bauchi',
  'Benin City','Calabar','Damaturu','Dutse','Enugu','Gombe','Gusau',
  'Ibadan','Ilorin','Jalingo','Jos','Kaduna','Kano','Katsina',
  'Lafia','Lagos','Lokoja','Maiduguri','Makurdi','Minna','Nnewi',
  'Ogbomosho','Onitsha','Osogbo','Owerri','Oyo',
  'Port Harcourt','Sokoto','Umuahia','Uyo','Warri','Yenagoa','Yola',
  'Lagos Island','Lagos Mainland','Victoria Island','Lekki',
  'Lekki Phase 1','Lekki Phase 2','Ajah','Sangotedo','Chevron',
  'Ikate','Ikeja','Ikeja GRA','Maryland','Magodo','Ojodu','Ojota',
  'Gbagada','Surulere','Yaba','Shomolu','Bariga','Ebute-Metta',
  'Festac','Oshodi','Isolo','Mushin','Ikorodu','Badagry','Epe',
  'Alagbado','Ojuelegba','Ilupeju','Palmgrove','Agidingbi','Oregun',
  'Ogba','Agege','Dopemu','Alimosho','Egbeda','Idimu','Iba',
  'Amuwo-Odofin','Satellite Town','Apapa','Orile','Mile 2','Mile 12',
  'Ketu','Alapere','Ogudu','Onipanu','Anthony Village','Fadeyi','Iwaya',
  'Garki','Wuse','Wuse 2','Maitama','Asokoro','Gwarinpa','Kubwa',
  'Lugbe','Jabi','Utako','Kado','Katampe','Lokogoma','Nyanya',
  'Karu','Gwagwalada','Bwari','Dawaki','Gudu','Apo','Galadimawa',
  'Trans Amadi','GRA Port Harcourt','Old GRA','New GRA',
  'Rumuola','Rumuokoro','Rumuigbo','Eleme',
  'Bodija','New Bodija','Ring Road Ibadan','Dugbe','Mokola',
  'Achara Layout','Independence Layout','GRA Enugu','New Haven',
  'Barnawa','Kawo','Rigasa','Tudun Wada',
  'Fagge','Nassarawa Kano','Gwale','Dala','Sabon Gari Kano',
];

const _POPULAR = [
  'Lekki, Lagos','Ikeja, Lagos','Victoria Island, Lagos',
  'Surulere, Lagos','Yaba, Lagos','Gbagada, Lagos',
  'Wuse 2, Abuja','Maitama, Abuja','GRA, Port Harcourt',
];

/* Format Nominatim address into a human-readable label */
function _fmt(r, precise) {
  const a      = r.address || {};
  const road   = a.road || a.pedestrian || a.footway || a.path || '';
  const hno    = a.house_number || '';
  const suburb = a.suburb || a.neighbourhood || a.quarter || '';
  const dist   = a.city_district || '';
  const city   = a.city || a.town || a.village || '';
  const state  = a.state || '';
  const parts  = [];

  if (precise) {
    if (hno && road) parts.push(hno + ' ' + road);
    else if (road)   parts.push(road);
    if (suburb)      parts.push(suburb);
    if (dist && dist !== suburb) parts.push(dist);
    if (city)        parts.push(city);
    if (state)       parts.push(state);
  } else {
    if (suburb)      parts.push(suburb);
    if (dist)        parts.push(dist);
    if (city)        parts.push(city);
    if (state)       parts.push(state);
  }

  return parts.length >= 2
    ? parts.slice(0, 4).join(', ')
    : r.display_name.split(',').slice(0, 4).join(',').trim();
}

function _isStreetLevel(label) {
  return /\d/.test(label) ||
    /\b(street|st[,\s]|road|rd[,\s]|avenue|ave|way|drive|dr[,\s]|close|crescent|lane|boulevard|blvd|layout)\b/i.test(label);
}

/* Nominatim search */
async function _nominatim(query, precise) {
  const ck = query + (precise ? '|p' : '|a');
  if (_nominatimCache[ck]) return _nominatimCache[ck];
  const params = new URLSearchParams({
    q: query, format: 'json', addressdetails: '1',
    limit: '8', countrycodes: 'ng', 'accept-language': 'en',
  });
  try {
    const res  = await fetch(NOMINATIM_BASE + '?' + params, { headers: { 'User-Agent': NOMINATIM_UA } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const seen = new Set();
    const out  = data.map(r => ({
      label:   _fmt(r, precise),
      lat:     parseFloat(r.lat),
      lon:     parseFloat(r.lon),
      precise: _isStreetLevel(_fmt(r, precise)),
      instant: false,
    })).filter(r => { if (seen.has(r.label)) return false; seen.add(r.label); return true; });
    _nominatimCache[ck] = out.length ? out : _instant(query);
    return _nominatimCache[ck];
  } catch(e) {
    return _instant(query);
  }
}

/* GPS reverse geocode */
async function _reverse(lat, lon, precise) {
  const params = new URLSearchParams({
    lat, lon, format: 'json', addressdetails: '1',
    zoom: precise ? '18' : '14', 'accept-language': 'en',
  });
  try {
    const res  = await fetch(NOMINATIM_REVERSE + '?' + params, { headers: { 'User-Agent': NOMINATIM_UA } });
    if (!res.ok) return null;
    const data = await res.json();
    const label = _fmt(data, precise);
    return { label, lat, lon, precise: _isStreetLevel(label) };
  } catch(e) { return null; }
}

/* Instant local area match */
function _instant(q) {
  const ql = q.toLowerCase();
  /* Only show places that START with what the user typed */
  const matches = _NIGERIA.filter(c => c.toLowerCase().startsWith(ql));
  /* If fewer than 3 startsWith results, also include contains matches */
  if (matches.length < 3) {
    const extra = _NIGERIA.filter(x => !x.toLowerCase().startsWith(ql) && x.toLowerCase().includes(ql));
    return [...matches, ...extra].slice(0, 6).map(label => ({ label, lat: null, lon: null, precise: false, instant: true }));
  }
  return matches.slice(0, 6).map(label => ({ label, lat: null, lon: null, precise: false, instant: true }));
}

/* SVGs */
const _PIN  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const _GPS  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/><circle cx="12" cy="12" r="9"/></svg>';
const _SPIN = '<svg class="loc-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';

/* Hint element under input */
function _hint(input, mode) {
  const id = input.id + 'Hint';
  let el   = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id; el.className = 'location-hint';
    el.style.cssText = 'font-size:0.75rem;margin-top:5px;min-height:16px;transition:color 0.15s;';
    input.closest('.input-wrap, .form-group, div')
      ?.insertAdjacentElement('afterend', el);
  }
  const val = input.value.trim();
  const ok  = input.dataset.lat && input.dataset.lon;
  const str = input.dataset.precise === '1';
  if (!val) { el.textContent = mode === 'precise' ? 'Include street name for precise matching' : ''; el.style.color = 'var(--text-muted)'; return; }
  if (mode === 'precise') {
    if (ok && str)  { el.textContent = '✓ Street-level location confirmed';  el.style.color = 'var(--green)'; }
    else if (ok)    { el.textContent = '⚠ Area confirmed — add street name for better customer matching'; el.style.color = 'var(--amber)'; }
    else            { el.textContent = '↑ Select from list or use GPS to confirm';  el.style.color = 'var(--text-muted)'; }
  } else {
    el.textContent = ok ? '✓ Location set' : ''; el.style.color = 'var(--green)';
  }
}

/* Build dropdown */
function _build(dropdown, input, suggs, onSelect, showGps, mode) {
  dropdown.innerHTML = '';
  dropdown.style.display = 'block';

  if (showGps) {
    const row = document.createElement('div');
    row.className = 'loc-row loc-row-gps';
    row.innerHTML = '<span class="loc-row-icon loc-row-icon-gps">' + _GPS + '</span>'
      + '<span class="loc-row-text"><span class="loc-row-primary">Use my current location'
      + (mode === 'precise' ? ' <span style="font-size:0.68rem;opacity:0.7;">(street-level)</span>' : '')
      + '</span></span>';
    row.addEventListener('mousedown', e => { e.preventDefault(); _gps(input, dropdown, row, onSelect, mode); });
    dropdown.appendChild(row);
    if (suggs.length) { const s = document.createElement('div'); s.className = 'loc-sep'; dropdown.appendChild(s); }
  }

  if (!suggs.length && !showGps) {
    const e = document.createElement('div'); e.className = 'loc-row loc-row-empty';
    e.textContent = 'No results — try adding a street name or area'; dropdown.appendChild(e); return;
  }

  suggs.forEach(r => {
    const row = document.createElement('div');
    row.className = 'loc-row';
    row.innerHTML = '<span class="loc-row-icon">' + _PIN + '</span>'
      + '<span class="loc-row-text"><span class="loc-row-primary">' + r.label
      + (r.precise && mode === 'precise' ? ' <span style="font-size:0.62rem;font-weight:700;background:var(--green-light);color:var(--green);border-radius:4px;padding:1px 5px;">street</span>' : '')
      + '</span>'
      + (r.instant ? '<span class="loc-row-sub" style="font-size:0.72rem;color:var(--text-muted);">Type more for street-level results</span>' : '')
      + '</span>';
    row.addEventListener('mousedown', e => {
      e.preventDefault();
      input.value = r.label;
      if (r.lat) { input.dataset.lat = r.lat; input.dataset.lon = r.lon; input.dataset.precise = r.precise ? '1' : '0'; }
      else       { delete input.dataset.lat; delete input.dataset.lon; input.dataset.precise = '0'; }
      _close(dropdown);
      _hint(input, mode);
      if (typeof onSelect === 'function') onSelect(r);
    });
    dropdown.appendChild(row);
  });
}

/* GPS */
function _gps(input, dropdown, row, onSelect, mode) {
  if (!navigator.geolocation) { showToast('GPS not available. Please type your address.'); return; }
  row.innerHTML = '<span class="loc-row-icon loc-row-icon-gps">' + _SPIN + '</span><span class="loc-row-text"><span class="loc-row-primary">Detecting…</span></span>';
  row.style.pointerEvents = 'none';
  const precise = mode === 'precise';
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const result = await _reverse(lat, lon, precise);
      _close(dropdown);
      if (result) {
        input.value = result.label;
        input.dataset.lat     = result.lat;
        input.dataset.lon     = result.lon;
        input.dataset.precise = result.precise ? '1' : '0';
        _hint(input, mode);
        if (typeof onSelect === 'function') onSelect(result);
        showToast('📍 ' + result.label);
      } else {
        input.value = lat.toFixed(5) + ', ' + lon.toFixed(5);
        input.dataset.lat = lat; input.dataset.lon = lon; input.dataset.precise = '1';
        showToast('Location detected.');
      }
    },
    err => {
      _close(dropdown);
      showToast({ 1:'Location permission denied. Please type your address.', 2:'Could not detect location.', 3:'Location timed out.' }[err.code] || 'GPS failed.');
    },
    { timeout: 15000, maximumAge: 0, enableHighAccuracy: precise }
  );
}

function _close(d) { if (d) { d.style.display = 'none'; d.innerHTML = ''; } }

/* ── Public: initLocationInput ──────────────────────────────── */
function initLocationInput(cfg) {
  const input = document.getElementById(cfg.inputId);
  const drop  = document.getElementById(cfg.dropdownId);
  if (!input || !drop) return;

  const mode    = cfg.mode || 'any';
  const useGps  = cfg.gps !== false;
  const precise = mode === 'precise';

  if (precise && !input.placeholder) input.placeholder = 'e.g. 14 Allen Avenue, Ikeja, Lagos';
  if (mode === 'area' && !input.placeholder) input.placeholder = 'e.g. Lekki, Lagos';

  /* Insert initial hint for precise mode */
  if (precise) _hint(input, mode);

  input.addEventListener('focus', () => {
    const val = input.value.trim();
    /* Don't show anything until the user has typed — avoids overwhelming dropdown on click */
    if (!val) { _close(drop); return; }
    /* If they already have text, show instant matches */
    _build(drop, input, _instant(val), cfg.onSelect, false, mode);
  });

  input.addEventListener('input', () => {
    const val = input.value.trim();
    /* User is re-typing — clear confirmed coords */
    if (input.dataset.lat) { delete input.dataset.lat; delete input.dataset.lon; input.dataset.precise = '0'; }
    _hint(input, mode);
    if (typeof cfg.onChange === 'function') cfg.onChange(val);
    clearTimeout(_debounceTimers[cfg.inputId]);
    if (!val) { _close(drop); return; }
    /* Only start suggesting after 2 chars to avoid noise */
    if (val.length < 2) { _close(drop); return; }
    _build(drop, input, _instant(val), cfg.onSelect, false, mode);
    /* Debounce Nominatim for street-level results */
    _debounceTimers[cfg.inputId] = setTimeout(async () => {
      if (input.value.trim() !== val) return;
      const results = await _nominatim(val, precise);
      if (input.value.trim() === val) _build(drop, input, results, cfg.onSelect, false, mode);
    }, 400);
  });

  input.addEventListener('blur',    () => { setTimeout(() => _close(drop), 180); });
  input.addEventListener('keydown', e  => { if (e.key === 'Escape') _close(drop); });
}

/* ── Public: validateLocation ───────────────────────────────── */
function validateLocation(inputId, mode) {
  const input = document.getElementById(inputId);
  if (!input) return { ok: false, error: 'Location field not found.' };
  const val   = (input.value || '').trim();
  const hasCo = input.dataset.lat && input.dataset.lon;
  if (!val) return { ok: false, error: 'Please enter your location.' };
  if (mode === 'precise' && !hasCo) {
    return { ok: false, error: 'Please select your location from the dropdown or tap GPS — we need a confirmed location to match you with nearby customers.' };
  }
  return { ok: true };
}

/* Legacy wrappers */
function fetchLocationSuggestions(query, cId) {
  const d = document.getElementById(cId); if (!d) return;
  const i = d.previousElementSibling?.tagName === 'INPUT' ? d.previousElementSibling : d.parentElement?.querySelector('input');
  if (!i) return;
  const q = (query || '').trim();
  if (!q) { _build(d, i, _POPULAR.map(l=>({label:l,lat:null,lon:null,precise:false,instant:true})), null, true, 'any'); return; }
  _build(d, i, _instant(q), null, q.length <= 2, 'any');
  if (q.length >= 2) {
    clearTimeout(_debounceTimers[cId]);
    _debounceTimers[cId] = setTimeout(async () => { if (i.value.trim()===q) _build(d, i, await _nominatim(q, false), null, false, 'any'); }, 350);
  }
}
function selectLocationSuggestion(val, cId) {
  const d = document.getElementById(cId); if (!d) return;
  const i = d.previousElementSibling?.tagName === 'INPUT' ? d.previousElementSibling : d.parentElement?.querySelector('input');
  if (i) i.value = val; _close(d);
}

window.initLocationInput        = initLocationInput;
window.validateLocation         = validateLocation;
window.fetchLocationSuggestions = fetchLocationSuggestions;
window.selectLocationSuggestion = selectLocationSuggestion;

/* ============================================================
   STREET TASKER — location.js  (v6 — Precise Nigeria)

   KEY IMPROVEMENTS:
   - Google Places Autocomplete API for hyper-precise results
   - Falls back to Nominatim OSM if no API key set
   - Nigeria-specific street database for instant offline results
   - Shows street-level suggestions from first character typed
   - GPS gives street name, not just area
   ============================================================ */
'use strict';

/* ── Config ────────────────────────────────────────────────── */
/* Set GOOGLE_PLACES_KEY to your Google Places API key for best results.
   Without it, Nominatim (free OpenStreetMap) is used instead.          */
const GOOGLE_PLACES_KEY = '';   /* e.g. 'AIzaSy...' */

const NOMINATIM_BASE    = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const NOMINATIM_UA      = 'StreetTasker/1.0 (streettasker.com)';
const _debounceTimers   = {};
const _cache            = {};

/* ── Extensive Nigeria street + area database ──────────────── */
/* Covers popular streets, estates, markets, bus stops          */
const _STREETS = [
  /* Lagos — Ikeja */
  'Allen Avenue, Ikeja, Lagos','Toyin Street, Ikeja, Lagos',
  'Awolowo Way, Ikeja, Lagos','Opebi Road, Ikeja, Lagos',
  'Adeniyi Jones Avenue, Ikeja, Lagos','Acme Road, Ogba, Lagos',
  'Oregun Road, Ikeja, Lagos','Aromire Avenue, Ikeja, Lagos',
  /* Lagos — Lekki / Ajah */
  'Admiralty Way, Lekki Phase 1, Lagos','Freedom Way, Lekki, Lagos',
  'Lekki-Epe Expressway, Lekki, Lagos','Chevron Drive, Lekki, Lagos',
  'Orchid Road, Lekki, Lagos','Agungi Estate, Lekki, Lagos',
  'Jakande Estate, Lekki, Lagos','Alpha Beach Road, Lekki, Lagos',
  'Ogombo Road, Ajah, Lagos','Abraham Adesanya Estate, Ajah, Lagos',
  /* Lagos — VI / Ikoyi */
  'Adeola Odeku Street, Victoria Island, Lagos',
  'Ligali Ayorinde Street, Victoria Island, Lagos',
  'Ozumba Mbadiwe Avenue, Victoria Island, Lagos',
  'Bourdillon Road, Ikoyi, Lagos','Awolowo Road, Ikoyi, Lagos',
  'Kingsway Road, Ikoyi, Lagos','Alexander Road, Ikoyi, Lagos',
  /* Lagos — Surulere / Yaba */
  'Adeniran Ogunsanya Street, Surulere, Lagos',
  'Bode Thomas Street, Surulere, Lagos',
  'Eric Moore Road, Surulere, Lagos',
  'Herbert Macaulay Way, Yaba, Lagos',
  'Western Avenue, Surulere, Lagos',
  'Ojuelegba Road, Surulere, Lagos',
  /* Lagos — Gbagada / Maryland */
  'Ikorodu Road, Maryland, Lagos','Oshodi-Apapa Expressway, Oshodi, Lagos',
  'Gbagada Expressway, Gbagada, Lagos','Phase 2 Estate, Gbagada, Lagos',
  'Anthony Village Road, Maryland, Lagos',
  /* Lagos — Isolo / Mushin */
  'Isolo Road, Isolo, Lagos','Ago Palace Way, Isolo, Lagos',
  'Itire Road, Surulere, Lagos','Ilasamaja Road, Isolo, Lagos',
  /* Lagos — Ikorodu */
  'Lagos Road, Ikorodu, Lagos','Owutu Road, Ikorodu, Lagos',
  /* Lagos — Areas */
  'Lekki Phase 1, Lagos','Lekki Phase 2, Lagos',
  'Ikeja GRA, Lagos','Magodo Phase 1, Lagos','Magodo Phase 2, Lagos',
  'Omole Phase 1, Lagos','Omole Phase 2, Lagos',
  'Ojodu Berger, Lagos','Ketu, Lagos','Alapere, Lagos',
  'Ogudu GRA, Lagos','Ojota, Lagos','Mile 12, Lagos',
  'Agege, Lagos','Alimosho, Lagos','Egbeda, Lagos',
  'Festac Town, Lagos','Amuwo-Odofin, Lagos','Satellite Town, Lagos',
  'Apapa, Lagos','Orile-Iganmu, Lagos','Mile 2, Lagos',
  'Badagry, Lagos','Epe, Lagos',
  /* Abuja */
  'Gimbiya Street, Garki, Abuja','Aguiyi-Ironsi Street, Maitama, Abuja',
  'Usuma Street, Maitama, Abuja','T.Y. Danjuma Street, Asokoro, Abuja',
  'Aminu Kano Crescent, Wuse 2, Abuja',
  'Aminu Kano Way, Wuse 2, Abuja',
  'Muhammadu Buhari Way, Garki, Abuja',
  'Adetokunbo Ademola Crescent, Wuse 2, Abuja',
  'Lobito Crescent, Wuse 2, Abuja',
  'Ajose Adeogun Street, Wuse 2, Abuja',
  'Wuse Market, Wuse, Abuja','Area 11, Garki, Abuja',
  'Gwarinpa Estate, Gwarinpa, Abuja','Kubwa Expressway, Kubwa, Abuja',
  'Jabi Lake Road, Jabi, Abuja','Utako, Abuja','Kado, Abuja',
  'Maitama, Abuja','Asokoro, Abuja','Wuse 2, Abuja',
  'Garki 2, Abuja','Gudu, Abuja','Apo, Abuja',
  /* Port Harcourt */
  'Aba Road, Port Harcourt','Rumuola Road, Port Harcourt',
  'Ada George Road, Port Harcourt','Trans-Amadi, Port Harcourt',
  'GRA Phase 1, Port Harcourt','GRA Phase 2, Port Harcourt',
  'Old GRA, Port Harcourt','Eleme, Port Harcourt',
  /* Ibadan */
  'Ring Road, Ibadan','Bodija Road, Ibadan',
  'UI Road, Ibadan','Dugbe Market, Ibadan',
  'New Bodija Estate, Ibadan','Oluyole Estate, Ibadan',
  /* Other cities */
  'Aba Road, Aba, Abia State',
  'GRA, Enugu','Independence Layout, Enugu',
  'New Haven, Enugu','Achara Layout, Enugu',
  'GRA, Benin City','Ugbowo, Benin City',
  'Sapele Road, Benin City',
  'GRA, Warri','Effurun, Warri',
  'GRA, Calabar','Calabar Municipality, Calabar',
  'Barnawa, Kaduna','Sabon Gari, Kaduna',
  'Kawo, Kaduna','Rigasa, Kaduna',
  'Sabon Gari, Kano','Fagge, Kano',
  'Nasarawa, Kano','Gwale, Kano',
];

/* Also keep the area-level list for broad matches */
const _AREAS = [
  'Lekki, Lagos','Ikeja, Lagos','Victoria Island, Lagos',
  'Surulere, Lagos','Yaba, Lagos','Gbagada, Lagos',
  'Isolo, Lagos','Mushin, Lagos','Oshodi, Lagos',
  'Ikorodu, Lagos','Badagry, Lagos','Ajah, Lagos',
  'Wuse 2, Abuja','Maitama, Abuja','Garki, Abuja',
  'GRA, Port Harcourt','Trans Amadi, Port Harcourt',
  'Bodija, Ibadan','Ring Road, Ibadan',
  'GRA, Enugu','Independence Layout, Enugu',
];

/* ── Format Nominatim result ───────────────────────────────── */
function _fmt(r, precise) {
  const a      = r.address || {};
  const road   = a.road || a.pedestrian || a.footway || a.path || '';
  const hno    = a.house_number || '';
  const suburb = a.suburb || a.neighbourhood || a.quarter || '';
  const city   = a.city || a.town || a.village || '';
  const state  = a.state || '';
  const parts  = [];
  if (precise) {
    if (hno && road) parts.push(hno + ' ' + road);
    else if (road)   parts.push(road);
    if (suburb)      parts.push(suburb);
    if (city)        parts.push(city);
    if (state)       parts.push(state);
  } else {
    if (suburb) parts.push(suburb);
    if (city)   parts.push(city);
    if (state)  parts.push(state);
  }
  return parts.length >= 2
    ? parts.slice(0, 4).join(', ')
    : r.display_name.split(',').slice(0, 4).join(',').trim();
}

function _isStreetLevel(label) {
  return /\d/.test(label) ||
    /\b(street|st[,\s]|road|rd[,\s]|avenue|ave|way|drive|dr[,\s]|close|crescent|lane|boulevard|blvd|layout|estate|phase|express|expressway)\b/i.test(label);
}

/* ── Instant local match — street-level from 1st character ── */
function _instant(q, precise) {
  const ql    = q.toLowerCase();
  const list  = precise ? [..._STREETS, ..._AREAS] : [..._AREAS, ..._STREETS];
  /* startsWith first, then contains */
  const starts   = list.filter(s => s.toLowerCase().startsWith(ql));
  const contains = list.filter(s => !s.toLowerCase().startsWith(ql) && s.toLowerCase().includes(ql));
  const merged   = [...starts, ...contains].slice(0, 8);
  return merged.map(label => ({
    label, lat: null, lon: null,
    precise: _isStreetLevel(label), instant: true,
  }));
}

/* ── Nominatim search ──────────────────────────────────────── */
async function _nominatim(query, precise) {
  const ck = query + (precise ? '|p' : '|a');
  if (_cache[ck]) return _cache[ck];
  const params = new URLSearchParams({
    q: query + ', Nigeria', format: 'json', addressdetails: '1',
    limit: '8', countrycodes: 'ng', 'accept-language': 'en',
  });
  try {
    const res  = await fetch(NOMINATIM_BASE + '?' + params, {
      headers: { 'User-Agent': NOMINATIM_UA },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const seen = new Set();
    const out  = data
      .map(r => ({
        label:   _fmt(r, precise),
        lat:     parseFloat(r.lat),
        lon:     parseFloat(r.lon),
        precise: _isStreetLevel(_fmt(r, precise)),
        instant: false,
      }))
      .filter(r => { if (seen.has(r.label)) return false; seen.add(r.label); return true; });
    _cache[ck] = out.length ? out : _instant(query, precise);
    return _cache[ck];
  } catch(e) {
    return _instant(query, precise);
  }
}

/* ── Google Places autocomplete ───────────────────────────── */
async function _googlePlaces(query) {
  if (!GOOGLE_PLACES_KEY) return null;
  const ck = 'gp:' + query;
  if (_cache[ck]) return _cache[ck];
  try {
    const url = 'https://maps.googleapis.com/maps/api/place/autocomplete/json?' +
      new URLSearchParams({
        input:      query,
        components: 'country:ng',
        types:      'geocode',
        language:   'en',
        key:        GOOGLE_PLACES_KEY,
      });
    const res  = await fetch(url);
    const data = await res.json();
    if (data.status !== 'OK') return null;
    const out = data.predictions.map(p => ({
      label:   p.description.replace(', Nigeria', ''),
      lat:     null, lon: null,
      precise: _isStreetLevel(p.description),
      placeId: p.place_id, instant: false,
    }));
    _cache[ck] = out;
    return out;
  } catch(e) { return null; }
}

/* ── GPS reverse geocode (street-level) ───────────────────── */
async function _reverse(lat, lon) {
  const params = new URLSearchParams({
    lat, lon, format: 'json', addressdetails: '1',
    zoom: '18', 'accept-language': 'en',
  });
  try {
    const res  = await fetch(NOMINATIM_REVERSE + '?' + params, {
      headers: { 'User-Agent': NOMINATIM_UA },
    });
    if (!res.ok) return null;
    const data  = await res.json();
    const label = _fmt(data, true);
    return { label, lat, lon, precise: _isStreetLevel(label) };
  } catch(e) { return null; }
}

/* ── SVGs ──────────────────────────────────────────────────── */
const _PIN  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const _GPS  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/><circle cx="12" cy="12" r="9"/></svg>';
const _SPIN = '<svg class="loc-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';

/* ── Hint element ──────────────────────────────────────────── */
function _hint(input, mode) {
  const id = input.id + 'Hint';
  let el   = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id; el.className = 'location-hint';
    el.style.cssText = 'font-size:0.75rem;margin-top:5px;min-height:16px;transition:color 0.15s;';
    input.closest('.input-wrap,.form-group,div')?.insertAdjacentElement('afterend', el);
  }
  const val = input.value.trim();
  const ok  = input.dataset.lat && input.dataset.lon;
  const str = input.dataset.precise === '1';
  if (!val) {
    el.textContent = mode === 'precise'
      ? '🔍 Type a street name or tap GPS for your exact location'
      : '';
    el.style.color = 'var(--text-muted)'; return;
  }
  if (mode === 'precise') {
    if (ok && str) { el.textContent = '✓ Street-level confirmed'; el.style.color = 'var(--green)'; }
    else if (ok)   { el.textContent = '⚠ Area set — add street name for better matching'; el.style.color = 'var(--amber)'; }
    else           { el.textContent = '↑ Select from the list or use GPS'; el.style.color = 'var(--text-muted)'; }
  } else {
    el.textContent = ok ? '✓ Location set' : ''; el.style.color = 'var(--green)';
  }
}

/* ── Build dropdown ────────────────────────────────────────── */
function _build(dropdown, input, suggs, onSelect, showGps, mode) {
  dropdown.innerHTML = '';
  dropdown.style.display = 'block';

  if (showGps) {
    const row = document.createElement('div');
    row.className = 'loc-row loc-row-gps';
    row.innerHTML =
      '<span class="loc-row-icon loc-row-icon-gps">' + _GPS + '</span>' +
      '<span class="loc-row-text"><span class="loc-row-primary">Use my current location' +
      (mode === 'precise' ? ' <span style="font-size:0.68rem;opacity:0.7">(street-level)</span>' : '') +
      '</span></span>';
    row.addEventListener('mousedown', e => {
      e.preventDefault();
      _gps(input, dropdown, row, onSelect, mode);
    });
    dropdown.appendChild(row);
    if (suggs.length) {
      const sep = document.createElement('div'); sep.className = 'loc-sep'; dropdown.appendChild(sep);
    }
  }

  if (!suggs.length && !showGps) {
    const e = document.createElement('div'); e.className = 'loc-row loc-row-empty';
    e.textContent = 'No results — try a street name, estate or area'; dropdown.appendChild(e); return;
  }

  suggs.forEach(r => {
    const row = document.createElement('div');
    row.className = 'loc-row';
    const badge = (r.precise && mode === 'precise')
      ? ' <span style="font-size:0.62rem;font-weight:700;background:var(--green-light,#dcfce7);color:var(--green,#16a34a);border-radius:4px;padding:1px 5px;">street</span>'
      : '';
    const sub = r.instant && !r.precise && mode === 'precise'
      ? '<span class="loc-row-sub" style="font-size:0.72rem;color:var(--text-muted);">Type more for exact street</span>'
      : '';
    row.innerHTML =
      '<span class="loc-row-icon">' + _PIN + '</span>' +
      '<span class="loc-row-text">' +
        '<span class="loc-row-primary">' + r.label + badge + '</span>' +
        (sub ? sub : '') +
      '</span>';
    row.addEventListener('mousedown', e => {
      e.preventDefault();
      input.value = r.label;
      if (r.lat) {
        input.dataset.lat     = r.lat;
        input.dataset.lon     = r.lon;
        input.dataset.precise = r.precise ? '1' : '0';
      } else {
        delete input.dataset.lat; delete input.dataset.lon;
        input.dataset.precise = r.precise ? '1' : '0';
      }
      _close(dropdown);
      _hint(input, mode);
      if (typeof onSelect === 'function') onSelect(r);
    });
    dropdown.appendChild(row);
  });
}

/* ── GPS handler ───────────────────────────────────────────── */
function _gps(input, dropdown, row, onSelect, mode) {
  if (!navigator.geolocation) {
    if (typeof showToast === 'function') showToast('GPS not available on this device.');
    return;
  }
  row.innerHTML =
    '<span class="loc-row-icon loc-row-icon-gps">' + _SPIN + '</span>' +
    '<span class="loc-row-text"><span class="loc-row-primary">Detecting your location…</span></span>';
  row.style.pointerEvents = 'none';

  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const result = await _reverse(lat, lon);
      _close(dropdown);
      if (result) {
        input.value           = result.label;
        input.dataset.lat     = result.lat;
        input.dataset.lon     = result.lon;
        input.dataset.precise = result.precise ? '1' : '0';
        _hint(input, mode);
        if (typeof onSelect === 'function') onSelect(result);
        if (typeof showToast === 'function') showToast('📍 ' + result.label);
      } else {
        input.value           = lat.toFixed(5) + ', ' + lon.toFixed(5);
        input.dataset.lat     = lat;
        input.dataset.lon     = lon;
        input.dataset.precise = '1';
        if (typeof showToast === 'function') showToast('Location detected.');
      }
    },
    err => {
      _close(dropdown);
      const msgs = {
        1: 'Location permission denied. Please type your address.',
        2: 'Could not detect your location.',
        3: 'Location request timed out.',
      };
      if (typeof showToast === 'function') showToast(msgs[err.code] || 'GPS failed. Please type your address.');
    },
    { timeout: 15000, maximumAge: 0, enableHighAccuracy: true }
  );
}

function _close(d) { if (d) { d.style.display = 'none'; d.innerHTML = ''; } }

/* ── Public: initLocationInput ─────────────────────────────── */
function initLocationInput(cfg) {
  const inputId      = cfg.inputId;
  const dropdownId   = cfg.dropdownId || cfg.suggestionsId;
  const input        = document.getElementById(inputId);
  const dropdown     = document.getElementById(dropdownId);
  if (!input || !dropdown) return;

  const mode    = cfg.mode || 'any';
  const useGps  = cfg.gps !== false;
  const precise = mode === 'precise';

  /* Placeholders */
  if (precise && !input.placeholder)
    input.placeholder = 'e.g. 14 Allen Avenue, Ikeja, Lagos';
  else if (mode === 'area' && !input.placeholder)
    input.placeholder = 'e.g. Lekki Phase 1, Lagos';

  if (precise) _hint(input, mode);

  /* Show GPS + instant results on focus even if input is empty */
  input.addEventListener('focus', () => {
    const val = input.value.trim();
    if (!val) {
      /* Show GPS + popular areas immediately */
      _build(dropdown, input, _AREAS.slice(0, 6).map(l => ({
        label: l, lat: null, lon: null, precise: false, instant: true,
      })), cfg.onSelect, useGps, mode);
    } else {
      _build(dropdown, input, _instant(val, precise), cfg.onSelect, false, mode);
    }
  });

  input.addEventListener('input', async () => {
    const val = input.value.trim();
    if (input.dataset.lat) {
      delete input.dataset.lat; delete input.dataset.lon; input.dataset.precise = '0';
    }
    _hint(input, mode);
    if (typeof cfg.onChange === 'function') cfg.onChange(val);
    clearTimeout(_debounceTimers[inputId]);

    if (!val) {
      _build(dropdown, input, _AREAS.slice(0, 6).map(l => ({
        label: l, lat: null, lon: null, precise: false, instant: true,
      })), cfg.onSelect, useGps, mode);
      return;
    }

    /* Show instant local results immediately (from first character) */
    _build(dropdown, input, _instant(val, precise), cfg.onSelect, val.length === 0 && useGps, mode);

    /* Debounce Nominatim / Google for richer results */
    _debounceTimers[inputId] = setTimeout(async () => {
      if (input.value.trim() !== val) return;
      let results = null;
      if (GOOGLE_PLACES_KEY) {
        results = await _googlePlaces(val);
      }
      if (!results || !results.length) {
        results = await _nominatim(val, precise);
      }
      if (input.value.trim() === val) {
        _build(dropdown, input, results, cfg.onSelect, false, mode);
      }
    }, 350);
  });

  input.addEventListener('blur',    () => setTimeout(() => _close(dropdown), 200));
  input.addEventListener('keydown', e  => { if (e.key === 'Escape') _close(dropdown); });
}

/* ── Public: validateLocation ──────────────────────────────── */
function validateLocation(inputId, mode) {
  const input = document.getElementById(inputId);
  if (!input) return { ok: false, error: 'Location field not found.' };
  const val   = (input.value || '').trim();
  const hasCo = input.dataset.lat && input.dataset.lon;
  if (!val) return { ok: false, error: 'Please enter your location.' };
  if (mode === 'precise' && !hasCo && !input.dataset.precise) {
    return {
      ok: false,
      error: 'Please select your location from the list or tap "Use my current location" for GPS.',
    };
  }
  return { ok: true };
}

/* ── Legacy wrappers (backward compat) ─────────────────────── */
function fetchLocationSuggestions(query, containerId) {
  const d = document.getElementById(containerId); if (!d) return;
  const i = d.previousElementSibling?.tagName === 'INPUT'
    ? d.previousElementSibling
    : d.parentElement?.querySelector('input');
  if (!i) return;
  const q = (query || '').trim();
  if (!q) {
    _build(d, i, _AREAS.slice(0, 6).map(l => ({ label: l, lat: null, lon: null, precise: false, instant: true })), null, true, 'any');
    return;
  }
  _build(d, i, _instant(q, false), null, false, 'any');
  clearTimeout(_debounceTimers[containerId]);
  _debounceTimers[containerId] = setTimeout(async () => {
    if (i.value.trim() === q) _build(d, i, await _nominatim(q, false), null, false, 'any');
  }, 350);
}
function selectLocationSuggestion(val, containerId) {
  const d = document.getElementById(containerId); if (!d) return;
  const i = d.previousElementSibling?.tagName === 'INPUT'
    ? d.previousElementSibling
    : d.parentElement?.querySelector('input');
  if (i) i.value = val;
  _close(d);
}

window.initLocationInput        = initLocationInput;
window.validateLocation         = validateLocation;
window.fetchLocationSuggestions = fetchLocationSuggestions;
window.selectLocationSuggestion = selectLocationSuggestion;

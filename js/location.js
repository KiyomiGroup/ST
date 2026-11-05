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
    const res  = await fetch(NOMINATIM_BASE + '?' + params);
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
    const res  = await fetch(NOMINATIM_REVERSE + '?' + params);
    if (!res.ok) return null;
    const data  = await res.json();
    const label = _fmt(data, true);
    return { label, lat, lon, precise: _isStreetLevel(label) };
  } catch(e) { return null; }
}


/* ============================================================
   AREA-ONLY MODE ('area-only')  — used where a customer posts a task.
   A customer's street or house must never be shown publicly, so this
   mode only ever stores an AREA such as "Lekki Phase 1, Lagos":
   - suggestions are areas (a street name suggests the area it is in)
   - GPS is turned into an area; coordinates are never kept or shown
   - a typed street address is converted to its area, or refused
   ============================================================ */

/* True when the text looks like a street address or a house, not an area.
   "Lekki Phase 1" and "Wuse 2" are areas, so a digit alone is fine. */
const _STREETY = /\b(street|road|rd|avenue|ave|close|crescent|lane|boulevard|blvd|drive|dr|way|expressway|highway|house|flat|plot|block|opposite|opp|behind|beside|junction|bus\s?stop)\b/i;
function _looksLikeStreet(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return /^\d/.test(t) || /\b(house|flat|plot|block|no\.?|number)\s*\d/i.test(t) || _STREETY.test(t);
}

/* Nominatim address -> "Area, City" (never a road or a house number) */
function _areaLabel(a) {
  a = a || {};
  const area  = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.residential || '';
  const city  = a.city || a.town || a.village || a.municipality || a.county || a.state_district || '';
  const state = a.state || '';
  const raw = (area && city) ? [area, city] : [area || city, state];
  const seen = new Set();
  return raw.filter(p => p && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase())).join(', ');
}

/* The local street list, turned into areas ("Allen Avenue, Ikeja, Lagos" -> "Ikeja, Lagos") */
function _areaOf(label) {
  const parts = label.split(',').map(p => p.trim());
  while (parts.length > 2 && _looksLikeStreet(parts[0])) parts.shift();
  return parts.join(', ');
}
function _instantAreas(q) {
  const ql = String(q || '').toLowerCase().replace(/^\d+[a-z]?[,\s]+/, '').trim();
  if (!ql) return [];
  const rows = [..._AREAS, ..._STREETS].map(l => ({ src: l.toLowerCase(), area: _areaOf(l) }));
  const starts   = rows.filter(r => r.src.startsWith(ql));
  const contains = rows.filter(r => !r.src.startsWith(ql) && r.src.includes(ql));
  const seen = new Set(), out = [];
  [...starts, ...contains].forEach(r => {
    if (seen.has(r.area)) return; seen.add(r.area);
    out.push({ label: r.area, lat: null, lon: null, precise: false, instant: true, area: true });
  });
  return out.slice(0, 8);
}

async function _nominatimAreas(query) {
  const ck = query + '|area-only';
  if (_cache[ck]) return _cache[ck];
  const params = new URLSearchParams({
    q: query.replace(/^\d+[a-z]?[,\s]+/, '') + ', Nigeria', format: 'json', addressdetails: '1',
    limit: '8', countrycodes: 'ng', 'accept-language': 'en',
  });
  try {
    const res = await fetch(NOMINATIM_BASE + '?' + params);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const seen = new Set(), out = [];
    data.forEach(r => {
      const label = _areaLabel(r.address);
      if (!label || seen.has(label)) return; seen.add(label);
      out.push({ label, lat: null, lon: null, precise: false, instant: false, area: true });
    });
    _cache[ck] = out.length ? out : _instantAreas(query);
    return _cache[ck];
  } catch (e) { return _instantAreas(query); }
}

/* Reverse lookup at neighbourhood level only (zoom 14 never returns a street or house) */
async function _reverseArea(lat, lon) {
  const params = new URLSearchParams({ lat, lon, format: 'json', addressdetails: '1', zoom: '14', 'accept-language': 'en' });
  try {
    const res = await fetch(NOMINATIM_REVERSE + '?' + params);
    if (!res.ok) return '';
    const data = await res.json();
    return _areaLabel(data.address);
  } catch (e) { return ''; }
}

/* Ask the browser for a position. Network/Wi-Fi position first (works on laptops and is fast),
   then one high-accuracy try (phones with GPS). Resolves { lat, lon } or { error: code }. */
function _getPosition() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ error: 0 });
    const ask = (opts, next) => navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      err => { if (err.code === 1 || !next) return resolve({ error: err.code }); next(); },
      opts);
    ask({ enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
        () => ask({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }, null));
  });
}

/* Public: current area. Resolves { ok:true, label } or { ok:false, error:'message' }. Coordinates are not returned. */
async function getCurrentArea() {
  if (!window.isSecureContext && location.hostname !== 'localhost') {
    return { ok: false, error: 'Location needs a secure (https) connection. Please choose your area from the list.' };
  }
  const pos = await _getPosition();
  if (pos.error !== undefined) {
    const msgs = {
      0: 'This device cannot share its location. Please choose your area from the list.',
      1: 'Location is blocked for this site. Allow it in your browser settings, or choose your area from the list.',
      2: 'We could not find your location. Please choose your area from the list.',
      3: 'Finding your location took too long. Please choose your area from the list.',
    };
    return { ok: false, error: msgs[pos.error] || msgs[2] };
  }
  const label = await _reverseArea(pos.lat, pos.lon);
  if (!label) return { ok: false, error: 'We found you but could not work out the area name. Please choose it from the list.' };
  return { ok: true, label };
}

/* Typed text that looks like a street -> the area it is in (or '' when unknown) */
async function _textToArea(text) {
  const local = _instantAreas(text);
  if (local.length) return local[0].label;
  const found = await _nominatimAreas(text);
  return found.length ? found[0].label : '';
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
    el.style.cssText = 'font-size:var(--text-xs);margin-top:5px;min-height:16px;transition:color 0.15s;';
    input.closest('.input-wrap,.form-group,div')?.insertAdjacentElement('afterend', el);
  }
  const val = input.value.trim();
  const ok  = input.dataset.lat && input.dataset.lon;
  const str = input.dataset.precise === '1';
  if (!val) {
    el.textContent = mode === 'area-only' ? '' : mode === 'precise'
      ? '🔍 Type a street name or tap GPS for your exact location'
      : '';
    el.style.color = 'var(--text-muted)'; return;
  }
  if (mode === 'area-only') {
    if (input.dataset.area === '1') { el.textContent = '\u2713 Area set. Only this is shown on your task.'; el.style.color = 'var(--green)'; }
    else if (_looksLikeStreet(val))  { el.textContent = 'That looks like a street address. We only show the area, so pick your area from the list.'; el.style.color = 'var(--amber)'; }
    else                              { el.textContent = 'Pick your area from the list.'; el.style.color = 'var(--text-muted)'; }
    return;
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
      '<span class="loc-row-text"><span class="loc-row-primary">' + (mode === 'area-only' ? 'Use my current area' : 'Use my current location') +
      (mode === 'precise' ? ' <span style="font-size:var(--text-xs);opacity:0.7">(street-level)</span>' : '') +
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
      ? ' <span style="font-size:var(--text-xs);font-weight:700;background:var(--green-light);color:var(--green);border-radius:4px;padding:1px 5px;">street</span>'
      : '';
    const sub = r.instant && !r.precise && mode === 'precise'
      ? '<span class="loc-row-sub" style="font-size:var(--text-xs);color:var(--text-muted);">Type more for exact street</span>'
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
      if (mode === 'area-only') {
        delete input.dataset.lat; delete input.dataset.lon;
        input.dataset.area = '1'; input.dataset.precise = '0';
      } else if (r.lat) {
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
  if (mode === 'area-only') return _gpsArea(input, dropdown, row, onSelect, mode);
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

/* Area-only GPS: fills the field with the area name and nothing else */
async function _gpsArea(input, dropdown, row, onSelect, mode) {
  if (row) {
    row.innerHTML =
      '<span class="loc-row-icon loc-row-icon-gps">' + _SPIN + '</span>' +
      '<span class="loc-row-text"><span class="loc-row-primary">Finding your area\u2026</span></span>';
    row.style.pointerEvents = 'none';
  }
  const r = await getCurrentArea();
  _close(dropdown);
  if (!r.ok) { if (typeof showToast === 'function') showToast(r.error); return r; }
  input.value = r.label;
  delete input.dataset.lat; delete input.dataset.lon;
  input.dataset.area = '1'; input.dataset.precise = '0';
  _hint(input, mode);
  if (typeof onSelect === 'function') onSelect({ label: r.label, area: true });
  if (typeof showToast === 'function') showToast('Area set to ' + r.label + '. Your exact spot is not shown.');
  return r;
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
  const areaOnly = mode === 'area-only';
  const popular = () => _AREAS.slice(0, 6).map(l => ({ label: l, lat: null, lon: null, precise: false, instant: true, area: true }));
  const instant = v => areaOnly ? _instantAreas(v) : _instant(v, precise);

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
      _build(dropdown, input, popular(), cfg.onSelect, useGps, mode);
    } else {
      _build(dropdown, input, instant(val), cfg.onSelect, false, mode);
    }
  });

  input.addEventListener('input', async () => {
    const val = input.value.trim();
    if (input.dataset.lat) {
      delete input.dataset.lat; delete input.dataset.lon; input.dataset.precise = '0';
    }
    if (areaOnly) delete input.dataset.area;
    _hint(input, mode);
    if (typeof cfg.onChange === 'function') cfg.onChange(val);
    clearTimeout(_debounceTimers[inputId]);

    if (!val) {
      _build(dropdown, input, popular(), cfg.onSelect, useGps, mode);
      return;
    }

    /* Show instant local results immediately (from first character) */
    _build(dropdown, input, instant(val), cfg.onSelect, val.length === 0 && useGps, mode);

    /* Debounce Nominatim / Google for richer results */
    _debounceTimers[inputId] = setTimeout(async () => {
      if (input.value.trim() !== val) return;
      let results = null;
      if (areaOnly) {
        results = await _nominatimAreas(val);
      } else {
        if (GOOGLE_PLACES_KEY) {
          results = await _googlePlaces(val);
        }
        if (!results || !results.length) {
          results = await _nominatim(val, precise);
        }
      }
      if (input.value.trim() === val) {
        _build(dropdown, input, results, cfg.onSelect, false, mode);
      }
    }, 350);
  });

  input.addEventListener('blur', () => setTimeout(async () => {
    _close(dropdown);
    /* Area-only: someone typed a street address and walked away. Swap it for the area it is in. */
    if (!areaOnly) return;
    const val = input.value.trim();
    if (!val || input.dataset.area === '1' || !_looksLikeStreet(val)) return;
    const area = await _textToArea(val);
    if (!area || input.value.trim() !== val) return;
    input.value = area; input.dataset.area = '1'; input.dataset.precise = '0';
    _hint(input, mode);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof showToast === 'function') showToast('We only show your area, so we used ' + area + '.');
  }, 200));
  input.addEventListener('keydown', e  => { if (e.key === 'Escape') _close(dropdown); });
}

/* ── Public: validateLocation ──────────────────────────────── */
function validateLocation(inputId, mode) {
  const input = document.getElementById(inputId);
  if (!input) return { ok: false, error: 'Location field not found.' };
  const val   = (input.value || '').trim();
  const hasCo = input.dataset.lat && input.dataset.lon;
  if (mode === 'area-only') {
    if (!val) return { ok: false, error: 'Please choose your area.' };
    if (input.dataset.area === '1') return { ok: true };
    if (_looksLikeStreet(val)) return { ok: false, error: 'Please choose just your area from the list (for example Lekki Phase 1, Lagos). We never show street addresses.' };
    return { ok: true };   /* plain area name that is not in our list, e.g. a small town */
  }
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
window.getCurrentArea           = getCurrentArea;
window.validateLocation         = validateLocation;
window.fetchLocationSuggestions = fetchLocationSuggestions;
window.selectLocationSuggestion = selectLocationSuggestion;

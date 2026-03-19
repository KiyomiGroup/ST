/* ============================================================
   STREET TASKER — location.js  (v2 — Nominatim + GPS)
   ============================================================
   Uses OpenStreetMap Nominatim API — completely free, no API key.
   Provides:
     1. Real address autocomplete via Nominatim
     2. GPS "use my location" via browser Geolocation API
     3. initLocationInput(config) — attach to any input in one call

   Nominatim usage policy:
     - Max 1 request/second (enforced via debounce)
     - Must send a valid User-Agent (set in fetch headers)
   ============================================================ */
'use strict';

const NOMINATIM_BASE    = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const NOMINATIM_UA      = 'StreetTasker/1.0 (streettasker.com)';

const _debounceTimers = {};
const _cache = {};

/* ── Nominatim fetch ─────────────────────────────────────────── */
async function _fetchNominatim(query) {
  if (_cache[query]) return _cache[query];

  const params = new URLSearchParams({
    q: query, format: 'json', addressdetails: '1',
    limit: '6', countrycodes: 'ng', 'accept-language': 'en',
  });

  try {
    const res = await fetch(`${NOMINATIM_BASE}?${params}`, {
      headers: { 'User-Agent': NOMINATIM_UA },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    const results = data.map(r => {
      const a = r.address || {};
      const parts = [];
      if (a.suburb || a.neighbourhood) parts.push(a.suburb || a.neighbourhood);
      if (a.city_district || a.town)   parts.push(a.city_district || a.town);
      if (a.city || a.county)          parts.push(a.city || a.county);
      if (a.state)                     parts.push(a.state);
      const label = parts.length >= 2
        ? parts.slice(0, 3).join(', ')
        : r.display_name.split(',').slice(0, 3).join(',').trim();
      return { label, lat: parseFloat(r.lat), lon: parseFloat(r.lon) };
    });

    const seen = new Set();
    const unique = results.filter(r => {
      if (seen.has(r.label)) return false;
      seen.add(r.label); return true;
    });

    _cache[query] = unique;
    return unique;
  } catch (e) {
    console.warn('[Location] Nominatim failed:', e.message);
    return _fallback(query);
  }
}

/* ── Fallback static list ────────────────────────────────────── */
const _CITIES = [
  'Abuja','Abeokuta','Ado-Ekiti','Akure','Asaba','Awka','Bauchi',
  'Benin City','Calabar','Enugu','Ibadan','Ilorin','Jos','Kaduna',
  'Kano','Katsina','Lagos','Lagos Island','Lekki','Lekki Phase 1',
  'Lekki Phase 2','Victoria Island','Ajah','Surulere','Ikeja',
  'Magodo','Gbagada','Yaba','Ikorodu','Maiduguri','Makurdi','Minna',
  'Onitsha','Owerri','Port Harcourt','Sokoto','Uyo','Warri','Yenagoa',
];
function _fallback(q) {
  const lq = q.toLowerCase();
  return _CITIES.filter(c => c.toLowerCase().includes(lq))
    .slice(0, 6).map(label => ({ label, lat: null, lon: null }));
}

/* ── Render dropdown ─────────────────────────────────────────── */
function _render(results, dropdown, input, onSelect) {
  if (!dropdown) return;
  dropdown.innerHTML = '';

  if (!results.length) {
    dropdown.innerHTML = '<div class="location-suggestion-item location-suggestion-empty">No locations found</div>';
    dropdown.style.display = 'block';
    return;
  }

  results.forEach(r => {
    const item = document.createElement('div');
    item.className = 'location-suggestion-item';
    item.innerHTML =
      '<svg class="loc-sug-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'
      + '<span>' + escapeHtml(r.label) + '</span>';

    item.addEventListener('mousedown', e => {
      e.preventDefault();
      input.value = r.label;
      if (r.lat) { input.dataset.lat = r.lat; input.dataset.lon = r.lon; }
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
      if (typeof onSelect === 'function') onSelect(r);
    });
    dropdown.appendChild(item);
  });
  dropdown.style.display = 'block';
}

/* ── Reverse geocode (GPS → address) ────────────────────────── */
async function _reverse(lat, lon) {
  const params = new URLSearchParams({
    lat, lon, format: 'json', addressdetails: '1',
    zoom: '14', 'accept-language': 'en',
  });
  try {
    const res = await fetch(`${NOMINATIM_REVERSE}?${params}`, {
      headers: { 'User-Agent': NOMINATIM_UA },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};
    const parts = [];
    if (a.suburb || a.neighbourhood) parts.push(a.suburb || a.neighbourhood);
    if (a.city_district || a.town)   parts.push(a.city_district || a.town);
    if (a.city || a.county)          parts.push(a.city || a.county);
    if (a.state)                     parts.push(a.state);
    return {
      label: parts.slice(0, 3).join(', ') || data.display_name.split(',').slice(0,3).join(',').trim(),
      lat, lon,
    };
  } catch (e) {
    return null;
  }
}

/* ── GPS detect ──────────────────────────────────────────────── */
function _gps(input, dropdown, btn, onSelect) {
  if (!navigator.geolocation) {
    showToast('GPS not available in this browser.');
    return;
  }
  const orig = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="loc-btn-spinner"></span>';
    btn.title = 'Detecting…';
  }
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const result = await _reverse(lat, lon);
      if (btn) { btn.disabled = false; btn.innerHTML = orig; btn.title = 'Use my location'; }
      if (result) {
        input.value = result.label;
        input.dataset.lat = result.lat;
        input.dataset.lon = result.lon;
        if (dropdown) { dropdown.style.display = 'none'; }
        if (typeof onSelect === 'function') onSelect(result);
        showToast('Location detected: ' + result.label);
      } else {
        input.value = lat.toFixed(4) + ', ' + lon.toFixed(4);
        showToast('Location detected.');
      }
    },
    err => {
      if (btn) { btn.disabled = false; btn.innerHTML = orig; btn.title = 'Use my location'; }
      const msg = {
        1: 'Location permission denied. Enable it in your browser settings.',
        2: 'Could not detect your location. Please type it manually.',
        3: 'Location detection timed out.',
      }[err.code] || 'Location detection failed.';
      showToast(msg);
    },
    { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false }
  );
}

/* ── GPS button markup ───────────────────────────────────────── */
function _gpsBtnHTML() {
  return '<button type="button" class="loc-gps-btn" title="Use my location" aria-label="Use my location">'
    + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
    + '<circle cx="12" cy="12" r="3"/>'
    + '<path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>'
    + '<circle cx="12" cy="12" r="9"/>'
    + '</svg>'
    + '</button>';
}

/* ── Public API ──────────────────────────────────────────────── */
/**
 * Wire up a location input with Nominatim autocomplete + GPS button.
 *
 * @param {object} cfg
 *   cfg.inputId    {string}   id of the <input>
 *   cfg.dropdownId {string}   id of the suggestions container <div>
 *   cfg.gps        {boolean}  show GPS button (default true)
 *   cfg.onSelect   {function} called with {label, lat, lon} on selection
 *   cfg.onChange   {function} called with current string value on each keystroke
 */
function initLocationInput(cfg) {
  const input    = document.getElementById(cfg.inputId);
  const dropdown = document.getElementById(cfg.dropdownId);
  if (!input) return;

  const gps = cfg.gps !== false;

  /* Inject GPS button once */
  let btn = null;
  if (gps) {
    if (!input.parentElement.querySelector('.loc-gps-btn')) {
      input.insertAdjacentHTML('afterend', _gpsBtnHTML());
    }
    btn = input.parentElement.querySelector('.loc-gps-btn');
    if (btn) btn.addEventListener('click', () => _gps(input, dropdown, btn, cfg.onSelect));
  }

  /* Typing handler with debounce */
  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (typeof cfg.onChange === 'function') cfg.onChange(val);
    clearTimeout(_debounceTimers[cfg.inputId]);
    if (val.length < 2) {
      if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }
      return;
    }
    _debounceTimers[cfg.inputId] = setTimeout(async () => {
      const results = await _fetchNominatim(val);
      if (dropdown) _render(results, dropdown, input, cfg.onSelect);
    }, 350);
  });

  /* Hide on blur */
  input.addEventListener('blur', () => {
    setTimeout(() => { if (dropdown) dropdown.style.display = 'none'; }, 200);
  });

  /* Escape key */
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dropdown) {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
    }
  });
}

/* ── Legacy wrappers (backwards compatible with old oninput= attrs) ── */
function fetchLocationSuggestions(query, containerId) {
  const dropdown = document.getElementById(containerId);
  if (!dropdown) return;
  const input = dropdown.previousElementSibling?.tagName === 'INPUT'
    ? dropdown.previousElementSibling
    : dropdown.parentElement?.querySelector('input');
  if (!input) return;
  const q = (query || '').trim();
  if (q.length < 2) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; return; }
  clearTimeout(_debounceTimers[containerId]);
  _debounceTimers[containerId] = setTimeout(async () => {
    const results = await _fetchNominatim(q);
    _render(results, dropdown, input, null);
  }, 350);
}

function selectLocationSuggestion(value, containerId) {
  const dropdown = document.getElementById(containerId);
  if (!dropdown) return;
  const input = dropdown.previousElementSibling?.tagName === 'INPUT'
    ? dropdown.previousElementSibling
    : dropdown.parentElement?.querySelector('input');
  if (input) input.value = value;
  dropdown.style.display = 'none';
  dropdown.innerHTML = '';
}

window.initLocationInput        = initLocationInput;
window.fetchLocationSuggestions = fetchLocationSuggestions;
window.selectLocationSuggestion = selectLocationSuggestion;

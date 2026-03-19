/* ============================================================
   STREET TASKER — location.js  (v4 — GPS inside dropdown)
   ============================================================
   UX pattern: GPS is the FIRST row inside the dropdown itself.
   No floating button. Clean input with just a pin icon.
   Opens on focus (shows GPS + popular cities), then filters
   as you type from 1 character onward.
   ============================================================ */
'use strict';

const NOMINATIM_BASE    = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const NOMINATIM_UA      = 'StreetTasker/1.0 (streettasker.com)';

const _debounceTimers = {};
const _nominatimCache = {};

/* ── Nigerian locations list ─────────────────────────────────── */
const _NIGERIA = [
  'Abuja','Abeokuta','Ado-Ekiti','Akure','Asaba','Awka','Bauchi',
  'Benin City','Calabar','Damaturu','Dutse','Enugu','Gombe','Gusau',
  'Ibadan','Ilorin','Jalingo','Jos','Kaduna','Kano','Katsina',
  'Lafia','Lagos','Lokoja','Maiduguri','Makurdi','Minna','Nnewi',
  'Ogbomosho','Onitsha','Osogbo','Owerri','Oyo',
  'Port Harcourt','Sokoto','Umuahia','Uyo','Warri','Yenagoa','Yola',
  /* Lagos */
  'Lagos Island','Lagos Mainland','Victoria Island','Lekki',
  'Lekki Phase 1','Lekki Phase 2','Lekki Phase 3','Ajah','Sangotedo',
  'Chevron','Ikate','Ikeja','Ikeja GRA','Maryland','Magodo',
  'Ojodu','Ojota','Gbagada','Surulere','Yaba','Shomolu','Bariga',
  'Ebute-Metta','Festac','Oshodi','Isolo','Mushin','Ikorodu',
  'Badagry','Epe','Alagbado','Ojuelegba','Ilupeju','Palmgrove',
  'Agidingbi','Oregun','Ogba','Agege','Dopemu','Alimosho',
  'Egbeda','Idimu','Iba','Amuwo-Odofin','Satellite Town',
  'Apapa','Orile','Mile 2','Mile 12','Ketu','Alapere','Ogudu',
  'Onipanu','Anthony Village','Fadeyi','Iwaya',
  /* Abuja */
  'Garki','Wuse','Wuse 2','Maitama','Asokoro','Gwarinpa','Kubwa',
  'Lugbe','Jabi','Utako','Kado','Katampe','Lokogoma','Nyanya',
  'Karu','Gwagwalada','Bwari','Dawaki','Gudu','Apo','Galadimawa',
  /* Port Harcourt */
  'Trans Amadi','GRA Port Harcourt','Old GRA','New GRA',
  'Rumuola','Rumuokoro','Rumuigbo','Eleme',
  /* Ibadan */
  'Bodija','New Bodija','Ring Road Ibadan','Dugbe','Mokola',
  /* Enugu */
  'Achara Layout','Independence Layout','GRA Enugu','New Haven',
  /* Kaduna */
  'Barnawa','Kawo','Rigasa','Tudun Wada',
  /* Kano */
  'Fagge','Nassarawa Kano','Gwale','Dala','Sabon Gari Kano',
];

/* Popular cities shown on focus before typing */
const _POPULAR = [
  'Lagos','Abuja','Port Harcourt','Ibadan','Kano',
  'Enugu','Kaduna','Lekki','Victoria Island','Ikeja',
];

/* ── Local instant match ─────────────────────────────────────── */
function _instant(query) {
  const q = query.toLowerCase();
  const starts = _NIGERIA.filter(c => c.toLowerCase().startsWith(q));
  const contains = _NIGERIA.filter(c => {
    const cl = c.toLowerCase();
    return !cl.startsWith(q) && cl.includes(q);
  });
  return [...starts, ...contains]
    .slice(0, 6)
    .map(label => ({ label, lat: null, lon: null, instant: true }));
}

/* ── Nominatim ───────────────────────────────────────────────── */
async function _nominatim(query) {
  if (_nominatimCache[query]) return _nominatimCache[query];
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
      return { label, lat: parseFloat(r.lat), lon: parseFloat(r.lon), instant: false };
    });
    const seen = new Set();
    const unique = results.filter(r => {
      if (seen.has(r.label)) return false;
      seen.add(r.label); return true;
    });
    const out = unique.length ? unique : _instant(query);
    _nominatimCache[query] = out;
    return out;
  } catch(e) {
    console.warn('[Location] Nominatim failed:', e.message);
    return _instant(query);
  }
}

/* ── GPS reverse geocode ─────────────────────────────────────── */
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
  } catch(e) { return null; }
}

/* ── SVG helpers ─────────────────────────────────────────────── */
const _PIN_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>' +
  '</svg>';

const _GPS_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="3"/>' +
  '<path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>' +
  '<circle cx="12" cy="12" r="9"/>' +
  '</svg>';

const _SPIN_SVG =
  '<svg class="loc-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>' +
  '</svg>';

/* ── Build dropdown ──────────────────────────────────────────── */
function _buildDropdown(dropdown, input, suggestions, onSelect, showGps) {
  dropdown.innerHTML = '';

  /* ── GPS row (always first when no query, or when query short) ── */
  if (showGps) {
    const gpsRow = document.createElement('div');
    gpsRow.className = 'loc-row loc-row-gps';
    gpsRow.setAttribute('role', 'option');
    gpsRow.innerHTML =
      '<span class="loc-row-icon loc-row-icon-gps">' + _GPS_SVG + '</span>' +
      '<span class="loc-row-text">' +
        '<span class="loc-row-primary">Use my current location</span>' +
      '</span>';

    gpsRow.addEventListener('mousedown', e => {
      e.preventDefault();
      _triggerGps(input, dropdown, gpsRow, onSelect);
    });
    dropdown.appendChild(gpsRow);

    /* Separator */
    if (suggestions.length) {
      const sep = document.createElement('div');
      sep.className = 'loc-sep';
      dropdown.appendChild(sep);
    }
  }

  /* ── Suggestion rows ── */
  suggestions.forEach(r => {
    const row = document.createElement('div');
    row.className = 'loc-row' + (r.instant ? '' : ' loc-row-real');
    row.setAttribute('role', 'option');
    row.innerHTML =
      '<span class="loc-row-icon">' + _PIN_SVG + '</span>' +
      '<span class="loc-row-text">' +
        '<span class="loc-row-primary">' + escapeHtml(r.label) + '</span>' +
      '</span>';

    row.addEventListener('mousedown', e => {
      e.preventDefault();
      input.value = r.label;
      if (r.lat) { input.dataset.lat = r.lat; input.dataset.lon = r.lon; }
      else { delete input.dataset.lat; delete input.dataset.lon; }
      _close(dropdown);
      if (typeof onSelect === 'function') onSelect(r);
    });
    dropdown.appendChild(row);
  });

  /* Empty state */
  if (!showGps && !suggestions.length) {
    const empty = document.createElement('div');
    empty.className = 'loc-row loc-row-empty';
    empty.textContent = 'No locations found';
    dropdown.appendChild(empty);
  }

  dropdown.style.display = 'block';
}

/* ── GPS trigger ─────────────────────────────────────────────── */
function _triggerGps(input, dropdown, row, onSelect) {
  if (!navigator.geolocation) {
    showToast('GPS is not available in this browser.');
    return;
  }

  /* Swap row to loading state */
  row.innerHTML =
    '<span class="loc-row-icon loc-row-icon-gps">' + _SPIN_SVG + '</span>' +
    '<span class="loc-row-text">' +
      '<span class="loc-row-primary">Detecting your location…</span>' +
    '</span>';
  row.style.pointerEvents = 'none';

  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const result = await _reverse(lat, lon);
      _close(dropdown);
      if (result) {
        input.value = result.label;
        input.dataset.lat = result.lat;
        input.dataset.lon = result.lon;
        if (typeof onSelect === 'function') onSelect(result);
        showToast('📍 ' + result.label);
      } else {
        input.value = lat.toFixed(4) + ', ' + lon.toFixed(4);
        showToast('Location detected.');
      }
    },
    err => {
      _close(dropdown);
      const msgs = {
        1: 'Location permission denied. Please allow it in your browser settings.',
        2: 'Could not detect location. Please type your address.',
        3: 'Location detection timed out.',
      };
      showToast(msgs[err.code] || 'Location detection failed.');
    },
    { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false }
  );
}

function _close(dropdown) {
  if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }
}

/* ── Public API ──────────────────────────────────────────────── */
function initLocationInput(cfg) {
  const input    = document.getElementById(cfg.inputId);
  const dropdown = document.getElementById(cfg.dropdownId);
  if (!input || !dropdown) return;

  const useGps = cfg.gps !== false;

  /* ── Focus: show GPS + popular cities immediately ── */
  input.addEventListener('focus', () => {
    const val = input.value.trim();
    if (!val) {
      const popular = _POPULAR.map(l => ({ label: l, lat: null, lon: null, instant: true }));
      _buildDropdown(dropdown, input, popular, cfg.onSelect, useGps);
    }
  });

  /* ── Typing ── */
  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (typeof cfg.onChange === 'function') cfg.onChange(val);
    clearTimeout(_debounceTimers[cfg.inputId]);

    if (!val) {
      const popular = _POPULAR.map(l => ({ label: l, lat: null, lon: null, instant: true }));
      _buildDropdown(dropdown, input, popular, cfg.onSelect, useGps);
      return;
    }

    /* 1+ char: instant match immediately */
    const instant = _instant(val);
    _buildDropdown(dropdown, input, instant, cfg.onSelect, useGps && val.length <= 2);

    /* 2+ chars: Nominatim in background */
    if (val.length >= 2) {
      _debounceTimers[cfg.inputId] = setTimeout(async () => {
        if (input.value.trim() !== val) return;
        const results = await _nominatim(val);
        if (input.value.trim() === val) {
          _buildDropdown(dropdown, input, results, cfg.onSelect, false);
        }
      }, 350);
    }
  });

  /* ── Blur ── */
  input.addEventListener('blur', () => {
    setTimeout(() => _close(dropdown), 180);
  });

  /* ── Escape ── */
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') _close(dropdown);
  });
}

/* ── Legacy wrappers ─────────────────────────────────────────── */
function fetchLocationSuggestions(query, containerId) {
  const dropdown = document.getElementById(containerId);
  if (!dropdown) return;
  const input = dropdown.previousElementSibling?.tagName === 'INPUT'
    ? dropdown.previousElementSibling
    : dropdown.parentElement?.querySelector('input');
  if (!input) return;
  const q = (query || '').trim();
  if (!q) {
    const popular = _POPULAR.map(l => ({ label: l, lat: null, lon: null, instant: true }));
    _buildDropdown(dropdown, input, popular, null, true);
    return;
  }
  const instant = _instant(q);
  _buildDropdown(dropdown, input, instant, null, q.length <= 2);
  if (q.length >= 2) {
    clearTimeout(_debounceTimers[containerId]);
    _debounceTimers[containerId] = setTimeout(async () => {
      if (input.value.trim() === q) {
        _buildDropdown(dropdown, input, await _nominatim(q), null, false);
      }
    }, 350);
  }
}

function selectLocationSuggestion(value, containerId) {
  const dropdown = document.getElementById(containerId);
  if (!dropdown) return;
  const input = dropdown.previousElementSibling?.tagName === 'INPUT'
    ? dropdown.previousElementSibling
    : dropdown.parentElement?.querySelector('input');
  if (input) input.value = value;
  _close(dropdown);
}

window.initLocationInput        = initLocationInput;
window.fetchLocationSuggestions = fetchLocationSuggestions;
window.selectLocationSuggestion = selectLocationSuggestion;

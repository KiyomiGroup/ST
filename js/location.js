/* ============================================================
   STREET TASKER — location.js  (v3 — instant suggestions + Nominatim + GPS)
   ============================================================
   - 1 character typed → instant suggestions from local Nigerian
     city/area list (feels snappy, zero network needed)
   - 2+ characters → real Nominatim results replace the instant ones
   - GPS button → reverse-geocodes to a real address
   ============================================================ */
'use strict';

const NOMINATIM_BASE    = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const NOMINATIM_UA      = 'StreetTasker/1.0 (streettasker.com)';

const _debounceTimers = {};
const _nominatimCache = {};

/* ── Complete Nigerian location list for instant suggestions ─── */
const _NIGERIA = [
  /* States & capitals */
  'Abuja','Abeokuta','Ado-Ekiti','Akure','Asaba','Awka','Bauchi',
  'Benin City','Calabar','Damaturu','Dutse','Enugu','Gombe','Gusau',
  'Ibadan','Ilorin','Jalingo','Jos','Kaduna','Kano','Katsina',
  'Kebbi','Lafia','Lagos','Lokoja','Maiduguri','Makurdi','Minna',
  'Nnewi','Ogbomosho','Onitsha','Osogbo','Owerri','Oyo',
  'Port Harcourt','Sokoto','Umuahia','Uyo','Warri','Yenagoa','Yola',
  /* Lagos areas */
  'Lagos Island','Lagos Mainland','Victoria Island','Lekki',
  'Lekki Phase 1','Lekki Phase 2','Lekki Phase 3','Ajah','Sangotedo',
  'Ikate','Chevron','Ikeja','Ikeja GRA','Maryland','Magodo',
  'Ojodu','Ojota','Gbagada','Surulere','Yaba','Shomolu','Bariga',
  'Ebute-Metta','Festac','Oshodi','Isolo','Mushin','Ikorodu',
  'Badagry','Epe','Alagbado','Ojuelegba','Ilupeju','Palmgrove',
  'Agidingbi','Oregun','Ogba','Ifako-Ijaiye','Agege','Dopemu',
  'Alimosho','Egbeda','Idimu','Iba','Amuwo-Odofin','Satellite Town',
  'Apapa','Orile','Mile 2','Mile 12','Ketu','Alapere','Ogudu',
  'Onipanu','Anthony Village','Pedro','Igbobi','Fadeyi','Iwaya',
  /* Abuja areas */
  'Garki','Wuse','Wuse 2','Maitama','Asokoro','Gwarinpa','Kubwa',
  'Lugbe','Jabi','Utako','Kado','Katampe','Lokogoma','Nyanya',
  'Karu','Gwagwalada','Bwari','Dawaki','Gudu','Apo','Galadimawa',
  /* Other major cities */
  'Trans Amadi','GRA Port Harcourt','Old GRA','New GRA',
  'Rumuola','Rumuokoro','Rumuigbo','Eleme',
  'Bodija','New Bodija','Ring Road Ibadan','Dugbe','Mokola',
  'Achara Layout','Independence Layout','GRA Enugu',
  'New Haven','Coal Camp',
  'Barnawa Kaduna','Kawo','Rigasa','Tudun Wada',
  'Fagge Kano','Nassarawa Kano','Gwale','Dala',
  'Sabon Gari Kano',
];

/* ── Instant match from local list ──────────────────────────── */
function _instant(query) {
  const q = query.toLowerCase();
  return _NIGERIA
    .filter(c => c.toLowerCase().startsWith(q))           /* starts-with first */
    .concat(_NIGERIA.filter(c => {
      const cl = c.toLowerCase();
      return !cl.startsWith(q) && cl.includes(q);         /* then contains */
    }))
    .slice(0, 6)
    .map(label => ({ label, lat: null, lon: null, instant: true }));
}

/* ── Nominatim fetch ─────────────────────────────────────────── */
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

    /* Deduplicate */
    const seen = new Set();
    const unique = results.filter(r => {
      if (seen.has(r.label)) return false;
      seen.add(r.label); return true;
    });

    /* Fallback to instant list if Nominatim returned nothing useful */
    const out = unique.length ? unique : _instant(query);
    _nominatimCache[query] = out;
    return out;
  } catch (e) {
    console.warn('[Location] Nominatim failed, using local list:', e.message);
    return _instant(query);
  }
}

/* ── Render dropdown ─────────────────────────────────────────── */
function _render(results, dropdown, input, onSelect) {
  if (!dropdown) return;
  dropdown.innerHTML = '';

  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'location-suggestion-item location-suggestion-empty';
    empty.textContent = 'No locations found';
    dropdown.appendChild(empty);
    dropdown.style.display = 'block';
    return;
  }

  results.forEach(r => {
    const item = document.createElement('div');
    item.className = 'location-suggestion-item' + (r.instant ? ' loc-item-instant' : '');

    /* Pin icon */
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'loc-sug-icon');
    icon.setAttribute('width', '11');
    icon.setAttribute('height', '11');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke-width', '2.5');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.innerHTML = '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>';

    /* Label */
    const label = document.createElement('span');
    label.className = 'loc-sug-label';
    label.textContent = r.label;

    item.appendChild(icon);
    item.appendChild(label);

    item.addEventListener('mousedown', e => {
      e.preventDefault();   /* prevent blur before click */
      input.value = r.label;
      if (r.lat) { input.dataset.lat = r.lat; input.dataset.lon = r.lon; }
      else { delete input.dataset.lat; delete input.dataset.lon; }
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
      if (typeof onSelect === 'function') onSelect(r);
    });

    dropdown.appendChild(item);
  });

  dropdown.style.display = 'block';
}

/* ── Reverse geocode ─────────────────────────────────────────── */
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
  } catch (e) { return null; }
}

/* ── GPS button HTML ─────────────────────────────────────────── */
function _gpsBtnHTML() {
  /* Pill with crosshair icon + label. CSS hides the label in search bars. */
  return '<button type="button" class="loc-gps-btn" title="Use my location" aria-label="Use my location">'
    + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
    + '<circle cx="12" cy="12" r="3"/>'
    + '<path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>'
    + '<circle cx="12" cy="12" r="9"/>'
    + '</svg>'
    + '<span class="loc-gps-btn-label">Use location</span>'
    + '</button>';
}

/* ── GPS detect ──────────────────────────────────────────────── */
function _gps(input, dropdown, btn, onSelect) {
  if (!navigator.geolocation) {
    showToast('GPS is not available in this browser.');
    return;
  }
  const origHTML = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="loc-btn-spinner"></span><span class="loc-gps-btn-label"> Detecting…</span>';
  }
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const result = await _reverse(lat, lon);
      if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
      if (result) {
        input.value = result.label;
        input.dataset.lat = result.lat;
        input.dataset.lon = result.lon;
        if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }
        if (typeof onSelect === 'function') onSelect(result);
        showToast('📍 ' + result.label);
      } else {
        input.value = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        showToast('Location detected.');
      }
    },
    err => {
      if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
      const msgs = {
        1: 'Location access denied. Allow it in your browser settings and try again.',
        2: 'Could not detect your location. Please type it manually.',
        3: 'Location detection timed out. Please type your location.',
      };
      showToast(msgs[err.code] || 'Location detection failed.');
    },
    { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false }
  );
}

/* ── Public API ──────────────────────────────────────────────── */
/**
 * Attach autocomplete + GPS to a location input.
 *
 * @param {object} cfg
 *   cfg.inputId    — id of the <input>
 *   cfg.dropdownId — id of the suggestions <div>
 *   cfg.gps        — show GPS button (default true)
 *   cfg.onSelect   — callback({ label, lat, lon }) on pick
 *   cfg.onChange   — callback(value) on every keystroke
 */
function initLocationInput(cfg) {
  const input    = document.getElementById(cfg.inputId);
  const dropdown = document.getElementById(cfg.dropdownId);
  if (!input) return;

  const useGps = cfg.gps !== false;

  /* Inject GPS button once */
  let btn = null;
  if (useGps && !input.parentElement.querySelector('.loc-gps-btn')) {
    input.insertAdjacentHTML('afterend', _gpsBtnHTML());
  }
  if (useGps) {
    btn = input.parentElement.querySelector('.loc-gps-btn');
    if (btn) btn.addEventListener('click', () => _gps(input, dropdown, btn, cfg.onSelect));
  }

  /* Typing handler */
  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (typeof cfg.onChange === 'function') cfg.onChange(val);

    clearTimeout(_debounceTimers[cfg.inputId]);

    if (!val) {
      if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }
      return;
    }

    /* 1 char: show instant local suggestions immediately (no network) */
    if (val.length === 1) {
      const instant = _instant(val);
      if (dropdown) _render(instant, dropdown, input, cfg.onSelect);
      return;
    }

    /* 2+ chars: show instant results right away, then replace with Nominatim */
    const instant = _instant(val);
    if (dropdown && instant.length) _render(instant, dropdown, input, cfg.onSelect);

    /* Debounce the real API call — 350ms keeps us within Nominatim's 1 req/sec */
    _debounceTimers[cfg.inputId] = setTimeout(async () => {
      const results = await _nominatim(val);
      /* Only update if input value hasn't changed while we were fetching */
      if (input.value.trim() === val && dropdown) {
        _render(results, dropdown, input, cfg.onSelect);
      }
    }, 350);
  });

  /* Hide on blur */
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (dropdown) { dropdown.style.display = 'none'; }
    }, 200);
  });

  /* Escape key */
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dropdown) {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
    }
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
  if (!q) { dropdown.style.display = 'none'; return; }

  /* Instant first */
  if (q.length === 1) {
    _render(_instant(q), dropdown, input, null);
    return;
  }
  /* Show instant then replace with Nominatim */
  _render(_instant(q), dropdown, input, null);
  clearTimeout(_debounceTimers[containerId]);
  _debounceTimers[containerId] = setTimeout(async () => {
    if (input.value.trim() === q) {
      _render(await _nominatim(q), dropdown, input, null);
    }
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

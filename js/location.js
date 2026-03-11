/* ============================================================
   STREET TASKER — location.js  (Sprint 3.5 v2)
   Location autocomplete using Nominatim (OpenStreetMap, free)
   + optional mini-map picker via Leaflet
   ============================================================ */
'use strict';

/* ── Nigerian fallback list (instant, offline) ─────────────── */
const NG_CITIES = [
  'Abuja, FCT','Abeokuta, Ogun','Ado-Ekiti, Ekiti','Akure, Ondo','Asaba, Delta',
  'Awka, Anambra','Bauchi, Bauchi','Benin City, Edo','Calabar, Cross River',
  'Enugu, Enugu','Ibadan, Oyo','Ilorin, Kwara','Jos, Plateau','Kaduna, Kaduna',
  'Kano, Kano','Katsina, Katsina','Lagos Island, Lagos','Lekki Phase 1, Lagos',
  'Lekki Phase 2, Lagos','Lekki, Lagos','Lokoja, Kogi','Maiduguri, Borno',
  'Makurdi, Benue','Minna, Niger','Onitsha, Anambra','Owerri, Imo',
  'Port Harcourt, Rivers','Sokoto, Sokoto','Surulere, Lagos','Uyo, Akwa Ibom',
  'Victoria Island, Lagos','Warri, Delta','Yaba, Lagos','Yenagoa, Bayelsa',
  'Ikeja, Lagos','Gbagada, Lagos','Ojota, Lagos','Maryland, Lagos',
  'Ajah, Lagos','Festac, Lagos','Isolo, Lagos','Mushin, Lagos',
  'Ikorodu, Lagos','Epe, Lagos','Badagry, Lagos','Agege, Lagos',
  'Alimosho, Lagos','Oshodi, Lagos','Shomolu, Lagos','Bariga, Lagos',
  'Magodo, Lagos','Ojodu, Lagos','Alagbado, Lagos','Ifako-Ijaiye, Lagos',
  'Kosofe, Lagos','Somolu, Lagos','Ibeju-Lekki, Lagos',
];

let _nominatimDebounce = null;
let _activeContainer = null;

/* ── Close suggestions when clicking outside ─────────────────── */
document.addEventListener('click', (e) => {
  if (_activeContainer && !_activeContainer.contains(e.target)) {
    _activeContainer.innerHTML = '';
    _activeContainer.style.display = 'none';
    _activeContainer = null;
  }
});

/* ── Main entry point ─────────────────────────────────────────── */
async function fetchLocationSuggestions(query, containerId, inputId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const q = (query || '').trim();
  if (q.length < 2) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  _activeContainer = container;

  /* Instant local matches first */
  const local = NG_CITIES.filter(c => c.toLowerCase().includes(q.toLowerCase())).slice(0, 5);

  /* Show local results immediately */
  if (local.length) {
    renderSuggestions(local.map(l => ({ display: l, value: l, lat: null, lon: null })), container, inputId);
  }

  /* Then fetch from Nominatim for real geocoded results */
  clearTimeout(_nominatimDebounce);
  _nominatimDebounce = setTimeout(async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ' Nigeria')}&format=json&limit=5&addressdetails=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      if (!res.ok) return;
      const results = await res.json();
      if (!results.length) return;

      const items = results.map(r => {
        const parts = [r.address?.suburb || r.address?.neighbourhood, r.address?.city || r.address?.town || r.address?.village, r.address?.state];
        const display = parts.filter(Boolean).join(', ') || r.display_name.split(',').slice(0, 2).join(',').trim();
        return { display, value: display, lat: parseFloat(r.lat), lon: parseFloat(r.lon) };
      });

      /* Merge with local, dedupe */
      const seen = new Set(local.map(l => l.toLowerCase()));
      const merged = [
        ...local.map(l => ({ display: l, value: l, lat: null, lon: null })),
        ...items.filter(i => !seen.has(i.display.toLowerCase())),
      ].slice(0, 7);

      renderSuggestions(merged, container, inputId);
    } catch (e) { /* Nominatim unavailable — local results already shown */ }
  }, 350);
}

function renderSuggestions(items, container, inputId) {
  if (!items.length) { container.style.display = 'none'; return; }
  container.innerHTML = items.map((item, i) =>
    `<div class="location-suggestion-item" data-idx="${i}" onmousedown="selectLocationSuggestion(event,'${inputId}','${item.value.replace(/'/g,"\\'")}',${item.lat||'null'},${item.lon||'null'},'${(container.id||'').replace(/'/g,"\\'")}')">${item.display}</div>`
  ).join('');
  container.style.display = 'block';
}

function selectLocationSuggestion(event, inputId, value, lat, lon, containerId) {
  event.preventDefault();
  const input = document.getElementById(inputId);
  if (input) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const container = document.getElementById(containerId);
  if (container) { container.innerHTML = ''; container.style.display = 'none'; }

  /* Store lat/lon as data attributes for later use */
  if (lat && lon && input) {
    input.dataset.lat = lat;
    input.dataset.lon = lon;
  }

  /* Update map if open */
  if (lat && lon && window._locationMap) {
    window._locationMap.setView([lat, lon], 14);
    if (window._locationMapMarker) window._locationMapMarker.setLatLng([lat, lon]);
  }
}

/* ── Mini Map Picker ─────────────────────────────────────────── */
function openMapPicker(inputId, mapContainerId) {
  const mapEl = document.getElementById(mapContainerId);
  if (!mapEl) return;

  const isVisible = mapEl.style.display !== 'none';
  if (isVisible) {
    mapEl.style.display = 'none';
    if (window._locationMap) { window._locationMap.remove(); window._locationMap = null; }
    return;
  }

  mapEl.style.display = 'block';

  /* Default to Lagos if no coords */
  const input = document.getElementById(inputId);
  const lat = parseFloat(input?.dataset?.lat) || 6.5244;
  const lon = parseFloat(input?.dataset?.lon) || 3.3792;

  /* Load Leaflet dynamically if not already loaded */
  if (!window.L) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => initMap(lat, lon, inputId, mapContainerId);
    document.head.appendChild(script);
  } else {
    initMap(lat, lon, inputId, mapContainerId);
  }
}

function initMap(lat, lon, inputId, mapContainerId) {
  if (window._locationMap) { window._locationMap.remove(); window._locationMap = null; }

  const map = L.map(mapContainerId).setView([lat, lon], 13);
  window._locationMap = map;

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(map);

  const marker = L.marker([lat, lon], { draggable: true }).addTo(map);
  window._locationMapMarker = marker;

  async function updateFromLatLon(newLat, newLon) {
    marker.setLatLng([newLat, newLon]);
    const input = document.getElementById(inputId);
    if (input) {
      input.dataset.lat = newLat;
      input.dataset.lon = newLon;
      /* Reverse geocode */
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${newLat}&lon=${newLon}&format=json`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        const data = await res.json();
        const addr = data.address;
        const loc = [addr?.suburb || addr?.neighbourhood, addr?.city || addr?.town || addr?.village, addr?.state].filter(Boolean).join(', ');
        if (loc) { input.value = loc; input.dispatchEvent(new Event('input', { bubbles: true })); }
      } catch(e) {}
    }
  }

  marker.on('dragend', (e) => {
    const pos = e.target.getLatLng();
    updateFromLatLon(pos.lat, pos.lng);
  });

  map.on('click', (e) => {
    updateFromLatLon(e.latlng.lat, e.latlng.lng);
  });

  setTimeout(() => map.invalidateSize(), 100);
}

window.fetchLocationSuggestions = fetchLocationSuggestions;
window.selectLocationSuggestion = selectLocationSuggestion;
window.openMapPicker = openMapPicker;

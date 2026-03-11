/* ============================================================
   STREET TASKER — location.js
   Simple location suggestions for Nigerian cities
   ============================================================ */
'use strict';

const NIGERIAN_LOCATIONS = [
  'Abuja', 'Abeokuta', 'Ado-Ekiti', 'Akure', 'Asaba', 'Awka', 'Bauchi',
  'Benin City', 'Calabar', 'Dutse', 'Enugu', 'Gusau', 'Ibadan', 'Ido',
  'Ilorin', 'Jos', 'Kaduna', 'Kano', 'Katsina', 'Lafia', 'Lagos',
  'Lagos Island', 'Lekki', 'Lekki Phase 1', 'Lekki Phase 2',
  'Lokoja', 'Maiduguri', 'Makurdi', 'Minna', 'Nnewi', 'Ogbomosho',
  'Onitsha', 'Osogbo', 'Owerri', 'Oyo', 'Port Harcourt', 'Sokoto',
  'Umuahia', 'Uyo', 'Victoria Island', 'Warri', 'Yenagoa', 'Yola',
  'Alagbado', 'Ajah', 'Surulere', 'Ikeja', 'Magodo', 'Ojodu', 'Ojota',
  'Gbagada', 'Maryland', 'Yaba', 'Ebute-Metta', 'Festac', 'Oshodi',
  'Isolo', 'Mushin', 'Shomolu', 'Bariga', 'Ikorodu', 'Epe', 'Badagry',
];

function fetchLocationSuggestions(query, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const q = (query || '').trim().toLowerCase();
  if (q.length < 2) { container.innerHTML = ''; container.style.display = 'none'; return; }

  const matches = NIGERIAN_LOCATIONS.filter(loc => loc.toLowerCase().includes(q)).slice(0, 6);
  if (!matches.length) { container.innerHTML = ''; container.style.display = 'none'; return; }

  container.innerHTML = matches.map(loc =>
    `<div class="location-suggestion-item" onclick="selectLocationSuggestion('${loc}','${containerId}')">${loc}</div>`
  ).join('');
  container.style.display = 'block';
}

function selectLocationSuggestion(value, containerId) {
  const container = document.getElementById(containerId);
  // Find the input associated with this suggestion container
  if (container) {
    const input = container.previousElementSibling;
    if (input && (input.tagName === 'INPUT' || input.tagName === 'DIV')) {
      // Try to find actual input
      const actualInput = input.tagName === 'INPUT' ? input : input.querySelector('input');
      if (actualInput) actualInput.value = value;
    }
    container.innerHTML = '';
    container.style.display = 'none';
  }
}

window.fetchLocationSuggestions = fetchLocationSuggestions;
window.selectLocationSuggestion = selectLocationSuggestion;

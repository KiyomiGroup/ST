/* ============================================================
   StreetTasker — post-service-ui.js
   Post a Service page: header progress (desktop pill + mobile bar)
   the Service Basics section (category chips, valid check)
   Pricing & Rate (charging unit) and Location (Use Current)
   and About (availability, specialty tags).
   Step 1 of 2 fills 0 to 50% as the five required fields are completed.
   Step 2 (the verify prompt) shows 75%.
   ============================================================ */
(function () {
  'use strict';

  var STEP1_MAX = 50;
  var STEP2_PCT = 75;

  function el(id) { return document.getElementById(id); }
  function val(id) { var n = el(id); return n ? String(n.value || '') : ''; }

  function countFilled() {
    var done = 0;
    if (val('svcName').trim()) done++;
    if (val('svcCategory')) done++;
    if (parseFloat(val('svcPrice')) > 0) done++;
    if (val('svcLocation').trim()) done++;
    if (val('svcDescription').trim().length >= 20) done++;
    return done;
  }

  function render(step, pct) {
    var numD  = el('psStepNumDesktop');
    var nameD = el('psStepNameDesktop');
    var fillD = el('psProgressFillDesktop');
    var lblM  = el('psStepLabelMobile');
    var pctM  = el('psProgressPctMobile');
    var fillM = el('psProgressFillMobile');
    if (numD)  numD.textContent  = step + ' of 2';
    if (nameD) nameD.textContent = step === 1 ? 'Create Service Listing' : 'Verify Identity';
    if (lblM)  lblM.textContent  = 'Step ' + step + ' of 2 \u2022 ' + (step === 1 ? 'Service Details' : 'Verify Identity');
    if (pctM)  pctM.textContent  = pct + '%';
    if (fillD) fillD.style.width = pct + '%';
    if (fillM) fillM.style.width = pct + '%';
  }

  function currentStep() {
    var vp = el('verifyPrompt');
    return vp && vp.style.display && vp.style.display !== 'none' ? 2 : 1;
  }

  /* ── Service Basics: chips follow the select, name shows a check once filled ── */
  function syncBasics() {
    var cat = el('svcCategory');
    var chips = document.querySelectorAll('#svcChips .pt-chip');
    for (var i = 0; i < chips.length; i++) {
      var on = !!cat && cat.value === chips[i].getAttribute('data-category');
      chips[i].classList.toggle('is-active', on);
      chips[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var unit = el('svcRateUnit');
    var radios = document.querySelectorAll('#rateUnits input[type="radio"]');
    for (var r = 0; r < radios.length; r++) radios[r].checked = !!unit && radios[r].value === unit.value;
    syncAvailability();
    if (specInput && document.activeElement !== specInput) renderTags(false);
    var nameField = el('svcNameField');
    if (nameField) nameField.classList.toggle('is-valid', val('svcName').trim().length > 0);
  }

  function update() {
    syncBasics();
    if (currentStep() === 2) { render(2, STEP2_PCT); return; }
    render(1, Math.round(countFilled() / 5 * STEP1_MAX));
  }

  window.psUpdateProgress = update;

  /* Charging unit: radios write into the hidden #svcRateUnit the save code reads */
  var unitWrap = el('rateUnits');
  var unitInput = el('svcRateUnit');
  if (unitWrap && unitInput) {
    unitWrap.addEventListener('change', function (e) {
      if (!e.target || e.target.name !== 'rateUnit') return;
      unitInput.value = e.target.value;
      unitInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  var chipWrap = el('svcChips');
  var catSelect = el('svcCategory');
  if (chipWrap && catSelect) {
    chipWrap.addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.pt-chip') : null;
      if (!chip) return;
      catSelect.value = chip.getAttribute('data-category');
      catSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    catSelect.addEventListener('change', function () {
      if (typeof window.onCategoryChange === 'function') window.onCategoryChange(catSelect.value);
    });
  }


  /* ── Location: "Use Current" fills #svcLocation from GPS (same flow as Post a Task) ── */
  var locInput = el('svcLocation');
  var locBtns = document.querySelectorAll('[data-use-location]');
  function toast(msg) { if (typeof window.showToast === 'function') window.showToast(msg); }
  function setBtns(disabled) { for (var b = 0; b < locBtns.length; b++) locBtns[b].disabled = disabled; }
  function useCurrentLocation() {
    if (!locInput) return;
    if (!navigator.geolocation) { toast('GPS not available on this device.'); return; }
    setBtns(true);
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lon = pos.coords.longitude;
      var done = function (label, rLat, rLon, precise) {
        locInput.value = label;
        locInput.dataset.lat = rLat; locInput.dataset.lon = rLon; locInput.dataset.precise = precise ? '1' : '0';
        setBtns(false);
        locInput.dispatchEvent(new Event('input', { bubbles: true }));
        locInput.dispatchEvent(new Event('change', { bubbles: true }));
      };
      var fallback = function () { done(lat.toFixed(5) + ', ' + lon.toFixed(5), lat, lon, true); };
      if (typeof window._reverse === 'function') {
        Promise.resolve(window._reverse(lat, lon)).then(function (r) {
          if (r) done(r.label, r.lat, r.lon, r.precise); else fallback();
        }, fallback);
      } else { fallback(); }
    }, function (err) {
      setBtns(false);
      var msgs = { 1: 'Location permission denied. Please type your address.', 2: 'Could not detect your location.', 3: 'Location request timed out.' };
      toast(msgs[err.code] || 'GPS failed. Please type your address.');
    }, { timeout: 15000, maximumAge: 0, enableHighAccuracy: true });
  }
  for (var lb = 0; lb < locBtns.length; lb++) locBtns[lb].addEventListener('click', useCurrentLocation);


  /* ── About: availability radios follow/write the hidden #svcAvailability ── */
  var availWrap = el('availOptions');
  var availInput = el('svcAvailability');
  if (availWrap && availInput) {
    availWrap.addEventListener('change', function (e) {
      if (!e.target || e.target.name !== 'availability') return;
      availInput.value = e.target.value;
      availInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  function syncAvailability() {
    if (!availInput) return;
    var radios = document.querySelectorAll('#availOptions input[type="radio"]');
    for (var a = 0; a < radios.length; a++) radios[a].checked = radios[a].value === availInput.value;
  }

  /* ── Specialties: #svcSpecialties stays the comma-separated source the save code reads;
        tags are drawn from it. The part still being typed is not tagged until you
        type a comma, press Enter or leave the field. ── */
  var specInput = el('svcSpecialties');
  var specTags = el('specTags');
  function specItems(skipLast) {
    var parts = String(specInput.value || '').split(',');
    if (skipLast) parts.pop();
    var seen = {}, out = [];
    for (var s = 0; s < parts.length; s++) {
      var t = parts[s].trim(), k = t.toLowerCase();
      if (t && !seen[k]) { seen[k] = true; out.push(t); }
    }
    return out;
  }
  function renderTags(skipLast) {
    if (!specInput || !specTags) return;
    specTags.textContent = '';
    var items = specItems(skipLast);
    for (var i = 0; i < items.length; i++) {
      var tag = document.createElement('span');
      tag.className = 'ps-tag';
      tag.appendChild(document.createTextNode(items[i]));
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'ps-tag-x'; x.setAttribute('aria-label', 'Remove ' + items[i]);
      x.setAttribute('data-spec', items[i]);
      x.innerHTML = '<svg class="pt-i" aria-hidden="true"><use href="#i-x"/></svg>';
      tag.appendChild(x);
      specTags.appendChild(tag);
    }
  }
  if (specInput && specTags) {
    specInput.addEventListener('input', function () { renderTags(true); });
    specInput.addEventListener('blur', function () {
      var items = specItems(false);
      specInput.value = items.join(', ');
      renderTags(false);
    });
    specInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var items = specItems(false);
      specInput.value = items.length ? items.join(', ') + ', ' : '';
      renderTags(false);
    });
    specTags.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.ps-tag-x') : null;
      if (!btn) return;
      var drop = btn.getAttribute('data-spec').toLowerCase();
      specInput.value = specItems(false).filter(function (t) { return t.toLowerCase() !== drop; }).join(', ');
      renderTags(false);
      specInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  var form = el('serviceForm');
  if (form) {
    form.addEventListener('input', update);
    form.addEventListener('change', update);
  }

  /* The save flow reveals #verifyPrompt; follow it without touching that code */
  var vp = el('verifyPrompt');
  if (vp && window.MutationObserver) {
    new MutationObserver(update).observe(vp, { attributes: true, attributeFilter: ['style'] });
  }

  update();
})();

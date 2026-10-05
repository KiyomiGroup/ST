/* ============================================================
   StreetTasker — post-service-ui.js
   Post a Service page: header progress (desktop pill + mobile bar).
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

  function update() {
    if (currentStep() === 2) { render(2, STEP2_PCT); return; }
    render(1, Math.round(countFilled() / 5 * STEP1_MAX));
  }

  window.psUpdateProgress = update;

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

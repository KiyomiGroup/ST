/* Coordinator application form. Sends the answers to the coordinator-apply Edge Function, which emails the admin. */
(function () {
  'use strict';
  var form = document.getElementById('coaForm');
  if (!form) return;
  var page = document.getElementById('coaPage');
  var errBox = document.getElementById('coaError');
  var btn = document.getElementById('coaSubmit');
  var FN_URL = 'https://ftoiqbacutnbjnztguts.supabase.co/functions/v1/coordinator-apply';
  var PHONE_RE = /^\+?[0-9][0-9 ()-]{6,19}$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function showError(msg) {
    errBox.textContent = msg;
    errBox.classList.add('is-visible');
    errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function val(name) { var el = form.elements[name]; return el && el.value ? el.value.trim() : ''; }
  function radio(name) { var el = form.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ''; }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errBox.classList.remove('is-visible');
    if (val('website')) return; /* honeypot */

    var trades = Array.prototype.map.call(form.querySelectorAll('input[name="trades"]:checked'), function (c) { return c.value; });
    var data = {
      full_name: val('full_name'), email: val('email'), phone: val('phone'), whatsapp: val('whatsapp'),
      age_range: val('age_range'), occupation: val('occupation'),
      state: val('state'), city: val('city'), areas: val('areas'), years_in_area: val('years_in_area'),
      trades: trades, tasker_count: val('tasker_count'), area_sqm: val('area_sqm'), how_you_know: val('how_you_know'),
      can_meet_taskers: radio('can_meet_taskers'), can_explain: radio('can_explain'), explain_text: val('explain_text'),
      experience: val('experience'), hours: val('hours'), languages: val('languages'),
      smartphone: radio('smartphone'), has_id: radio('has_id'),
      why: val('why'), heard: val('heard'), social: val('social'),
      ref_name: val('ref_name'), ref_phone: val('ref_phone'), notes: val('notes')
    };

    var required = ['full_name', 'email', 'phone', 'age_range', 'occupation', 'state', 'city', 'areas', 'years_in_area', 'tasker_count', 'area_sqm', 'how_you_know', 'can_meet_taskers', 'can_explain', 'experience', 'hours', 'languages', 'smartphone', 'has_id', 'why'];
    for (var i = 0; i < required.length; i++) {
      if (!data[required[i]]) return showError('Please answer every question marked with a star.');
    }
    var nTaskers = Number(data.tasker_count), nArea = Number(data.area_sqm);
    if (!/^\d+$/.test(data.tasker_count) || nTaskers < 1 || nTaskers > 10000) return showError('Please enter how many Local Taskers you can bring, as a whole number from 1 to 10,000.');
    if (!/^\d+$/.test(data.area_sqm) || nArea < 1 || nArea > 100000000) return showError('Please enter the area you would cover in square metres, as a whole number.');
    if (data.can_explain === 'Yes' && !data.explain_text) return showError('Please write in your own words what a Local Tasker is.');
    data.tasker_count = nTaskers; data.area_sqm = nArea;
    data.can_meet_taskers = data.can_meet_taskers === 'Yes'; data.can_explain = data.can_explain === 'Yes';
    if (!trades.length) return showError('Please choose at least one skill or trade you know people in.');
    if (!EMAIL_RE.test(data.email)) return showError('Please enter a valid email address.');
    if (!PHONE_RE.test(data.phone) || (data.whatsapp && !PHONE_RE.test(data.whatsapp))) return showError('Please enter a valid phone number.');
    if (data.age_range === 'Under 18') return showError('Coordinators must be 18 or older.');
    if (!form.elements.consent_checks.checked || !form.elements.consent_data.checked) return showError('Please tick both boxes at the bottom to continue.');
    data.consent = true;

    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = 'Sending...';
    try {
      var key = typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '';
      var res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': 'Bearer ' + key },
        body: JSON.stringify(data)
      });
      var out = await res.json().catch(function () { return {}; });
      if (!res.ok || !out.ok) throw new Error(out.message || 'Something went wrong. Please try again.');
      page.classList.add('is-sent');
      var ok = document.getElementById('coaSuccess');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (ok) ok.focus();
    } catch (err) {
      showError(err && err.message ? err.message : 'Something went wrong. Please try again.');
      btn.disabled = false;
      btn.textContent = label;
    }
  });
})();

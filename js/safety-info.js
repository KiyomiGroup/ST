/* StreetTasker Safety Reminder: the info icon (messages.html). Opens a sheet that explains held payments, disputes,
   clearing (taskers) and the permanent ban. The text for each role is already in the page; this only shows the right one
   and opens/closes the sheet. No data is read or written. */
(function () {
  'use strict';
  var btn = document.getElementById('jrSafetyInfoBtn');
  var layer = document.getElementById('jrSafetyInfoLayer');
  if (!btn || !layer) return;
  var closeBtn = document.getElementById('jrSafetyInfoClose');
  var backdrop = document.getElementById('jrSafetyInfoBackdrop');

  window.stSafetyInfoRole = function (role) {
    var r = role === 'tasker' ? 'tasker' : 'customer';
    layer.querySelectorAll('[data-safety-info]').forEach(function (n) { n.hidden = n.getAttribute('data-safety-info') !== r; });
  };

  function open() { layer.hidden = false; btn.setAttribute('aria-expanded', 'true'); if (closeBtn) closeBtn.focus(); }
  function close() { layer.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.focus(); }

  btn.addEventListener('click', function () { if (layer.hidden) open(); else close(); });
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (backdrop) backdrop.addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !layer.hidden) close(); });
})();

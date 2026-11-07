/* Tasker profile: promotional flyer dialog (Stage 4).
   The hero button (#tpFlyerBtn, owner only, shown by js/tasker-profile.js) opens a dialog with a preview and three downloads:
   A5 PDF, A4 PDF (browser print -> Save as PDF, STFlyer.print) and PNG (STFlyer.png).
   Data comes from window.STProfileFlyer.prepare() (js/tasker-profile.js -> js/flyer-data.js). Reads nothing else, writes nothing.
   Needs: js/flyer-template.js, js/vendor/html-to-image.min.js, js/flyer-data.js, js/tasker-profile.js (load this one after it). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var btn = $('tpFlyerBtn'), dlg = $('tpFlyerDialog');
  if (!btn || !dlg || typeof dlg.showModal !== 'function') return;

  var host = $('tpFlyerHost'), msg = $('tpFlyerMsg'), actions = $('tpFlyerActions'), help = $('tpFlyerHelp'), pngBtn = $('tpFlyerPng');
  var PNG_LABEL = pngBtn.textContent;
  var current = null, data = null, token = 0, pngBusy = false;

  function say(text) { msg.textContent = text || ''; msg.hidden = !text; }

  function previewWidth() { return Math.max(200, Math.min(host.clientWidth - 24, 420)); }
  function draw() {
    var f = current = STFlyer.render(host, data);
    STFlyer.setWidth(f.el, previewWidth());
    f.ready.then(function () { if (f === current) STFlyer.refit(f.el); });   /* text wraps differently at phone size */
  }

  async function open() {
    var mine = ++token;
    current = null; data = null; host.textContent = ''; actions.hidden = true; help.hidden = true;
    say('Getting your flyer ready…');
    if (!dlg.open) dlg.showModal();
    var r;
    try { r = await window.STProfileFlyer.prepare(); }
    catch (e) { r = { ok: false, message: 'We could not get your flyer ready. Please try again in a moment.' }; }
    if (mine !== token || !dlg.open) return;   /* closed or reopened while waiting */
    if (!r.ok) { say(r.message || 'Your flyer is not available right now.'); return; }
    data = r.data; say(''); draw();
    actions.hidden = false; help.hidden = false;
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }
  function fileName() {
    var base = String((data && data.name) || 'tasker').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tasker';
    return 'streettasker-flyer-' + base + '.png';
  }

  async function makePng() {
    if (!data || pngBusy) return;
    pngBusy = true; pngBtn.disabled = true; pngBtn.textContent = 'Making your picture…'; say('');
    try {
      var res = await STFlyer.png(data);
      download(res.blob, fileName());
      if (res.photoDropped) say('Your picture is ready, but your photo could not be added to it. The PDF downloads include your photo.');
    } catch (e) {
      console.error('[flyer png]', e);
      say('We could not make the picture. Please use one of the PDF downloads instead.');
    } finally {
      pngBusy = false; pngBtn.disabled = false; pngBtn.textContent = PNG_LABEL;
    }
  }

  btn.addEventListener('click', open);
  $('tpFlyerClose').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });   /* click on the backdrop */
  dlg.addEventListener('close', function () { token++; });
  $('tpFlyerA5').addEventListener('click', function () { if (current) STFlyer.print(current.el, 'a5'); });
  $('tpFlyerA4').addEventListener('click', function () { if (current) STFlyer.print(current.el, 'a4'); });
  pngBtn.addEventListener('click', makePng);
  window.addEventListener('resize', function () { if (current && dlg.open) { STFlyer.setWidth(current.el, previewWidth()); STFlyer.refit(current.el); } });
})();

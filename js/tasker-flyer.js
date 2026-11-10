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
  var current = null, data = null, base = null, token = 0, pngBusy = false;
  var photoOverride = null;   /* null = the profile photo; '' = no photo; a data: URL = a photo chosen here */
  var edit = $('tpFlyerEdit'), drawTimer = null;
  var FIELDS = { name: $('tpFlyerName'), prof: $('tpFlyerProf'), loc: $('tpFlyerLoc'), svc: [$('tpFlyerSvc1'), $('tpFlyerSvc2'), $('tpFlyerSvc3')] };
  var PHOTO_MAX = 5 * 1024 * 1024, PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  function say(text) { msg.textContent = text || ''; msg.hidden = !text; }

  function previewWidth() { return Math.max(200, Math.min(host.clientWidth - 24, 420)); }
  function draw() {
    var f = current = STFlyer.render(host, data);
    STFlyer.setWidth(f.el, previewWidth());
    f.ready.then(function () { if (f === current) STFlyer.refit(f.el); });   /* text wraps differently at phone size */
  }

  /* The flyer shows what the form says. Nothing here is saved to the profile. */
  function fillForm() {
    FIELDS.name.value = base.name || ''; FIELDS.prof.value = base.profession || ''; FIELDS.loc.value = base.location || '';
    FIELDS.svc.forEach(function (f, i) { f.value = (base.services && base.services[i]) || ''; });
  }
  function collect() {
    var photo = photoOverride === null ? base.photoUrl : photoOverride;
    data = Object.assign({}, base, {
      name: FIELDS.name.value, profession: FIELDS.prof.value, location: FIELDS.loc.value,
      services: FIELDS.svc.map(function (f) { return f.value; }).filter(function (v) { return v.trim(); }),
      photoUrl: photo
    });
    $('tpFlyerPhotoReset').hidden = photoOverride === null;
    $('tpFlyerPhotoNone').hidden = !(photo);
  }
  function redraw() { collect(); draw(); }
  function redrawSoon() { clearTimeout(drawTimer); drawTimer = setTimeout(redraw, 200); }

  async function open() {
    var mine = ++token;
    current = null; data = null; base = null; photoOverride = null; host.textContent = ''; actions.hidden = true; help.hidden = true; edit.hidden = true;
    say('Getting your flyer ready…');
    if (!dlg.open) dlg.showModal();
    var r;
    try { r = await window.STProfileFlyer.prepare(); }
    catch (e) { r = { ok: false, message: 'We could not get your flyer ready. Please try again in a moment.' }; }
    if (mine !== token || !dlg.open) return;   /* closed or reopened while waiting */
    if (!r.ok) { say(r.message || 'Your flyer is not available right now.'); return; }
    base = r.data; say(''); fillForm(); collect(); draw();
    edit.hidden = false; actions.hidden = false; help.hidden = false;
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

  [FIELDS.name, FIELDS.prof, FIELDS.loc].concat(FIELDS.svc).forEach(function (f) { f.addEventListener('input', redrawSoon); });
  $('tpFlyerPhotoFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (PHOTO_TYPES.indexOf(f.type) === -1) { say('Please choose a JPG, PNG or WebP photo.'); e.target.value = ''; return; }
    if (f.size > PHOTO_MAX) { say('That photo is over 5 MB. Please choose a smaller one.'); e.target.value = ''; return; }
    var rd = new FileReader();
    rd.onload = function () { photoOverride = String(rd.result); say(''); redraw(); };
    rd.onerror = function () { say('We could not read that photo. Please try another.'); };
    rd.readAsDataURL(f);   /* a data: URL works for the print and the PNG download alike */
  });
  $('tpFlyerPhotoNone').addEventListener('click', function () { photoOverride = ''; $('tpFlyerPhotoFile').value = ''; redraw(); });
  $('tpFlyerPhotoReset').addEventListener('click', function () { photoOverride = null; $('tpFlyerPhotoFile').value = ''; redraw(); });
  $('tpFlyerReset').addEventListener('click', function () { photoOverride = null; $('tpFlyerPhotoFile').value = ''; fillForm(); redraw(); });

  btn.addEventListener('click', open);
  $('tpFlyerClose').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });   /* click on the backdrop */
  dlg.addEventListener('close', function () { token++; });
  $('tpFlyerA5').addEventListener('click', function () { if (current) STFlyer.print(current.el, 'a5'); });
  $('tpFlyerA4').addEventListener('click', function () { if (current) STFlyer.print(current.el, 'a4'); });
  pngBtn.addEventListener('click', makePng);
  window.addEventListener('resize', function () { if (current && dlg.open) { STFlyer.setWidth(current.el, previewWidth()); STFlyer.refit(current.el); } });
})();

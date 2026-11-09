/* ============================================================
   StreetTasker — coordinator-flyer.js (Stage T1c)
   The coordinator makes the promotional flyer for a PUBLISHED Local Tasker (for one who has a shop), prints or saves it, and gives it to them.
   It is the normal website flyer: the same template (js/flyer-template.js) and the same A5 / A4 / PNG downloads as the Tasker profile page.
   Reads only (coordinator's own access): local_tasker_profiles, users (public name), services, local_tasker_photos (private bucket, signed link).
   Writes nothing. The QR opens the Local Tasker's public profile: tasker-profile.html?id=<their user id>. No referral code (a Local Tasker has no login).
   Everything typed or read is set by the template with textContent. Needs: js/vendor/qrcode.min.js, js/vendor/html-to-image.min.js,
   js/flyer-template.js, css/flyer.css. Public API: STCoFlyer.mount(profile) (called by js/coordinator-tasker.js after the profile is drawn).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  function $(id) { return document.getElementById(id); }
  var BUCKET = 'local-tasker-photos';
  var current = null, data = null, base = null, token = 0, pngBusy = false, timer = null, taskerId = null;

  function say(t) { var m = $('coFlyerMsg'); m.textContent = t || ''; m.hidden = !t; }
  function width() { var h = $('coFlyerHost'); return Math.max(200, Math.min(h.clientWidth - 24, 420)); }
  function str(v) { return String(v == null ? '' : v).trim(); }

  /* The QR link (the only place it is built). Anyone who scans it lands on the public profile. */
  function qrLink(userId) { return window.location.origin + '/tasker-profile.html?id=' + encodeURIComponent(userId); }

  /* A signed link works for the preview; for the PNG the template fetches it again, so turn it into a data URL here when we can. */
  async function toDataUrl(url) {
    try {
      var r = await fetch(url); if (!r.ok) throw new Error('fetch');
      var b = await r.blob();
      return await new Promise(function (ok, no) { var f = new FileReader(); f.onload = function () { ok(String(f.result)); }; f.onerror = no; f.readAsDataURL(b); });
    } catch (e) { return url; }
  }

  async function photoUrl(id) {
    /* the profile picture first; if there is none yet, the cover portfolio photo; otherwise the template's own placeholder */
    var res = await window.supabase.from('local_tasker_photos').select('storage_path, kind, is_cover, created_at')
      .eq('tasker_user_id', id).is('removed_at', null);
    if (res.error) throw res.error;
    var rows = res.data || [];
    var pick = rows.filter(function (r) { return r.kind === 'avatar'; })[0]
      || rows.filter(function (r) { return r.is_cover; })[0] || rows[0];
    if (!pick) return '';
    var s = await window.supabase.storage.from(BUCKET).createSignedUrl(pick.storage_path, 3600);
    if (s.error || !s.data || !s.data.signedUrl) return '';
    return toDataUrl(s.data.signedUrl);
  }

  /* One read of what the flyer shows: public name, the main service as the job line, up to 3 live services (main first), the place. */
  async function load(id) {
    var pr = await window.supabase.from('local_tasker_profiles').select('tasker_user_id, status, areas_served').eq('tasker_user_id', id).maybeSingle();
    if (pr.error) throw pr.error;
    if (!pr.data) return { ok: false, message: 'This Local Tasker could not be found.' };
    if (pr.data.status !== 'published') {
      return { ok: false, message: 'The flyer is available once this Local Tasker is published, because the QR code opens their public profile. Publish first, then come back.' };
    }
    var ur = await window.supabase.from('users').select('name').eq('id', id).maybeSingle();
    var sv = await window.supabase.from('services').select('service_name, price, location, available, is_main, created_at').eq('user_id', id);
    if (sv.error) throw sv.error;
    var live = (sv.data || []).filter(function (s) { return s.available === true && Number(s.price) > 0; });
    live.sort(function (a, b) {
      if (!!a.is_main !== !!b.is_main) return a.is_main ? -1 : 1;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
    var main = live[0] || null;
    var photo = '';
    try { photo = await photoUrl(id); } catch (e) { console.error('[coordinator flyer photo]', e); }
    return {
      ok: true,
      data: {
        name: str(ur && ur.data && ur.data.name),
        profession: main ? str(main.service_name) : '',
        location: str((main && main.location) || pr.data.areas_served),
        services: live.slice(0, 3).map(function (s) { return str(s.service_name); }),
        photoUrl: photo,
        qrUrl: qrLink(id)
      }
    };
  }

  function draw() {
    var d = Object.assign({}, base, { location: str($('coFlyerAddress').value) || base.location });
    data = d;
    var f = current = window.STFlyer.render($('coFlyerHost'), d);
    window.STFlyer.setWidth(f.el, width());
    f.ready.then(function () { if (f === current) window.STFlyer.refit(f.el); });
  }

  function fileName() {
    var b = String((data && data.name) || 'local-tasker').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'local-tasker';
    return 'streettasker-flyer-' + b + '.png';
  }
  async function makePng() {
    if (!data || pngBusy) return;
    var btn = $('coFlyerPng'), label = btn.textContent;
    pngBusy = true; btn.disabled = true; btn.textContent = 'Making the picture…'; say('');
    try {
      var res = await window.STFlyer.png(data);
      var url = URL.createObjectURL(res.blob), a = document.createElement('a');
      a.href = url; a.download = fileName(); document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      if (res.photoDropped) say('The picture is ready, but the photo could not be added to it. The PDF downloads include the photo.');
    } catch (e) {
      console.error('[coordinator flyer png]', e);
      say('We could not make the picture. Use one of the PDF downloads instead.');
    } finally { pngBusy = false; btn.disabled = false; btn.textContent = label; }
  }

  async function mount(profile) {
    var card = $('coFlyer'); if (!card || !window.STFlyer || !profile) return;
    taskerId = profile.tasker_user_id;
    var mine = ++token;
    card.hidden = false;
    $('coFlyerBody').hidden = true; $('coFlyerHost').textContent = ''; current = null; data = null; base = null;
    say('Getting the flyer ready…');
    var r;
    try { r = await load(taskerId); }
    catch (e) { console.error('[coordinator flyer]', e); r = { ok: false, message: 'We could not get the flyer ready. Reload the page to try again.' }; }
    if (mine !== token) return;
    if (!r.ok) { say(r.message); return; }
    say(''); base = r.data;
    $('coFlyerBody').hidden = false;
    $('coFlyerAddress').value = '';
    $('coFlyerAddress').placeholder = base.location || 'Shop address';
    draw();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var a = $('coFlyerAddress'); if (!a) return;
    a.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { if (base) draw(); }, 250); });
    $('coFlyerA5').addEventListener('click', function () { if (current) window.STFlyer.print(current.el, 'a5'); });
    $('coFlyerA4').addEventListener('click', function () { if (current) window.STFlyer.print(current.el, 'a4'); });
    $('coFlyerPng').addEventListener('click', makePng);
    window.addEventListener('resize', function () { if (current && base) { window.STFlyer.setWidth(current.el, width()); window.STFlyer.refit(current.el); } });
  });

  window.STCoFlyer = { mount: mount };
})();

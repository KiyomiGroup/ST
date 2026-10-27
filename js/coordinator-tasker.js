/* ============================================================
   StreetTasker — coordinator-tasker.js (Stage 4A-1)
   Read-only profile of ONE Local Tasker: coordinator-tasker.html?id=<tasker user id>.
   The id comes from the address bar, so it is only ever a filter on a query that
   RLS (lt_profiles_read / coordinator_manages_tasker) restricts to the signed-in
   coordinator's own taskers. A missing row and a row that is not yours look the
   same on purpose ("not found or not assigned to you").
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  function $(id) { return document.getElementById(id); }
  var last = null;

  function fact(list, label, value, opts) {
    opts = opts || {};
    var dt = C.el('dt', 'co-fact-label', label);
    var dd = C.el('dd', 'co-fact-value');
    if (value == null || value === '') {
      dd.textContent = opts.empty || 'Not recorded';
      dd.classList.add('is-empty');
    } else if (opts.tel) {
      var digits = String(value).replace(/[^0-9+]/g, '');
      var a = C.el('a', 'co-fact-link', String(value));
      a.href = 'tel:' + digits;
      dd.appendChild(a);
    } else {
      dd.textContent = String(value);
    }
    list.appendChild(dt); list.appendChild(dd);
  }

  function show(which) {
    ['coDetailLoading', 'coDetailError', 'coDetailMissing', 'coDetail'].forEach(function (id) {
      var n = $(id); if (n) n.hidden = (id !== which);
    });
  }

  var PURPOSE = { profile: 'Profile created', publish_info: 'Publishing their information', photos: 'Photos', payout: 'Payout details', price_change: 'Price changes', booking_confirmation: 'Booking confirmations' };
  var METHOD = { in_person: 'In person', phone: 'By phone call', written: 'In writing' };

  function showCreated() {
    var q = new URLSearchParams(window.location.search).get('created');
    var box = $('coCreatedBanner'), text = $('coCreatedText');
    if (!box || !text || (q !== '1' && q !== '0')) return;
    text.textContent = q === '1'
      ? 'Local Tasker created. They are a draft: nothing is shown to customers until you publish. Their agreement is recorded below.'
      : 'This Local Tasker was already created by an earlier attempt, so nothing new was added.';
    box.hidden = false;
  }

  function showUpdated() {
    var q = new URLSearchParams(window.location.search).get('updated');
    var box = $('coCreatedBanner'), text = $('coCreatedText');
    if (!box || !text || (q !== '1' && q !== '0')) return;
    text.textContent = q === '1' ? 'Changes saved.' : 'Nothing was changed, so nothing was saved.';
    box.hidden = false;
  }

  function showServiceSaved() {
    var q = new URLSearchParams(window.location.search).get('service_saved');
    var box = $('coCreatedBanner'), text = $('coCreatedText');
    var T = { created: 'Service added. It stays hidden from customers until you publish.', updated: 'Service saved.', none: 'Nothing was changed, so nothing was saved.' };
    if (!box || !text || !T[q]) return;
    text.textContent = T[q]; box.hidden = false;
  }

  var UNIT = { '/job': 'job', '/hour': 'hour', '/day': 'day', '/visit': 'visit', '/session': 'session' };
  function money(n) { var x = Number(n); return isFinite(x) ? '\u20A6' + x.toLocaleString('en-NG', { maximumFractionDigits: 2 }) : ''; }

  function serviceItem(id, s) {
    var li = C.el('li', 'co-svc-item');
    var head = C.el('div', 'co-consent-head');
    head.appendChild(C.el('span', 'co-consent-purpose', s.service_name || 'Service'));
    head.appendChild(C.el('span', s.available === false ? 'co-status co-status--draft' : 'co-status co-status--published', s.available === false ? 'Paused' : 'Active'));
    li.appendChild(head);
    var price = money(s.price);
    var meta = (s.category ? C.statusLabel(s.category) : '') + (price ? (s.category ? ' · ' : '') + price + (UNIT[s.rate_unit] ? ' per ' + UNIT[s.rate_unit] : '') : '');
    if (meta) li.appendChild(C.el('p', 'co-consent-meta', meta));
    if (s.description) li.appendChild(C.el('p', 'co-consent-note', s.description));
    var a = C.el('a', 'co-fact-link', 'Edit service');
    a.href = 'coordinator-service-edit.html?id=' + encodeURIComponent(id) + '&service=' + encodeURIComponent(s.id);
    li.appendChild(a);
    return li;
  }

  /* Services load separately so a problem here can never hide the profile. */
  async function loadServices(id) {
    var list = $('coSvcList');
    ['coSvcLoading', 'coSvcError', 'coSvcEmpty'].forEach(function (x) { $(x).hidden = true; });
    list.hidden = true; list.textContent = '';
    $('coSvcLoading').hidden = false;
    $('coSvcAdd').href = 'coordinator-service-edit.html?id=' + encodeURIComponent(id);
    try {
      var res = await window.supabase.from('services')
        .select('id, service_name, category, price, rate_unit, description, available, created_at')
        .eq('user_id', id)
        .order('created_at', { ascending: true });
      if (res.error) throw res.error;
      $('coSvcLoading').hidden = true;
      var rows = res.data || [];
      if (!rows.length) { $('coSvcEmpty').hidden = false; return; }
      rows.forEach(function (s) { list.appendChild(serviceItem(id, s)); });
      list.hidden = false;
      if (rows.length >= 5) $('coSvcAdd').hidden = true;
    } catch (e) {
      console.error('[coordinator tasker services]', e);
      $('coSvcLoading').hidden = true;
      $('coSvcError').hidden = false;
    }
  }

  /* Photos load separately too (private bucket, short-lived signed links). A problem here never hides the profile. */
  async function loadPhotos(id) {
    var strip = $('coPhotoStrip');
    ['coPhotoLoading', 'coPhotoError', 'coPhotoEmpty', 'coPhotoCount'].forEach(function (x) { $(x).hidden = true; });
    strip.hidden = true; strip.textContent = '';
    $('coPhotoLoading').hidden = false;
    $('coPhotoManage').href = 'coordinator-photos.html?id=' + encodeURIComponent(id);
    try {
      var res = await window.supabase.from('local_tasker_photos')
        .select('id, storage_path, caption, is_cover, created_at')
        .eq('tasker_user_id', id).is('removed_at', null)
        .order('is_cover', { ascending: false }).order('created_at', { ascending: true });
      if (res.error) throw res.error;
      $('coPhotoLoading').hidden = true;
      var rows = (res.data || []).slice().sort(function (a, b) {
        if (!!a.is_cover !== !!b.is_cover) return a.is_cover ? -1 : 1;
        return String(a.created_at || '').localeCompare(String(b.created_at || ''));
      });
      if (!rows.length) { $('coPhotoEmpty').hidden = false; return; }
      $('coPhotoManage').textContent = 'Manage photos';
      var shown = rows.slice(0, 4), map = {};
      try {
        var s = await window.supabase.storage.from('local-tasker-photos').createSignedUrls(shown.map(function (r) { return r.storage_path; }), 3600);
        if (!s.error) (s.data || []).forEach(function (d) { if (d && d.signedUrl && !d.error) map[d.path] = d.signedUrl; });
      } catch (e) { console.error('[coordinator tasker photo links]', e); }
      shown.forEach(function (p, i) {
        var li = C.el('li', 'co-photo-thumb');
        if (map[p.storage_path]) {
          var img = C.el('img'); img.src = map[p.storage_path]; img.alt = p.caption || ('Photo ' + (i + 1)); img.loading = 'lazy'; li.appendChild(img);
        } else {
          li.appendChild(C.el('span', 'co-photo-missing', 'Unavailable'));
        }
        if (p.is_cover) li.appendChild(C.el('span', 'co-status co-status--published co-photo-cover', 'Cover'));
        strip.appendChild(li);
      });
      strip.hidden = false;
      var cnt = $('coPhotoCount');
      cnt.textContent = rows.length + (rows.length === 1 ? ' photo' : ' photos') + ' of 8. Private until you publish.';
      cnt.hidden = false;
    } catch (e) {
      console.error('[coordinator tasker photos]', e);
      $('coPhotoLoading').hidden = true;
      $('coPhotoError').hidden = false;
    }
  }

  function consentItem(c) {
    var li = C.el('li', 'co-consent-item');
    var head = C.el('div', 'co-consent-head');
    head.appendChild(C.el('span', 'co-consent-purpose', PURPOSE[c.purpose] || C.statusLabel(c.purpose)));
    var withdrawn = !!c.revoked_at;
    head.appendChild(C.el('span', withdrawn ? 'co-status co-status--withdrawn' : 'co-status co-status--published', withdrawn ? 'Withdrawn' : 'Active'));
    li.appendChild(head);
    var when = C.formatDate(c.recorded_at);
    li.appendChild(C.el('p', 'co-consent-meta', (METHOD[c.method] || C.statusLabel(c.method)) + (when ? ' · recorded ' + when : '')));
    if (c.evidence_ref) li.appendChild(C.el('p', 'co-consent-note', 'Reference: ' + c.evidence_ref));
    if (c.details) li.appendChild(C.el('p', 'co-consent-note', c.details));
    if (withdrawn) {
      var w = 'Withdrawn ' + C.formatDate(c.revoked_at) + (c.revoke_reason ? ': ' + c.revoke_reason : '');
      li.appendChild(C.el('p', 'co-consent-note', w));
    }
    return li;
  }

  /* The agreement record is read-only and must never block the profile itself. */
  async function loadConsents(id) {
    var list = $('coConsentList');
    ['coConsentLoading', 'coConsentError', 'coConsentEmpty'].forEach(function (x) { $(x).hidden = true; });
    list.hidden = true; list.textContent = '';
    $('coConsentLoading').hidden = false;
    try {
      var res = await window.supabase.from('local_tasker_consents')
        .select('id, purpose, method, recorded_at, evidence_ref, details, revoked_at, revoke_reason')
        .eq('tasker_user_id', id)
        .order('recorded_at', { ascending: false });
      if (res.error) throw res.error;
      $('coConsentLoading').hidden = true;
      var rows = res.data || [];
      if (!rows.length) { $('coConsentEmpty').hidden = false; return; }
      rows.forEach(function (c) { list.appendChild(consentItem(c)); });
      list.hidden = false;
    } catch (e) {
      console.error('[coordinator tasker consents]', e);
      $('coConsentLoading').hidden = true;
      $('coConsentError').hidden = false;
    }
  }

  function paint(p) {
    var name = p.full_name || 'Local Tasker';
    document.title = name + ' — StreetTasker';
    $('coDetailAvatar').textContent = C.initialsOf(name);
    $('coDetailName').textContent = name;
    var skills = Array.isArray(p.skills) ? p.skills.filter(Boolean) : [];
    $('coDetailSkills').textContent = skills.length ? skills.join(', ') : 'No skills recorded yet';
    var st = $('coDetailStatus'); st.textContent = '';
    st.appendChild(C.el('span', C.statusClass(p.status), C.statusLabel(p.status)));

    var c = $('coFactsContact'); c.textContent = '';
    fact(c, 'Phone', p.phone, { tel: true });
    fact(c, 'Areas served', p.areas_served);

    var f = $('coFactsProfile'); f.textContent = '';
    fact(f, 'Skills', skills.join(', '));
    fact(f, 'Availability notes', p.availability_notes);
    fact(f, 'Added', C.formatDate(p.created_at));
    fact(f, 'Published', p.published_at ? C.formatDate(p.published_at) : '', { empty: 'Not published' });

    var v = $('coFactsVerify'); v.textContent = '';
    fact(v, 'Method', p.verification_method, { empty: 'Not verified yet' });
    fact(v, 'Verified on', C.formatDate(p.verified_at), { empty: 'Not verified yet' });
    fact(v, 'Notes', p.verification_notes);
    show('coDetail');
    showCreated();
    showUpdated();
    showServiceSaved();
    $('coEditLink').href = 'coordinator-tasker-edit.html?id=' + encodeURIComponent(p.tasker_user_id);
    var pubLink = $('coPubLink'), pubSum = $('coPubSummary');
    if (pubLink && pubSum) {
      pubLink.href = 'coordinator-publish.html?id=' + encodeURIComponent(p.tasker_user_id);
      if (p.status === 'published') { pubLink.textContent = 'Manage listing'; pubSum.textContent = 'Published' + (p.published_at ? ' on ' + C.formatDate(p.published_at) : '') + '. Customers can find this person.'; }
      else if (p.status === 'inactive') { pubLink.hidden = true; pubSum.textContent = 'This profile is retired and cannot be published.'; }
      else { pubLink.textContent = 'Preview and publish'; pubSum.textContent = 'Not published. Nothing is shown to customers yet. Preview how it will look and check what is still needed.'; }
    }
    loadConsents(p.tasker_user_id);
    loadServices(p.tasker_user_id);
    loadPhotos(p.tasker_user_id);
  }

  async function load(detail) {
    var id = new URLSearchParams(window.location.search).get('id');
    if (!C.isUuid(id)) { show('coDetailMissing'); return; }
    show('coDetailLoading');
    var cb = $('coCreatedBanner'); if (cb) cb.hidden = true;
    try {
      var res = await window.supabase.from('local_tasker_profiles')
        .select('tasker_user_id, full_name, phone, areas_served, skills, availability_notes, status, published_at, verification_method, verified_at, verification_notes, created_at')
        .eq('tasker_user_id', id)
        .maybeSingle();
      if (res.error) throw res.error;
      if (!res.data) { show('coDetailMissing'); return; }
      paint(res.data);
    } catch (e) {
      console.error('[coordinator tasker]', e);
      show('coDetailError');
    }
  }

  document.addEventListener('coordinator:ready', function (e) { last = e.detail; load(last); });
  document.addEventListener('DOMContentLoaded', function () {
    var retry = $('coDetailRetry');
    if (retry) retry.addEventListener('click', function () { if (last) load(last); });
  });
})();

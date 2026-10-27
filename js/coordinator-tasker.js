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
    $('coEditLink').href = 'coordinator-tasker-edit.html?id=' + encodeURIComponent(p.tasker_user_id);
    loadConsents(p.tasker_user_id);
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

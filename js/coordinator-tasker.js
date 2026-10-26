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
  }

  async function load(detail) {
    var id = new URLSearchParams(window.location.search).get('id');
    if (!C.isUuid(id)) { show('coDetailMissing'); return; }
    show('coDetailLoading');
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

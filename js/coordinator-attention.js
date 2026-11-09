/* ============================================================
   StreetTasker — coordinator-attention.js (Stage C3)
   "Taskers needing attention" card on coordinator-dashboard.html.
   Real signals only, one line per Local Tasker (the most important one):
     1. identity check not finished  (rpc idv_local_status_list, same source as My Local Taskers)
     2. profile changed, needs republishing (local_tasker_profiles.needs_republish)
     3. profile is still a draft
     4. profile is inactive
   Profiles come from coordinator-overview.js (event `coordinator:taskers`); this file only adds the identity read.
   If the identity read fails, the card still shows the profile signals and says the identity check could not be read.
   Display only: nothing here changes data. Renders with textContent only.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  var MAX_SHOWN = 4;
  function $(id) { return document.getElementById(id); }

  function items(detail, vById) {
    var out = [];
    detail.ids.forEach(function (id) {
      var p = detail.byId[id] || {};
      var name = p.full_name || 'Local Tasker';
      var enc = encodeURIComponent(id);
      var it = null;
      var v = vById ? C.verifyView(vById[id] || { status: 'NOT_STARTED' }, id) : null;
      if (v && v.group !== 'verified' && v.action && v.href) {
        it = { name: name, text: 'Identity check: ' + v.label, action: v.action, href: v.href, tone: (v.tone === 'bad' || v.tone === 'review') ? 'bad' : 'warn', rank: v.tone === 'bad' ? 1 : 3 };
      } else if (p.status === 'published' && p.needs_republish === true) {
        it = { name: name, text: 'Profile changes need republishing', action: 'Republish', href: 'coordinator-publish.html?id=' + enc, tone: 'warn', rank: 2 };
      } else if (p.status === 'draft') {
        it = { name: name, text: 'Draft profile, not published yet', action: 'Complete', href: 'coordinator-tasker-edit.html?id=' + enc, tone: 'warn', rank: 4 };
      } else if (p.status === 'inactive') {
        it = { name: name, text: 'Profile is inactive', action: 'Open', href: 'coordinator-tasker.html?id=' + enc, tone: 'bad', rank: 2 };
      }
      if (it) out.push(it);
    });
    out.sort(function (a, b) { return a.rank - b.rank; });
    return out;
  }

  function row(it) {
    var li = C.el('li', 'co-attn-item');
    var av = C.el('span', 'co-tasker-avatar co-attn-avatar', C.initialsOf(it.name));
    li.appendChild(av);
    var txt = C.el('div', 'co-attn-text');
    txt.appendChild(C.el('p', 'co-attn-name', it.name));
    txt.appendChild(C.el('p', 'co-attn-reason' + (it.tone === 'bad' ? ' is-bad' : ''), it.text));
    li.appendChild(txt);
    var a = C.el('a', 'co-fact-link co-attn-action', it.action + ' \u2192');
    a.href = it.href; a.setAttribute('aria-label', it.action + ': ' + it.name);
    li.appendChild(a);
    return li;
  }

  function show(list) {
    var ul = $('coAttnList'), count = $('coAttnCount');
    $('coAttnLoading').hidden = true;
    ul.textContent = '';
    list.slice(0, MAX_SHOWN).forEach(function (it) { ul.appendChild(row(it)); });
    ul.hidden = !list.length;
    $('coAttnEmpty').hidden = !!list.length;
    count.hidden = !list.length;
    if (list.length) count.textContent = String(list.length);
    if (list.length > MAX_SHOWN) {
      var li = C.el('li', 'co-attn-more');
      var a = C.el('a', 'co-fact-link', (list.length - MAX_SHOWN) + ' more in My Local Taskers \u2192'); a.href = 'coordinator-taskers.html';
      li.appendChild(a); ul.appendChild(li);
    }
  }

  async function onTaskers(e) {
    var d = e.detail || {};
    var note = $('coAttnNote'); note.hidden = true;
    if (d.error || !Array.isArray(d.ids)) {
      $('coAttnLoading').hidden = true;
      note.textContent = 'We couldn\u2019t check your Local Taskers just now.'; note.hidden = false;
      return;
    }
    var vById = {};
    try {
      var vr = await window.supabase.rpc('idv_local_status_list');
      if (vr.error) throw vr.error;
      (Array.isArray(vr.data) ? vr.data : []).forEach(function (x) { if (x && x.tasker_user_id) vById[x.tasker_user_id] = x; });
    } catch (ve) {
      console.error('[coordinator attention] identity status', ve);
      vById = null;
      note.textContent = 'Identity checks could not be read just now, so they are not listed here.'; note.hidden = false;
    }
    show(items(d, vById));
  }

  document.addEventListener('coordinator:taskers', onTaskers);
})();

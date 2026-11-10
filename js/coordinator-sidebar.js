/* ============================================================
   StreetTasker — coordinator-sidebar.js (sidebar on every coordinator page)
   Fills the desktop sidebar (components/coordinator-nav.html, shown from 1044px) with:
     - the "My Local Taskers" list, its filter and the "6/10" places count
     - the unread-messages badge on Messages
   Loaded by js/coordinator.js once the nav is in the page. Waits for `coordinator:ready` (the guard has said yes).
   Display only. Each row opens that Local Tasker's profile. Renders with textContent only.
   Two things are filled by other scripts and are left alone here:
     - the Local Tasker page: js/coordinator-tasker-shell.js fills the list itself (current row, per-tasker "new" counts)
     - the overview: js/coordinator-messages.js already sets the Messages badge
   If a read fails, the list says so and the badge stays hidden. No made-up numbers.
   ============================================================ */
'use strict';

(function () {
  var rows = [], q = '', current = '', failed = false;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var STATUS = { published: 'Published', draft: 'Draft', inactive: 'Inactive' };
  function statusLabel(s) {
    if (STATUS[s]) return STATUS[s];
    var t = String(s || 'unknown').replace(/_/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '')); }

  function draw() {
    var ul = $('coSideTaskers'), empty = $('coSideEmpty');
    if (!ul) return;
    ul.textContent = '';
    var term = q.trim().toLowerCase();
    var shown = rows.filter(function (r) { return !term || (r.name + ' ' + r.skills).toLowerCase().indexOf(term) > -1; });
    shown.forEach(function (r) {
      var li = el('li');
      var isCur = r.id === current;
      var a = el('a', 'co-side-trow' + (isCur ? ' is-current' : ''));
      a.href = 'coordinator-tasker.html?id=' + encodeURIComponent(r.id);
      a.setAttribute('aria-label', r.name + ', ' + statusLabel(r.status));
      if (isCur) a.setAttribute('aria-current', 'page');
      var dot = el('span', 'co-side-dot co-side-dot--' + (r.status === 'published' || r.status === 'inactive' ? r.status : 'draft'));
      dot.setAttribute('aria-hidden', 'true');
      a.appendChild(dot);
      var t = el('span', 'co-side-ttext');
      t.appendChild(el('span', 'co-side-tname', r.name));
      t.appendChild(el('span', 'co-side-tsub', r.skills || statusLabel(r.status)));
      a.appendChild(t);
      li.appendChild(a); ul.appendChild(li);
    });
    if (empty) {
      empty.hidden = !!shown.length;
      if (failed) { empty.hidden = false; empty.textContent = 'We couldn\u2019t load your Local Taskers just now.'; }
      else empty.textContent = rows.length ? 'No Local Taskers match that filter.' : 'No Local Taskers assigned to you yet.';
    }
  }

  async function loadRoster(userId) {
    var sb = window.supabase;
    try {
      var asg = await sb.from('coordinator_assignments').select('tasker_user_id, assigned_at')
        .eq('coordinator_id', userId).is('ended_at', null).order('assigned_at', { ascending: true });
      if (asg.error) throw asg.error;
      var ids = (asg.data || []).map(function (a) { return a.tasker_user_id; });
      var byId = {};
      if (ids.length) {
        var pr = await sb.from('local_tasker_profiles').select('tasker_user_id, full_name, skills, status').in('tasker_user_id', ids);
        if (pr.error) throw pr.error;
        (pr.data || []).forEach(function (p) { byId[p.tasker_user_id] = p; });
      }
      rows = ids.map(function (id) {
        var p = byId[id] || {};
        return { id: id, name: p.full_name || 'Local Tasker', status: p.status || 'unknown', skills: Array.isArray(p.skills) ? p.skills.filter(Boolean).join(', ') : '' };
      });
      failed = false;
      draw();
      var cap = $('coSideCap');
      if (cap && window.STCo && typeof window.STCo.plan === 'function') {
        var plan = await window.STCo.plan();
        if (plan) { cap.textContent = ids.length + '/' + plan.capacity; cap.hidden = false; }
      }
    } catch (e) {
      console.error('[coordinator sidebar roster]', e);
      failed = true; draw();
    }
  }

  async function loadUnread() {
    var b = $('coSideUnread'); if (!b) return;
    try {
      var res = await window.supabase.rpc('coordinator_chat_list', { p_limit: 100 });
      if (res.error || !Array.isArray(res.data)) throw (res.error || new Error('unexpected reply'));
      var n = res.data.reduce(function (sum, r) { return sum + (r && r.access === 'coordinator' && r.unread > 0 ? r.unread : 0); }, 0);
      b.hidden = !(n > 0);
      if (n > 0) { b.textContent = n > 98 ? '99+' : String(n); b.setAttribute('aria-label', n + ' unread messages'); }
    } catch (e) { b.hidden = true; }   /* no badge is the safe answer */
  }

  function start(detail) {
    var onTaskerPage = document.body.classList.contains('co-page--tasker');
    var onOverview = !!$('coMsgsList');
    if (onTaskerPage) return;   /* coordinator-tasker-shell.js fills the list and the badge on that page */
    var id = new URLSearchParams(window.location.search).get('id');
    current = isUuid(id) ? id : '';
    var f = $('coSideFilter');
    if (f) f.addEventListener('input', function () { q = this.value; draw(); });
    loadRoster(detail.userId);
    if (!onOverview) loadUnread();
  }

  var started = false;
  document.addEventListener('coordinator:ready', function (e) { if (!started) { started = true; start(e.detail || {}); } });
  /* This script is added after the nav loads, which is before `coordinator:ready` fires. If the page was already ready, start now. */
  if (window.STCoordinatorReady && !started) { started = true; start(window.STCoordinatorReady); }
})();

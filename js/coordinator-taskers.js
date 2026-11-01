/* ============================================================
   StreetTasker — coordinator-taskers.js (Stage 4A-1)
   "My Local Taskers" list. Read-only: own ACTIVE assignments plus the profiles
   of those taskers, both under RLS (lt_assignments_read, lt_profiles_read).
   Search and status filter run in the browser on the rows already loaded.
   Stage V4a: each card also shows the real identity-check status, read with the
   server function idv_local_status_list() (the server decides who may see what).
   If that read fails the list still loads and the card says "Status unavailable".
   There is no control anywhere to mark a person verified.
   Runs on `coordinator:ready` (after the route guard).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  function $(id) { return document.getElementById(id); }

  var rows = [];          /* [{ id, profile|null }] in assignment order */
  var last = null;
  var filter = 'all';
  var vfilter = 'all';
  var query = '';

  function haystack(r) {
    var p = r.profile || {};
    return [p.full_name, (Array.isArray(p.skills) ? p.skills.join(' ') : ''), p.areas_served].join(' ').toLowerCase();
  }

  function card(r) {
    var p = r.profile || { full_name: '', status: 'unknown', skills: [], areas_served: '' };
    var name = p.full_name || 'Local Tasker';
    var li = C.el('li', 'co-tasker-card');
    var link = C.el('a', 'co-tasker-link');
    link.href = 'coordinator-tasker.html?id=' + encodeURIComponent(r.id);
    link.setAttribute('aria-label', name + ', ' + C.statusLabel(p.status));

    var top = C.el('div', 'co-tasker-top');
    top.appendChild(C.el('span', 'co-tasker-avatar', C.initialsOf(name)));
    top.appendChild(C.el('span', C.statusClass(p.status), C.statusLabel(p.status)));
    link.appendChild(top);
    link.appendChild(C.el('h2', 'co-tasker-name', name));
    var skills = Array.isArray(p.skills) ? p.skills.filter(Boolean) : [];
    link.appendChild(C.el('p', 'co-tasker-skills', skills.length ? skills.join(', ') : 'No skills recorded yet'));
    link.appendChild(C.el('p', 'co-tasker-area', p.areas_served || 'No service area recorded yet'));
    li.appendChild(link);

    var v = C.verifyView(r.verify, r.id);
    var foot = C.el('div', 'co-tasker-verify');
    foot.appendChild(C.el('span', 'co-vstatus co-vstatus--' + v.tone, v.label));
    if (v.date) foot.appendChild(C.el('span', 'co-vdate', v.date));
    if (v.action && v.href) {
      var act = C.el('a', 'co-vaction', v.action);
      act.href = v.href;
      act.setAttribute('aria-label', v.action + ' for ' + name);
      foot.appendChild(act);
    }
    li.appendChild(foot);
    return li;
  }

  function render() {
    var grid = $('coListGrid'), empty = $('coListEmpty'), nomatch = $('coListNoMatch'), tools = $('coToolbar');
    grid.textContent = '';
    empty.hidden = true; nomatch.hidden = true;

    if (!rows.length) {
      grid.hidden = true; tools.hidden = true; empty.hidden = false;
      return;
    }
    tools.hidden = false;
    var q = query.trim().toLowerCase();
    var shown = rows.filter(function (r) {
      var st = r.profile ? r.profile.status : 'unknown';
      if (filter !== 'all' && st !== filter) return false;
      if (vfilter !== 'all' && C.verifyView(r.verify, r.id).group !== vfilter) return false;
      return !q || haystack(r).indexOf(q) > -1;
    });
    shown.forEach(function (r) { grid.appendChild(card(r)); });
    grid.hidden = !shown.length;
    nomatch.hidden = !!shown.length;
  }

  function summary() {
    var n = rows.length;
    var el = $('coListSummary');
    if (!el) return;
    el.textContent = n
      ? n + ' of ' + C.CAP + ' places used. Choose a Local Tasker to see their profile.'
      : 'Neighbourhood taskers under your coordination.';
  }

  async function load(detail) {
    var sb = window.supabase;
    $('coListLoading').hidden = false;
    $('coListGrid').hidden = true;
    $('coListEmpty').hidden = true; $('coListNoMatch').hidden = true; $('coToolbar').hidden = true;
    $('coListError').hidden = true;
    try {
      var asg = await sb.from('coordinator_assignments')
        .select('tasker_user_id, assigned_at')
        .eq('coordinator_id', detail.userId)
        .is('ended_at', null)
        .order('assigned_at', { ascending: true });
      if (asg.error) throw asg.error;
      var ids = (asg.data || []).map(function (a) { return a.tasker_user_id; });

      var byId = {};
      if (ids.length) {
        var pr = await sb.from('local_tasker_profiles')
          .select('tasker_user_id, full_name, areas_served, skills, status')
          .in('tasker_user_id', ids);
        if (pr.error) throw pr.error;
        (pr.data || []).forEach(function (p) { byId[p.tasker_user_id] = p; });
      }
      /* Stage V4a: one server read for all of this coordinator's Local Taskers. Never blocks the list. */
      var vById = {};
      try {
        var vr = await sb.rpc('idv_local_status_list');
        if (vr.error) throw vr.error;
        (Array.isArray(vr.data) ? vr.data : []).forEach(function (x) { if (x && x.tasker_user_id) vById[x.tasker_user_id] = x; });
      } catch (ve) {
        console.error('[coordinator taskers] identity status', ve);
        vById = null;
      }
      rows = ids.map(function (id) {
        return { id: id, profile: byId[id] || null, verify: vById ? (vById[id] || { status: 'NOT_STARTED' }) : null };
      });
      $('coListLoading').hidden = true;
      summary();
      render();
    } catch (e) {
      console.error('[coordinator taskers]', e);
      $('coListLoading').hidden = true;
      $('coListError').hidden = false;
    }
  }

  document.addEventListener('coordinator:ready', function (e) { last = e.detail; load(last); });
  document.addEventListener('DOMContentLoaded', function () {
    var retry = $('coListRetry');
    if (retry) retry.addEventListener('click', function () { if (last) load(last); });
    var search = $('coSearch');
    if (search) search.addEventListener('input', function () { query = search.value; render(); });
    document.querySelectorAll('[data-co-vfilter]').forEach(function (b) {
      b.addEventListener('click', function () {
        vfilter = b.getAttribute('data-co-vfilter');
        document.querySelectorAll('[data-co-vfilter]').forEach(function (x) {
          var on = x === b;
          x.classList.toggle('is-active', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        render();
      });
    });
    document.querySelectorAll('[data-co-filter]').forEach(function (b) {
      b.addEventListener('click', function () {
        filter = b.getAttribute('data-co-filter');
        document.querySelectorAll('[data-co-filter]').forEach(function (x) {
          var on = x === b;
          x.classList.toggle('is-active', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        render();
      });
    });
  });
})();

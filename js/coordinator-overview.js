/* ============================================================
   StreetTasker — coordinator-overview.js (Stage 3B)
   Real data for coordinator-dashboard.html.

   Reads ONLY what a coordinator is allowed to read today (RLS from Stage 2C):
     coordinator_assignments  own ACTIVE rows (coordinator_id = me, ended_at is null)
     local_tasker_profiles    profiles of taskers the coordinator actively manages
   Bookings are NOT read: coordinators have no booking access until Stage 5, so the
   Active Requests panel says so instead of showing a count it cannot know.

   Runs on the `coordinator:ready` event from js/coordinator.js (after the route
   guard passed). Renders with textContent only (names are user-entered data).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  var CAP = C.CAP;   /* display mirror of the database cap; the assignment trigger is the authority */

  function $(id) { return document.getElementById(id); }
  function setStat(key, text) {
    var el = document.querySelector('[data-co-stat="' + key + '"]');
    if (el) el.textContent = text;
  }

  var el = C.el, initialsOf = C.initialsOf, statusLabel = C.statusLabel;

  function card(profile) {
    var name = profile.full_name || 'Local Tasker';
    var li = el('li', 'co-tasker-card');
    var link = el('a', 'co-tasker-link');
    link.href = 'coordinator-tasker.html?id=' + encodeURIComponent(profile.tasker_user_id || '');
    link.setAttribute('aria-label', name + ', ' + statusLabel(profile.status));

    var top = el('div', 'co-tasker-top');
    top.appendChild(el('span', 'co-tasker-avatar', initialsOf(name)));
    top.appendChild(el('span', C.statusClass(profile.status), statusLabel(profile.status)));
    link.appendChild(top);

    link.appendChild(el('h3', 'co-tasker-name', name));

    var skills = Array.isArray(profile.skills) ? profile.skills.filter(Boolean) : [];
    link.appendChild(el('p', 'co-tasker-skills', skills.length ? skills.join(', ') : 'No skills recorded yet'));
    link.appendChild(el('p', 'co-tasker-area', profile.areas_served ? profile.areas_served : 'No service area recorded yet'));
    li.appendChild(link);
    return li;
  }

  function showError(on) {
    var box = $('coOverviewError'); if (box) box.hidden = !on;
  }

  async function load(detail) {
    var sb = window.supabase;
    var loading = $('coTaskersLoading'), grid = $('coTaskerGrid'), empty = $('coTaskersEmpty');
    if (loading) loading.hidden = false;
    if (grid) grid.hidden = true;
    if (empty) empty.hidden = true;
    showError(false);

    try {
      var asg = await sb.from('coordinator_assignments')
        .select('tasker_user_id, assigned_at')
        .eq('coordinator_id', detail.userId)
        .is('ended_at', null)
        .order('assigned_at', { ascending: true });
      if (asg.error) throw asg.error;
      var assignments = asg.data || [];
      var ids = assignments.map(function (a) { return a.tasker_user_id; });

      var profiles = [];
      if (ids.length) {
        var pr = await sb.from('local_tasker_profiles')
          .select('tasker_user_id, full_name, areas_served, skills, status')
          .in('tasker_user_id', ids);
        if (pr.error) throw pr.error;
        profiles = pr.data || [];
      }
      var byId = {};
      profiles.forEach(function (p) { byId[p.tasker_user_id] = p; });

      /* Count from the assignments (the rule that is capped); status from the profile. */
      var published = 0, drafts = 0;
      ids.forEach(function (id) {
        var p = byId[id];
        if (!p) return;
        if (p.status === 'published') published++;
        else if (p.status === 'draft') drafts++;
      });

      setStat('assigned', String(ids.length));
      setStat('published', String(published));
      setStat('draft', String(drafts));
      setStat('open', String(Math.max(0, CAP - ids.length)));
      var cap = $('coCapNote'); if (cap) cap.textContent = 'of ' + CAP + ' allowed';

      if (loading) loading.hidden = true;
      if (!ids.length) {
        if (empty) empty.hidden = false;
        return;
      }
      grid.textContent = '';
      ids.forEach(function (id) {
        grid.appendChild(card(byId[id] || { tasker_user_id: id, full_name: '', status: 'unknown', skills: [], areas_served: '' }));
      });
      grid.hidden = false;
    } catch (e) {
      console.error('[coordinator overview]', e);
      ['assigned', 'published', 'draft', 'open'].forEach(function (k) { setStat(k, '—'); });
      if (loading) loading.hidden = true;
      showError(true);
    }
  }

  var last = null;
  document.addEventListener('coordinator:ready', function (e) {
    last = e.detail;
    load(last);
  });
  document.addEventListener('DOMContentLoaded', function () {
    var retry = $('coOverviewRetry');
    if (retry) retry.addEventListener('click', function () { if (last) load(last); });
  });
})();

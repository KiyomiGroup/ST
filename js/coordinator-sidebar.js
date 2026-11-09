/* ============================================================
   StreetTasker — coordinator-sidebar.js (Stage C4)
   "My Local Taskers" list in the overview sidebar (desktop only; the sidebar is hidden below 1044px).
   Uses the profiles that coordinator-overview.js already read (event `coordinator:taskers`), plus the plan capacity for the "6/10" count.
   Display only. Each row opens that Local Tasker's profile. Renders with textContent only.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  var rows = [], q = '';
  function $(id) { return document.getElementById(id); }

  function draw() {
    var ul = $('coSideTaskers'), empty = $('coSideEmpty');
    if (!ul) return;
    ul.textContent = '';
    var term = q.trim().toLowerCase();
    var shown = rows.filter(function (r) { return !term || (r.name + ' ' + r.skills).toLowerCase().indexOf(term) > -1; });
    shown.forEach(function (r) {
      var li = C.el('li');
      var a = C.el('a', 'co-side-trow');
      a.href = 'coordinator-tasker.html?id=' + encodeURIComponent(r.id);
      a.setAttribute('aria-label', r.name + ', ' + C.statusLabel(r.status));
      var dot = C.el('span', 'co-side-dot co-side-dot--' + (r.status === 'published' || r.status === 'inactive' ? r.status : 'draft'));
      dot.setAttribute('aria-hidden', 'true');
      a.appendChild(dot);
      var t = C.el('span', 'co-side-ttext');
      t.appendChild(C.el('span', 'co-side-tname', r.name));
      t.appendChild(C.el('span', 'co-side-tsub', r.skills || C.statusLabel(r.status)));
      a.appendChild(t);
      li.appendChild(a); ul.appendChild(li);
    });
    empty.hidden = !!shown.length;
    empty.textContent = rows.length ? 'No Local Taskers match that filter.' : 'No Local Taskers assigned to you yet.';
  }

  document.addEventListener('coordinator:taskers', async function (e) {
    var d = e.detail || {};
    if (d.error || !Array.isArray(d.ids)) { var em = $('coSideEmpty'); if (em) { em.textContent = 'We couldn\u2019t load your Local Taskers just now.'; em.hidden = false; } return; }
    rows = d.ids.map(function (id) {
      var p = d.byId[id] || {};
      var sk = Array.isArray(p.skills) ? p.skills.filter(Boolean).join(', ') : '';
      return { id: id, name: p.full_name || 'Local Tasker', skills: sk, status: p.status || 'unknown' };
    });
    draw();
    var cap = $('coSideCap'), plan = await C.plan();
    if (cap && plan) { cap.textContent = d.ids.length + '/' + plan.capacity; cap.hidden = false; }
  });
  document.addEventListener('DOMContentLoaded', function () {
    var f = $('coSideFilter');
    if (f) f.addEventListener('input', function () { q = this.value; draw(); });
  });
})();

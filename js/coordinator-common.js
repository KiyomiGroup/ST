/* ============================================================
   StreetTasker — coordinator-common.js (Stage 4A-1)
   Small helpers shared by the coordinator pages. Plain DOM, no data access.
   Always build user-entered text with textContent (el()), never innerHTML.
   ============================================================ */
'use strict';

(function () {
  var STATUS_LABEL = { draft: 'Draft', published: 'Published', inactive: 'Inactive' };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function initialsOf(name, fallback) {
    var parts = String(name || '').replace(/[^a-zA-Z ]/g, ' ').split(' ').filter(Boolean);
    if (!parts.length) return fallback || 'LT';
    return parts.slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }
  function statusLabel(s) {
    if (STATUS_LABEL[s]) return STATUS_LABEL[s];
    var t = String(s || 'unknown').replace(/_/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function statusClass(s) { return 'co-status co-status--' + (STATUS_LABEL[s] ? s : 'other'); }
  function isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '')); }
  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  /* The coordinator's plan (Stage 7G): tier, capacity, active count, places left. The database function my_coordinator_plan() is the source and the
     assignment trigger is the authority; the page only shows what it returns. One call per page load, shared. Resolves to null if it cannot be read
     (the caller then shows a dash instead of guessing a number). */
  var planPromise = null;
  function plan() {
    if (!planPromise) {
      planPromise = Promise.resolve().then(function () { return window.supabase.rpc('my_coordinator_plan'); }).then(function (res) {
        var d = res && res.data;
        if (!res || res.error || !d || typeof d.capacity !== 'number' || typeof d.active_count !== 'number') return null;
        return d;
      }).catch(function (e) { console.error('[coordinator plan]', e); return null; });
    }
    return planPromise;
  }

  window.STCo = { el: el, initialsOf: initialsOf, statusLabel: statusLabel, statusClass: statusClass, isUuid: isUuid, formatDate: formatDate, plan: plan };
})();

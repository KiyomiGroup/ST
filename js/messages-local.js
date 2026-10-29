/* ============================================================================
   Customer side of a Local Tasker booking thread (Stage 6A): who is my contact?
   For a Local Tasker booking the Local Tasker has no login, so the customer talks to the COORDINATOR. This file only works out the
   NAME to show; it draws nothing and changes no existing file. It is NOT wired into messages.html yet: the thread header change needs
   the reference screens (desktop and mobile), see docs/local-tasker/handoffs/stage-06a.md section 12 (UI BLOCKED).

   API (window.JRLocal):
     JRLocal.load(threads)        one rpc `local_thread_labels` for the customer's own threads; marks each thread t._lt = { assigned, name }
                                  for Local Tasker threads only. Never throws: on any failure the threads stay as they are.
     JRLocal.isLocal(t)           true when t._lt was set
     JRLocal.contactName(t, fallbackName)   the coordinator's name for a Local Tasker thread, "StreetTasker coordinator" when none is
                                  assigned right now, otherwise fallbackName (the normal tasker name)
     JRLocal.contactRole(t)       "Coordinator" for a Local Tasker thread, otherwise "" (for a small label under the name)
   Text is returned as plain strings: the caller must put it in with textContent, never innerHTML.
   ============================================================================ */
(function (root) {
  'use strict';
  var NO_COORDINATOR = 'StreetTasker coordinator';

  async function load(threads, sb) {
    sb = sb || (root && root.supabase);
    if (!sb || !threads || !threads.length) return threads;
    var ids = [];
    threads.forEach(function (t) {
      if (t && t.id && t.context_type === 'booking' && ids.indexOf(t.id) === -1) ids.push(t.id);
    });
    if (!ids.length) return threads;
    try {
      var r = await sb.rpc('local_thread_labels', { p_threads: ids.slice(0, 100) });
      if (r.error || !Array.isArray(r.data)) return threads;
      var byId = {};
      r.data.forEach(function (x) { if (x && x.thread_id) byId[x.thread_id] = x; });
      threads.forEach(function (t) {
        var x = t && byId[t.id];
        if (x) t._lt = { assigned: !!x.coordinator_assigned, name: typeof x.coordinator_name === 'string' ? x.coordinator_name : '' };
      });
    } catch (_e) { /* the normal tasker name stays */ }
    return threads;
  }

  function isLocal(t) { return !!(t && t._lt); }

  function contactName(t, fallbackName) {
    if (!isLocal(t)) return fallbackName;
    return (t._lt.assigned && t._lt.name) ? t._lt.name : NO_COORDINATOR;
  }

  function contactRole(t) { return isLocal(t) ? 'Coordinator' : ''; }

  root.JRLocal = { load: load, isLocal: isLocal, contactName: contactName, contactRole: contactRole, NO_COORDINATOR: NO_COORDINATOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.JRLocal;
})(typeof window !== 'undefined' ? window : globalThis);

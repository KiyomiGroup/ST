/* ============================================================
   STREET TASKERS — task-drafts.js
   The list of saved task drafts (several per person), shared by
   post-task.html (Save as Draft, "My drafts" count) and drafts.html.

   Drafts live on THIS device in localStorage, one list per signed-in
   person (so two accounts on one phone never see each other's drafts).
   The post-task form keeps its own single auto-saved "working copy"
   under st_task_draft (see tasks.js); this file holds the saved list
   and moves a draft in and out of that working copy.

   Public: window.TaskDrafts
     init()            -> Promise, call once before the others
     list()            -> [{ id, savedAt, data }] newest first
     count()           -> number
     upsert(id, data)  -> saves or updates one draft
     remove(id)
     newId()
     openInForm(id)    -> puts the draft in the form's working copy
   No coordinates are ever stored (tasks.js strips them before saving).
   ============================================================ */
'use strict';

(function () {
  var LIST_PREFIX = 'st_task_drafts_';
  var WORKING_KEY = 'st_task_draft';    /* the form's auto-saved working copy (tasks.js DRAFT_KEY) */
  var MAX_DRAFTS = 20;
  var listKey = LIST_PREFIX + 'guest';
  var ready = null;

  function hasContent(d) {
    return !!(d && (d.title || d.description || d.budget || d.location || d.category || d.urgentPaid));
  }

  function init() {
    if (ready) return ready;
    ready = (async function () {
      try {
        if (window.supabase && window.supabase.auth) {
          var s = await window.supabase.auth.getSession();
          var u = s && s.data && s.data.session && s.data.session.user;
          if (u && u.id) listKey = LIST_PREFIX + u.id;
        }
      } catch (e) { /* stay on the guest list */ }
    })();
    return ready;
  }

  function read() {
    try {
      var rows = JSON.parse(localStorage.getItem(listKey) || '[]');
      return Array.isArray(rows) ? rows.filter(function (r) { return r && r.id && r.data; }) : [];
    } catch (e) { return []; }
  }
  function write(rows) {
    try { localStorage.setItem(listKey, JSON.stringify(rows)); return true; } catch (e) { return false; }
  }

  function list() { return read().sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); }); }
  function count() { return read().length; }
  function newId() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function upsert(id, data) {
    if (!id || !hasContent(data)) return false;
    var rows = read().filter(function (r) { return r.id !== id; });
    var copy = JSON.parse(JSON.stringify(data));
    copy.draftId = id;
    copy.savedToList = true;
    rows.push({ id: id, savedAt: Date.now(), data: copy });
    rows.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
    return write(rows.slice(0, MAX_DRAFTS));
  }

  function remove(id) {
    write(read().filter(function (r) { return r.id !== id; }));
  }

  /* Opening a draft replaces the form's working copy. Keep whatever is in it first, so nothing is lost. */
  function openInForm(id) {
    var row = read().filter(function (r) { return r.id === id; })[0];
    if (!row) return false;
    try {
      var current = JSON.parse(localStorage.getItem(WORKING_KEY) || 'null');
      if (hasContent(current) && current.draftId !== id) upsert(current.draftId || newId(), current);
      var data = JSON.parse(JSON.stringify(row.data));
      data.draftId = id; data.savedToList = true; data.savedAt = row.savedAt;
      localStorage.setItem(WORKING_KEY, JSON.stringify(data));
      return true;
    } catch (e) { return false; }
  }

  window.TaskDrafts = { init: init, list: list, count: count, upsert: upsert, remove: remove, newId: newId, openInForm: openInForm, hasContent: hasContent };
})();

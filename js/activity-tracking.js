/* StreetTasker: view tracking (S4j). window.STActivity.profile(userId) and window.STActivity.service(serviceId).
   Two server functions do all the work and all the rules (S3g): record_profile_view(p_tasker, p_visitor_token) and
   record_service_view(p_service, p_visitor_token). The server ignores the tasker's own views, Local Taskers, services that are not
   live, counts one view per person per day, and rate limits. This file only tells the server that a page was opened.
   What is sent: the id being viewed and, for a person who is not signed in, a random visitor code kept in this browser so one
   visitor is counted once a day. No name, no email, no page address. A tasker never sees who viewed (only how many).
   Never throws and never blocks a page: any failure means the view is simply not counted. */
(function (root) {
  'use strict';

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var CODE = /^[A-Za-z0-9_-]{16,64}$/;           // the shape the server accepts
  var KEY = 'st_visitor_code';
  var WAIT_MS = 600;                              // longest a click waits before the page moves on

  var memoryCode = '';                            // used when browser storage is blocked
  var done = Object.create(null);                 // views already sent during this page load

  function makeCode() {
    var out = '';
    try {
      var c = root.crypto, a = new Uint8Array(24);
      if (c && c.getRandomValues) { c.getRandomValues(a); for (var i = 0; i < a.length; i++) out += ('0' + a[i].toString(16)).slice(-2); }
    } catch (e) { out = ''; }
    while (out.length < 32) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }

  function visitorCode() {
    try {
      var saved = root.localStorage.getItem(KEY);
      if (saved && CODE.test(saved)) return saved;
      var fresh = makeCode();
      root.localStorage.setItem(KEY, fresh);
      return fresh;
    } catch (e) {
      if (!memoryCode) memoryCode = makeCode();
      return memoryCode;
    }
  }

  function send(fn, argName, id) {
    var sb = root.supabase;
    if (!sb || typeof sb.rpc !== 'function' || !UUID.test(String(id || ''))) return Promise.resolve('skipped');
    var mark = fn + ':' + String(id).toLowerCase();
    if (done[mark]) return Promise.resolve('already_sent');
    done[mark] = true;
    var args = { p_visitor_token: visitorCode() };
    args[argName] = String(id);
    return new Promise(function (resolve) {
      var finished = false;
      function end(v) { if (!finished) { finished = true; resolve(v); } }
      try {
        var p = sb.rpc(fn, args);
        Promise.resolve(p).then(function (r) {
          var d = r && r.data;
          end(d && typeof d === 'object' && d.reason ? String(d.reason) : 'sent');
        }, function () { end('failed'); });
      } catch (e) { end('failed'); }
    });
  }

  function profile(userId) { return send('record_profile_view', 'p_tasker', userId); }
  function service(serviceId) { return send('record_service_view', 'p_service', serviceId); }

  /* For a click that leaves the page: count the view, but never keep the person waiting longer than WAIT_MS. */
  function thenGo(promise, go) {
    var moved = false;
    function move() { if (!moved) { moved = true; try { go(); } catch (e) { /* page change failed: nothing to do */ } } }
    var t = setTimeout(move, WAIT_MS);
    Promise.resolve(promise).then(function () { clearTimeout(t); move(); }, function () { clearTimeout(t); move(); });
  }

  root.STActivity = { profile: profile, service: service, thenGo: thenGo, _visitorCode: visitorCode };
})(typeof window !== 'undefined' ? window : this);

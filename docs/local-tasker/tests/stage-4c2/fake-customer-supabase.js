/* Test double for the Supabase UMD global on the CUSTOMER pages (stage 4C-2). Scenario: window.__SC.
   tables: { services:[], users:[], taskers:[], ... }  local: { info:[{user_id,cover_path}], photos:{id:[{path,caption,is_cover}]}, cards:[...] }
   fail: { info, photos, cards, sign } -> make that call return an error. Every rpc / sign call is recorded in window.__log. */
(function () {
  var SC = window.__SC || {}; window.__log = [];
  var PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  function builder(table) {
    var rows = ((SC.tables || {})[table] || []).slice(); var single = false;
    var b = {
      select: function () { return b; }, order: function () { return b; }, limit: function () { return b; },
      eq: function (c, v) { rows = rows.filter(function (r) { return String(r[c]) === String(v); }); return b; },
      in: function (c, vs) { rows = rows.filter(function (r) { return vs.map(String).indexOf(String(r[c])) !== -1; }); return b; },
      neq: function () { return b; }, gte: function () { return b; }, or: function () { return b; },
      maybeSingle: function () { single = true; return b; }, single: function () { single = true; return b; },
      then: function (res, rej) { var out = { data: single ? (rows[0] || null) : rows, error: null }; return Promise.resolve(out).then(res, rej); }
    };
    return b;
  }
  var client = {
    auth: {
      getSession: async function () { return { data: { session: null }, error: null }; },
      getUser: async function () { return { data: { user: null }, error: null }; },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    },
    from: function (t) { window.__log.push('from:' + t); return builder(t); },
    rpc: async function (name, args) {
      window.__log.push('rpc:' + name + ':' + JSON.stringify(args));
      var L = SC.local || {}, F = SC.fail || {};
      if (name === 'local_tasker_public_info') {
        if (F.info) return { data: null, error: { message: 'boom' } };
        return { data: (L.info || []).filter(function (r) { return (args.p_ids || []).indexOf(r.user_id) !== -1; }), error: null };
      }
      if (name === 'local_tasker_public_photos') {
        if (F.photos) return { data: null, error: { message: 'boom' } };
        return { data: (L.photos || {})[args.p_tasker] || [], error: null };
      }
      if (name === 'local_tasker_public_cards') {
        if (F.cards) return { data: null, error: { message: 'boom' } };
        return { data: L.cards || [], error: null };
      }
      return { data: null, error: { message: 'unknown rpc ' + name } };
    },
    storage: { from: function (bucket) { return {
      createSignedUrls: async function (paths, secs) {
        window.__log.push('sign:' + bucket + ':' + secs + ':' + JSON.stringify(paths));
        if ((SC.fail || {}).sign) return { data: null, error: { message: 'boom' } };
        return { data: paths.map(function (p) { return { path: p, signedUrl: PX + '#' + encodeURIComponent(p), error: null }; }), error: null };
      },
      getPublicUrl: function (p) { return { data: { publicUrl: PX } }; }
    }; } },
    channel: function () { return { on: function () { return this; }, subscribe: function () { return this; } }; },
    removeChannel: function () {}
  };
  window.supabase = { createClient: function () { return client; } };
})();

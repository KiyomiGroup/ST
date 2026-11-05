/* StreetTasker: membership labels on public screens (S4h).
   One question to the server per page: membership_for_users(uuid[]) (S3f). The answer is the ONLY source of a label.
   Nothing is read from taskers.subscription_plan / subscription_status / free_limit (browser-writable, never trusted).
   Free and Starter people are not returned by the server and get no element at all.
   Only the two texts PRO and PREMIUM are ever drawn; anything else the server might send is ignored.
   This is subscription membership only. It is not identity verification: no check mark, shield or "verified" here.
   Never throws: any failure simply means "no label". Styles: css/membership.css (S4a). */
(function (root) {
  'use strict';

  var ALLOWED = { PRO: 'pro', PREMIUM: 'premium' };
  var RPC = 'membership_for_users';
  /* The argument name of the S3f function was not in the S4h session's files, so a few names are tried once
     and the one that works is remembered for the page. */
  var ARG_NAMES = ['p_user_ids', 'user_ids', 'p_users', 'ids'];
  var WAIT_MS = 3000;                       // a slow answer must not hold a page back; no label is the safe result
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var labels = Object.create(null);         // user id -> 'PRO' | 'PREMIUM'
  var asked = Object.create(null);          // user ids the server has already answered for
  var argName = null;

  function clean(v) {
    var s = String(v == null ? '' : v).trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(ALLOWED, s) ? s : '';
  }

  /* Accepts the shapes a SQL function can return: rows [{user_id, membership_label}], a {user_id: 'PRO'} map,
     or a {user_id: {membership_label}} map. Returns {id: label} for allowed labels only. */
  function parse(data) {
    var out = Object.create(null), k;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { return out; } }
    if (Array.isArray(data)) {
      data.forEach(function (row) {
        if (!row || typeof row !== 'object') return;
        var id = row.user_id || row.id || row.tasker_id;
        var lab = clean(row.membership_label != null ? row.membership_label : row.label);
        if (id && lab) out[String(id)] = lab;
      });
    } else if (data && typeof data === 'object') {
      for (k in data) {
        if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
        var v = data[k];
        var lab2 = clean(v && typeof v === 'object' ? (v.membership_label != null ? v.membership_label : v.label) : v);
        if (lab2) out[String(k)] = lab2;
      }
    }
    return out;
  }

  function isMissingFunction(err) {
    var m = String((err && (err.message || err.details || err.hint)) || '') + ' ' + String((err && err.code) || '');
    return /PGRST202|42883|could not find the function|function .* does not exist|no function matches/i.test(m);
  }

  function withTimeout(promise) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, WAIT_MS);
      promise.then(function (r) { if (!done) { done = true; clearTimeout(t); resolve(r); } },
                   function () { if (!done) { done = true; clearTimeout(t); resolve(null); } });
    });
  }

  async function ask(ids) {
    var sb = root.supabase;
    if (!sb || typeof sb.rpc !== 'function') return null;
    var names = argName ? [argName] : ARG_NAMES;
    for (var i = 0; i < names.length; i++) {
      var args = {}; args[names[i]] = ids;
      var res = await withTimeout(Promise.resolve(sb.rpc(RPC, args)));
      if (!res) return null;
      if (!res.error) { argName = names[i]; return res.data; }
      if (!isMissingFunction(res.error)) return null;   // a real refusal: stop, show nothing
    }
    return null;
  }

  /* load(ids): remembers labels for these people. Real accounts only (a UUID); demo and unknown ids are skipped. */
  async function load(ids) {
    try {
      var want = [], seen = Object.create(null);
      (ids || []).forEach(function (x) {
        var id = String(x == null ? '' : x);
        if (!UUID.test(id) || seen[id] || asked[id]) return;
        seen[id] = 1; want.push(id);
      });
      if (!want.length) return;
      var data = await ask(want);
      if (data === null || data === undefined) return;   // no answer: nothing is cached, so no label and a later page may retry
      var found = parse(data);
      want.forEach(function (id) {
        asked[id] = true;
        if (found[id]) labels[id] = found[id];
      });
    } catch (e) { /* label is optional */ }
  }

  function get(id) { return labels[String(id == null ? '' : id)] || ''; }

  function classes(label, opts) {
    var c = 'membership-label membership-label--' + ALLOWED[label];
    if (opts && opts.small) c += ' membership-label--sm';
    if (opts && opts.onDark) c += ' membership-label--on-dark';
    return c;
  }

  /* html(id, opts): the label element as a string, or '' when this person has none. Text is one of two fixed words. */
  function html(id, opts) {
    var l = get(id);
    /* The leading space keeps "Name PRO" readable when copied or read aloud; inside a flex row it is not drawn. */
    return l ? ' <span class="' + classes(l, opts) + '">' + l + '</span>' : '';
  }

  /* node(label, opts): the same element as a DOM node (used on the profile hero). */
  function node(label, opts) {
    var l = clean(label);
    if (!l || typeof document === 'undefined') return null;
    var el = document.createElement('span');
    el.className = classes(l, opts);
    el.textContent = l;
    return el;
  }

  var api = { load: load, get: get, html: html, node: node, parse: parse, clean: clean };
  root.STMembership = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof window !== 'undefined' ? window : globalThis);

/* ============================================================
   STREETTASKER — rating badge (stage M9) and the STRating loader.

   This file was missing from the project, so no page could show a star rating.
   Pages that use it load css/rating-badge.css and this file.

   Badge markup:
     <span data-rating-user="<uuid>" data-rating-role="tasker|customer"></span>
     add data-rating-new to show "New" when the person has no reviews;
     otherwise the span stays empty.

   API:
     STRating.load(ids, role)  -> Promise of { "<lowercase uuid>": { avg, count } }
                                  (only people who have at least one review)
     STRating.decorate(root)   -> fills every empty [data-rating-user] span under root (default: document)

   Ratings come from rating_summary only (through the rating_summaries() database function when it
   answers, otherwise a direct read of rating_summary). Never from taskers.rating, taskers.review_count
   or services.rating. All text is set with textContent.
   ============================================================ */
(function (root) {
  'use strict';

  var CHUNK = 100;
  var cache = { tasker: {}, customer: {} };   /* role -> uuid -> { avg, count } | null (asked, no reviews) */
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function norm(role) { return role === 'customer' ? 'customer' : 'tasker'; }
  function client() { return root.supabase && typeof root.supabase.from === 'function' ? root.supabase : null; }

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* One row from the database, whatever the column names, -> { id, role, avg, count } or null */
  function readRow(r) {
    if (!r || typeof r !== 'object') return null;
    var id = r.user_id || r.reviewee_id || r.subject_id || r.id;
    if (!id) return null;
    var avg = num(r.avg != null ? r.avg : r.avg_rating != null ? r.avg_rating : r.average != null ? r.average : r.rating_avg != null ? r.rating_avg : r.rating);
    var count = num(r.count != null ? r.count : r.review_count != null ? r.review_count : r.reviews_count != null ? r.reviews_count : r.total != null ? r.total : r.ratings_count);
    return { id: String(id).toLowerCase(), role: r.role || r.user_role || null, avg: avg, count: count };
  }

  /* The function may return an array of rows, or an object keyed by user id */
  function readRows(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data.map(readRow).filter(Boolean);
    if (typeof data === 'object') {
      if (Array.isArray(data.rows)) return data.rows.map(readRow).filter(Boolean);
      return Object.keys(data).map(function (k) {
        var v = data[k];
        if (v && typeof v === 'object') return readRow(Object.assign({ user_id: k }, v));
        return null;
      }).filter(Boolean);
    }
    return [];
  }

  async function viaFunction(sb, ids, role) {
    /* The parameter names of rating_summaries() are not in the repo: try the likely ones, first answer wins. */
    var shapes = [
      { p_users: ids, p_role: role },
      { p_user_ids: ids, p_role: role },
      { p_ids: ids, p_role: role },
      { user_ids: ids, role: role },
      { p_users: ids }
    ];
    for (var i = 0; i < shapes.length; i++) {
      try {
        var res = await sb.rpc('rating_summaries', shapes[i]);
        if (!res.error) return readRows(res.data);
      } catch (e) { /* try the next shape */ }
    }
    return null;
  }

  async function viaTable(sb, ids, role) {
    try {
      var res = await sb.from('rating_summary').select('*').in('user_id', ids);
      if (res.error || !res.data) return null;
      return readRows(res.data).filter(function (r) { return !r.role || r.role === role; });
    } catch (e) { return null; }
  }

  async function fetchBatch(ids, role) {
    var sb = client();
    if (!sb || !ids.length) return;
    var rows = await viaFunction(sb, ids, role);
    if (rows === null) rows = await viaTable(sb, ids, role);
    if (rows === null) return;   /* no answer: leave them unasked so a later call can try again, and show nothing */
    var seen = {};
    rows.forEach(function (r) {
      if (r.role && r.role !== role) return;
      if (r.count > 0 && r.avg > 0) { cache[role][r.id] = { avg: r.avg, count: r.count }; seen[r.id] = true; }
    });
    ids.forEach(function (id) { if (!seen[id]) cache[role][id] = null; });
  }

  function load(ids, role) {
    role = norm(role);
    var want = [];
    (ids || []).forEach(function (id) {
      var k = String(id || '').toLowerCase();
      if (UUID.test(k) && want.indexOf(k) === -1 && !(k in cache[role])) want.push(k);
    });
    var jobs = [];
    for (var i = 0; i < want.length; i += CHUNK) jobs.push(fetchBatch(want.slice(i, i + CHUNK), role));
    return Promise.all(jobs).then(function () {
      var out = {};
      (ids || []).forEach(function (id) {
        var k = String(id || '').toLowerCase();
        if (cache[role][k]) out[k] = cache[role][k];
      });
      return out;
    }).catch(function () { return {}; });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function paint(span, r) {
    while (span.firstChild) span.removeChild(span.firstChild);
    var badge = el('span', 'rating-badge');
    if (r) {
      badge.setAttribute('aria-label', r.avg.toFixed(1) + ' out of 5, ' + r.count + (r.count === 1 ? ' review' : ' reviews'));
      badge.appendChild(el('span', 'rating-badge-star', '\u2605'));
      badge.appendChild(document.createTextNode(r.avg.toFixed(1)));
      badge.appendChild(el('span', 'rating-badge-count', '(' + r.count + ')'));
    } else {
      badge.className = 'rating-badge is-new';
      badge.appendChild(document.createTextNode('New'));
    }
    span.appendChild(badge);
  }

  function decorate(scope) {
    scope = scope || document;
    if (!scope.querySelectorAll) return Promise.resolve();
    var spans = Array.prototype.filter.call(scope.querySelectorAll('[data-rating-user]'), function (s) {
      return !s.firstChild && !s.hasAttribute('data-rating-done');
    });
    if (!spans.length) return Promise.resolve();
    var byRole = { tasker: [], customer: [] };
    spans.forEach(function (s) {
      s.setAttribute('data-rating-done', '1');
      byRole[norm(s.getAttribute('data-rating-role'))].push(s);
    });
    return Promise.all(['tasker', 'customer'].map(function (role) {
      var group = byRole[role];
      if (!group.length) return null;
      return load(group.map(function (s) { return s.getAttribute('data-rating-user'); }), role).then(function (map) {
        group.forEach(function (s) {
          var r = map[String(s.getAttribute('data-rating-user') || '').toLowerCase()] || null;
          if (r) paint(s, r);
          else if (s.hasAttribute('data-rating-new')) paint(s, null);
          /* no answer yet (no client, or the lookup failed): let a later pass try this span again */
          if (!(String(s.getAttribute('data-rating-user') || '').toLowerCase() in cache[role])) s.removeAttribute('data-rating-done');
        });
      });
    })).catch(function () { /* badges stay empty */ });
  }

  root.STRating = { load: load, decorate: decorate };

  /* Cards are added after load (rows, filters, paging): fill new spans in one batch shortly after the last change. */
  var timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(function () { decorate(document); }, 120); }
  function start() {
    decorate(document);
    if (typeof MutationObserver === 'function' && document.body) {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);

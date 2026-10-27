/* ============================================================
   STREET TASKER: local-tasker-public.js  (Local Tasker stage 4C-2)
   Customer-side helper. For a page's user ids it asks the database
   (local_tasker_public_info, callable by visitors) which of them are
   PUBLISHED Local Taskers, and turns their photo paths into short-lived
   signed links (the bucket is private; decision D46).
   Needs: supabaseClient.js (window.supabase). Safe to load before it is used.
   Never throws: if anything fails the page simply shows no Local Tasker
   label (the person still appears as a normal listing). The label comes
   ONLY from the database function, never from a column (decision D50).
   ============================================================ */
(function () {
  'use strict';
  var BUCKET = 'local-tasker-photos';
  var TTL = 3600;                     /* signed links last one hour */
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var info = {};                      /* user id -> { coverUrl } for published Local Taskers */
  var asked = {};                     /* user id -> true once the database answered for it */

  function sb() { return window.supabase || null; }

  /* paths -> { path: signedUrl } (missing or failed links are simply absent) */
  async function sign(paths) {
    var out = {};
    var list = Array.from(new Set((paths || []).filter(Boolean)));
    if (!list.length || !sb()) return out;
    try {
      var r = await sb().storage.from(BUCKET).createSignedUrls(list, TTL);
      (r.data || []).forEach(function (x) { if (x && x.path && x.signedUrl && !x.error) out[x.path] = x.signedUrl; });
    } catch (e) { /* no pictures: the card shows initials */ }
    return out;
  }

  /* Ask once for any ids not asked yet (100 per call, the database limit). */
  async function load(ids) {
    if (!sb()) return;
    var todo = Array.from(new Set((ids || []).map(String).filter(function (x) { return UUID.test(x) && !asked[x]; })));
    for (var i = 0; i < todo.length; i += 100) {
      var chunk = todo.slice(i, i + 100);
      try {
        var r = await sb().rpc('local_tasker_public_info', { p_ids: chunk });
        if (r.error) continue;                 /* not asked: a later call may retry */
        var rows = r.data || [];
        var urls = await sign(rows.map(function (x) { return x.cover_path; }));
        chunk.forEach(function (id) { asked[id] = true; });
        rows.forEach(function (x) { info[String(x.user_id)] = { coverUrl: urls[x.cover_path] || null }; });
      } catch (e) { /* leave the chunk unasked */ }
    }
  }

  /* Photos of ONE published person: [{ url, caption, isCover }] */
  async function photos(id) {
    if (!sb() || !UUID.test(String(id))) return [];
    try {
      var r = await sb().rpc('local_tasker_public_photos', { p_tasker: String(id) });
      if (r.error) return [];
      var rows = r.data || [];
      var urls = await sign(rows.map(function (x) { return x.path; }));
      return rows.filter(function (x) { return urls[x.path]; })
        .map(function (x) { return { url: urls[x.path], caption: x.caption || '', isCover: !!x.is_cover }; });
    } catch (e) { return []; }
  }

  /* Public cards for local-taskers.html: published people only. */
  async function cards(limit) {
    if (!sb()) return [];
    try {
      var r = await sb().rpc('local_tasker_public_cards', { p_limit: limit || 12 });
      if (r.error) return [];
      var rows = r.data || [];
      var urls = await sign(rows.map(function (x) { return x.cover_path; }));
      return rows.map(function (x) {
        return {
          user_id: String(x.user_id), name: x.display_name || '', service: x.service_name || '',
          category: x.category || '', location: x.location || '', price: Number(x.price) || 0,
          rate_unit: x.rate_unit || '/job', specialties: x.specialties || [], coverUrl: urls[x.cover_path] || null
        };
      });
    } catch (e) { return []; }
  }

  window.STLocal = {
    LABEL: 'Local Tasker',
    LABEL_PHONE: 'Phone Assisted',
    /* Plain-text note shown on a Local Tasker's profile. No fee, donation or percentage is stated here. */
    NOTE: 'This is a Local Tasker. A StreetTasker coordinator talks to them by phone to confirm your job, so skilled people who are not online can still take work. Making room for people without a smartphone is part of how StreetTasker is built.',
    load: load,
    isLocal: function (id) { return !!info[String(id)]; },
    coverUrl: function (id) { return (info[String(id)] && info[String(id)].coverUrl) || null; },
    photos: photos,
    cards: cards
  };
})();

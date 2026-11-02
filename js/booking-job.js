/* ============================================================
   STREETTASKER — booking-job.js
   The job details a customer gives in the booking pop-up (tasker-profile.html), read back for the two
   Bookings pages (bookings.html = tasker, customer-bookings.html = customer).

   Reads:  bookings.job_title / job_description / job_area / job_urgency / job_photos (sql/booking-popup-stage5.sql).
           Requests sent before that SQL was run keep the same details as plain lines in bookings.notes:
             <title> / <description> / "Area: ..." / "Address: ..." / "Urgency: ..." / "Photos: <url> <url>"
           so parse() reads the columns first and falls back to those lines.
   Private: booking_private.address (the street address) is returned by the database only to the customer,
           and to the tasker once the booking is confirmed. Nothing here decides that; the database does.
   Needs:  window.supabase (loadAddresses / loadOne only). Callers may pass their own esc() and icon(); both are optional.
   Also:   when(raw) reads bookings.scheduled_time, which the pop-up saves as "YYYY-MM-DD \u2014 <time window>"
           (for example "2026-11-05 \u2014 Morning (7am \u2013 12pm)"). That is NOT a valid Date string, so every page
           that shows the schedule must go through when() instead of new Date(raw).
   ============================================================ */
(function () {
  'use strict';

  var COLS = 'job_title,job_description,job_area,job_urgency,job_photos';
  var MAX_PHOTOS = 5;

  /* Photo links must be public files in our own storage (what the pop-up uploads), nothing from other sites */
  function isOwnPhoto(u) { return /^https:\/\/[^\s\/]+\/storage\/v1\/object\/public\/\S+$/.test(u || ''); }
  function text(v) { return String(v == null ? '' : v).trim(); }

  /* Returns { title, description, area, urgent, photos } or null when the booking has no job details. */
  function parse(b) {
    if (!b) return null;
    if (text(b.job_title)) {
      var ph = Array.isArray(b.job_photos) ? b.job_photos : [];
      return {
        title: text(b.job_title), description: text(b.job_description), area: text(b.job_area),
        urgent: b.job_urgency === 'urgent', flexible: b.job_urgency === 'flexible', photos: ph.filter(isOwnPhoto).slice(0, MAX_PHOTOS)
      };
    }
    /* Older request: the same details as lines in notes. Only trusted when the Area and Urgency lines are there. */
    var notes = text(b.notes);
    if (!/\nArea: /.test(notes) || !/\nUrgency: (Flexible|Urgent)\s*(\nPhotos: [^\n]*)?$/.test(notes)) return null;
    var lines = notes.split('\n'), first = lines.length, i, area = '', urgent = false, photos = [];
    for (i = 1; i < lines.length; i++) {
      var ln = lines[i], m;
      if ((m = /^Area: (.*)$/.exec(ln))) { area = m[1].trim(); if (i < first) first = i; }
      else if (/^Address: /.test(ln)) { if (i < first) first = i; }      /* never shown from notes: that was the open copy */
      else if ((m = /^Urgency: (Flexible|Urgent)$/.exec(ln))) { urgent = m[1] === 'Urgent'; if (i < first) first = i; }
      else if ((m = /^Photos: (.*)$/.exec(ln))) { photos = m[1].trim().split(/\s+/).filter(isOwnPhoto).slice(0, MAX_PHOTOS); if (i < first) first = i; }
    }
    return {
      title: lines[0].replace(/^\[[^\]]+\]\s*/, '').trim(),
      description: lines.slice(1, first).join('\n').trim(), area: area, urgent: urgent, flexible: !urgent, photos: photos
    };
  }

  /* { booking id: street address } for the bookings this person is allowed to read it for. Never throws. */
  async function loadAddresses(ids) {
    var out = {};
    if (!ids || !ids.length || !window.supabase) return out;
    try {
      var r = await window.supabase.from('booking_private').select('booking_id,address').in('booking_id', ids);
      if (r.error) return out;
      (r.data || []).forEach(function (x) { if (x.booking_id && x.address) out[x.booking_id] = x.address; });
    } catch (e) { /* table not created yet, or blocked: the card just has no address line */ }
    return out;
  }

  /* Safe defaults so a page without its own esc() / icon() (the job room, the dashboard) can still call html() */
  function escHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function noIcon() { return ''; }

  /* Reads scheduled_time as saved by the pop-up ("YYYY-MM-DD \u2014 Morning (7am \u2013 12pm)"), a plain date, a
     "YYYY-MM-DD HH:MM" stamp, or a full ISO timestamp. Returns { date, slot, hasTime }. date is null when unreadable. */
  function when(raw) {
    var s = text(raw), d, m;
    if (!s) return { date: null, slot: '', hasTime: false };
    if (/T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) { d = new Date(s); return { date: isNaN(d) ? null : d, slot: '', hasTime: !isNaN(d) }; }
    m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(s);
    if (m) {
      var rest = m[4].replace(/^[\s\u2014\u2013-]+/, '').trim(), t = /^(\d{1,2}):(\d{2})/.exec(rest);
      d = new Date(+m[1], +m[2] - 1, +m[3], t ? +t[1] : 0, t ? +t[2] : 0);
      return { date: isNaN(d) ? null : d, slot: t ? '' : (rest === 'Flexible' ? 'Flexible time' : rest), hasTime: !!t };
    }
    d = new Date(s);
    return { date: isNaN(d) ? null : d, slot: '', hasTime: !isNaN(d) };
  }

  /* One booking's job details for the job room: { job, address, scheduled }. Never throws. */
  async function loadOne(id) {
    var out = { job: null, address: '', scheduled: '' };
    if (!id || !window.supabase) return out;
    var sets = ['id,notes,scheduled_time,' + COLS, 'id,notes,scheduled_time'];
    for (var i = 0; i < sets.length; i++) {
      try {
        var r = await window.supabase.from('bookings').select(sets[i]).eq('id', id).maybeSingle();
        if (r.error) continue;                       /* job columns not created yet: try the smaller set */
        if (r.data) { out.job = parse(r.data); out.scheduled = r.data.scheduled_time || ''; }
        break;
      } catch (e) { /* try the next set */ }
    }
    var a = await loadAddresses([id]);
    out.address = a[id] || '';
    return out;
  }

  /* The block on a card: area + timing chips, the street address (when allowed), every photo (max 5).
     opts.description adds the customer's description above the chips (the Bookings card shows it as its own Note). */
  function html(job, address, esc, icon, opts) {
    if (!job) return '';
    esc = esc || escHtml; icon = icon || noIcon; opts = opts || {};
    var chips = '';
    if (job.area) chips += '<span class="bk-job-chip">' + icon('pin') + esc(job.area) + '</span>';
    if (job.urgent) chips += '<span class="bk-job-chip is-urgent">' + icon('clock') + 'Urgent</span>';
    else if (job.flexible) chips += '<span class="bk-job-chip">' + icon('calendar') + 'Flexible timing</span>';
    var out = (opts.description && job.description) ? '<p class="bk-job-desc">' + esc(job.description) + '</p>' : '';
    out += chips ? '<div class="bk-job-chips">' + chips + '</div>' : '';
    if (address) out += '<p class="bk-job-address">' + icon('lock') + '<span><strong>Address:</strong> ' + esc(address) + '</span></p>';
    if (job.photos.length) {
      out += '<div class="bk-job-photos">' + job.photos.map(function (u, i) {
        return '<a class="bk-job-thumb" href="' + esc(u) + '" target="_blank" rel="noopener" aria-label="Open job photo ' + (i + 1) + ' of ' + job.photos.length + '"><img src="' + esc(u) + '" alt="" loading="lazy" /></a>';
      }).join('') + '</div>';
    }
    return out ? '<div class="bk-job">' + out + '</div>' : '';
  }

  window.STBookingJob = { COLS: COLS, parse: parse, when: when, loadAddresses: loadAddresses, loadOne: loadOne, html: html };
})();

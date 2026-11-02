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
   Needs:  window.supabase (loadAddresses only). Callers pass in their own esc() and icon().
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
        urgent: b.job_urgency === 'urgent', photos: ph.filter(isOwnPhoto).slice(0, MAX_PHOTOS)
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
      description: lines.slice(1, first).join('\n').trim(), area: area, urgent: urgent, photos: photos
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

  /* The compact block on a card: area + urgency chips, the street address (when allowed), up to 3 photo thumbnails. */
  function html(job, address, esc, icon) {
    if (!job) return '';
    var chips = '';
    if (job.area) chips += '<span class="bk-job-chip">' + icon('pin') + esc(job.area) + '</span>';
    if (job.urgent) chips += '<span class="bk-job-chip is-urgent">' + icon('clock') + 'Urgent</span>';
    var out = chips ? '<div class="bk-job-chips">' + chips + '</div>' : '';
    if (address) out += '<p class="bk-job-address">' + icon('lock') + '<span><strong>Address:</strong> ' + esc(address) + '</span></p>';
    if (job.photos.length) {
      var shown = job.photos.slice(0, 3), more = job.photos.length - shown.length;
      out += '<div class="bk-job-photos">' + shown.map(function (u, i) {
        return '<a class="bk-job-thumb" href="' + esc(u) + '" target="_blank" rel="noopener" aria-label="Open job photo ' + (i + 1) + '"><img src="' + esc(u) + '" alt="" loading="lazy" /></a>';
      }).join('') + (more > 0 ? '<span class="bk-job-more">+' + more + '</span>' : '') + '</div>';
    }
    return out ? '<div class="bk-job">' + out + '</div>' : '';
  }

  window.STBookingJob = { COLS: COLS, parse: parse, loadAddresses: loadAddresses, html: html };
})();

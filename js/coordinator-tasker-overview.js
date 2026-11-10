/* ============================================================
   StreetTasker — coordinator-tasker-overview.js (Stage T2)
   The Overview tab on coordinator-tasker.html?id=<tasker user id>.
   Real data only, read-only, nothing is written:
     rpc local_booking_list      (shared with the page frame through window.STCoTasker.bookings())
     rpc coordinator_chat_list   (shared: window.STCoTasker.chats())
     rpc idv_local_status        the same identity answer the Verification card shows
     local_tasker_profiles       this Local Tasker's status and needs_republish (the coordinator's own RLS)
   A figure that cannot be read stays a dash; a card that cannot be read says so. Never an invented number.
   Left out on purpose (no real source yet): client rating, the coordinator's own share per month (that is the Earnings tab, T5).
   Loads the first time the tab is opened (event coordinator-tasker:tab from js/coordinator-tasker-shell.js).
   Renders with textContent only (names are user-entered data).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  var taskerId = new URLSearchParams(window.location.search).get('id');
  var MAX_BOOKINGS = 4;
  var MONTHS = 6;
  var ready = false, opened = false, started = false, seq = 0;

  function $(id) { return document.getElementById(id); }
  function setText(key, text) { var n = document.querySelector('[data-ov="' + key + '"]'); if (n) n.textContent = text; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* ── Which bookings count ─────────────────────────────────── */
  function mine(rows) { return rows.filter(function (r) { return r && r.tasker_user_id === taskerId; }); }
  function isOpenForMe(r) { return window.STCoTasker ? window.STCoTasker.isOpenForMe(r) : false; }
  function isActive(r) { return r.open === true && r.lt_status !== 'needs_reassignment' && !r.frozen && r.booking_status !== 'disputed'; }
  function isDone(r) { return r.booking_status === 'completed'; }
  function doneDate(r) { var d = new Date(r.updated_at || r.created_at); return isNaN(d.getTime()) ? null : d; }
  function monthIndex(d) { return d.getFullYear() * 12 + d.getMonth(); }

  /* ── Stat tiles ───────────────────────────────────────────── */
  function paintTiles(rows) {
    var now = monthIndex(new Date()), done = rows.filter(isDone);
    var thisM = 0, lastM = 0, valueM = 0;
    done.forEach(function (r) {
      var d = doneDate(r); if (!d) return;
      var m = monthIndex(d);
      if (m === now) { thisM += 1; valueM += num(r.amount); }
      else if (m === now - 1) lastM += 1;
    });
    setText('jobs', String(thisM));
    var diff = thisM - lastM;
    setText('jobs-note', diff > 0 ? '+' + diff + ' vs last month' : diff < 0 ? '\u2212' + Math.abs(diff) + ' vs last month' : 'Same as last month');

    var active = rows.filter(isActive);
    setText('active', String(active.length));
    var held = 0;
    active.forEach(function (r) { if (r.payment_status === 'paid') held += num(r.amount); });
    setText('active-note', held > 0 ? B.naira(held) + ' held safely' : active.length ? 'Nothing paid yet' : 'Open right now');

    var need = rows.filter(function (r) { return isOpenForMe(r) && B.nextAction(r).tab === 'action'; }).length;
    setText('action', String(need));
    setText('action-note', need ? 'Bookings waiting for you' : 'All caught up');

    setText('value', B.naira(valueM) || '\u20A60');
    setText('value-note', thisM ? plural(thisM, 'completed job', 'completed jobs') + ', before fees' : 'No completed jobs yet this month');
    return need;
  }

  function dashTiles() {
    ['jobs', 'active', 'action', 'value'].forEach(function (k) { setText(k, '\u2014'); });
  }

  /* ── Open bookings ────────────────────────────────────────── */
  function ago(iso) {
    var t = new Date(iso).getTime();
    if (!iso || isNaN(t)) return '';
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return 'Received just now';
    if (m < 60) return 'Received ' + m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 24) return 'Received ' + h + 'h ago';
    var d = Math.round(h / 24);
    return 'Received ' + d + (d === 1 ? ' day ago' : ' days ago');
  }

  function bookingCard(r, act) {
    var issue = r.frozen === true || r.booking_status === 'disputed';
    var li = C.el('li', 'co-req-item' + (issue ? ' is-issue' : ''));
    var top = C.el('div', 'co-req-top'), tags = C.el('div', 'co-req-tags');
    tags.appendChild(C.el('span', issue ? 'co-status co-status--inactive' : 'co-status', issue ? 'Problem reported' : B.ltLabel(r.lt_status)));
    var when = ago(r.created_at); if (when) tags.appendChild(C.el('span', 'co-req-when', when));
    top.appendChild(tags);
    var amt = B.naira(r.amount); if (amt) top.appendChild(C.el('span', 'co-req-amount', amt));
    li.appendChild(top);
    li.appendChild(C.el('h3', 'co-req-title', r.title || 'Booking'));
    if (r.customer_name) li.appendChild(C.el('p', 'co-req-meta', 'Customer: ' + r.customer_name));
    li.appendChild(C.el('p', 'co-req-meta', act.text));
    var foot = C.el('div', 'co-req-foot'), sub = [B.ref(r.booking_id)];
    if (B.whenText(r)) sub.push(B.whenText(r));
    foot.appendChild(C.el('p', 'co-req-sub', sub.join(' \u00B7 ')));
    var a = C.el('a', 'btn btn-sm ' + (act.tab === 'action' || issue ? 'btn-primary' : 'btn-mint'), act.tab === 'action' ? 'Open and act' : 'Open booking');
    a.href = 'coordinator-booking.html?id=' + encodeURIComponent(r.booking_id);
    a.setAttribute('aria-label', 'Open booking: ' + (r.title || 'Booking'));
    foot.appendChild(a);
    li.appendChild(foot);
    return li;
  }

  function paintBookings(rows) {
    var list = $('coOvBookList'), empty = $('coOvBookEmpty');
    $('coOvBookLoading').hidden = true;
    var rank = { action: 0, problem: 1, waiting: 2 };
    var open = rows.filter(isOpenForMe).map(function (r) { return { r: r, a: B.nextAction(r) }; });
    open.sort(function (x, y) { return (rank[x.a.tab] || 2) - (rank[y.a.tab] || 2); });   /* stable: newest first inside a group */
    list.textContent = '';
    open.slice(0, MAX_BOOKINGS).forEach(function (x) { list.appendChild(bookingCard(x.r, x.a)); });
    if (open.length > MAX_BOOKINGS) {
      var li = C.el('li', 'co-req-more'), a = C.el('a', 'co-fact-link', (open.length - MAX_BOOKINGS) + ' more in Bookings \u2192');
      a.href = 'coordinator-bookings.html'; li.appendChild(a); list.appendChild(li);
    }
    list.hidden = !open.length;
    empty.hidden = !!open.length;
  }

  /* ── Past six months ──────────────────────────────────────── */
  function compact(n) {
    if (n >= 1e6) return '\u20A6' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return '\u20A6' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return '\u20A6' + Math.round(n);
  }

  function paintChart(rows) {
    var ul = $('coOvBars'), foot = $('coOvChartFoot'), empty = $('coOvChartEmpty');
    $('coOvChartLoading').hidden = true;
    var now = new Date(), nowIdx = monthIndex(now), buckets = [];
    for (var i = MONTHS - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ idx: monthIndex(d), d: d, value: 0, jobs: 0 });
    }
    rows.filter(isDone).forEach(function (r) {
      var d = doneDate(r); if (!d) return;
      var b = buckets.filter(function (x) { return x.idx === monthIndex(d); })[0];
      if (b) { b.value += num(r.amount); b.jobs += 1; }
    });
    var total = 0, jobs = 0, max = 0;
    buckets.forEach(function (b) { total += b.value; jobs += b.jobs; if (b.value > max) max = b.value; });
    ul.textContent = '';
    if (!jobs) { ul.hidden = true; foot.hidden = true; empty.hidden = false; return; }
    buckets.forEach(function (b) {
      var li = C.el('li', 'co-ov-bar' + (b.idx === nowIdx ? ' is-now' : ''));
      var full = b.d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) + ': ' + (B.naira(b.value) || '\u20A60') + ', ' + plural(b.jobs, 'job', 'jobs');
      li.appendChild(C.el('span', 'sr-only', full));
      var amt = C.el('span', 'co-ov-bar-amt', b.value > 0 ? compact(b.value) : '\u2014'); amt.setAttribute('aria-hidden', 'true'); li.appendChild(amt);
      var track = C.el('span', 'co-ov-bar-track'); track.setAttribute('aria-hidden', 'true');
      var fill = C.el('span', 'co-ov-bar-fill');
      fill.style.setProperty('--bar', String(max > 0 ? Math.max(0, Math.round(b.value / max * 100)) : 0));
      track.appendChild(fill); li.appendChild(track);
      var mo = C.el('span', 'co-ov-bar-month', b.d.toLocaleDateString(undefined, { month: 'short' })); mo.setAttribute('aria-hidden', 'true'); li.appendChild(mo);
      ul.appendChild(li);
    });
    ul.hidden = false; empty.hidden = true;
    foot.textContent = '';
    foot.appendChild(document.createTextNode('Total for ' + MONTHS + ' months: '));
    foot.appendChild(C.el('strong', null, B.naira(total) || '\u20A60'));
    foot.appendChild(document.createTextNode(' from ' + plural(jobs, 'completed job', 'completed jobs') + '.'));
    foot.hidden = false;
  }

  function chartUnreadable() {
    $('coOvChartLoading').hidden = true; $('coOvBars').hidden = true; $('coOvChartFoot').hidden = true; $('coOvChartEmpty').hidden = true;
  }

  /* ── Action needed ────────────────────────────────────────── */
  function unreadFor(rows, chats) {
    var ids = {}; rows.forEach(function (r) { ids[r.booking_id] = true; });
    var n = 0;
    chats.forEach(function (c) { if (c && c.access === 'coordinator' && c.unread > 0 && ids[c.booking_id]) n += c.unread; });
    return n;
  }

  function attnRow(it) {
    var li = C.el('li', 'co-attn-item'), txt = C.el('div', 'co-attn-text');
    txt.appendChild(C.el('p', 'co-attn-name', it.title));
    txt.appendChild(C.el('p', 'co-attn-reason' + (it.bad ? ' is-bad' : ''), it.text));
    li.appendChild(txt);
    var a = C.el('a', 'co-fact-link co-attn-action', it.action + ' \u2192');
    a.href = it.href; a.setAttribute('aria-label', it.action + ': ' + it.title);
    li.appendChild(a);
    return li;
  }

  function paintAttention(items, notes) {
    var ul = $('coOvAttnList'), count = $('coOvAttnCount'), note = $('coOvAttnNote');
    $('coOvAttnLoading').hidden = true;
    ul.textContent = '';
    items.forEach(function (it) { ul.appendChild(attnRow(it)); });
    ul.hidden = !items.length;
    count.hidden = !items.length; if (items.length) count.textContent = String(items.length);
    $('coOvAttnEmpty').hidden = items.length > 0 || notes.length > 0;   /* never say "all good" when something could not be checked */
    note.textContent = notes.join(' '); note.hidden = !notes.length;
  }

  async function loadAttention(rows, chats, needBookings, mark) {
    var items = [], notes = [], enc = encodeURIComponent(taskerId);
    if (needBookings > 0) items.push({ title: plural(needBookings, 'booking needs', 'bookings need') + ' your action', text: 'A customer or the Local Tasker is waiting for you.', action: 'Open bookings', href: 'coordinator-bookings.html', bad: false });
    if (rows && chats) {
      var un = unreadFor(rows, chats);
      if (un > 0) items.push({ title: plural(un, 'new message', 'new messages'), text: 'From customers of this Local Tasker.', action: 'Open inbox', href: 'coordinator-chat.html', bad: false });
    } else if (chats === null) notes.push('Messages could not be checked just now.');

    var out = await Promise.all([
      Promise.resolve(window.supabase.rpc('idv_local_status', { p_tasker: taskerId })).then(function (r) { return r; }, function () { return null; }),
      Promise.resolve(window.supabase.from('local_tasker_profiles').select('status, needs_republish').eq('tasker_user_id', taskerId).maybeSingle()).then(function (r) { return r; }, function () { return null; })
    ]);
    if (mark !== seq) return;

    var idv = out[0];
    if (idv && !idv.error && idv.data && typeof idv.data === 'object' && typeof C.verifyView === 'function') {
      var v = C.verifyView(idv.data, taskerId);
      if (v.group !== 'verified' && v.action && v.href) {
        items.push({ title: 'Identity check: ' + v.label, text: 'This Local Tasker must pass the identity check before working.', action: v.action, href: v.href, bad: v.tone === 'bad' || v.tone === 'review' });
      }
    } else notes.push('The identity check could not be read just now.');

    var pr = out[1];
    if (pr && !pr.error && pr.data) {
      if (pr.data.status === 'published' && pr.data.needs_republish === true) items.push({ title: 'Profile changes need republishing', text: 'Customers still see the old version.', action: 'Republish', href: 'coordinator-publish.html?id=' + enc, bad: false });
      else if (pr.data.status === 'draft') items.push({ title: 'Draft profile, not published yet', text: 'Customers cannot find this Local Tasker yet.', action: 'Complete', href: 'coordinator-tasker-edit.html?id=' + enc, bad: false });
      else if (pr.data.status === 'inactive') items.push({ title: 'Profile is inactive', text: 'Customers cannot find this Local Tasker.', action: 'Open profile', href: 'coordinator-publish.html?id=' + enc, bad: true });
    } else notes.push('The profile status could not be read just now.');

    paintAttention(items, notes);
  }

  /* ── Quick actions ────────────────────────────────────────── */
  function wireQuickActions() {
    var map = { coQaService: 'coordinator-service-edit.html', coQaPhotos: 'coordinator-photos.html', coQaPayout: 'coordinator-tasker-payout.html', coQaPublish: 'coordinator-publish.html' };
    Object.keys(map).forEach(function (id) {
      var a = $(id); if (!a) return;
      if (C.isUuid(taskerId)) a.href = map[id] + '?id=' + encodeURIComponent(taskerId);
      else a.classList.add('is-off');
    });
  }

  /* ── Load ─────────────────────────────────────────────────── */
  async function load(again) {
    var mark = ++seq;
    $('coOvError').hidden = true;
    $('coOvBookLoading').hidden = false; $('coOvBookList').hidden = true; $('coOvBookEmpty').hidden = true;
    $('coOvChartLoading').hidden = false; $('coOvBars').hidden = true; $('coOvChartFoot').hidden = true; $('coOvChartEmpty').hidden = true;
    $('coOvAttnLoading').hidden = false; $('coOvAttnList').hidden = true; $('coOvAttnEmpty').hidden = true; $('coOvAttnNote').hidden = true; $('coOvAttnCount').hidden = true;

    var out = await Promise.all([window.STCoTasker.bookings(again), window.STCoTasker.chats(again)]);
    if (mark !== seq) return;
    var all = out[0], chats = out[1];
    if (!all) {
      dashTiles(); chartUnreadable();
      $('coOvBookLoading').hidden = true;
      $('coOvError').hidden = false;
      loadAttention(null, chats, 0, mark);
      return;
    }
    var rows = mine(all);
    var need = paintTiles(rows);
    paintBookings(rows);
    paintChart(rows);
    loadAttention(rows, chats, need, mark);
  }

  function maybeStart() {
    if (started || !ready || !opened || !C.isUuid(taskerId) || !window.STCoTasker) return;
    started = true;
    wireQuickActions();
    load(false);
  }

  document.addEventListener('coordinator:ready', function () { ready = true; maybeStart(); });
  document.addEventListener('coordinator-tasker:tab', function (e) { if (e.detail && e.detail.tab === 'overview') { opened = true; maybeStart(); } });
  document.addEventListener('DOMContentLoaded', function () {
    var retry = $('coOvRetry');
    if (retry) retry.addEventListener('click', function () { if (started) load(true); });
  });
})();

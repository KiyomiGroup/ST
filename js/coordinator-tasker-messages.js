/* ============================================================
   StreetTasker — coordinator-tasker-messages.js (Stage T4)
   The Messages tab on coordinator-tasker.html: this Local Tasker's conversations (only the ones the coordinator handles,
   access = 'coordinator'), newest first, All / Unread, search; each row opens coordinator-chat.html?booking=<id>.
   Read-only. A chat row has no Local Tasker id, so it is matched through its booking in the booking list. Both lists come from
   the page frame (window.STCoTasker), so no extra call. If either cannot be read: an error with Try again, never "no conversations".
   Loads the first time the tab is opened. Renders with textContent only (names and messages are user-entered data).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  var taskerId = new URLSearchParams(window.location.search).get('id');
  var rows = [], filter = 'all', query = '';
  var ready = false, opened = false, started = false, seq = 0;

  function $(id) { return document.getElementById(id); }

  function preview(r) {
    var t = String(r.last_message || '');
    if (/^PAYMENT_REQUEST:/.test(t)) return 'Payment request';
    if (/^[A-Z_]{4,}:/.test(t)) return 'Job Room update';
    return t;
  }
  function ago(iso) {
    var t = new Date(iso).getTime();
    if (!iso || isNaN(t)) return '';
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    var d = Math.round(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }
  function unreadCount() { return rows.filter(function (r) { return r.unread > 0; }).length; }

  function buildTabs() {
    var wrap = $('coTmTabs'); wrap.textContent = '';
    [{ id: 'all', label: 'All (' + rows.length + ')' }, { id: 'unread', label: 'Unread (' + unreadCount() + ')' }].forEach(function (t) {
      var b = C.el('button', 'co-filter' + (t.id === filter ? ' is-active' : ''), t.label);
      b.type = 'button'; b.setAttribute('aria-pressed', t.id === filter ? 'true' : 'false');
      b.addEventListener('click', function () { filter = t.id; buildTabs(); render(); });
      wrap.appendChild(b);
    });
  }

  function row(r) {
    var li = C.el('li', 'co-msgs-item' + (r.unread > 0 ? ' is-unread' : ''));
    var a = C.el('a', 'co-msgs-link');
    a.href = 'coordinator-chat.html?booking=' + encodeURIComponent(r.booking_id);
    a.setAttribute('aria-label', 'Open conversation with ' + (r.customer_name || 'customer') + (r.unread > 0 ? ', ' + r.unread + ' unread' : ''));
    a.appendChild(C.el('span', 'co-tasker-avatar co-msgs-avatar', C.initialsOf(r.customer_name, 'CU')));
    var body = C.el('div', 'co-msgs-body'), top = C.el('div', 'co-msgs-top');
    top.appendChild(C.el('span', 'co-msgs-name', r.customer_name || 'Customer'));
    var when = ago(r.last_message_at || r.created_at); if (when) top.appendChild(C.el('span', 'co-req-when', when));
    body.appendChild(top);
    body.appendChild(C.el('p', 'co-msgs-text', preview(r) || 'No messages yet'));
    a.appendChild(body);
    if (r.unread > 0) {
      var u = C.el('span', 'co-attn-count co-msgs-unread', r.unread > 98 ? '99+' : String(r.unread));
      u.setAttribute('aria-label', r.unread + ' unread'); a.appendChild(u);
    } else a.appendChild(C.el('span', 'co-msgs-open', 'Open \u2192'));
    li.appendChild(a);
    return li;
  }

  function render() {
    var list = $('coTmList'), empty = $('coTmEmpty'), nomatch = $('coTmNoMatch'), tools = $('coTmToolbar');
    list.textContent = ''; empty.hidden = true; nomatch.hidden = true;
    if (!rows.length) { list.hidden = true; tools.hidden = true; empty.hidden = false; return; }
    tools.hidden = false;
    var q = query.trim().toLowerCase();
    var shown = rows.filter(function (r) {
      if (q) return ((r.customer_name || '') + ' ' + preview(r)).toLowerCase().indexOf(q) > -1;   /* a search looks across both views */
      return filter === 'all' || r.unread > 0;
    });
    shown.forEach(function (r) { list.appendChild(row(r)); });
    list.hidden = !shown.length;
    if (!shown.length) {
      nomatch.hidden = false;
      $('coTmNoMatchTitle').textContent = q ? 'No match' : 'Nothing here';
      $('coTmNoMatchText').textContent = q ? 'None of these conversations match that search.' : 'No unread conversations right now.';
    }
  }

  function summary() {
    var n = rows.reduce(function (s, r) { return s + (r.unread > 0 ? r.unread : 0); }, 0);
    $('coTmSummary').textContent = n ? n + (n === 1 ? ' unread message.' : ' unread messages.') : 'No unread messages.';
  }

  async function load(again) {
    var mark = ++seq;
    $('coTmLoading').hidden = false; $('coTmList').hidden = true; $('coTmToolbar').hidden = true;
    $('coTmEmpty').hidden = true; $('coTmNoMatch').hidden = true; $('coTmError').hidden = true;
    var out = await Promise.all([window.STCoTasker.bookings(again), window.STCoTasker.chats(again)]);
    if (mark !== seq) return;
    $('coTmLoading').hidden = true;
    var bookings = out[0], chats = out[1];
    if (!bookings || !chats) { $('coTmError').hidden = false; return; }
    var mine = {};
    bookings.forEach(function (b) { if (b && b.tasker_user_id === taskerId) mine[b.booking_id] = true; });
    rows = chats.filter(function (r) { return r && r.access === 'coordinator' && mine[r.booking_id]; });
    rows.sort(function (a, b) { return new Date(b.last_message_at || b.created_at || 0) - new Date(a.last_message_at || a.created_at || 0); });
    buildTabs(); summary(); render();
  }

  function maybeStart() {
    if (started || !ready || !opened || !C.isUuid(taskerId) || !window.STCoTasker) return;
    started = true; load(false);
  }

  document.addEventListener('coordinator:ready', function () { ready = true; maybeStart(); });
  document.addEventListener('coordinator-tasker:tab', function (e) { if (e.detail && e.detail.tab === 'messages') { opened = true; maybeStart(); } });
  document.addEventListener('DOMContentLoaded', function () {
    $('coTmRetry').addEventListener('click', function () { if (started) load(true); });
    $('coTmSearch').addEventListener('input', function () { query = this.value; if (started) render(); });
  });
})();

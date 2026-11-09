/* ============================================================
   StreetTasker — coordinator-messages.js (Stage C4)
   "Latest Messages" card on coordinator-dashboard.html, and the unread count on the sidebar Messages link.
   Real data only: one call, rpc coordinator_chat_list (the database decides which conversations this coordinator may see).
   Read-only: each row opens coordinator-chat.html?booking=<id>. Only conversations the coordinator handles (access = 'coordinator') are listed.
   Renders with textContent only (names and messages are user-entered data).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  var SHOWN = 3;
  var last = null;
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

  function row(r) {
    var li = C.el('li', 'co-msgs-item' + (r.unread > 0 ? ' is-unread' : ''));
    var a = C.el('a', 'co-msgs-link');
    a.href = 'coordinator-chat.html?booking=' + encodeURIComponent(r.booking_id);
    a.setAttribute('aria-label', 'Open conversation with ' + (r.customer_name || 'customer') + (r.unread > 0 ? ', ' + r.unread + ' unread' : ''));
    a.appendChild(C.el('span', 'co-tasker-avatar co-msgs-avatar', C.initialsOf(r.customer_name, 'CU')));
    var body = C.el('div', 'co-msgs-body');
    var top = C.el('div', 'co-msgs-top');
    top.appendChild(C.el('span', 'co-msgs-name', r.customer_name || 'Customer'));
    if (r.tasker_name) top.appendChild(C.el('span', 'co-status co-msgs-re', r.tasker_name));
    var when = ago(r.last_message_at || r.created_at);
    if (when) top.appendChild(C.el('span', 'co-req-when', when));
    body.appendChild(top);
    body.appendChild(C.el('p', 'co-msgs-text', preview(r) || 'No messages yet'));
    a.appendChild(body);
    if (r.unread > 0) {
      var u = C.el('span', 'co-attn-count co-msgs-unread', r.unread > 98 ? '99+' : String(r.unread));
      u.setAttribute('aria-label', r.unread + ' unread');
      a.appendChild(u);
    } else {
      a.appendChild(C.el('span', 'co-msgs-open', 'Open \u2192'));
    }
    li.appendChild(a);
    return li;
  }

  function setBadge(n) {
    var b = $('coSideUnread'); if (!b) return;
    b.hidden = !(n > 0);
    if (n > 0) { b.textContent = n > 98 ? '99+' : String(n); b.setAttribute('aria-label', n + ' unread messages'); }
  }

  async function load() {
    $('coMsgsLoading').hidden = false; $('coMsgsError').hidden = true; $('coMsgsList').hidden = true; $('coMsgsEmpty').hidden = true;
    try {
      var res = await window.supabase.rpc('coordinator_chat_list', { p_limit: 100 });
      if (res.error || !Array.isArray(res.data)) throw (res.error || new Error('unexpected reply'));
      var mine = res.data.filter(function (r) { return r && r.access === 'coordinator'; });
      mine.sort(function (a, b) { return new Date(b.last_message_at || b.created_at || 0) - new Date(a.last_message_at || a.created_at || 0); });
      var unread = mine.reduce(function (n, r) { return n + (r.unread > 0 ? r.unread : 0); }, 0);
      setBadge(unread);
      var ul = $('coMsgsList'); ul.textContent = '';
      mine.slice(0, SHOWN).forEach(function (r) { ul.appendChild(row(r)); });
      $('coMsgsLoading').hidden = true;
      ul.hidden = !mine.length;
      $('coMsgsEmpty').hidden = !!mine.length;
    } catch (e) {
      console.error('[coordinator messages]', e);
      $('coMsgsLoading').hidden = true; $('coMsgsError').hidden = false;
    }
  }

  document.addEventListener('coordinator:ready', function (e) { last = e.detail; load(); });
  document.addEventListener('DOMContentLoaded', function () {
    var retry = $('coMsgsRetry');
    if (retry) retry.addEventListener('click', function () { if (last) load(); });
  });
})();

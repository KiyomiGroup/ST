/* ============================================================
   STREETTASKER — messages-list.js   (Job Room, step 2)
   Conversation list: loading + enrichment, per-thread job state,
   role filters, search and rendering.

   Public API (window.JRList), used by messages.html:
     JRList.init({ role, onSelect })   wire tabs + search for the role
     JRList.load(user, role, onEnrich) -> threads (fast), then enriches
     JRList.render(ctx)                draw the list (ctx below)
     JRList.refreshOne(thread, role)   re-fetch one thread's job state
     JRList.derive(thread, role)       job state used by chips + filters

   render ctx: { threads, user, role, activeId }

   No inline styles, no raw colours: classes live in css/messages.css.
   ============================================================ */
'use strict';

(function () {

  /* ── Filters (spec sections 31 and 32) ───────────────────── */
  var FILTERS = {
    customer: [
      { key: 'all',       label: 'All' },
      { key: 'active',    label: 'Active Jobs' },
      { key: 'awaiting',  label: 'Awaiting Action' },
      { key: 'completed', label: 'Completed' },
      { key: 'archived',  label: 'Archived', needsArchive: true }
    ],
    tasker: [
      { key: 'all',       label: 'All' },
      { key: 'active',    label: 'Active Jobs' },
      { key: 'requests',  label: 'Customer Requests' },
      { key: 'payments',  label: 'Payments' },
      { key: 'awaiting',  label: 'Awaiting Customer' },
      { key: 'completed', label: 'Completed' }
    ]
  };

  var EMPTY_COPY = {
    all:       'No conversations yet. Book a service or accept an application to start chatting.',
    active:    'No active jobs right now.',
    awaiting:  'Nothing is waiting on you.',
    requests:  'No new customer requests.',
    payments:  'No payment activity yet.',
    completed: 'No completed jobs yet.',
    archived:  'No archived conversations.'
  };

  /* Job states derived from payment_requests + bookings (see derive()). */
  var ACTIVE_STATES = ['payment_pending', 'secured', 'awaiting_confirmation', 'disputed'];

  var state = { attnOpen: false, filter: 'all', query: '', role: 'customer', onSelect: null, lastCtx: null, archiveReady: true };

  /* ── Small helpers ───────────────────────────────────────── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function naira(n) {
    return Number(n || 0).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
  }

  function initialsOf(name) {
    return String(name || '').trim().split(' ').filter(Boolean)
      .map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase() || '??';
  }

  function safeUrl(u) {
    return (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : '';
  }

  function relTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var diff = Date.now() - d.getTime();
    var m = Math.floor(diff / 60000);
    if (m < 1) return 'Now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    var startYesterday = startToday.getTime() - 86400000;
    if (d.getTime() >= startYesterday) return 'Yesterday';
    return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  }

  function unreadFor(t, userId) {
    return userId === t.customer_id ? (t.customer_unread || 0) : (t.tasker_unread || 0);
  }

  /* ── Job state ───────────────────────────────────────────────
     Order matters: the first match wins.
       disputed              booking.status = disputed
       completed             booking completed / payment released
       cancelled             booking cancelled
       awaiting_confirmation booking.status = awaiting_confirmation
       secured               booking paid, or latest payment request paid
       payment_pending       latest payment request pending / accepted
       inquiry               none of the above (just talking)           */
  function derive(t, role) {
    var bk = t.booking || null;
    var pr = t.latestRequest || null;
    var key = 'inquiry';

    if (bk && bk.status === 'disputed') key = 'disputed';
    else if (bk && (bk.status === 'completed' || bk.payment_status === 'released')) key = 'completed';
    else if (bk && bk.status === 'cancelled') key = 'cancelled';
    else if (bk && bk.status === 'awaiting_confirmation') key = 'awaiting_confirmation';
    else if ((bk && bk.payment_status === 'paid') || (pr && pr.status === 'paid')) key = 'secured';
    else if (pr && (pr.status === 'pending' || pr.status === 'accepted')) key = 'payment_pending';

    var amount = (pr && pr.amount) || t.agreed_price || (bk && bk.amount) || 0;
    var isCustomer = role === 'customer';
    var label = '', tone = 'muted', needsAction = false;

    switch (key) {
      case 'payment_pending':
        label = isCustomer ? 'Awaiting your payment' : 'Awaiting customer payment';
        tone = isCustomer ? 'action' : 'muted'; needsAction = isCustomer; break;
      case 'awaiting_confirmation':
        label = isCustomer ? 'Review completed work' : 'Awaiting customer review';
        tone = isCustomer ? 'action' : 'muted'; needsAction = isCustomer; break;
      case 'secured':
        label = amount ? naira(amount) + (isCustomer ? ' in escrow' : ' escrow funded') : 'Payment secured';
        tone = 'success'; break;
      case 'completed': label = 'Completed'; tone = 'success'; break;
      case 'disputed':  label = 'Under review'; tone = 'danger'; break;
      case 'cancelled': label = 'Cancelled'; tone = 'muted'; break;
      default: break;
    }

    /* A transport / extra-cost request waiting for the customer to pay or decline comes first */
    if (t.addonPending && ['completed', 'cancelled', 'disputed'].indexOf(key) === -1) {
      label = isCustomer ? 'Payment needed' : 'Awaiting customer payment';
      tone = isCustomer ? 'action' : 'muted';
      needsAction = isCustomer;
    }
    return { key: key, label: label, tone: tone, needsAction: needsAction, amount: amount };
  }

  /* Customers can archive a conversation (needs customer_archived, step 5 SQL) */
  function isArchived(t, role) { return role === 'customer' && state.archiveReady && t.customer_archived === true; }

  function filtersFor(role) {
    return FILTERS[role].filter(function (f) { return !f.needsArchive || state.archiveReady; });
  }

  /* Does a thread belong in a filter tab? */
  function inFilter(t, role, filterKey, userId) {
    if (filterKey === 'archived') return isArchived(t, role);
    if (isArchived(t, role)) return false;
    var d = t._job || derive(t, role);
    var unread = unreadFor(t, userId);
    switch (filterKey) {
      case 'all':       return true;
      case 'active':    return ACTIVE_STATES.indexOf(d.key) !== -1;
      case 'completed': return d.key === 'completed';
      case 'awaiting':  /* customer: things I must act on; tasker: things the customer must act on */
        return role === 'customer'
          ? d.needsAction
          : (d.key === 'payment_pending' || d.key === 'awaiting_confirmation' || !!t.addonPending);
      case 'requests':  /* tasker: new inquiries or unread customer messages */
        return d.key === 'inquiry' || unread > 0;
      case 'payments':
        return !!t.latestRequest || d.key === 'secured' || d.key === 'completed';
      default:          return true;
    }
  }

  function matchesQuery(t, role, q) {
    if (!q) return true;
    var other = role === 'customer' ? t.tasker : t.customer;
    var hay = [(other && other.name) || '', t._title || '', t.last_message || ''].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  /* ── Data loading ────────────────────────────────────────── */
  function otherPartyId(t, userId) {
    return userId === t.customer_id ? t.tasker_id : t.customer_id;
  }

  async function fetchThreads(userId) {
    var timeout = new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('Timed out. Check your connection.')); }, 10000);
    });
    function run(cols) {
      return window.supabase
        .from('message_threads')
        .select(cols)
        .or('customer_id.eq.' + userId + ',tasker_id.eq.' + userId)
        .order('last_message_at', { ascending: false });
    }
    var base = 'id,customer_id,tasker_id,context_type,context_id,last_message,last_message_at,customer_unread,tasker_unread,agreed_price';
    var res = await Promise.race([run(base + ',customer_archived'), timeout]);
    if (res.error && /customer_archived/.test(String(res.error.message || ''))) {
      /* Step 5 SQL not run yet: load without the archive flag, hide the Archived tab */
      state.archiveReady = false;
      res = await Promise.race([run(base), timeout]);
    } else if (!res.error) {
      state.archiveReady = true;
    }
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function fetchNames(threads, userId) {
    var ids = [];
    threads.forEach(function (t) {
      var o = otherPartyId(t, userId);
      if (o && ids.indexOf(o) === -1) ids.push(o);
    });
    var map = {};
    if (!ids.length) return map;
    try {
      var r = await window.supabase.from('users').select('id,name,avatar_url').in('id', ids);
      (r.data || []).forEach(function (u) { map[u.id] = u; });
    } catch (_e) { /* names fall back to "Tasker" / "Customer" */ }
    return map;
  }

  /* Latest payment request, booking / application and task title per thread.
     Every query is optional: a failure just leaves that part blank. */
  async function enrich(threads) {
    if (!threads.length) return;
    var sb = window.supabase;
    var threadIds = threads.map(function (t) { return t.id; });

    var prByThread = {}, addonByThread = {};
    var ADDONS = ['transport', 'additional_cost'];
    try {
      var prCols = 'id,thread_id,amount,status,created_at,kind';
      var pr = await sb.from('payment_requests').select(prCols)
        .in('thread_id', threadIds).order('created_at', { ascending: false });
      if (pr.error) {
        /* Step 6 SQL not run yet: no kind column */
        pr = await sb.from('payment_requests').select('id,thread_id,amount,status,created_at')
          .in('thread_id', threadIds).order('created_at', { ascending: false });
      }
      (pr.data || []).forEach(function (r) {
        var isAddon = ADDONS.indexOf(r.kind) !== -1;
        if (isAddon) {
          if (r.status === 'pending') addonByThread[r.thread_id] = true;
        } else if (!prByThread[r.thread_id]) {
          prByThread[r.thread_id] = r;       /* latest payment-type request */
        }
      });
    } catch (_e) {}

    var bookingIds = [], appIds = [];
    threads.forEach(function (t) {
      if (!t.context_id) return;
      if (t.context_type === 'booking') bookingIds.push(t.context_id);
      else appIds.push(t.context_id);
    });

    var bookings = {}, apps = {};
    try {
      if (bookingIds.length) {
        var b = await sb.from('bookings').select('id,task_id,status,payment_status,notes,amount,work_stage').in('id', bookingIds);
        if (b.error) {
          /* Step 7 SQL not run yet: no work_stage column */
          b = await sb.from('bookings').select('id,task_id,status,payment_status,notes,amount').in('id', bookingIds);
        }
        (b.data || []).forEach(function (r) { bookings[r.id] = r; });
      }
    } catch (_e) {}
    try {
      if (appIds.length) {
        var a = await sb.from('task_applications').select('id,task_id,status').in('id', appIds);
        (a.data || []).forEach(function (r) { apps[r.id] = r; });
      }
    } catch (_e) {}

    var taskIds = [];
    Object.keys(bookings).forEach(function (k) { if (bookings[k].task_id) taskIds.push(bookings[k].task_id); });
    Object.keys(apps).forEach(function (k) { if (apps[k].task_id) taskIds.push(apps[k].task_id); });
    var titles = {};
    try {
      if (taskIds.length) {
        var tk = await sb.from('tasks').select('id,title').in('id', taskIds);
        (tk.data || []).forEach(function (r) { titles[r.id] = r.title; });
      }
    } catch (_e) {}

    threads.forEach(function (t) {
      t.latestRequest = prByThread[t.id] || null;
      t.addonPending = !!addonByThread[t.id];
      var bk = t.context_type === 'booking' ? bookings[t.context_id] : null;
      var ap = t.context_type !== 'booking' ? apps[t.context_id] : null;
      t.booking = bk || null;
      t.application = ap || null;
      var taskId = (bk && bk.task_id) || (ap && ap.task_id);
      t._taskId = taskId || null;
      t._title = (taskId && titles[taskId]) ||
                 (bk && bk.notes ? String(bk.notes).slice(0, 48) : '') ||
                 (t.context_type === 'booking' ? 'Service booking' : 'Task application');
      t._job = derive(t, state.role);
    });
  }

  async function load(user, role, onEnrich) {
    state.role = role;
    var threads = await fetchThreads(user.id);
    var names = await fetchNames(threads, user.id);
    threads.forEach(function (t) {
      var isCustomer = user.id === t.customer_id;
      var other = names[otherPartyId(t, user.id)] || { id: otherPartyId(t, user.id), name: null };
      t.customer = isCustomer ? { id: user.id, name: null } : other;
      t.tasker   = isCustomer ? other : { id: user.id, name: null };
      t._title = t.context_type === 'booking' ? 'Service booking' : 'Task application';
      t._job = derive(t, role);
    });
    /* Enrich in the background so the list paints immediately. */
    enrich(threads).then(function () { if (onEnrich) onEnrich(); }).catch(function () {});
    return threads;
  }

  async function refreshOne(t, role) {
    await enrich([t]);
    t._job = derive(t, role);
  }

  /* ── Rendering ───────────────────────────────────────────── */
  function buildRow(t, ctx) {
    var isCustomer = ctx.user.id === t.customer_id;
    var other = isCustomer ? t.tasker : t.customer;
    var name = (other && other.name) || (isCustomer ? 'Tasker' : 'Customer');
    var job = t._job || derive(t, ctx.role);
    var unread = unreadFor(t, ctx.user.id);

    var row = el('div', 'msg-thread-item' + (t.id === ctx.activeId ? ' active' : ''));
    row.id = 'ti-' + t.id;
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    var open = function () { if (state.onSelect) state.onSelect(t.id); };
    row.addEventListener('click', open);
    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });

    var av = el('div', 'msg-thread-avatar');
    var url = safeUrl(other && other.avatar_url);
    if (url) {
      var img = el('img', 'msg-thread-avatar-img');
      img.src = url; img.alt = '';
      img.addEventListener('error', function () { img.remove(); av.textContent = initialsOf(name); });
      av.appendChild(img);
    } else {
      av.textContent = initialsOf(name);
    }
    row.appendChild(av);

    var info = el('div', 'msg-thread-info');
    var top = el('div', 'jr-thread-top');
    top.appendChild(el('div', 'msg-thread-name', t._title || 'Conversation'));
    top.appendChild(el('div', 'jr-thread-time', relTime(t.last_message_at)));
    info.appendChild(top);

    info.appendChild(el('div', 'jr-thread-person', name));

    var prevText = t.last_message || '';
    var prev = el('div', 'msg-thread-preview' + (prevText ? '' : ' is-empty'), prevText || 'No messages yet');
    info.appendChild(prev);

    var foot = el('div', 'jr-thread-foot');
    if (job.label) foot.appendChild(el('span', 'jr-chip jr-chip--' + job.tone, job.label));
    if (unread > 0) foot.appendChild(el('span', 'msg-thread-unread', String(unread)));
    if (foot.childNodes.length) info.appendChild(foot);

    row.appendChild(info);
    return row;
  }

  function renderTabs(ctx) {
    var host = document.getElementById('jrFilters');
    if (!host) return;
    host.textContent = '';
    filtersFor(ctx.role).forEach(function (f) {
      var count = (f.key === 'all' || f.key === 'archived') ? 0 : ctx.threads.filter(function (t) {
        return inFilter(t, ctx.role, f.key, ctx.user.id);
      }).length;
      var b = el('button', 'jr-tab' + (state.filter === f.key ? ' is-active' : ''));
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', state.filter === f.key ? 'true' : 'false');
      b.dataset.filter = f.key;
      b.appendChild(document.createTextNode(f.label));
      if (count > 0) b.appendChild(el('span', 'jr-tab-count', String(count)));
      b.addEventListener('click', function () {
        state.filter = f.key;
        if (state.lastCtx) render(state.lastCtx);
      });
      host.appendChild(b);
    });
  }

  /* "N things need your attention" strip (spec section 43, Stage 5).
     Lists the conversations that need the person, newest first, each one a
     button that opens its own room. Shows 3 (2 below 769px); "See all" opens
     the rest in place and "Show fewer" folds them again.
       customer: a payment or review is waiting on them, or unread messages
       tasker:   unread messages from the customer                           */
  var ATTN_MAX = 3;
  var ATTN_MAX_MOBILE = 2;

  function attentionReasons(t, ctx) {
    var unread = unreadFor(t, ctx.user.id);
    var reasons = [];
    if (ctx.role === 'customer') {
      var job = t._job || derive(t, ctx.role);
      if (job.needsAction && job.label) reasons.push(job.label);
    }
    if (unread > 0) reasons.push(unread + (unread === 1 ? ' new message' : ' new messages'));
    return reasons;
  }

  function renderAttention(ctx) {
    var host = document.getElementById('jrAttention');
    if (!host) return;
    var items = [];
    ctx.threads.forEach(function (t) {
      if (isArchived(t, ctx.role)) return;
      var reasons = attentionReasons(t, ctx);
      if (reasons.length) items.push({ t: t, reasons: reasons });
    });
    var n = items.length;
    host.textContent = '';
    host.hidden = n === 0;
    if (!n) return;
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Needs your attention');

    host.appendChild(el('strong', 'jr-attn-head', n + (n === 1 ? ' thing needs' : ' things need') + ' your attention'));

    var ul = el('ul', 'jr-attn-list');
    var shown = state.attnOpen ? items : items.slice(0, ATTN_MAX);
    shown.forEach(function (it, i) {
      var li = el('li', 'jr-attn-row' + (!state.attnOpen && i >= ATTN_MAX_MOBILE ? ' jr-attn-row--wide' : ''));
      var b = el('button', 'jr-attn-item');
      b.type = 'button';
      b.dataset.thread = it.t.id;
      b.appendChild(el('span', 'jr-attn-title', it.t._title || 'Conversation'));
      b.appendChild(el('span', 'jr-attn-why', it.reasons.join(' \u00b7 ')));
      b.addEventListener('click', function () { if (state.onSelect) state.onSelect(it.t.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    host.appendChild(ul);

    if (n > ATTN_MAX_MOBILE) {
      var hiddenOnWide = n > ATTN_MAX;
      var more = el('button', 'jr-attn-more' + (hiddenOnWide || state.attnOpen ? '' : ' jr-attn-more--mobile'),
        state.attnOpen ? 'Show fewer' : 'See all ' + n);
      more.type = 'button';
      more.setAttribute('aria-expanded', state.attnOpen ? 'true' : 'false');
      more.addEventListener('click', function () {
        state.attnOpen = !state.attnOpen;
        if (state.lastCtx) render(state.lastCtx);
      });
      host.appendChild(more);
    }
  }

  function renderChip(ctx) {
    var chip = document.getElementById('jrCountChip');
    if (!chip) return;
    var n = ctx.threads.filter(function (t) { return inFilter(t, ctx.role, 'active', ctx.user.id); }).length;
    chip.hidden = n === 0;
    chip.textContent = n + (ctx.role === 'tasker' ? ' Live' : ' Active');
  }

  function render(ctx) {
    state.lastCtx = ctx;
    state.role = ctx.role;
    var list = document.getElementById('threadList');
    if (!list) return;

    renderChip(ctx);
    renderTabs(ctx);
    renderAttention(ctx);

    if (state.filter === 'archived' && !state.archiveReady) state.filter = 'all';
    var q = state.query;
    var rows = ctx.threads.filter(function (t) {
      return inFilter(t, ctx.role, state.filter, ctx.user.id) && matchesQuery(t, ctx.role, q);
    });

    list.textContent = '';
    if (!rows.length) {
      var box = el('div', 'msg-status');
      if (q) {
        box.appendChild(el('strong', 'msg-status-title', 'No matches'));
        box.appendChild(document.createElement('br'));
        box.appendChild(el('span', 'msg-status-sub', 'Try a different name, job or word.'));
      } else {
        box.appendChild(el('strong', 'msg-status-title', state.filter === 'all' ? 'No conversations yet' : 'Nothing here'));
        box.appendChild(document.createElement('br'));
        box.appendChild(el('span', 'msg-status-sub', EMPTY_COPY[state.filter] || EMPTY_COPY.all));
      }
      list.appendChild(box);
      return;
    }
    var frag = document.createDocumentFragment();
    rows.forEach(function (t) { frag.appendChild(buildRow(t, ctx)); });
    list.appendChild(frag);
  }

  /* ── Wiring ──────────────────────────────────────────────── */
  function init(opts) {
    state.role = opts.role || 'customer';
    state.onSelect = opts.onSelect || null;
    state.filter = 'all';
    state.query = '';
    state.attnOpen = false;

    var input = document.getElementById('jrSearch');
    if (input && !input.dataset.bound) {
      input.dataset.bound = '1';
      input.addEventListener('input', function () {
        state.query = input.value.trim().toLowerCase();
        if (state.lastCtx) render(state.lastCtx);
      });
    }
  }

  /* Archive / unarchive (customer only). Throws on failure. */
  async function setArchived(t, flag) {
    var r = await window.supabase.from('message_threads').update({ customer_archived: !!flag }).eq('id', t.id);
    if (r.error) throw r.error;
    t.customer_archived = !!flag;
    if (state.lastCtx) render(state.lastCtx);
  }

  window.JRList = {
    setArchived: setArchived,
    isArchived: function (t) { return isArchived(t, state.role); },
    archiveReady: function () { return state.archiveReady; },
    init: init,
    load: load,
    render: render,
    refreshOne: refreshOne,
    derive: derive
  };

})();

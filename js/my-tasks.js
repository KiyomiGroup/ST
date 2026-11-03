/* ============================================================
   STREETTASKER — my-tasks.js
   Customer "My Tasks" page (my-tasks.html).
   Loads the customer's tasks, the offers on them and any escrow booking,
   then filters, searches, sorts and renders task cards.
   Actions: Review Offers (links to Applications), Message Tasker,
   View Profile, Close Post (open tasks only, with confirmation).

   Data: tasks -> task_applications -> taskers + users; bookings (escrow).
   Task statuses seen in the codebase: open, in_progress (set when an offer
   is accepted), completed, cancelled / closed / expired / done, draft.
   Anything else is treated as open.
   ============================================================ */
(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var ENDED = ['cancelled', 'canceled', 'closed', 'done', 'expired'];
  var state = { user: null, tasks: [], filter: 'all', query: '', category: '', sort: 'recent', shown: PAGE_SIZE };

  var $ = function (id) { return document.getElementById(id); };
  var esc = window.escapeHtml || function (s) { return String(s == null ? '' : s); };
  var icon = function (id) { return '<svg class="ap-i" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };
  var naira = function (n) { return '\u20A6' + Number(n || 0).toLocaleString('en-NG'); };
  var safeUrl = function (u) { return /^(https?:)?\/\//.test(u || '') || /^\/?[\w.\-\/]+$/.test(u || '') ? u : ''; };

  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60); if (m < 60) return m + (m === 1 ? ' min' : ' mins') + ' ago';
    var h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour' : ' hours') + ' ago';
    var d = Math.floor(h / 24); return d + (d === 1 ? ' day' : ' days') + ' ago';
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function initials(name) {
    return String(name).replace(/[^a-zA-Z ]/g, '').trim().split(' ').filter(Boolean)
      .map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase() || '??';
  }
  function shortId(t) { return '#TSK-' + String(t.id || '').replace(/-/g, '').slice(0, 4).toUpperCase(); }
  /* Same format the Applications page uses: pitch and proposed rate share one string */
  function parseRate(msg) {
    var m = String(msg || '').match(/\|\s*Proposed rate:\s*([^|]+)/i);
    var rate = m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) : NaN;
    return isNaN(rate) ? null : rate;
  }
  function appGroup(status) {
    if (status === 'accepted' || status === 'completed') return 'accepted';
    if (status === 'rejected' || status === 'closed' || status === 'declined' || status === 'withdrawn') return 'declined';
    return 'pending';
  }
  function taskGroup(status) {
    var s = String(status || 'open').toLowerCase();
    if (s === 'completed') return 'completed';
    if (s === 'in_progress') return 'progress';
    if (s === 'draft') return 'draft';
    if (ENDED.indexOf(s) !== -1) return 'closed';
    return 'open';
  }
  function payState(b) {
    if (!b) return 'none';
    var p = b.payment_status || 'unpaid';
    if (p === 'released' || b.status === 'completed') return 'released';
    if (p === 'disputed' || b.status === 'disputed') return 'disputed';
    if (p === 'paid') return 'held';
    return 'unpaid';
  }

  /* ── Data ─────────────────────────────────────────────── */
  async function load() {
    var sess = await window.supabase.auth.getSession();
    var user = sess.data.session && sess.data.session.user;
    if (!user) { window.location.replace('login.html?next=my-tasks.html'); return; }
    state.user = user;

    var role = null;
    try { role = await window.ST.auth.getUserRole(user); } catch (e) { /* use cache */ }
    role = role || localStorage.getItem('st_role');
    if (role === 'tasker') { window.location.replace('bookings.html'); return; }

    var tr = await window.supabase.from('tasks').select('*')
      .or('customer_id.eq.' + user.id + ',user_id.eq.' + user.id).order('created_at', { ascending: false });
    if (tr.error) { renderError(tr.error.message); return; }
    var tasks = tr.data || [];

    var rows = [];
    if (tasks.length) {
      var ar = await window.supabase.from('task_applications').select('*')
        .in('task_id', tasks.map(function (t) { return t.id; })).neq('status', 'withdrawn').order('created_at', { ascending: false });   /* withdrawn offers are kept but not shown */
      if (ar.error) { renderError(ar.error.message); return; }
      rows = ar.data || [];
    }

    /* One batched lookup each for tasker profiles and user records */
    var ids = Object.keys(rows.reduce(function (o, a) { if (a.tasker_id) o[a.tasker_id] = 1; return o; }, {}));
    var profiles = {}, users = {};
    if (ids.length) {
      try {
        var tk = await window.supabase.from('taskers')
          .select('user_id, name, service, service_name, location, rating, photo_url, business_name').in('user_id', ids);
        (tk.data || []).forEach(function (r) { profiles[r.user_id] = r; });
      } catch (e) { /* fall back to users */ }
      try {
        var us = await window.supabase.from('users').select('id, name, business_name, avatar_url').in('id', ids);
        (us.data || []).forEach(function (r) { users[r.id] = r; });
      } catch (e) { /* fall back to ids */ }
    }

    /* Escrow bookings are optional: a failure here must not hide the tasks */
    var bookings = [];
    if (tasks.length) {
      try {
        var br = await window.supabase.from('bookings').select('*').eq('customer_id', user.id)
          .order('created_at', { ascending: false });
        if (!br.error) bookings = br.data || [];
      } catch (e) { /* no escrow info */ }
    }

    var people = rows.map(function (a) {
      var p = profiles[a.tasker_id] || {}, u = users[a.tasker_id] || {};
      return {
        id: a.id, taskId: a.task_id, taskerId: a.tasker_id, status: a.status, group: appGroup(a.status),
        name: p.business_name || u.business_name || p.name || u.name || ('Tasker #' + String(a.tasker_id || '').slice(0, 6).toUpperCase()),
        service: p.service || p.service_name || '', location: p.location || '',
        rating: p.rating ? parseFloat(p.rating) : null, photo: safeUrl(p.photo_url || u.avatar_url || ''),
        rate: parseRate(a.message)
      };
    });

    state.tasks = tasks.map(function (t) {
      var mine = people.filter(function (a) { return String(a.taskId) === String(t.id); });
      var hired = mine.filter(function (a) { return a.group === 'accepted'; })[0] || null;
      var group = taskGroup(t.status);
      /* A hired tasker means the job is under way, even if the status was not updated */
      if (hired && group === 'open') group = 'progress';
      return {
        raw: t, id: t.id, title: t.title || 'Untitled task', description: t.description || '', category: t.category || '',
        location: t.location || '', budget: Number(t.budget) || 0, urgent: !!t.urgent, deadline: t.deadline || '',
        created: t.created_at, group: group,
        offers: mine.filter(function (a) { return a.group === 'pending'; }),
        hired: hired,
        booking: bookings.filter(function (b) { return String(b.task_id) === String(t.id); })[0] || null
      };
    });
    buildCategoryOptions();
    render();
  }

  /* ── Render ───────────────────────────────────────────── */
  function buildCategoryOptions() {
    var sel = $('mtCategory'), seen = {};
    state.tasks.forEach(function (t) {
      if (!t.category || seen[t.category]) return; seen[t.category] = 1;
      var o = document.createElement('option'); o.value = t.category; o.textContent = t.category; sel.appendChild(o);
    });
  }

  function visible() {
    var q = state.query.toLowerCase();
    var list = state.tasks.filter(function (t) {
      if (state.filter !== 'all' && t.group !== state.filter) return false;
      if (state.category && t.category !== state.category) return false;
      if (q) {
        var hay = [t.title, t.category, t.location, shortId(t), t.hired ? t.hired.name : ''].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    list.sort(function (x, y) {
      if (state.sort === 'oldest') return new Date(x.created) - new Date(y.created);
      if (state.sort === 'budget-high') return y.budget - x.budget;
      if (state.sort === 'budget-low') return x.budget - y.budget;
      return new Date(y.created) - new Date(x.created);
    });
    return list;
  }

  function badges(t) {
    var main = {
      open:      '<span class="ap-badge ap-badge-accepted"><span class="ap-badge-dot"></span>Open for Offers</span>',
      progress:  '<span class="ap-badge mt-badge-progress">In Progress</span>',
      completed: '<span class="ap-badge ap-badge-completed">' + icon('circle-check') + 'Completed</span>',
      closed:    '<span class="ap-badge ap-badge-completed">Closed</span>',
      draft:     '<span class="ap-badge ap-badge-completed">Draft</span>'
    }[t.group];
    var urgent = t.urgent && t.group === 'open' ? '<span class="ap-badge ap-badge-pending">Urgent</span>' : '';
    return '<div class="mt-badges">' + main + urgent + '</div>';
  }

  function avatar(a) {
    return '<span class="mt-avatar">' + (a.photo ? '<img src="' + esc(a.photo) + '" alt="" loading="lazy" />' : esc(initials(a.name))) + '</span>';
  }
  function personSub(a) {
    var sub = [];
    if (a.rating) sub.push('<span class="ap-rating">' + icon('star') + a.rating.toFixed(1) + '</span>');
    if (a.service) sub.push('<span>' + esc(a.service) + '</span>');
    if (a.location) sub.push('<span>' + icon('pin') + esc(a.location) + '</span>');
    return sub.join('');
  }

  function figures(t) {
    var budget = '<div><div class="ap-fig-label">Your Budget</div><div class="ap-fig-value">' + (t.budget ? naira(t.budget) : '\u2014') + '</div></div>';
    if (t.group === 'open') {
      var n = t.offers.length;
      var rates = t.offers.map(function (a) { return a.rate; }).filter(function (r) { return r != null; });
      var quote = '\u2014';
      if (rates.length) {
        var lo = Math.min.apply(null, rates), hi = Math.max.apply(null, rates);
        quote = lo === hi ? naira(lo) : naira(lo) + ' \u2013 ' + naira(hi);
      }
      return '<div class="ap-figures">' + budget +
        '<div><div class="ap-fig-label">Offers Received</div><div class="ap-fig-value' + (n ? ' is-offer' : '') + '">' + n + '</div></div>' +
        '<div><div class="ap-fig-label">Quotes</div><div class="ap-fig-value mt-fig-range' + (rates.length ? ' is-offer' : '') + '">' + quote + '</div></div></div>';
    }
    if (t.group === 'progress' || t.group === 'completed') {
      var ps = payState(t.booking), amt = t.booking && (Number(t.booking.amount) || t.budget);
      var pay = {
        held:     '<div class="ap-fig-value is-offer">' + naira(amt) + '</div><div class="ap-delta is-below">Held in escrow</div>',
        released: '<div class="mt-fig-text is-green">Released</div>',
        disputed: '<div class="mt-fig-text">On hold</div><div class="ap-delta is-above">Dispute open</div>',
        unpaid:   '<div class="mt-fig-text">Awaiting payment</div>',
        none:     '<div class="mt-fig-text">Not in escrow yet</div>'
      }[ps];
      return '<div class="ap-figures">' + budget +
        '<div><div class="ap-fig-label">Hired Tasker</div><div class="mt-fig-text">' + (t.hired ? esc(t.hired.name) : '\u2014') + '</div></div>' +
        '<div><div class="ap-fig-label">Payment</div>' + pay + '</div></div>';
    }
    return '<div class="ap-figures">' + budget + '<div></div><div></div></div>';
  }

  function peopleRow(t) {
    if (t.hired) {
      return '<div class="mt-person">' + avatar(t.hired) + '<div class="mt-person-body"><div class="mt-person-name">' + esc(t.hired.name) +
        '</div><div class="ap-card-sub">' + personSub(t.hired) + '</div></div></div>';
    }
    if (t.group === 'open' && t.offers.length) {
      var top = t.offers.slice(0, 3);
      var stack = top.map(avatar).join('') + (t.offers.length > top.length ? '<span class="mt-avatar mt-avatar-more">+' + (t.offers.length - top.length) + '</span>' : '');
      var names = top.slice(0, 2).map(function (a) { return esc(a.name) + (a.rating ? ' (' + a.rating.toFixed(1) + '\u2605)' : ''); }).join(', ');
      var more = t.offers.length - 2;
      return '<div class="mt-person"><span class="mt-avatars">' + stack + '</span><div class="mt-person-body"><div class="ap-card-sub"><span>' +
        names + (more > 0 ? ' and ' + more + ' more' : '') + '</span></div></div></div>';
    }
    return '';
  }

  function actions(t) {
    var id = esc(t.id), a = '';
    var profile = t.hired ? 'tasker-profile.html?id=' + encodeURIComponent(t.hired.taskerId || '') + '&task=' + encodeURIComponent(t.id) + '&app=' + encodeURIComponent(t.hired.id) : '';
    if (t.group === 'open') {
      if (t.offers.length) a += '<a class="ap-btn ap-btn-primary" href="customer-applications.html?task=' + encodeURIComponent(t.id) + '">Review Offers (' + t.offers.length + ')</a>';
      a += '<button type="button" class="ap-btn ' + (t.offers.length ? 'ap-btn-quiet' : '') + '" data-act="close" data-id="' + id + '">Close Post</button>';
    } else if ((t.group === 'progress' || t.group === 'completed') && t.hired) {
      a += '<button type="button" class="ap-btn ap-btn-primary" data-act="message" data-id="' + id + '">' + icon('chat') + 'Message Tasker</button>' +
        '<a class="ap-btn" href="' + profile + '">View Profile</a>';
    }
    return a ? '<div class="ap-actions">' + a + '</div>' : '';
  }

  function card(t) {
    var sub = [];
    sub.push('<span>' + esc(shortId(t)) + '</span>');
    if (t.category) sub.push('<span>' + esc(t.category) + '</span>');
    if (t.location) sub.push('<span>' + icon('pin') + esc(t.location) + '</span>');
    if (t.deadline && t.group !== 'completed' && fmtDate(t.deadline)) sub.push('<span>' + icon('clock') + 'Needed by ' + esc(fmtDate(t.deadline)) + '</span>');
    return '<article class="ap-card" data-id="' + esc(t.id) + '"><div class="ap-card-top">' + badges(t) +
      (t.created ? '<span class="ap-meta">' + icon('clock') + 'Posted ' + esc(ago(t.created)) + '</span>' : '') + '</div>' +
      '<div><h2 class="ap-card-title">' + esc(t.title) + '</h2><div class="ap-card-sub">' + sub.join('') + '</div></div>' +
      (t.description ? '<p class="mt-desc">' + esc(t.description) + '</p>' : '') +
      figures(t) + peopleRow(t) + actions(t) + '</article>';
  }

  function heldTotal() {
    var sum = 0;
    state.tasks.forEach(function (t) {
      if (t.group !== 'completed' && payState(t.booking) === 'held') sum += Number(t.booking.amount) || t.budget;
    });
    return sum;
  }

  function render() {
    $('mtList').setAttribute('aria-busy', 'false');
    var all = state.tasks, list = visible(), host = $('mtList');
    var counts = { all: all.length, open: 0, progress: 0, completed: 0 };
    all.forEach(function (t) { if (counts[t.group] != null) counts[t.group]++; });
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var n = counts[el.getAttribute('data-count')]; el.textContent = n > 0 ? n : '';
    });
    var held = heldTotal(); $('mtHeldWrap').hidden = !held; $('mtHeld').textContent = held ? naira(held) : '';

    if (!all.length) {
      host.innerHTML = '<div class="ap-state"><h2 class="ap-state-title">No tasks yet</h2><p class="ap-state-text">Post a task and taskers near you can send you offers.</p>' +
        '<a class="ap-btn ap-btn-primary" href="post-task.html">Post a Task</a></div>';
      $('mtMore').hidden = true; return;
    }
    if (!list.length) {
      host.innerHTML = '<div class="ap-state"><h2 class="ap-state-title">Nothing matches</h2><p class="ap-state-text">Try a different tab, search or category.</p></div>';
      $('mtMore').hidden = true; return;
    }
    host.innerHTML = list.slice(0, state.shown).map(card).join('');
    $('mtMore').hidden = list.length <= state.shown;
  }

  function renderError(msg) {
    $('mtList').setAttribute('aria-busy', 'false');
    $('mtList').innerHTML = '<div class="ap-state"><h2 class="ap-state-title">Could not load your tasks</h2><p class="ap-state-text">' + esc(msg) + '</p>' +
      '<button type="button" class="ap-btn" data-act="retry">Try Again</button></div>';
  }

  /* ── Events ───────────────────────────────────────────── */
  function reset() { state.shown = PAGE_SIZE; render(); }
  $('mtTabs').addEventListener('click', function (e) {
    var b = e.target.closest('.ap-tab'); if (!b) return;
    state.filter = b.getAttribute('data-filter');
    document.querySelectorAll('#mtTabs .ap-tab').forEach(function (t) { t.setAttribute('aria-pressed', t === b ? 'true' : 'false'); });
    reset();
  });
  $('mtSearch').addEventListener('input', function (e) { state.query = e.target.value.trim(); reset(); });
  /* The list already filters as you type: the button applies the text and returns focus */
  $('mtSearchBtn').addEventListener('click', function () { var box = $('mtSearch'); state.query = box.value.trim(); reset(); box.focus(); });
  $('mtCategory').addEventListener('change', function (e) { state.category = e.target.value; reset(); });
  $('mtSort').addEventListener('change', function (e) { state.sort = e.target.value; reset(); });
  $('mtMore').addEventListener('click', function () { state.shown += PAGE_SIZE; render(); });

  /* ── Actions ──────────────────────────────────────────── */
  var current = null;
  function findTask(id) { return state.tasks.filter(function (t) { return String(t.id) === String(id); })[0]; }
  function toast(m) { if (window.showToast) window.showToast(m); }
  var dlg = $('mtCloseDlg');
  dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.hasAttribute('data-close')) dlg.close(); });

  function openChat(t) {
    if (!t.hired || !t.hired.taskerId) { toast('Cannot open chat \u2014 tasker ID missing.'); return; }
    /* Same chat context the Applications page uses for a hired tasker */
    sessionStorage.setItem('st_chat_context', JSON.stringify({
      contextType: 'task_application', contextId: String(t.hired.id), taskerId: String(t.hired.taskerId), customerId: String(state.user.id) }));
    window.location.href = 'messages.html';
  }

  $('mtList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'retry') { $('mtList').setAttribute('aria-busy', 'true'); load().catch(function (x) { renderError(x && x.message ? x.message : 'Something went wrong.'); }); return; }
    var t = findTask(b.getAttribute('data-id')); if (!t) return;
    current = t;
    if (act === 'message') { openChat(t); return; }
    if (act === 'close') {
      var n = t.offers.length;
      $('mtClText').textContent = '\u201C' + t.title + '\u201D will stop appearing to taskers.' +
        (n ? ' Its ' + n + (n === 1 ? ' pending offer' : ' pending offers') + ' will be closed.' : '') + ' This can\u2019t be undone.';
      $('mtClError').hidden = true; dlg.showModal();
    }
  });

  $('mtClConfirm').addEventListener('click', async function () {
    var btn = this, t = current, err = $('mtClError'); btn.disabled = true; err.hidden = true;
    try {
      if (t.group !== 'open' || t.hired) throw new Error('Only open posts with no hired tasker can be closed.');
      var r = await window.supabase.from('tasks').update({ status: 'cancelled' }).eq('id', t.id).select('id');
      if (r.error) throw new Error(r.error.message);
      if (!r.data || !r.data.length) throw new Error('We could not close this post. Please refresh and try again.');
      var ar = await window.supabase.from('task_applications').update({ status: 'closed' }).eq('task_id', t.id).eq('status', 'pending');
      if (ar.error) toast('Post closed, but its offers could not be updated. Please refresh.');
      t.group = 'closed'; t.raw.status = 'cancelled'; t.offers = [];
      dlg.close(); render(); toast('Post closed.');
    } catch (x) { err.textContent = x.message || 'Could not close this post.'; err.hidden = false; }
    btn.disabled = false;
  });

  load().catch(function (e) { renderError(e && e.message ? e.message : 'Something went wrong.'); });
})();

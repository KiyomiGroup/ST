/* ============================================================
   STREETTASKER — messages-room.js   (Job Room, step 3)
   Room header (who + what job) and the task status banner.

   Public API (window.JRRoom), used by messages.html:
     JRRoom.open({ thread, user, role })  draw header + banner for a thread
     JRRoom.refresh()                     redraw after the thread's data changed
     JRRoom.statusFor(thread, role)       { key, label } for the status pill
     JRRoom.current()                     { thread, user, role } of the open room

   Data (all best-effort; a blocked query just leaves that part blank):
     users            name, avatar_url, is_verified
     taskers          service, category, location, photo_url, is_verified
     bookings         count of completed jobs for the tasker (customer view)
     tasks            title, location
   Rating is NOT shown: there is no ratings table in the data yet.

   No inline styles, no raw colours: classes live in css/messages.css.
   ============================================================ */
'use strict';

(function () {

  var cache = { profiles: {}, tasks: {} };
  var current = null;          /* { thread, user, role } */
  var menuBound = false;

  /* Statuses from spec section 3 that the data can express today.
     The in-work ones (en route, arrived, ...) are read from booking.status
     once step 7 starts writing them; the strings below are the agreed names
     and must match what step 7 stores. */
  /* On-site progress (bookings.work_stage, set by job_progress() in sql/messaging-step7.sql) */
  var WORK_STAGE = {
    en_route:    'Tasker En Route',
    arrived:     'Arrived',
    in_progress: 'Work In Progress',
    paused:      'Work Paused'
  };
  /* Statuses nothing sets yet (reschedule / suspension come with step 10) */
  var BOOKING_STATUS_EXTRA = { rescheduled: 'Rescheduled', suspended: 'Suspended' };

  var ICON_SHIELD = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>';
  var ICON_PIN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  var ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

  /* ── helpers ─────────────────────────────────────────────── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svgSpan(cls, svg) {
    var s = el('span', cls);
    s.innerHTML = svg;            /* constant strings above, never user data */
    return s;
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
  function $(id) { return document.getElementById(id); }

  /* ── status ──────────────────────────────────────────────── */
  function statusFor(t, role) {
    var isCustomer = role === 'customer';
    var job = (window.JRList && window.JRList.derive) ? (t._job || window.JRList.derive(t, role)) : { key: 'inquiry' };
    var bk = t.booking || null;

    var closed = ['completed', 'disputed', 'cancelled', 'awaiting_confirmation'].indexOf(job.key) !== -1;
    if (bk && bk.work_stage && WORK_STAGE[bk.work_stage] && !closed) {
      return { key: 'work', stage: bk.work_stage, label: WORK_STAGE[bk.work_stage], job: job };
    }
    if (bk && BOOKING_STATUS_EXTRA[bk.status] && !closed) {
      return { key: 'work', label: BOOKING_STATUS_EXTRA[bk.status], job: job };
    }
    switch (job.key) {
      case 'payment_pending':       return { key: job.key, label: 'Payment Pending', job: job };
      case 'secured':               return { key: job.key, label: 'Payment Secured', job: job };
      case 'awaiting_confirmation': return { key: job.key, label: isCustomer ? 'Awaiting Approval' : 'Awaiting Customer Confirmation', job: job };
      case 'completed':             return { key: job.key, label: 'Completed', job: job };
      case 'disputed':              return { key: job.key, label: 'Disputed', job: job };
      case 'cancelled':             return { key: job.key, label: 'Cancelled', job: job };
      default: break;
    }
    if (bk && bk.status === 'confirmed') return { key: 'booked', label: 'Booking Confirmed', job: job };
    if (t.application && t.application.status === 'accepted') return { key: 'booked', label: 'Application Accepted', job: job };
    return { key: 'inquiry', label: '', job: job };
  }

  function bannerText(st, role, amount, held) {
    var isCustomer = role === 'customer';
    var amt = amount ? naira(amount) : '';
    switch (st.key) {
      case 'payment_pending':
        return isCustomer
          ? (amt ? amt + ' requested. Pay securely through StreetTasker SafePay.' : 'Payment requested. Pay securely through StreetTasker SafePay.')
          : 'Waiting for the customer to pay' + (amt ? ' ' + amt : '') + '.';
      case 'secured':
        return (held ? 'SafePay is holding ' + naira(held) + ' ' : (amt ? 'SafePay is holding ' + amt + ' ' : 'SafePay is holding the payment ')) + 'until the work is signed off.';
      case 'awaiting_confirmation':
        return isCustomer ? 'Review the work, then release payment.' : 'Waiting for the customer to confirm and share the completion code.';
      case 'completed': return 'This task is complete.';
      case 'disputed':  return 'Payment stays protected while this issue is reviewed.';
      case 'cancelled': return 'This task was cancelled.';
      case 'work':
        if (st.stage === 'en_route') return isCustomer ? 'Your tasker is on the way.' : 'You told the customer you are on the way.';
        if (st.stage === 'arrived')  return isCustomer ? 'Your tasker has arrived.' : 'You have arrived.';
        if (st.stage === 'paused')   return 'Work is paused.';
        return 'Work is underway.';
      case 'booked':    return 'Agree the details here, then pay through StreetTasker SafePay.';
      default:          return 'Agree the details here before any payment.';
    }
  }

  /* ── data ────────────────────────────────────────────────── */
  async function getProfile(otherId, otherIsTasker) {
    var key = otherId + ':' + (otherIsTasker ? 't' : 'c');
    if (cache.profiles[key]) return cache.profiles[key];
    var out = { verified: false, avatar: '', service: '', completed: null };
    var sb = window.supabase;
    try {
      var u = await sb.from('users').select('id,avatar_url,is_verified').eq('id', otherId).maybeSingle();
      if (u.data) { out.verified = u.data.is_verified === true; out.avatar = u.data.avatar_url || ''; }
    } catch (_e) {}
    if (otherIsTasker) {
      try {
        var tk = await sb.from('taskers')
          .select('id,service,service_name,category,business_name,photo_url,is_verified')
          .eq('user_id', String(otherId)).maybeSingle();
        if (tk.data) {
          out.service = tk.data.service_name || tk.data.service || tk.data.category || '';
          if (tk.data.is_verified === true) out.verified = true;
          if (!out.avatar && tk.data.photo_url) out.avatar = tk.data.photo_url;
          try {
            var c = await sb.from('bookings').select('id', { count: 'exact', head: true })
              .eq('tasker_id', tk.data.id).eq('status', 'completed');
            if (!c.error && typeof c.count === 'number') out.completed = c.count;
          } catch (_e2) {}
        }
      } catch (_e3) {}
    }
    cache.profiles[key] = out;
    return out;
  }

  async function getTask(taskId) {
    if (!taskId) return null;
    if (cache.tasks[taskId]) return cache.tasks[taskId];
    try {
      var r = await window.supabase.from('tasks').select('id,title,location').eq('id', taskId).maybeSingle();
      if (r.data) { cache.tasks[taskId] = r.data; return r.data; }
    } catch (_e) {}
    return null;
  }

  /* ── rendering ───────────────────────────────────────────── */
  function otherOf(ctx) {
    var t = ctx.thread;
    var isCustomer = ctx.user.id === t.customer_id;
    return {
      isCustomer: isCustomer,
      id: isCustomer ? t.tasker_id : t.customer_id,
      data: isCustomer ? t.tasker : t.customer
    };
  }

  function paintHead(ctx, profile, task) {
    var o = otherOf(ctx);
    var name = (o.data && o.data.name) || (o.isCustomer ? 'Tasker' : 'Customer');

    /* avatar */
    var av = $('chatHeadAvatar');
    if (av) {
      av.textContent = '';
      var url = safeUrl((profile && profile.avatar) || (o.data && o.data.avatar_url));
      if (url) {
        var img = el('img', 'msg-thread-avatar-img');
        img.src = url; img.alt = '';
        img.addEventListener('error', function () { img.remove(); av.textContent = initialsOf(name); });
        av.appendChild(img);
      } else {
        av.textContent = initialsOf(name);
      }
    }

    /* name + verified badge */
    var nm = $('chatHeadName');
    if (nm) {
      nm.textContent = '';
      nm.appendChild(el('span', 'msg-chat-head-title', name));
      if (profile && profile.verified) {
        var vb = svgSpan('jr-verified', ICON_CHECK);
        vb.title = 'Verified';
        vb.setAttribute('aria-label', 'Verified');
        nm.appendChild(vb);
      }
    }

    /* sub line: customer sees service + completed jobs, tasker sees role + job location */
    var sub = $('chatHeadSub');
    if (sub) {
      var bits = [];
      if (o.isCustomer) {
        if (profile && profile.service) bits.push(profile.service);
        if (profile && typeof profile.completed === 'number' && profile.completed > 0) {
          bits.push(profile.completed + (profile.completed === 1 ? ' completed job' : ' completed jobs'));
        }
        if (!bits.length) bits.push('Tasker');
      } else {
        bits.push('Customer');
        if (task && task.location) bits.push(task.location);
      }
      sub.textContent = bits.join(' · ');
    }

    paintMenu(ctx, o);
  }

  function paintBanner(ctx, task) {
    var host = $('jrBanner');
    if (!host) return;
    var t = ctx.thread;
    var st = statusFor(t, ctx.role);
    var title = (task && task.title) || t._title || '';
    var amount = (st.job && st.job.amount) || t.agreed_price || 0;
    var held = 0;
    if (window.JRMoney) {
      var sm = window.JRMoney.summary(t);
      if (sm.total > 0) amount = sm.total;          /* agreed + approved extras */
      held = sm.paid;
    }

    host.textContent = '';
    if (!title && st.key === 'inquiry') { host.hidden = true; return; }
    host.hidden = false;
    host.className = 'jr-banner jr-banner--' + st.key;

    host.appendChild(svgSpan('jr-banner-icon', ICON_SHIELD));

    var main = el('div', 'jr-banner-main');
    main.appendChild(el('div', 'jr-banner-title', title || 'Task discussion'));
    main.appendChild(el('div', 'jr-banner-text', bannerText(st, ctx.role, amount, held)));
    if (task && task.location) {
      var loc = el('div', 'jr-banner-meta');
      loc.appendChild(svgSpan('jr-banner-pin', ICON_PIN));
      loc.appendChild(document.createTextNode(task.location));
      main.appendChild(loc);
    }
    host.appendChild(main);

    var side = el('div', 'jr-banner-side');
    if (st.label) side.appendChild(el('span', 'jr-banner-pill', st.label));
    if (amount) side.appendChild(el('div', 'jr-banner-amount', naira(amount)));
    host.appendChild(side);
  }

  /* More menu. Items are added here as features land (report, block, cancel in step 10). */
  function menuItems(ctx, o) {
    var items = [];
    if (o.isCustomer && o.id) {
      items.push({ label: 'View tasker profile', href: 'tasker-profile.html?id=' + encodeURIComponent(o.id) });
    }
    if (o.isCustomer && window.JRList && window.JRList.archiveReady()) {
      var archived = window.JRList.isArchived(ctx.thread);
      items.push({
        label: archived ? 'Unarchive conversation' : 'Archive conversation',
        onClick: async function () {
          try {
            await window.JRList.setArchived(ctx.thread, !archived);
            if (window.JRThread) window.JRThread.toast(archived ? 'Conversation restored' : 'Conversation archived');
            paintMenu(ctx, o);
          } catch (e) {
            if (window.JRThread) window.JRThread.toast('Could not update: ' + ((e && e.message) || String(e)), 'error');
          }
        }
      });
    }
    return items;
  }

  function paintMenu(ctx, o) {
    var btn = $('chatHeadMore');
    var menu = $('chatHeadMenu');
    if (!btn || !menu) return;
    var items = menuItems(ctx, o);
    menu.textContent = '';
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.hidden = items.length === 0;
    items.forEach(function (it) {
      var a;
      if (it.href) {
        a = el('a', 'jr-menu-item', it.label);
        a.href = it.href;
      } else {
        a = el('button', 'jr-menu-item', it.label);
        a.type = 'button';
        a.addEventListener('click', it.onClick);
      }
      a.setAttribute('role', 'menuitem');
      menu.appendChild(a);
    });
    if (!menuBound) {
      menuBound = true;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = menu.hidden;
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', function () { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
      });
    }
  }

  /* ── public ──────────────────────────────────────────────── */
  async function open(ctx) {
    current = ctx;
    var t = ctx.thread;
    var o = otherOf(ctx);
    var token = t.id;

    /* 1) paint immediately with what the list already knows */
    var cachedProfile = cache.profiles[o.id + ':' + (o.isCustomer ? 't' : 'c')] || null;
    var cachedTask = t._taskId ? cache.tasks[t._taskId] || null : null;
    paintHead(ctx, cachedProfile, cachedTask);
    paintBanner(ctx, cachedTask);
    if (window.JRRequests) window.JRRequests.update(ctx);
    if (window.JRWork) window.JRWork.update(ctx);

    /* 2) then fill in profile + task details */
    var results = await Promise.all([getProfile(o.id, o.isCustomer), getTask(t._taskId)]);
    if (!current || current.thread.id !== token) return;   /* user switched threads meanwhile */
    paintHead(ctx, results[0], results[1]);
    paintBanner(ctx, results[1]);
    if (window.JRRequests) window.JRRequests.update(ctx);
    if (window.JRWork) window.JRWork.update(ctx);
  }

  function refresh() {
    if (!current) return;
    var t = current.thread;
    var o = otherOf(current);
    paintHead(current, cache.profiles[o.id + ':' + (o.isCustomer ? 't' : 'c')] || null, t._taskId ? cache.tasks[t._taskId] || null : null);
    paintBanner(current, t._taskId ? cache.tasks[t._taskId] || null : null);
    if (window.JRRequests) window.JRRequests.update(current);
    if (window.JRWork) window.JRWork.update(current);
  }

  window.JRRoom = { open: open, refresh: refresh, statusFor: statusFor, current: function () { return current; } };

})();

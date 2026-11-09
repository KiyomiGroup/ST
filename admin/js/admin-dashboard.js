/* StreetTasker Admin: Dashboard (stage A4, spec S01). READ ONLY.
   One call: rpc admin_dashboard_summary(). The server returns only the sections this admin may see;
   a section it could not read comes back as { available: false, reason } and is shown as "Not available".
   Nothing here writes. All text is set with textContent. */
'use strict';
AdminShell.init({ page: 'dashboard', title: 'Dashboard', permission: null }).then(function (ctx) {
  var root = document.getElementById('adDash');
  var body = document.getElementById('adDashBody');
  var stamp = document.getElementById('adDashStamp');
  root.hidden = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function fmt(n) { return Number(n).toLocaleString('en-NG'); }
  function naira(n) { return '\u20A6' + Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 }); }
  function label(s) { var t = String(s == null ? 'unknown' : s).replace(/[._]/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); }
  function ok(sec) { return sec && sec.available === true; }

  /* a card links only to a page that is built; otherwise it is plain (no dead links) */
  function builtHref(file) {
    var found = null;
    (AdminShell.nav || []).forEach(function (g) { g.items.forEach(function (i) { if (i.href === file && i.built) found = i.href; }); });
    return found;
  }

  function section(title, note) {
    var s = el('section', 'ad-card ad-dash-section');
    s.appendChild(el('h2', 'ad-card-title', title));
    if (note) s.appendChild(el('p', 'ad-note', note));
    body.appendChild(s);
    return s;
  }
  function unavailable(sec, why) {
    var b = el('div', 'ad-na');
    b.appendChild(el('strong', null, 'Not available'));
    b.appendChild(el('span', null, why ? ' ' + why : ''));
    sec.appendChild(b);
  }
  function stat(parent, value, text, href, tone) {
    var node = href ? el('a', 'ad-stat ad-stat--link') : el('div', 'ad-stat');
    if (href) node.href = href;
    if (tone) node.classList.add('ad-stat--' + tone);
    node.appendChild(el('div', 'ad-stat-num', value));
    node.appendChild(el('div', 'ad-stat-label', text));
    parent.appendChild(node);
  }
  function grid(parent) { var g = el('div', 'ad-grid'); parent.appendChild(g); return g; }

  function render(d) {
    clear(body);

    /* Row 1: needs attention. A card is shown only when the admin may see it AND the count is above zero;
       a source that could not be read is shown as Not available (never hidden, never zero). */
    var att = [];
    function addCount(key, text, href, tone) {
      var s = d[key];
      if (!s) return;
      if (!ok(s)) { att.push({ na: true, text: text, reason: s.reason }); return; }
      if (s.count > 0) att.push({ value: fmt(s.count), text: text, href: href, tone: tone });
    }
    addCount('pending_approvals', 'Pending approvals', builtHref('approvals.html'), 'warn');
    addCount('local_needs_coordinator', 'Local bookings needing a coordinator', null, 'warn');
    if (d.disputes) {
      if (!ok(d.disputes)) att.push({ na: true, text: 'Disputes', reason: d.disputes.reason });
      else {
        var od = Number(d.disputes.open) + Number(d.disputes.under_review);
        if (od > 0) att.push({ value: fmt(od), text: 'Open disputes (' + fmt(d.disputes.open) + ' open, ' + fmt(d.disputes.under_review) + ' under review)', tone: 'danger' });
      }
    }
    addCount('verifications_waiting', 'Identity checks waiting', null, 'warn');
    addCount('stuck_withdrawals', 'Withdrawals stuck over 60 minutes', null, 'danger');
    addCount('coordinator_applications', 'Coordinator applications waiting', builtHref('coordinators.html'), 'warn');

    var a = section('Needs attention');
    var anySeen = ['pending_approvals', 'local_needs_coordinator', 'disputes', 'verifications_waiting', 'stuck_withdrawals', 'coordinator_applications'].some(function (k) { return d[k]; });
    if (!anySeen) {
      a.appendChild(el('p', 'ad-note', 'Your role has no item that needs attention here.'));
    } else if (!att.length) {
      a.appendChild(el('p', 'ad-note', 'Nothing needs attention right now.'));
    } else {
      var g1 = grid(a);
      att.forEach(function (x) {
        if (x.na) { var c = el('div', 'ad-stat'); c.appendChild(el('div', 'ad-stat-num', 'Not available')); c.appendChild(el('div', 'ad-stat-label', x.text + (x.reason ? '. ' + x.reason : ''))); g1.appendChild(c); }
        else stat(g1, x.value, x.text, x.href, x.tone);
      });
    }
    a.appendChild(el('p', 'ad-note', 'Not shown yet because no source exists: locked bookings, subscription payments needing review.'));

    /* Row 2: people */
    if (d.people || d.local_taskers || d.coordinators || d.admins) {
      var p = section('People');
      var g2 = grid(p);
      if (d.people) {
        if (ok(d.people)) {
          stat(g2, fmt(d.people.customers), 'Customers');
          stat(g2, fmt(d.people.taskers), 'Taskers');
          if (Number(d.people.other) > 0) stat(g2, fmt(d.people.other), 'Accounts with no role chosen yet');
        } else unavailable(p, d.people.reason);
      }
      if (d.local_taskers) {
        if (ok(d.local_taskers)) {
          stat(g2, fmt(d.local_taskers.published), 'Local Taskers published');
          stat(g2, fmt(d.local_taskers.ready + d.local_taskers.draft + d.local_taskers.inactive), 'Local Taskers not published (' + fmt(d.local_taskers.ready) + ' ready, ' + fmt(d.local_taskers.draft) + ' draft, ' + fmt(d.local_taskers.inactive) + ' inactive)');
        } else unavailable(p, 'Local Taskers: ' + d.local_taskers.reason);
      }
      if (d.coordinators) {
        if (ok(d.coordinators)) {
          stat(g2, fmt(d.coordinators.active), 'Coordinators active');
          var other = Number(d.coordinators.pending) + Number(d.coordinators.suspended) + Number(d.coordinators.deactivated);
          if (other > 0) stat(g2, fmt(other), 'Coordinators not active (' + fmt(d.coordinators.pending) + ' pending, ' + fmt(d.coordinators.suspended) + ' suspended, ' + fmt(d.coordinators.deactivated) + ' deactivated)');
        } else unavailable(p, 'Coordinators: ' + d.coordinators.reason);
      }
      if (d.admins) {
        if (ok(d.admins)) stat(g2, fmt(d.admins.active), 'Active admins');
        else unavailable(p, 'Admin team: ' + d.admins.reason);
      }
    }

    /* Row 3: bookings by status, last 30 days (status words exactly as stored) */
    if (d.bookings_30d) {
      var b = section('Bookings, last 30 days', 'Status words are shown exactly as the database stores them.');
      var bs = d.bookings_30d;
      if (!ok(bs)) unavailable(b, bs.reason);
      else {
        var keys = Object.keys(bs.by_status || {});
        if (!keys.length) b.appendChild(el('p', 'ad-note', 'No bookings were created in the last 30 days.'));
        else {
          var g3 = grid(b);
          keys.sort().forEach(function (k) { stat(g3, fmt(bs.by_status[k]), label(k)); });
          b.appendChild(el('p', 'ad-note', 'Total: ' + fmt(bs.total)));
        }
      }
    }

    /* Row 4: money, separate boxes (never one total) */
    if (d.commission) {
      var m = section('Money', 'Four separate boxes. They are never added together. Admin only reads these numbers; it never moves money.');
      var g4 = el('div', 'ad-grid ad-grid--wide');
      m.appendChild(g4);
      var box = el('div', 'ad-box');
      box.appendChild(el('h3', 'ad-box-title', 'Regular Tasker commission (platform fee on escrow rows)'));
      if (!ok(d.commission)) unavailable(box, d.commission.reason);
      else {
        var st = Object.keys(d.commission.by_status || {});
        if (!st.length) box.appendChild(el('p', 'ad-note', 'No escrow rows yet.'));
        st.sort().forEach(function (k) {
          var row = d.commission.by_status[k];
          var line = el('div', 'ad-line');
          line.appendChild(el('span', null, label(k) + ' (' + fmt(row.rows) + ' ' + (Number(row.rows) === 1 ? 'row' : 'rows') + ')'));
          line.appendChild(el('strong', null, naira(row.platform_fee)));
          box.appendChild(line);
        });
      }
      g4.appendChild(box);
      ['Subscription revenue', 'Coordinator plan revenue', 'Other income (donations, gift cards)'].forEach(function (t) {
        var o = el('div', 'ad-box');
        o.appendChild(el('h3', 'ad-box-title', t));
        unavailable(o, 'Built in a later stage (Revenue, stage A16). No number is shown until a server record supports it.');
        g4.appendChild(o);
      });
    }

    /* Row 5: recent activity */
    if (d.recent_activity) {
      var r = section('Recent activity', 'Last 20 admin actions: what, on what kind of thing, and the result. Names and values are not shown here.');
      if (!ok(d.recent_activity)) unavailable(r, d.recent_activity.reason);
      else if (!(d.recent_activity.rows || []).length) r.appendChild(el('p', 'ad-note', 'No admin activity has been recorded yet.'));
      else {
        var ul = el('ul', 'ad-feed');
        d.recent_activity.rows.forEach(function (x) {
          var li = el('li', 'ad-feed-item');
          var when = new Date(x.at);
          li.appendChild(el('span', 'ad-feed-when', isNaN(when) ? '' : when.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })));
          li.appendChild(el('span', 'ad-feed-what', label(x.action) + (x.target_type ? ' on ' + String(x.target_type).replace(/_/g, ' ') : '')));
          var res = el('span', 'badge ad-feed-badge', x.outcome === 'ok' ? 'Done' : (x.outcome === 'refused' ? 'Refused' : 'Error'));
          li.appendChild(res);
          ul.appendChild(li);
        });
        r.appendChild(ul);
      }
    }

    /* Row 6: growth (plain table with a <meter> bar per week, no inline style) */
    if (d.growth) {
      var gr = section('New accounts per week, last 12 weeks');
      if (!ok(d.growth)) unavailable(gr, d.growth.reason);
      else {
        var weeks = d.growth.weeks || [];
        var max = weeks.reduce(function (n, w) { return Math.max(n, Number(w.count)); }, 0);
        var wrap = el('div', 'ad-tablewrap');
        var tbl = el('table', 'ad-table');
        var cap = el('caption', 'ad-sr', 'New accounts per week'); tbl.appendChild(cap);
        var hr = el('tr'); ['Week starting', 'New accounts', ''].forEach(function (h) { var th = el('th', null, h); th.scope = 'col'; hr.appendChild(th); });
        var thead = el('thead'); thead.appendChild(hr); tbl.appendChild(thead);
        var tb = el('tbody');
        weeks.forEach(function (w) {
          var tr = el('tr');
          var d0 = new Date(w.week_start + 'T00:00:00');
          tr.appendChild(el('td', null, isNaN(d0) ? String(w.week_start) : d0.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })));
          tr.appendChild(el('td', null, fmt(w.count)));
          var td = el('td', 'ad-meter-cell');
          var mt = document.createElement('meter');
          mt.min = 0; mt.max = Math.max(max, 1); mt.value = Number(w.count);
          mt.setAttribute('aria-label', fmt(w.count) + ' new accounts');
          td.appendChild(mt); tr.appendChild(td);
          tb.appendChild(tr);
        });
        tbl.appendChild(tb); wrap.appendChild(tbl); gr.appendChild(wrap);
      }
    }

    var when = new Date(d.generated_at);
    stamp.textContent = isNaN(when) ? '' : 'Read from the server at ' + when.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) + '.';
  }

  async function load() {
    clear(body);
    body.appendChild(ctx.skeleton(4));
    var res;
    try { res = await window.supabase.rpc('admin_dashboard_summary'); }
    catch (e) { res = { error: e }; }
    if (res.error || !res.data) {
      var code = res.error && (res.error.code || '');
      if (code === '42501') ctx.showNoPermission(body, 'an active admin login');
      else if (code === '42883' || code === 'PGRST202') ctx.showError(body, 'The dashboard function is not on the server yet. Run sql/admin/a4-dashboard.sql in the Supabase SQL editor, then press Retry.', load);
      else ctx.showError(body, 'The server could not answer. Nothing was changed.', load);
      return;
    }
    render(res.data);
  }
  load();
});

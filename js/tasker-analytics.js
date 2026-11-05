/* StreetTasker: tasker Analytics panel (S4j). Lives in dashboard-tasker.html (panel-analytics).
   One read: get_my_analytics(p_days) (S3g). The server decides what each plan may see and answers every section as
   {access: 'full' | 'basic' | 'locked', upgrade_to, data}. This file only draws that answer:
   - 'full' / 'basic': draws the numbers it was given, never computes or estimates one.
   - 'locked': an upgrade card (never a broken or empty tile). upgrade_to is a plan key; its name comes from get_public_plans().
   - a rate the server could not work out (null) reads "Not enough data yet", never 0%.
   - no activity in the period: a plain note, the real zeros stay.
   No plan name, price, limit or period length is written in this file. Read-only: no insert, update or payment. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var RANGES = [7, 30, 90, 365];
  var state = { days: 30, max: 30, busy: false, names: null };
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmtInt(v) { return num(v).toLocaleString('en-NG'); }
  function naira(v) { return '₦' + num(v).toLocaleString('en-NG', { maximumFractionDigits: 2 }); }
  function pct(v) { return v == null || !isFinite(Number(v)) ? 'Not enough data yet' : String(Number(v)) + '%'; }
  function change(v) {
    if (v == null || !isFinite(Number(v))) return 'No earlier period to compare';
    var n = Number(v);
    return (n > 0 ? '+' : '') + n + '% compared with the period before';
  }
  function title(s) { s = String(s == null ? '' : s).replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmtDay(iso) {
    if (!iso) return '';
    try { return new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
    catch (e) { return ''; }
  }

  /* Which ranges the person can pick: only those the server's plan allows (max_days). */
  function rangeOptions(max) {
    var m = num(max) || 30;
    return RANGES.filter(function (d) { return d <= m; });
  }

  function stat(label, value, hint) {
    var d = el('div', 'ta-stat');
    d.appendChild(el('div', 'ta-stat-value', value));
    d.appendChild(el('div', 'ta-stat-label', label));
    if (hint) d.appendChild(el('div', 'ta-stat-hint', hint));
    return d;
  }
  function statGrid(items) {
    var g = el('div', 'ta-stats');
    items.forEach(function (i) { g.appendChild(stat(i[0], i[1], i[2])); });
    return g;
  }

  function card(titleText, sec, names) {
    var c = el('section', 'ta-card');
    c.appendChild(el('h3', 'ta-card-title', titleText));
    if (!sec || sec.access === 'locked' || !sec.access) {
      c.classList.add('ta-card--locked');
      c.appendChild(el('p', 'ta-locked-text', 'This is part of ' + planName(sec && sec.upgrade_to, names) + '.'));
      c.appendChild(upgradeLink('See plans'));
      return { node: c, open: false };
    }
    return { node: c, open: true };
  }
  function planName(key, names) {
    return (key && names && names[key]) ? 'the ' + names[key] + ' plan' : 'a higher plan';
  }
  function upgradeLink(text) {
    var a = el('a', 'btn btn-ghost btn-sm', text);
    a.href = 'subscription.html';
    return a;
  }
  function moreNote(c, sec, names) {
    if (sec && sec.access === 'basic' && sec.upgrade_to) {
      var p = el('p', 'ta-more');
      p.appendChild(document.createTextNode('See more detail with ' + planName(sec.upgrade_to, names) + '. '));
      var a = el('a', 'db-link', 'See plans'); a.href = 'subscription.html';
      p.appendChild(a);
      c.appendChild(p);
    }
  }

  /* Simple bar chart. Draws the numbers it is given; every bar has a text label for screen readers and hover. */
  function chart(daily) {
    var rows = Array.isArray(daily) ? daily : [];
    var hasService = rows.some(function (r) { return r && r.service_views != null; });
    var max = 0;
    rows.forEach(function (r) { max = Math.max(max, num(r.profile_views), num(r.service_views)); });
    var wrap = el('div', 'ta-chart');
    var totalP = rows.reduce(function (a, r) { return a + num(r.profile_views); }, 0);
    var totalS = rows.reduce(function (a, r) { return a + num(r.service_views); }, 0);
    if (!rows.length || max === 0) {
      wrap.appendChild(el('p', 'ta-empty', 'No views in this period yet. Bars appear here as people open your profile' + (hasService ? ' and services.' : '.')));
      return wrap;
    }
    var W = 600, H = 140, n = rows.length, slot = W / n, groups = hasService ? 2 : 1;
    var bw = Math.max(1, (slot * 0.8) / groups);
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'ta-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Daily views: ' + totalP + ' profile views' + (hasService ? ', ' + totalS + ' service views' : '') + ' over ' + n + ' days');
    var base = document.createElementNS(NS, 'line');
    base.setAttribute('x1', 0); base.setAttribute('x2', W); base.setAttribute('y1', H - 0.5); base.setAttribute('y2', H - 0.5);
    base.setAttribute('class', 'ta-axis');
    svg.appendChild(base);
    function bar(i, g, v, cls, label) {
      var h = Math.max(v > 0 ? 2 : 0, (v / max) * (H - 4));
      var r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', (i * slot + slot * 0.1 + g * bw).toFixed(2));
      r.setAttribute('y', (H - h).toFixed(2));
      r.setAttribute('width', bw.toFixed(2));
      r.setAttribute('height', h.toFixed(2));
      r.setAttribute('class', cls);
      var t = document.createElementNS(NS, 'title');
      t.textContent = label;
      r.appendChild(t);
      svg.appendChild(r);
    }
    rows.forEach(function (r, i) {
      var d = fmtDay(r.day);
      bar(i, 0, num(r.profile_views), 'ta-bar ta-bar--profile', d + ': ' + num(r.profile_views) + ' profile views');
      if (hasService) bar(i, 1, num(r.service_views), 'ta-bar ta-bar--service', d + ': ' + num(r.service_views) + ' service views');
    });
    wrap.appendChild(svg);
    var axis = el('div', 'ta-chart-axis');
    axis.appendChild(el('span', null, fmtDay(rows[0].day)));
    axis.appendChild(el('span', null, 'Busiest day: ' + fmtInt(max)));
    axis.appendChild(el('span', null, fmtDay(rows[rows.length - 1].day)));
    wrap.appendChild(axis);
    var legend = el('div', 'ta-legend');
    legend.appendChild(el('span', 'ta-key ta-key--profile', 'Profile views'));
    if (hasService) legend.appendChild(el('span', 'ta-key ta-key--service', 'Service views'));
    wrap.appendChild(legend);
    return wrap;
  }

  function list(rows, left, right) {
    var ul = el('ul', 'ta-list');
    rows.forEach(function (r) {
      var li = el('li', 'ta-list-row');
      li.appendChild(el('span', 'ta-list-left', left(r)));
      li.appendChild(el('strong', 'ta-list-right', right(r)));
      ul.appendChild(li);
    });
    return ul;
  }

  var builders = {
    offer_history: function (s, c) {
      var d = s.data || {}, b = d.by_status || {};
      c.appendChild(statGrid([['Offers sent in this period', fmtInt(d.submitted)], ['Offers sent, all time', fmtInt(d.all_time)]]));
      c.appendChild(list(['pending', 'accepted', 'rejected', 'closed', 'withdrawn'], title, function (k) { return fmtInt(b[k]); }));
    },
    booking_history: function (s, c) {
      var d = s.data || {}, b = d.by_status || {}, keys = Object.keys(b).sort();
      c.appendChild(statGrid([['Bookings received in this period', fmtInt(d.received)], ['Completed', fmtInt(d.completed)], ['Bookings received, all time', fmtInt(d.all_time)]]));
      if (keys.length) c.appendChild(list(keys, title, function (k) { return fmtInt(b[k]); }));
    },
    profile_views: function (s, c) {
      var d = s.data || {}, items = [['Profile views', fmtInt(d.total)]];
      if (d.unique_viewers != null) items.push(['Different people', fmtInt(d.unique_viewers)]);
      c.appendChild(statGrid(items));
      if (Array.isArray(d.daily)) c.appendChild(chart(d.daily));
    },
    service_views: function (s, c) {
      var d = s.data || {}, items = [['Service views', fmtInt(d.total)]];
      if (d.unique_viewers != null) items.push(['Different people', fmtInt(d.unique_viewers)]);
      c.appendChild(statGrid(items));
      var top = Array.isArray(d.most_viewed) ? d.most_viewed : null;
      if (top) {
        c.appendChild(el('h4', 'ta-sub', 'Most viewed services'));
        if (top.length) c.appendChild(list(top, function (r) { return r.service_name || 'Service'; }, function (r) { return fmtInt(r.views) + ' views'; }));
        else c.appendChild(el('p', 'ta-empty', 'No service has been viewed in this period yet.'));
      }
    },
    offer_performance: function (s, c) {
      var d = s.data || {}, items = [['Offers sent', fmtInt(d.submitted)], ['Accepted', fmtInt(d.accepted)], ['Acceptance rate', pct(d.accept_rate_percent)]];
      if (d.rejected != null) items.push(['Not chosen', fmtInt(d.rejected)], ['Withdrawn', fmtInt(d.withdrawn)], ['Still waiting', fmtInt(d.still_pending)], ['Task closed first', fmtInt(d.task_closed)]);
      c.appendChild(statGrid(items));
    },
    booking_conversion: function (s, c) {
      var d = s.data || {};
      c.appendChild(statGrid([
        ['Different people who viewed you', fmtInt(d.unique_viewers)], ['Bookings received', fmtInt(d.bookings_received)],
        ['Bookings for every 100 people', d.bookings_per_100_viewers == null ? 'Not enough data yet' : String(d.bookings_per_100_viewers)],
        ['Offers sent', fmtInt(d.offers_submitted)], ['Bookings that came from offers', fmtInt(d.bookings_from_offers)],
        ['Offers that became a booking', pct(d.offers_to_booking_percent)]]));
    },
    customer_engagement: function (s, c) {
      var d = s.data || {};
      c.appendChild(statGrid([['Customers who booked you', fmtInt(d.customers_booked)], ['Booked you more than once', fmtInt(d.repeat_customers)], ['Repeat customers', pct(d.repeat_percent)]]));
    },
    trends: function (s, c) {
      var d = s.data || {};
      if (d.compared_with) c.appendChild(el('p', 'ta-note', 'Compared with ' + fmtDay(d.compared_with.from_day) + ' to ' + fmtDay(d.compared_with.to_day) + '.'));
      var items = [['Profile views', 'profile_views'], ['Service views', 'service_views'], ['Offers sent', 'offers'], ['Bookings', 'bookings']].map(function (k) {
        var t = d[k[1]] || {};
        return [k[0], fmtInt(t.current), change(t.change_percent)];
      });
      c.appendChild(statGrid(items));
      var weeks = Array.isArray(d.weekly) ? d.weekly : [];
      if (weeks.length) {
        c.appendChild(el('h4', 'ta-sub', 'Last 12 weeks'));
        var wrap = el('div', 'ta-table-wrap');
        var t = el('table', 'ta-table');
        var head = el('tr');
        ['Week starting', 'Profile views', 'Service views', 'Offers', 'Bookings'].forEach(function (h) { var th = el('th', null, h); th.scope = 'col'; head.appendChild(th); });
        var thead = el('thead'); thead.appendChild(head); t.appendChild(thead);
        var tb = el('tbody');
        weeks.forEach(function (w) {
          var tr = el('tr');
          var th = el('th', null, fmtDay(w.week_start)); th.scope = 'row'; tr.appendChild(th);
          [w.profile_views, w.service_views, w.offers, w.bookings].forEach(function (v) { tr.appendChild(el('td', null, fmtInt(v))); });
          tb.appendChild(tr);
        });
        t.appendChild(tb); wrap.appendChild(t); c.appendChild(wrap);
      }
    },
    business_insights: function (s, c) {
      var d = s.data || {};
      c.appendChild(statGrid([
        ['Average booking amount', d.average_booking_amount == null ? 'Not enough data yet' : naira(d.average_booking_amount)],
        ['Bookings completed', pct(d.completed_percent)]]));
      var cats = Array.isArray(d.top_categories) ? d.top_categories : [];
      c.appendChild(el('h4', 'ta-sub', 'Where your bookings come from'));
      if (cats.length) c.appendChild(list(cats, function (r) { return title(r.category || 'Other'); }, function (r) { return fmtInt(r.bookings) + ' bookings'; }));
      else c.appendChild(el('p', 'ta-empty', 'No bookings in this period yet.'));
    }
  };

  var TITLES = [
    ['offer_history', 'Your offers'], ['booking_history', 'Your bookings'], ['profile_views', 'Profile views'],
    ['service_views', 'Service views'], ['offer_performance', 'Offer performance'], ['booking_conversion', 'From views to bookings'],
    ['customer_engagement', 'Customers'], ['trends', 'Performance trends'], ['business_insights', 'Business insights']
  ];

  function render(data, names) {
    var root = $('taRoot');
    root.textContent = '';
    var secs = (data && data.sections) || {};
    state.max = num(data.max_days) || 30;
    state.days = num(data.window_days) || state.days;

    var head = el('p', 'ta-window', 'Showing ' + fmtDay(data.from_day) + ' to ' + fmtDay(data.to_day) + ' (' + state.days + ' days). Your plan keeps up to ' + state.max + ' days of history.');
    root.appendChild(head);
    if (data.has_any_activity === false) {
      root.appendChild(el('p', 'ta-banner', 'No activity in this period yet. Your statistics will appear here as people view your profile and services, and as you send offers and receive bookings. Nothing here is estimated.'));
    }
    var grid = el('div', 'ta-grid');
    TITLES.forEach(function (t) {
      var sec = secs[t[0]];
      var made = card(t[1], sec, names);
      if (made.open && builders[t[0]]) { builders[t[0]](sec, made.node); moreNote(made.node, sec, names); }
      if (t[0] === 'trends' || t[0] === 'profile_views' || t[0] === 'service_views') made.node.classList.add('ta-card--wide');
      grid.appendChild(made.node);
    });
    root.appendChild(grid);

    var sel = $('taRange');
    if (sel) {
      sel.textContent = '';
      rangeOptions(state.max).forEach(function (d) {
        var o = el('option', null, 'Last ' + d + ' days'); o.value = String(d); if (d === state.days) o.selected = true; sel.appendChild(o);
      });
    }
  }

  function showError() {
    var root = $('taRoot');
    root.textContent = '';
    var box = el('div', 'db-state db-state--danger');
    box.appendChild(el('p', null, 'We could not load your analytics. Please try again.'));
    var b = el('button', 'btn btn-ghost btn-sm', 'Try again'); b.type = 'button';
    b.addEventListener('click', function () { load(); });
    box.appendChild(b);
    root.appendChild(box);
  }

  async function planNames() {
    if (state.names) return state.names;
    var map = {};
    try {
      var r = await window.supabase.rpc('get_public_plans');
      if (!r.error && Array.isArray(r.data)) r.data.forEach(function (p) { map[p.plan_key] = p.name; });
    } catch (e) { /* names are optional */ }
    state.names = map;
    return map;
  }

  async function load(days) {
    if (state.busy) return;
    state.busy = true;
    if (days) state.days = days;
    var root = $('taRoot');
    if (root) { root.textContent = ''; root.appendChild(el('div', 'db-state', 'Loading...')); }
    try {
      var r = await window.supabase.rpc('get_my_analytics', { p_days: state.days });
      if (r.error || !r.data || !r.data.sections) { showError(); return; }
      var names = await planNames();
      render(r.data, names);
    } catch (e) { showError(); }
    finally { state.busy = false; }
  }

  var sel = $('taRange');
  if (sel) sel.addEventListener('change', function () { load(num(sel.value)); });

  window.STAnalytics = { load: load, rangeOptions: rangeOptions, pct: pct, change: change, _render: render };
})();

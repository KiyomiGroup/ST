/* StreetTasker Admin: Services (services.html) and Reviews and community (reviews.html), stage A14a. READ ONLY.
   Calls admin_service_list, admin_review_list, admin_flagged_user_list, admin_community_list; each checks its own permission again.
   No button hides, deletes, clears or changes anything. All text via textContent. */
'use strict';
(function () {
  var PAGE = document.body.getAttribute('data-page');
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(v) { var d = new Date(v); return (v == null || isNaN(d)) ? '' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }); }
  function words(s) { var t = String(s == null ? '' : s).replace(/[._]/g, ' ').trim().toLowerCase(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  function money(n) { return (n == null || n === '' || isNaN(Number(n))) ? '' : '₦' + String(Math.round(Number(n) * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fail(res) {
    if (res && res.error) return 'The server could not answer. Nothing was changed.';
    if (res && res.data && res.data.ok === false) return res.data.error || 'The server refused this.';
    return null;
  }
  async function call(n, a) { try { return await window.supabase.rpc(n, a || {}); } catch (e) { return { error: e }; } }
  function stat(label, value, def, cls) {
    var s = el('div', 'ad-stat' + (cls ? ' ad-stat--' + cls : ''));
    s.appendChild(el('div', 'ad-stat-label', label)); s.appendChild(el('div', 'ad-stat-num', value));
    if (def) s.appendChild(el('p', 'ad-hint', def));
    return s;
  }
  function tableOf(caption, heads) {
    var wrap = el('div', 'ad-tablewrap ad-cards'), tbl = el('table', 'ad-table ad-table--cards');
    tbl.appendChild(el('caption', 'ad-sr', caption));
    var tr = el('tr'); heads.forEach(function (h) { var th = el('th', null, h); th.scope = 'col'; tr.appendChild(th); });
    var th = el('thead'); th.appendChild(tr); tbl.appendChild(th);
    var tb = el('tbody'); tbl.appendChild(tb); wrap.appendChild(tbl);
    return { wrap: wrap, body: tb };
  }
  function cell(tr, label, content) {
    var td = el('td'); td.setAttribute('data-label', label);
    if (content && content.nodeType) td.appendChild(content); else td.textContent = content == null ? '' : content;
    tr.appendChild(td); return td;
  }
  function badge(text) { return el('span', 'badge', text); }
  function facts(pairs) {
    var dl = el('dl', 'ad-dl');
    pairs.forEach(function (p) { if (p[1] == null || p[1] === '') return; dl.appendChild(el('dt', null, p[0])); dl.appendChild(el('dd', null, String(p[1]))); });
    return dl;
  }
  function tabs(box, list, current, onPick) {
    clear(box);
    list.forEach(function (x) {
      var b = el('button', 'btn btn-sm ' + (x[0] === current ? 'btn-outline' : 'btn-ghost'), x[1]); b.type = 'button';
      b.setAttribute('aria-pressed', x[0] === current ? 'true' : 'false');
      b.addEventListener('click', function () { onPick(x[0]); });
      box.appendChild(b);
    });
  }
  function toggleRow(t, tr, cols, build) {
    var drow = el('tr', 'ad-detail-row'), td = el('td'); td.colSpan = cols; td.setAttribute('data-label', '');
    var holder = el('div', 'ad-detail'); td.appendChild(holder); drow.appendChild(td);
    var act = el('td'); act.setAttribute('data-label', '');
    var b = el('button', 'btn ad-btn-small', 'Details'); b.type = 'button';
    b.addEventListener('click', function () {
      if (holder.firstChild) { clear(holder); b.textContent = 'Details'; return; }
      holder.appendChild(build()); b.textContent = 'Hide details';
    });
    act.appendChild(b); tr.appendChild(act); t.body.appendChild(tr); t.body.appendChild(drow);
  }
  function pager(prefix, off, n, size, onMove) {
    $(prefix + 'Newer').disabled = off === 0; $(prefix + 'Older').disabled = n < size;
    $(prefix + 'Pager').hidden = off === 0 && n < size;
  }

  /* ---------------- Services ---------------- */
  function startServices(ctx) {
    $('svRoot').hidden = false;
    var SF = [['all', 'All'], ['active', 'Active'], ['paused', 'Paused (subscription)'], ['unavailable', 'Not available']];
    var f = 'all', q = '', off = 0, req = 0, SIZE = 25;
    function range(x) { var a = money(x.price), b = money(x.price_max); return a ? (b && b !== a ? a + ' to ' + b : a) + (x.rate_unit ? ' ' + x.rate_unit : '') : ''; }
    async function load() {
      var mine = ++req, box = $('svList');
      tabs($('svTabs'), SF, f, function (k) { f = k; off = 0; load(); });
      clear(box); box.appendChild(ctx.skeleton(3)); $('svPager').hidden = true;
      var res = await call('admin_service_list', { p_filter: f, p_search: q, p_offset: off });
      if (mine !== req) return;
      var m = fail(res);
      if (m || !res.data) { ctx.showError(box, m || 'The listings could not be read.', load); return; }
      var d = res.data, items = d.items || [], c = d.counts || {};
      var sm = $('svSummary'); clear(sm);
      var g = el('div', 'ad-grid');
      g.appendChild(stat('Listings', String(c.total || 0), 'All services on the site.'));
      g.appendChild(stat('Active', String(c.active || 0), 'Shown to customers by the site.'));
      g.appendChild(stat('Paused', String(c.paused || 0), 'Paused by the subscription rules, not by an admin.'));
      g.appendChild(stat('Not available', String(c.unavailable || 0), 'The Tasker marked it unavailable.'));
      sm.appendChild(g);
      var cb = $('svCats'); clear(cb);
      (d.categories || []).forEach(function (x) { cb.appendChild(badge(x.category + ': ' + x.n)); cb.appendChild(document.createTextNode(' ')); });
      $('svCount').textContent = d.total + ' listing(s) in this view.';
      clear(box);
      if (!items.length) { if (off > 0) ctx.showEmpty(box, 'No older listings.'); else if (f === 'all' && !q) ctx.showEmpty(box, 'No listings yet.'); else ctx.showNoResults(box); }
      else {
        var t = tableOf('Service listings', ['Service', 'Tasker', 'Category', 'Price', 'Status', '']);
        items.forEach(function (x) {
          var tr = el('tr');
          cell(tr, 'Service', x.service_name || '');
          cell(tr, 'Tasker', x.tasker_name || '');
          cell(tr, 'Category', x.category || '');
          cell(tr, 'Price', range(x));
          var st = el('span'); st.appendChild(badge(words(x.listing_status)));
          if (x.available === false) st.appendChild(badge('Not available'));
          if (x.is_main) st.appendChild(badge('Main'));
          cell(tr, 'Status', st);
          toggleRow(t, tr, 6, function () {
            return facts([['Place', x.location], ['Description', x.description], ['Availability', words(x.availability_status)], ['Verified', x.verified ? 'Yes' : 'No'],
              ['Rating', x.rating != null ? x.rating + ' (' + (x.reviews_count || 0) + ' review(s))' : ''], ['Listed', when(x.created_at)], ['Last changed', when(x.updated_at)],
              ['Listing id', x.id], ['Tasker id', x.tasker_id]]);
          });
        });
        box.appendChild(t.wrap);
      }
      pager('sv', off, items.length, SIZE);
    }
    function go() { q = $('svSearch').value.trim(); off = 0; load(); }
    $('svGo').addEventListener('click', go);
    $('svSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    $('svNewer').addEventListener('click', function () { off = Math.max(0, off - SIZE); load(); });
    $('svOlder').addEventListener('click', function () { off += SIZE; load(); });
    load();
  }

  /* ---------------- Reviews and community ---------------- */
  function startReviews(ctx) {
    $('rvRoot').hidden = false;
    var SECTIONS = [];
    if (ctx.has('reviews.moderate')) SECTIONS.push(['reviews', 'Reviews']);
    if (ctx.has('trust.flags.view')) SECTIONS.push(['flags', 'Flagged users']);
    if (ctx.has('community.moderate')) { SECTIONS.push(['posts', 'Community posts']); SECTIONS.push(['comments', 'Comments']); }
    var SUBS = {
      reviews: [['all', 'All'], ['low', 'Low (1 to 2 stars)'], ['comment', 'With a comment']],
      flags: [['all', 'All'], ['flagged', 'Flagged'], ['warned', 'Warned only']],
      posts: [], comments: []
    };
    var sec = SECTIONS[0][0], sub = 'all', off = 0, req = 0, SIZE = 25;
    function stars(n) { return n == null ? '' : n + ' / 5'; }
    async function load() {
      var mine = ++req, box = $('rvList');
      tabs($('rvTabs'), SECTIONS, sec, function (k) { sec = k; sub = 'all'; off = 0; load(); });
      tabs($('rvSub'), SUBS[sec], sub, function (k) { sub = k; off = 0; load(); });
      $('rvSub').hidden = !SUBS[sec].length;
      clear(box); box.appendChild(ctx.skeleton(3)); $('rvPager').hidden = true; clear($('rvSummary'));
      var res;
      if (sec === 'reviews') res = await call('admin_review_list', { p_filter: sub, p_offset: off });
      else if (sec === 'flags') res = await call('admin_flagged_user_list', { p_filter: sub, p_offset: off });
      else res = await call('admin_community_list', { p_kind: sec, p_offset: off });
      if (mine !== req) return;
      var m = fail(res);
      if (m || !res.data) { ctx.showError(box, m || 'This could not be read.', load); return; }
      var d = res.data, items = d.items || [], c = d.counts || {}, sm = $('rvSummary');
      var g = el('div', 'ad-grid');
      if (sec === 'reviews') {
        g.appendChild(stat('Reviews', String(c.total || 0), 'All reviews on the site.'));
        g.appendChild(stat('Average', c.average != null ? String(c.average) : 'None', 'Out of 5.'));
        g.appendChild(stat('Low', String(c.low || 0), '1 or 2 stars.'));
        g.appendChild(stat('With a comment', String(c.with_comment || 0), 'Has written text.'));
      } else if (sec === 'flags') {
        g.appendChild(stat('Flagged', String(c.flagged || 0), 'Marked as flagged on the account.', c.flagged > 0 ? 'warn' : null));
        g.appendChild(stat('Warned only', String(c.warned || 0), 'Shared contact details but not flagged.'));
      } else {
        if (sec === 'posts') g.appendChild(stat('Posts', String(d.total || 0)));
        g.appendChild(stat('Comments', String(d.comments_total || 0)));
      }
      sm.appendChild(g);
      $('rvCount').textContent = d.total + ' record(s) in this view.';
      clear(box);
      if (!items.length) { if (off > 0) ctx.showEmpty(box, 'No older records.'); else if (sub === 'all') ctx.showEmpty(box, 'Nothing here yet.'); else ctx.showNoResults(box); }
      else if (sec === 'reviews') {
        var t = tableOf('Reviews', ['Date', 'From', 'About', 'Rating', 'Comment', '']);
        items.forEach(function (x) {
          var tr = el('tr');
          cell(tr, 'Date', when(x.created_at)); cell(tr, 'From', (x.reviewer_name || '') + (x.reviewer_role ? ' (' + x.reviewer_role + ')' : ''));
          cell(tr, 'About', (x.reviewee_name || '') + (x.reviewee_role ? ' (' + x.reviewee_role + ')' : ''));
          cell(tr, 'Rating', stars(x.rating)); cell(tr, 'Comment', x.comment || '');
          toggleRow(t, tr, 6, function () { return facts([['Booking', x.booking_ref], ['Review id', x.id], ['Reviewer id', x.reviewer_id], ['About id', x.reviewee_id]]); });
        });
        box.appendChild(t.wrap);
      } else if (sec === 'flags') {
        var t2 = tableOf('Flagged users', ['Person', 'Role', 'Contact warnings', 'State', '']);
        items.forEach(function (x) {
          var tr = el('tr');
          cell(tr, 'Person', x.name || 'No name'); cell(tr, 'Role', words(x.role)); cell(tr, 'Contact warnings', String(x.contact_violations));
          var st = el('span'); st.appendChild(badge(x.is_flagged ? 'Flagged' : 'Warned')); cell(tr, 'State', st);
          toggleRow(t2, tr, 5, function () { return facts([['Reason', x.flagged_reason], ['Joined', when(x.created_at)], ['Person id', x.id]]); });
        });
        box.appendChild(t2.wrap);
      } else if (sec === 'posts') {
        var t3 = tableOf('Community posts', ['Date', 'Author', 'Post', 'Comments', '']);
        items.forEach(function (x) {
          var tr = el('tr');
          cell(tr, 'Date', when(x.created_at)); cell(tr, 'Author', x.author || ''); cell(tr, 'Post', (x.text || '') + (x.has_image ? ' [has a picture]' : '')); cell(tr, 'Comments', String(x.comment_count || 0));
          toggleRow(t3, tr, 5, function () { return facts([['Service', x.service], ['Place', x.location], ['Likes', x.likes], ['Post id', x.id], ['Author id', x.user_id]]); });
        });
        box.appendChild(t3.wrap);
      } else {
        var t4 = tableOf('Comments', ['Date', 'Author', 'Comment', '']);
        items.forEach(function (x) {
          var tr = el('tr');
          cell(tr, 'Date', when(x.created_at)); cell(tr, 'Author', x.author || ''); cell(tr, 'Comment', x.text || '');
          toggleRow(t4, tr, 4, function () { return facts([['Comment id', x.id], ['On post', x.post_id], ['Author id', x.user_id]]); });
        });
        box.appendChild(t4.wrap);
      }
      pager('rv', off, items.length, SIZE);
    }
    $('rvNewer').addEventListener('click', function () { off = Math.max(0, off - SIZE); load(); });
    $('rvOlder').addEventListener('click', function () { off += SIZE; load(); });
    load();
  }

  if (PAGE === 'services') {
    AdminShell.init({ page: 'services', title: 'Services', permission: ['listings.moderate', 'taskers.view'] }).then(startServices);
  } else {
    AdminShell.init({ page: 'reviews', title: 'Reviews and community', permission: ['reviews.moderate', 'trust.flags.view', 'community.moderate'] }).then(startReviews);
  }
})();

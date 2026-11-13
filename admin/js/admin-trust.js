/* StreetTasker Admin: Services (services.html) and Reviews and community (reviews.html). A14a read, A14b hide and restore.
   Reads: admin_service_list, admin_review_list, admin_flagged_user_list, admin_community_list.
   Writes (A14b, only services and reviews): admin_service_hide / _restore (listings.moderate), admin_review_hide / _restore (reviews.moderate),
   history from admin_hide_history. Each function checks its own permission again on the server. A hide needs a reason from a fixed list and a
   note; there is no "negative review" reason. Nothing is ever deleted. Flagged users and community posts are still read only.
   All text via textContent. */
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
  var uidn = 0; function nextId(p) { uidn += 1; return p + uidn; }
  var SERVICE_REASONS = [['prohibited', 'Not an allowed kind of service'], ['misleading', 'Misleading or false'], ['contact_details', 'Shares contact details'], ['inappropriate', 'Inappropriate content'], ['other', 'Other (explain in the note)']];
  var REVIEW_REASONS = [['abuse', 'Abusive or threatening'], ['fake', 'Fake, or not about a real job'], ['personal_data', 'Shows personal data'], ['off_topic', 'Off topic']];
  function reasonLabel(list, code) { for (var i = 0; i < list.length; i++) if (list[i][0] === code) return list[i][1]; return words(code); }
  function field(label, input) { var w = el('div', 'ad-field'), l = el('label', null, label); l.setAttribute('for', input.id); w.appendChild(l); w.appendChild(input); return w; }
  /* One form for hide (reason list + note, two presses) and restore (note only). opt: label, reasons, confirm, run(code, note), done(res) */
  function actionForm(opt) {
    var f = el('form', 'ad-form'); f.noValidate = true;
    var sel = null;
    if (opt.reasons) {
      sel = el('select', 'form-input'); sel.id = nextId('trReason');
      var o0 = el('option', null, 'Choose a reason'); o0.value = ''; sel.appendChild(o0);
      opt.reasons.forEach(function (r) { var o = el('option', null, r[1]); o.value = r[0]; sel.appendChild(o); });
      f.appendChild(field('Reason', sel));
    }
    var note = el('textarea', 'form-input'); note.id = nextId('trNote'); note.rows = 3; note.maxLength = 300;
    var err = el('p', 'ad-error'); err.hidden = true; err.setAttribute('role', 'alert');
    var go = el('button', 'btn ' + (opt.confirm ? 'btn-outline' : 'btn-primary'), opt.label); go.type = 'submit';
    var armed = false;
    f.appendChild(field(opt.noteLabel || 'Note (at least 10 characters; it goes in the activity log)', note));
    f.appendChild(err); var ac = el('div', 'ad-actions ad-actions--tight'); ac.appendChild(go); f.appendChild(ac);
    function disarm() { armed = false; go.textContent = opt.label; }
    note.addEventListener('input', disarm); if (sel) sel.addEventListener('change', disarm);
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); err.hidden = true;
      if (sel && !sel.value) { err.textContent = 'Choose a reason from the list.'; err.hidden = false; return; }
      if (note.value.trim().length < 10) { err.textContent = 'Write a note of at least 10 characters.'; err.hidden = false; return; }
      if (opt.confirm && !armed) { armed = true; go.textContent = 'Press again to confirm'; return; }
      go.disabled = true;
      var res = await opt.run(sel ? sel.value : null, note.value.trim());
      go.disabled = false; disarm();
      var m = fail(res);
      if (m || !res.data) { err.textContent = m || 'It could not be done. Nothing was changed.'; err.hidden = false; return; }
      opt.done(res.data);
    });
    return f;
  }
  /* Decision history of one item, read when the details are opened. */
  function historyBox(kind, id, reasons) {
    var box = el('div', 'ad-card'); box.appendChild(el('h3', 'ad-card-title', 'Hide and restore history'));
    var body = el('div'); body.appendChild(el('p', 'ad-hint', 'Loading...')); box.appendChild(body);
    call('admin_hide_history', { p_kind: kind, p_id: String(id) }).then(function (res) {
      clear(body);
      var m = fail(res);
      if (m || !res.data) { body.appendChild(el('p', 'ad-hint', 'The history could not be read.')); return; }
      var items = res.data.items || [];
      if (!items.length) { body.appendChild(el('p', 'ad-hint', 'Never hidden.')); return; }
      var ul = el('ul', 'ad-list');
      items.forEach(function (x) {
        var li = el('li');
        li.appendChild(el('span', null, 'Hidden ' + when(x.hidden_at) + (x.hidden_by_name ? ' by ' + x.hidden_by_name : '') + '. Reason: ' + reasonLabel(reasons, x.reason_code) + '. ' + (x.note || '')));
        if (x.restored_at) { li.appendChild(document.createElement('br')); li.appendChild(el('span', null, 'Restored ' + when(x.restored_at) + (x.restored_by_name ? ' by ' + x.restored_by_name : '') + '. ' + (x.restore_note || ''))); }
        else { li.appendChild(document.createTextNode(' ')); li.appendChild(badge('Hidden now')); }
        ul.appendChild(li);
      });
      body.appendChild(ul);
    });
    return box;
  }
  function pager(prefix, off, n, size, onMove) {
    $(prefix + 'Newer').disabled = off === 0; $(prefix + 'Older').disabled = n < size;
    $(prefix + 'Pager').hidden = off === 0 && n < size;
  }

  /* ---------------- Services ---------------- */
  function startServices(ctx) {
    $('svRoot').hidden = false;
    var SF = [['all', 'All'], ['active', 'Active'], ['paused', 'Paused (subscription)'], ['unavailable', 'Not available'], ['hidden', 'Hidden by admin']];
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
      g.appendChild(stat('Hidden by admin', String(c.hidden || 0), 'Not shown to customers. The Tasker can still see it.', c.hidden > 0 ? 'warn' : null));
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
          if (x.admin_hidden) st.appendChild(badge('Hidden by admin'));
          cell(tr, 'Status', st);
          toggleRow(t, tr, 6, function () {
            var wrap = el('div');
            wrap.appendChild(facts([['Place', x.location], ['Description', x.description], ['Availability', words(x.availability_status)], ['Verified', x.verified ? 'Yes' : 'No'],
              ['Rating', x.rating != null ? x.rating + ' (' + (x.reviews_count || 0) + ' review(s))' : ''], ['Listed', when(x.created_at)], ['Last changed', when(x.updated_at)],
              ['Listing id', x.id], ['Tasker id', x.tasker_id],
              ['Hidden by admin', x.admin_hidden ? reasonLabel(SERVICE_REASONS, x.hide_reason) + ' (' + when(x.hidden_at) + '). ' + (x.hide_note || '') : '']]));
            if (ctx.has('listings.moderate')) {
              var card = el('div', 'ad-card');
              card.appendChild(el('h3', 'ad-card-title', x.admin_hidden ? 'Show this listing to customers again' : 'Hide this listing from customers'));
              card.appendChild(el('p', 'ad-note', x.admin_hidden ? 'The Tasker\'s subscription pause is not changed. Restoring only removes the admin hide.' : 'The listing disappears for customers and visitors. The Tasker still sees it in their own dashboard, nothing is deleted, and the subscription pause is not changed. You can restore it at any time.'));
              card.appendChild(actionForm(x.admin_hidden
                ? { label: 'Restore listing', noteLabel: 'Why is it being restored? (at least 10 characters)', run: function (c, n) { return call('admin_service_restore', { p_service: String(x.id), p_note: n }); }, done: function () { ctx.toast('Listing restored.'); load(); } }
                : { label: 'Hide listing', confirm: true, reasons: SERVICE_REASONS, run: function (c, n) { return call('admin_service_hide', { p_service: String(x.id), p_reason: c, p_note: n }); }, done: function () { ctx.toast('Listing hidden.'); load(); } }));
              wrap.appendChild(card);
            }
            wrap.appendChild(historyBox('service', x.id, SERVICE_REASONS));
            return wrap;
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
      reviews: [['all', 'All'], ['low', 'Low (1 to 2 stars)'], ['comment', 'With a comment'], ['hidden', 'Hidden']],
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
        g.appendChild(stat('Average', c.average != null ? String(c.average) : 'None', 'Out of 5. Hidden reviews are left out.'));
        g.appendChild(stat('Low', String(c.low || 0), '1 or 2 stars.'));
        g.appendChild(stat('With a comment', String(c.with_comment || 0), 'Has written text.'));
        g.appendChild(stat('Hidden', String(c.hidden || 0), 'Not shown to the public and not counted in ratings.', c.hidden > 0 ? 'warn' : null));
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
          var rt = el('span', null, stars(x.rating)); if (x.admin_hidden) { rt.appendChild(document.createTextNode(' ')); rt.appendChild(badge('Hidden')); }
          cell(tr, 'Rating', rt); cell(tr, 'Comment', x.comment || '');
          toggleRow(t, tr, 6, function () {
            var wrap = el('div');
            wrap.appendChild(facts([['Booking', x.booking_ref], ['Review id', x.id], ['Reviewer id', x.reviewer_id], ['About id', x.reviewee_id],
              ['Hidden', x.admin_hidden ? reasonLabel(REVIEW_REASONS, x.hide_reason) + ' (' + when(x.hidden_at) + '). ' + (x.hide_note || '') : '']]));
            if (ctx.has('reviews.moderate')) {
              var card = el('div', 'ad-card');
              card.appendChild(el('h3', 'ad-card-title', x.admin_hidden ? 'Show this review again' : 'Hide this review'));
              card.appendChild(el('p', 'ad-note', x.admin_hidden ? 'The review counts in the rating again.' : 'A review can be hidden only for the reasons in the list. A low rating is not a reason. A hidden review is not shown and does not count in the average. Nothing is deleted and you can restore it.'));
              card.appendChild(actionForm(x.admin_hidden
                ? { label: 'Restore review', noteLabel: 'Why is it being restored? (at least 10 characters)', run: function (c, n) { return call('admin_review_restore', { p_review: x.id, p_note: n }); }, done: function () { ctx.toast('Review restored.'); load(); } }
                : { label: 'Hide review', confirm: true, reasons: REVIEW_REASONS, run: function (c, n) { return call('admin_review_hide', { p_review: x.id, p_reason: c, p_note: n }); }, done: function () { ctx.toast('Review hidden.'); load(); } }));
              wrap.appendChild(card);
            }
            wrap.appendChild(historyBox('review', x.id, REVIEW_REASONS));
            return wrap;
          });
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

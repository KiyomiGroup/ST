/* StreetTasker stage M15: the referrals page (referrals.html). Read only: every number comes from the signed-in person's own database
   functions (js/referral-data.js). All text is set with textContent, never innerHTML. */
(function () {
  'use strict';
  var D = window.STReferralData;
  var $ = function (id) { return document.getElementById(id); };
  var RUN = 0;          /* newest render wins when the person switches programme quickly */
  var ROWS = [];

  var COPY = {
    tasker: {
      title: 'More People. More Tasks. More Opportunities.',
      lead: 'Invite people to StreetTasker. Every friend who signs up and verifies their email earns you points, and milestones save you free Starter plan time.',
      how: 'Each milestone you reach saves one free 30-day Starter gift.',
      tab: 'Tasker account',
    },
    customer: {
      title: 'Invite Friends. Earn Rewards.',
      lead: 'Share StreetTasker with friends. Every friend who signs up and verifies their email earns you points you can turn into wallet credit.',
      how: 'Every full 1,000 points earns N200 wallet credit.',
      tab: 'Customer account',
    },
  };

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function num(n) { return Number(n || 0).toLocaleString('en-NG'); }
  function day(iso) { try { return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
  function toast(msg) { if (window.showToast) window.showToast(msg); }
  function state(msg) { var s = $('rfState'); s.textContent = msg || ''; s.hidden = !msg; }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Link copied'); return; } catch (e) {}
    var i = $('rfLinkInput'); i.focus(); i.select();
    try { document.execCommand('copy'); toast('Link copied'); } catch (e2) { toast('Press and hold the link to copy it'); }
  }

  function renderTabs(active) {
    var box = $('rfTabs');
    box.textContent = '';
    if (ROWS.length < 2) { box.hidden = true; return; }
    box.hidden = false;
    ROWS.forEach(function (r) {
      var b = el('button', 'rf-tab', (COPY[r.programme] || {}).tab || r.programme);
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', r.programme === active ? 'true' : 'false');
      b.addEventListener('click', function () { show(r.programme); });
      box.appendChild(b);
    });
  }

  function renderProgress(row) {
    var pts = Number(row.points || 0);
    var text = $('rfProgText'), bar = $('rfProgBar'), note = $('rfProgNote');
    if (row.programme === 'tasker') {
      var next = Number(row.next_milestone || 0);
      if (next > 0) { text.textContent = num(pts) + ' of ' + num(next) + ' points to your next free gift'; bar.max = next; bar.value = Math.min(pts, next); }
      note.textContent = 'Reaching a milestone saves one free 30-day Starter gift. Each milestone is further away than the last.';
      if (Number(row.gifts_saved || 0) > 0) note.textContent += ' A saved gift can be used once your current plan has ended.';
    } else {
      var into = pts % 1000, earned = Math.floor(pts / 1000);
      text.textContent = num(into) + ' of 1,000 points to your next N200 credit';
      bar.max = 1000; bar.value = into;
      note.textContent = earned > 0
        ? 'You have reached ' + earned + ' credit' + (earned === 1 ? '' : 's') + ' of N200. Add it to your gift card balance below.'
        : 'Every full 1,000 points earns N200 gift card credit. Part of a thousand does not count yet.';
    }
    renderCreditButton(row);
  }

  /* Customer credit: the button shows only when credit is waiting; the database decides everything when it is pressed. */
  async function renderCreditButton(row) {
    var host = $('rfCreditBox');
    if (!host) { host = el('div', 'rf-credit'); host.id = 'rfCreditBox'; $('rfProgNote').insertAdjacentElement('afterend', host); }
    host.textContent = ''; host.hidden = true;
    if (row.programme !== 'customer') return;
    var my = RUN;
    var s = null;
    try { s = await D.creditStatus(); } catch (e) { return; }
    if (my !== RUN || !s) return;
    if (Number(s.accepted_naira) > 0) host.appendChild(el('p', 'rf-note', 'Your gift card balance: N' + num(s.balance)));
    if (Number(s.available_naira) > 0) {
      var b = el('button', 'btn btn-primary', 'Add \u20A6' + num(s.available_naira) + ' to my gift balance');
      b.type = 'button';
      b.addEventListener('click', async function () {
        b.disabled = true;
        try {
          var r = await D.creditAccept();
          toast(r.ok ? '\u20A6' + num(r.credited) + ' was added to your gift card balance.' : (r.message || 'We could not add the credit. Please try again.'));
        } catch (e) { toast('We could not add the credit. Please try again.'); }
        show('customer');
      });
      host.appendChild(b);
    }
    host.hidden = host.childNodes.length === 0;
  }

  function renderHistory(items) {
    var ul = $('rfHist'); ul.textContent = '';
    $('rfHistEmpty').hidden = items.length > 0;
    items.forEach(function (h) {
      var li = el('li', 'rf-item');
      var left = el('div');
      left.appendChild(el('div', 'rf-item-main', h.who || 'New member'));
      left.appendChild(el('div', 'rf-item-sub', 'Signed up ' + day(h.referred_on)));
      li.appendChild(left);
      var done = h.status === 'converted';
      li.appendChild(el('span', 'rf-item-badge' + (done ? '' : ' rf-item-badge--wait'),
        done ? 'Verified' + (Number(h.points) ? ' · +' + num(h.points) + ' points' : '') : 'Waiting for email verification'));
      ul.appendChild(li);
    });
  }

  function renderRewards(programme, items) {
    var ul = $('rfRew'); ul.textContent = '';
    var empty = $('rfRewEmpty');
    empty.textContent = programme === 'customer' ? 'Credits you add to your gift card balance are shown in your gift card history.' : 'No rewards yet.';
    empty.hidden = items.length > 0;
    var label = { saved: 'Saved', active: 'Active', used: 'Used' };
    items.forEach(function (r) {
      var li = el('li', 'rf-item');
      var left = el('div');
      left.appendChild(el('div', 'rf-item-main', 'Free 30 days of Starter'));
      left.appendChild(el('div', 'rf-item-sub', 'Milestone ' + num(r.points_threshold) + ' points · ' + day(r.created_at)));
      li.appendChild(left);
      if (r.status === 'saved' && r.id) {
        var gb = el('button', 'btn btn-primary', 'Activate my free Starter month');
        gb.type = 'button';
        gb.addEventListener('click', async function () {
          gb.disabled = true;
          try {
            var res = await D.rewardAccept(r.id);
            toast(res.ok ? 'Your free Starter month is active.' : (res.message || 'We could not activate this reward. Please try again.'));
          } catch (e) { toast('We could not activate this reward. Please try again.'); }
          show('tasker');
        });
        li.appendChild(gb);
      } else {
        li.appendChild(el('span', 'rf-item-badge', label[r.status] || r.status));
      }
      ul.appendChild(li);
    });
  }

  async function show(programme) {
    var my = ++RUN;
    var row = ROWS.find(function (r) { return r.programme === programme; });
    if (!row) return;
    var c = COPY[programme] || COPY.customer;
    $('rfTitle').textContent = c.title; $('rfLead').textContent = c.lead; $('rfHowReward').textContent = c.how;
    renderTabs(programme);

    var url = D.shareUrl(row.code);
    $('rfLinkInput').value = url; $('rfCode').textContent = row.code;
    $('rfWhatsapp').href = 'https://wa.me/?text=' + encodeURIComponent('Join me on StreetTasker: ' + url);
    $('rfPoints').textContent = num(row.points);
    renderProgress(row);

    var r = await Promise.allSettled([D.stats(programme), D.history(programme), D.rewards(programme)]);
    if (my !== RUN) return;
    var st = r[0].status === 'fulfilled' ? r[0].value : null;
    if (st) {
      $('rfStVisits').textContent = num(st.visits); $('rfStSigned').textContent = num(st.signed_up);
      $('rfStVerified').textContent = num(st.verified); $('rfStPoints').textContent = num(st.points);
    }
    renderHistory(r[1].status === 'fulfilled' ? r[1].value : []);
    renderRewards(programme, r[2].status === 'fulfilled' ? r[2].value : []);
    if (r.some(function (x) { return x.status === 'rejected'; })) toast('Some details could not be loaded. Refresh to try again.');
    $('rfApp').hidden = false; state('');
  }

  async function init() {
    var user = await window.ST.auth.requireAuth();
    if (!user) return;
    try { ROWS = await D.summary(); } catch (e) { state('We could not load your referral details. Please refresh and try again.'); return; }
    if (!ROWS.length) { state('Your referral link is not ready yet. Finish setting up your account and check back soon.'); return; }
    $('rfCopy').addEventListener('click', function () { copy($('rfLinkInput').value); });
    if (navigator.share) {
      var sb = $('rfShare'); sb.hidden = false;
      sb.addEventListener('click', function () { navigator.share({ title: 'StreetTasker', text: 'Join me on StreetTasker', url: $('rfLinkInput').value }).catch(function () {}); });
    }
    var want = D.activeProgramme();
    show(ROWS.some(function (r) { return r.programme === want; }) ? want : ROWS[0].programme);
  }

  init();
})();

/* ============================================================
   STREETTASKER — make-offer.js
   Make an Offer page: make-offer.html?task=<task id>
   (?id=<task id> also works). Replaces the small offer pop-up.

   Stage 1: load the task, check the viewer may make an offer, fill the title block and the task summary.
   Stage 2: offer amount, quick-amount chips, 12% fee + "You will receive".
   Stage 3: pitch (counter, quick phrases) and availability (date + arrival window); the message builder.
   Stage 4: terms checkbox, Submit Offer (saves through applyToTask), error handling, "Offer sent" state.
   Stage 5: edit mode (make-offer.html?task=<id>&edit=1: loads the pending offer, pre-fills, saves through
   updateMyApplication), sticky submit bar on phones, and the links from the task page, client profile and
   My Applications. See MAKE-OFFER-HANDOFF.md.

   Reads:  tasks (the row), users (the customer), reviews (their rating, if the table exists),
           task_applications (has this tasker already made an offer?).
   Nothing is invented. A section or figure with no data hides itself.
   Needs: supabaseClient.js, sanitize.js (escapeHtml), auth.js, db.js, ui.js, app.js.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return escapeHtml(s); };
  var NAIRA = '\u20a6';
  var ENDED = ['cancelled', 'canceled', 'closed', 'done', 'expired'];
  var MAX_SPECS = 5;
  var MIN_OFFER = 1000;        /* lowest offer a tasker can send */
  var MAX_OFFER = 10000000;    /* guards against a mistyped extra zero */
  var STEP = 500;              /* quick amounts round to the nearest N500 */
  var PRESET_PCT = 0.10;       /* quick amounts: budget, 10% above, 10% below */
  var PITCH_MAX = 600;
  var PITCH_MIN = 20;
  var WINDOWS = { morning: 'Morning (8am-11am)', afternoon: 'Afternoon (12pm-3pm)', flexible: 'Flexible (anytime)' };
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var FEE_RATE = 0.12;         /* mirrors PLATFORM_COMMISSION in js/payments.js; used only if calculateAmounts is missing */

  var state = { id: null, edit: false, task: null, viewer: null, isTasker: false, posterId: null, poster: null, rating: null, myApplication: null,
    amount: null, pitch: '', date: '', window: '', sending: false };   /* the offer in naira (whole number) or null while empty or invalid */

  /* ── helpers ─────────────────────────────────────────────── */
  function icon(name) { return '<svg class="ap-i" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function text(v) { return String(v == null ? '' : v).trim(); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function money(n) { var v = Number(n); return isFinite(v) && v > 0 ? NAIRA + v.toLocaleString('en-NG') : ''; }
  function safeUrl(u) { return /^(https?:)?\/\//.test(u || '') || /^\/?[\w.\-\/]+$/.test(u || '') ? u : ''; }
  function label(v) { return String(v || '').replace(/[_-]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function setText(id, v) { var el = $(id); if (el) el.textContent = v; }
  function initials(name) {
    var s = String(name || '').replace(/[^a-zA-Z ]/g, '').trim().split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    return s || 'ST';
  }
  function shortName(name) {
    var p = text(name).split(/\s+/).filter(Boolean);
    if (!p.length) return '';
    return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0].toUpperCase() + '.' : p[0];
  }
  function fmtDate(iso, opts) { var d = new Date(iso); return iso && !isNaN(d) ? d.toLocaleDateString('en-NG', opts) : ''; }
  function parseList(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim()) { try { var p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; } }
    return [];
  }
  function taskGroup(status) {
    var s = String(status || 'open').toLowerCase();
    if (s === 'completed') return 'completed';
    if (s === 'in_progress') return 'progress';
    if (s === 'draft') return 'draft';
    if (ENDED.indexOf(s) !== -1) return 'closed';
    return 'open';
  }
  function toLogin() { window.location.href = 'login.html?redirect=' + encodeURIComponent(window.location.pathname.replace(/^\//, '') + window.location.search); }
  function taskUrl() { return 'task-details.html?id=' + encodeURIComponent(state.id); }
  function backUrl() { return state.edit ? 'applications.html' : taskUrl(); }

  async function currentUser() {
    if (state.viewer) return state.viewer;
    var s = await window.supabase.auth.getSession();
    state.viewer = s.data.session && s.data.session.user;
    return state.viewer;
  }
  async function roleOf(user) {
    var r = '';
    try { r = localStorage.getItem('st_role') || ''; } catch (e) { /* storage blocked */ }
    if (r) return r;
    try { var q = await window.supabase.from('users').select('role').eq('id', user.id).maybeSingle(); return (q.data && q.data.role) || ''; }
    catch (e) { return ''; }
  }
  function showError(title, msg, href, lab) {
    $('moLoading').hidden = true;
    $('moContent').hidden = true;
    setText('moErrorTitle', title); setText('moErrorText', msg);
    var cta = $('moErrorCta'); cta.href = href || 'find-tasks.html'; cta.textContent = lab || 'Browse Tasks';
    $('moError').hidden = false;
  }

  /* ── data ────────────────────────────────────────────────── */
  async function loadMyApplication(sb, taskId, user) {
    try {
      var r = await sb.from('task_applications').select('id, status, message, created_at').eq('task_id', taskId).eq('tasker_id', user.id).limit(1);
      return (r.data && r.data[0]) || null;
    } catch (e) { return null; }
  }
  async function loadRating(sb, posterId) {
    try {
      var v = await sb.from('reviews').select('rating').eq('reviewee_id', posterId).limit(200);
      var rows = (v.error ? [] : (v.data || [])).filter(function (x) { return Number(x.rating) > 0; });
      if (!rows.length) return null;
      return { avg: rows.reduce(function (n, r) { return n + Number(r.rating); }, 0) / rows.length, count: rows.length };
    } catch (e) { return null; }
  }

  /* ── rendering ───────────────────────────────────────────── */
  function renderHead(t) {
    var badges = [], urgency = String(t.urgency || '').toLowerCase();
    if (text(t.category)) badges.push('<span class="td-badge td-badge--open">' + icon('check') + esc(label(t.category)) + '</span>');
    if (urgency === 'immediate' || t.urgent === true) badges.push('<span class="td-badge td-badge--urgent">Urgent Need</span>');
    else if (urgency === 'scheduled') badges.push('<span class="td-badge td-badge--soft">Scheduled</span>');
    $('moBadges').innerHTML = badges.join('');
    $('moBadges').hidden = !badges.length;

    var title = text(t.title) || 'Untitled task';
    setText('moTitle', 'Apply for Task: ' + title);
    setText('moSumTitle', title);
    document.title = 'Make an Offer: ' + title + ' \u2014 StreetTasker';

    var remote = String(t.work_mode || t.task_type || '').toLowerCase() === 'remote';
    var chips = [];
    var budget = money(t.budget);
    chips.push('<span class="mo-chip mo-chip--primary">' + icon('wallet') + 'Client budget: ' + esc(budget || 'To be agreed') + '</span>');
    chips.push('<span class="mo-chip">' + icon('shield') + 'Escrow protected</span>');
    if (remote) chips.push('<span class="mo-chip">' + icon('globe') + 'Remote</span>');
    else if (text(t.location)) chips.push('<span class="mo-chip">' + icon('pin') + esc(text(t.location)) + '</span>');
    if (t.deadline) {
      var when = fmtDate(t.deadline, { day: 'numeric', month: 'short' });
      if (when) chips.push('<span class="mo-chip">' + icon('calendar') + 'Due ' + esc(when) + '</span>');
    }
    $('moChips').innerHTML = chips.join('');

    var back = backUrl();
    $('moBack').href = back; $('moClose').href = back;
    if (state.edit) {
      setText('moBackText', 'Back to My Applications');
      setText('moTitle', 'Edit Offer: ' + title);
      document.title = 'Edit Offer: ' + title + ' \u2014 StreetTasker';
      document.querySelector('.mo-topbar-chip').lastChild.textContent = 'Edit Offer';
      $('moClose').setAttribute('aria-label', 'Close and go back to My Applications');
      setText('moSubmitLabel', 'Save Changes');
      $('moDoneBack').href = taskUrl();
    }
  }

  function renderSummary(t) {
    var urls = list(t.photo_urls).map(function (u) { return safeUrl(text(u)); }).filter(Boolean);
    var photo = $('moPhoto');
    photo.hidden = !urls.length;
    if (urls.length) { $('moPhotoImg').src = urls[0]; $('moPhotoImg').alt = ''; }

    var remote = String(t.work_mode || t.task_type || '').toLowerCase() === 'remote';
    var loc = remote ? 'Remote' : text(t.location);
    $('moLoc').hidden = !loc;
    setText('moLocText', loc);

    /* Specifications: the bullet or numbered lines of the description, then what the customer provides */
    var items = [];
    text(t.description).split(/\r?\n/).forEach(function (raw) {
      var m = raw.trim().match(/^(?:[-\u2022*\u25AA\u25CF]|\d+[.)])\s+(.*)$/);
      if (m && m[1]) items.push(m[1].trim());
    });
    parseList(t.host_provides).map(text).filter(Boolean).forEach(function (x) { items.push(x + ' provided'); });
    items = items.map(function (s) { return s.length > 90 ? s.slice(0, 90).trim() + '\u2026' : s; }).slice(0, MAX_SPECS);
    $('moSpecsWrap').hidden = !items.length;
    $('moSpecs').innerHTML = items.map(function (s) { return '<li>' + icon('circle-check') + '<span>' + esc(s) + '</span></li>'; }).join('');
  }

  function renderWho(u) {
    var name = text(u && u.name) || text(u && u.business_name) || 'StreetTasker customer';
    var verified = !!(u && u.is_verified === true);
    var url = safeUrl(text(u && u.avatar_url));
    var av = url ? '<img src="' + esc(url) + '" alt="" />' : esc(initials(name));
    var meta = [];
    if (state.rating) meta.push(icon('star') + '<b>' + state.rating.avg.toFixed(1) + '</b>');
    if (text(u && u.location)) meta.push(esc(text(u.location)));
    var html = '<div class="td-avatar-wrap"><span class="td-avatar" aria-hidden="true">' + av + '</span>' +
      (verified ? '<span class="td-avatar-tick">' + icon('check') + '</span>' : '') + '</div>' +
      '<div class="mo-who-text"><p class="mo-who-name">' + esc(shortName(name)) + '<span class="td-tag">Customer</span></p>' +
      (meta.length ? '<p class="mo-who-meta">' + meta.join('<span aria-hidden="true">\u2022</span>') + '</p>' : '') + '</div>';
    $('moWhoPhone').innerHTML = html; $('moWhoCard').innerHTML = html;
    var first = text(u && (u.name || u.business_name)).split(/\s+/)[0];
    if (first) setText('moPitchWho', first);
  }

  /* ── Stage 2: offer amount ───────────────────────────────── */
  function payout(amount) {
    try {
      var a = window.ST.payments.calculateAmounts(amount);
      return { fee: a.platformFee, net: a.taskerAmount };
    } catch (e) {
      var fee = Math.round(amount * FEE_RATE);
      return { fee: fee, net: amount - fee };
    }
  }
  function readAmount() {
    var digits = $('moAmount').value.replace(/\D/g, '');
    return digits ? parseInt(digits, 10) : NaN;
  }
  /* Returns an error message, or '' when the amount can be sent */
  function amountError(n) {
    if (isNaN(n)) return 'Enter the amount you want to be paid.';
    if (n < MIN_OFFER) return 'The lowest offer is ' + money(MIN_OFFER) + '.';
    if (n > MAX_OFFER) return 'The highest offer is ' + money(MAX_OFFER) + '.';
    return '';
  }
  function showAmountError(msg) {
    var err = $('moAmountErr');
    err.textContent = msg; err.hidden = !msg;
    $('moAmount').parentNode.classList.toggle('is-invalid', !!msg);
    $('moAmount').setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function renderFee() {
    var n = state.amount;
    var out = n ? payout(n) : null;
    setText('moFeeTotal', n ? money(n) : '\u2014');
    setText('moFeeAmt', out ? '- ' + money(out.fee) : '\u2014');
    setText('moFeeNet', out ? money(out.net) : '\u2014');
  }
  function paintAmount() {
    var n = state.amount, budget = Number(state.task && state.task.budget);
    var tag = $('moAmountTag'), match = !!n && budget > 0 && n === budget;
    tag.textContent = match ? 'Client budget' : 'Custom';
    tag.classList.toggle('is-match', match);
    Array.prototype.forEach.call($('moPresets').children, function (b) {
      b.setAttribute('aria-pressed', n && Number(b.getAttribute('data-amount')) === n ? 'true' : 'false');
    });
    renderFee();
    paintSubmit();
  }
  function setAmount(n) {
    $('moAmount').value = n ? String(n) : '';
    state.amount = n && !amountError(n) ? n : null;
    showAmountError('');
    paintAmount();
  }
  /* Budget, then 10% above and below it (rounded to N500). Dropped when too low or the same as another. */
  function renderPresets(t) {
    var budget = Number(t.budget), box = $('moPresets');
    if (!(budget >= MIN_OFFER)) { box.hidden = true; box.innerHTML = ''; return; }
    var round = function (v) { return Math.round(v / STEP) * STEP; };
    var seen = {}, opts = [{ n: budget, text: 'Match client (' + money(budget) + ')', first: true }];
    seen[budget] = true;
    [round(budget * (1 + PRESET_PCT)), round(budget * (1 - PRESET_PCT))].forEach(function (v) {
      if (v >= MIN_OFFER && v <= MAX_OFFER && !seen[v]) { seen[v] = true; opts.push({ n: v, text: money(v) }); }
    });
    box.innerHTML = opts.map(function (o) {
      return '<button type="button" class="mo-preset" data-amount="' + o.n + '" aria-pressed="false">' + (o.first ? icon('circle-check') : '') + esc(o.text) + '</button>';
    }).join('');
    box.hidden = false;
  }
  function wireAmount() {
    var input = $('moAmount');
    input.addEventListener('input', function () {
      var digits = input.value.replace(/\D/g, '');
      if (input.value !== digits) input.value = digits;
      var n = readAmount();
      state.amount = amountError(n) ? null : n;
      if (!amountError(n) || isNaN(n)) showAmountError('');
      else if (n > MAX_OFFER) showAmountError(amountError(n));
      paintAmount();
    });
    input.addEventListener('blur', function () {
      var n = readAmount();
      if (input.value !== '') showAmountError(amountError(n));
    });
    $('moPresets').addEventListener('click', function (e) {
      var b = e.target.closest('[data-amount]');
      if (b) setAmount(Number(b.getAttribute('data-amount')));
    });
  }
  function initAmount(t) {
    $('moFeePct').textContent = Math.round(FEE_RATE * 100) + '%';
    renderPresets(t);
    var budget = Number(t.budget);
    setAmount(budget >= MIN_OFFER ? budget : null);
  }

  /* ── Stage 3: pitch + availability ───────────────────────── */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayYmd() { return ymd(new Date()); }
  function parseYmd(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d) ? null : d;
  }
  function pitchError(v) {
    var t = text(v);
    if (!t) return 'Write a short pitch for the customer.';
    if (t.length < PITCH_MIN) return 'Tell the customer a little more (at least ' + PITCH_MIN + ' characters).';
    return '';
  }
  function dateError(v) {
    if (!v) return 'Choose the date you can do the job.';
    if (!parseYmd(v)) return 'Choose a valid date.';
    if (v < todayYmd()) return 'Choose today or a later date.';
    return '';
  }
  function showFieldError(inputId, errId, wrapEl, msg) {
    var err = $(errId);
    err.textContent = msg; err.hidden = !msg;
    $(inputId).setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (wrapEl) wrapEl.classList.toggle('is-invalid', !!msg);
  }
  function paintPitchCount() {
    setText('moPitchCount', $('moPitch').value.length + ' / ' + PITCH_MAX);
    var phrases = $('moSuggest').querySelectorAll('[data-phrase]'), v = $('moPitch').value;
    Array.prototype.forEach.call(phrases, function (b) { b.disabled = v.indexOf(b.getAttribute('data-phrase')) !== -1; });
  }
  function paintWindow() {
    Array.prototype.forEach.call($('moWindows').children, function (b) {
      var on = b.getAttribute('data-window') === state.window;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on || (!state.window && b === $('moWindows').firstElementChild) ? 0 : -1;
    });
  }
  function setWindow(w) { state.window = WINDOWS[w] ? w : ''; paintWindow(); }

  /* "Sat 15 Nov" (the year is added when it is not this year) */
  function arrivalDate(v) {
    var d = parseYmd(v);
    if (!d) return '';
    var out = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    return d.getFullYear() !== new Date().getFullYear() ? out + ' ' + d.getFullYear() : out;
  }
  /* The message saved with the offer (see MAKE-OFFER-HANDOFF.md, "Message format").
     "|" is the separator, so it is removed from the pitch. The rate comes before the arrival on purpose. */
  function pitchText() { return text($('moPitch').value).replace(/\|/g, '/'); }
  /* "Sat 15 Nov, Morning (8am-11am)", or '' when no date is chosen */
  function buildArrival() {
    var when = arrivalDate(state.date);
    return when ? when + ', ' + (WINDOWS[state.window] || WINDOWS.flexible) : '';
  }
  function buildMessage() {
    var msg = pitchText() + ' | Proposed rate: ' + NAIRA + Number(state.amount).toLocaleString('en-NG');
    var arrival = buildArrival();
    return arrival ? msg + ' | Arrival: ' + arrival : msg;
  }
  /* The reverse of buildMessage(), used by edit mode. Anything missing comes back empty. */
  function parseMessage(msg, createdAt) {
    var s = String(msg || '');
    var rate = s.match(/\|\s*Proposed rate:\s*([^|]+)/i);
    var arr = s.match(/\|\s*Arrival:\s*([^|]+)/i);
    var out = { pitch: s.replace(/\|\s*(?:Proposed rate|Arrival):.*$/i, '').trim(), rate: null, date: '', window: '' };
    if (rate) { var n = parseInt(rate[1].replace(/[^\d]/g, ''), 10); if (n > 0) out.rate = n; }
    if (arr) {
      var a = arr[1].trim(), d = /^(?:\w{3}\s+)?(\d{1,2})\s+(\w{3})(?:\s+(\d{4}))?/.exec(a);
      if (d) {
        var mi = MONTHS.indexOf(d[2]);
        if (mi !== -1) {
          /* No year saved means "this year or the next": the first date that is not before the day the offer was sent */
          var sent = new Date(createdAt), year = d[3] ? Number(d[3]) : (isNaN(sent) ? new Date().getFullYear() : sent.getFullYear());
          var day = new Date(year, mi, Number(d[1]));
          if (!d[3] && !isNaN(sent) && day < new Date(sent.getFullYear(), sent.getMonth(), sent.getDate())) day = new Date(year + 1, mi, Number(d[1]));
          if (!isNaN(day) && day.getMonth() === mi) out.date = ymd(day);
        }
      }
      var low = a.toLowerCase();
      out.window = low.indexOf('morning') !== -1 ? 'morning' : low.indexOf('afternoon') !== -1 ? 'afternoon' : low.indexOf('flexible') !== -1 ? 'flexible' : '';
    }
    return out;
  }
  /* Checks every field, shows the errors, focuses the first bad one. Used by Submit in Stage 4. */
  function validateAll() {
    var aErr = amountError(readAmount()), pErr = pitchError($('moPitch').value), dErr = dateError($('moDate').value);
    showAmountError(aErr);
    showFieldError('moPitch', 'moPitchErr', null, pErr);
    showFieldError('moDate', 'moDateErr', $('moDate').parentNode, dErr);
    var first = aErr ? 'moAmount' : pErr ? 'moPitch' : dErr ? 'moDate' : '';
    if (first) $(first).focus();
    return !first;
  }

  function wirePitch() {
    var box = $('moPitch');
    box.addEventListener('input', function () {
      state.pitch = box.value; paintPitchCount();
      if (!pitchError(box.value)) showFieldError('moPitch', 'moPitchErr', null, '');
    });
    box.addEventListener('blur', function () { if (box.value !== '') showFieldError('moPitch', 'moPitchErr', null, pitchError(box.value)); });
    $('moSuggest').addEventListener('click', function (e) {
      var b = e.target.closest('[data-phrase]');
      if (!b) return;
      var cur = box.value.replace(/\s+$/, ''), add = b.getAttribute('data-phrase');
      var next = cur ? cur + ' ' + add : add;
      if (next.length > PITCH_MAX) { showFieldError('moPitch', 'moPitchErr', null, 'There is no room left for that phrase. The pitch can be ' + PITCH_MAX + ' characters.'); return; }
      box.value = next; state.pitch = next; paintPitchCount();
      showFieldError('moPitch', 'moPitchErr', null, pitchError(next));
      box.focus();
    });

    var date = $('moDate');
    date.min = todayYmd();
    date.addEventListener('change', function () {
      state.date = date.value;
      showFieldError('moDate', 'moDateErr', date.parentNode, dateError(date.value));
    });
    $('moWindows').addEventListener('click', function (e) {
      var b = e.target.closest('[data-window]');
      if (b) setWindow(b.getAttribute('data-window'));
    });
    /* Arrow keys move through the three windows, as a radio group does */
    $('moWindows').addEventListener('keydown', function (e) {
      var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!keys[e.key]) return;
      e.preventDefault();
      var items = Array.prototype.slice.call($('moWindows').children);
      var at = items.indexOf(document.activeElement); if (at < 0) at = 0;
      var next = items[(at + keys[e.key] + items.length) % items.length];
      setWindow(next.getAttribute('data-window')); next.focus();
    });
  }
  /* Starting values: the task's due date (if it is not in the past) and its time of day, otherwise flexible */
  function initAvailability(t) {
    var due = '';
    if (t.deadline) { var d = new Date(t.deadline); if (!isNaN(d)) due = ymd(d); }
    if (due && due >= todayYmd()) { $('moDate').value = due; state.date = due; }
    var tod = String(t.time_of_day || '').toLowerCase();
    setWindow(tod === 'morning' || tod === 'afternoon' ? tod : 'flexible');
    paintPitchCount();
  }

  /* ── Stage 5: edit mode ──────────────────────────────────── */
  /* Fills the form from the saved offer. A date in the past is left empty so the tasker must pick a new one. */
  function prefillFromOffer(app) {
    var p = parseMessage(app.message, app.created_at);
    if (p.rate) setAmount(p.rate);
    $('moPitch').value = p.pitch.slice(0, PITCH_MAX); state.pitch = $('moPitch').value;
    if (p.date && p.date >= todayYmd()) { $('moDate').value = p.date; state.date = p.date; }
    else { $('moDate').value = ''; state.date = ''; }
    setWindow(p.window || 'flexible');
    paintPitchCount();
  }

  /* ── Stage 4: terms + submit ─────────────────────────────── */
  function paintSubmit() {
    if (state.sending) return;
    var verb = state.edit ? 'Save Changes' : 'Submit Offer';
    setText('moSubmitLabel', state.amount ? verb + ' for ' + money(state.amount) : verb);
  }
  function showSubmitError(msg, linkHref, linkText) {
    var el = $('moSubmitErr');
    el.textContent = msg;
    if (msg && linkHref) {
      el.appendChild(document.createTextNode(' '));
      var a = document.createElement('a'); a.href = linkHref; a.textContent = linkText; el.appendChild(a);
    }
    el.hidden = !msg;
  }
  function showDone() {
    $('moForm').hidden = true;
    $('moDoneBack').href = taskUrl();
    if (state.edit) { setText('moDoneTitle', 'Offer updated'); setText('moDoneText', 'The customer has been told that your offer changed.'); }
    var done = $('moDone'); done.hidden = false;
    document.querySelector('.mo-topbar-chip').lastChild.textContent = state.edit ? 'Offer updated' : 'Offer sent';
    window.scrollTo(0, 0);
    done.focus();
  }
  async function submitOffer() {
    if (state.sending) return;
    showSubmitError('');
    var ok = validateAll();
    var agreed = $('moTerms').checked;
    var tErr = $('moTermsErr');
    tErr.textContent = agreed ? '' : 'Tick the box to confirm you agree.'; tErr.hidden = agreed;
    $('moTerms').setAttribute('aria-invalid', agreed ? 'false' : 'true');
    if (!ok) return;
    if (!agreed) { $('moTerms').focus(); return; }

    state.sending = true;
    var btn = $('moSubmit'); btn.disabled = true; setText('moSubmitLabel', state.edit ? 'Saving\u2026' : 'Sending\u2026');
    try {
      if (state.edit) {
        /* The arrival is passed as a string so it replaces the one saved before */
        await window.updateMyApplication(state.myApplication.id, { message: pitchText(), rate: state.amount, arrival: buildArrival() });
      } else {
        var apply = (window.ST && window.ST.db && window.ST.db.applyToTask) || window.applyToTask;
        var saved = await apply({ taskId: state.task.id, message: buildMessage() });
        state.myApplication = { id: saved && saved.id, status: 'pending' };
      }
      state.sending = false;
      showDone();
    } catch (e) {
      var msg = (e && e.message) || '';
      state.sending = false; btn.disabled = false; paintSubmit();
      if (state.edit && /no longer be edited/i.test(msg)) showSubmitError('This offer can no longer be edited. It may have been answered or withdrawn.', 'applications.html', 'View My Applications');
      else if (/already applied/i.test(msg)) showSubmitError('You have already applied for this task.', 'applications.html', 'View My Applications');
      else if (/log in/i.test(msg)) showSubmitError('Your session has ended. Please log in again.', 'login.html?redirect=' + encodeURIComponent(window.location.pathname.replace(/^\//, '') + window.location.search), 'Log in');
      else showSubmitError(state.edit ? 'We could not save your changes. Check your connection and try again.' : 'We could not send your offer. Check your connection and try again.');
    }
  }
  function wireSubmit() {
    $('moSubmit').addEventListener('click', submitOffer);
    $('moTerms').addEventListener('change', function () {
      if ($('moTerms').checked) { $('moTermsErr').hidden = true; $('moTerms').setAttribute('aria-invalid', 'false'); }
    });
  }

  /* ── load ────────────────────────────────────────────────── */
  async function load() {
    var sb = window.supabase;
    var r = await sb.from('tasks').select('*').eq('id', state.id).maybeSingle();
    var t = r.data;
    if (r.error || !t) return showError('Task not found', 'This task may have been removed, or the link is incomplete.', 'find-tasks.html', 'Browse Tasks');
    state.task = t;
    state.posterId = t.customer_id || t.user_id || null;
    var back = backUrl();

    if (state.posterId && String(state.viewer.id) === String(state.posterId)) {
      return showError('This is your task', 'Offers are made by taskers. You can review the offers you receive from My Tasks.', 'my-tasks.html', 'Go to My Tasks');
    }
    if (!state.isTasker) {
      return showError('Switch to a tasker account', 'Offers are made by taskers. Switch to your tasker account to apply for this task.', back, 'Back to Task Details');
    }
    if (taskGroup(t.status) !== 'open') {
      return showError('No longer taking offers', 'This task is no longer open, so new offers cannot be sent.', back, 'Back to Task Details');
    }

    var results = await Promise.all([
      state.posterId ? sb.from('users').select('*').eq('id', state.posterId).maybeSingle().then(function (x) { return x.data; }, function () { return null; }) : Promise.resolve(null),
      state.posterId ? loadRating(sb, state.posterId) : Promise.resolve(null),
      loadMyApplication(sb, t.id, state.viewer)
    ]);
    state.poster = results[0]; state.rating = results[1]; state.myApplication = results[2];

    var mine = state.myApplication;
    if (state.edit && !mine) state.edit = false;   /* nothing to edit: treat the link as a new offer */
    if (mine && !state.edit) {
      return showError('You have already sent an offer', 'Your offer for this task is waiting for the customer. You can follow it, change it or withdraw it from My Applications.', 'applications.html', 'View My Applications');
    }
    if (mine && String(mine.status || '').toLowerCase() !== 'pending') {
      return showError('This offer can no longer be edited', 'The customer has already answered it, so it is locked. You can see it in My Applications.', 'applications.html', 'View My Applications');
    }

    renderHead(t); renderSummary(t); renderWho(state.poster); initAmount(t); initAvailability(t);
    if (state.edit) prefillFromOffer(mine);

    $('moLoading').hidden = true;
    $('moContent').hidden = false;
  }

  async function init() {
    wireAmount(); wirePitch(); wireSubmit();
    try {
      var q = new URLSearchParams(window.location.search);
      state.id = text(q.get('task') || q.get('id'));
      state.edit = q.get('edit') === '1';
      if (!state.id) return showError('Task not found', 'This offer link is incomplete.', 'find-tasks.html', 'Browse Tasks');
      var user = await currentUser();
      if (!user) return toLogin();
      state.isTasker = (await roleOf(user)) === 'tasker';
      await load();
    } catch (err) {
      console.error('[make-offer]', err);
      showError('Offer unavailable', 'Something went wrong while loading this page. Please try again.', 'find-tasks.html', 'Browse Tasks');
    }
  }

  init();
})();

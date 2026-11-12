/* ============================================================
   STREET TASKERS — ui.js v2
   UI interactions, toast, placeholder data, card builder
   Sprint 1: Frontend only
   ============================================================
   ============================================================ */

'use strict';

/* ── Toast ───────────────────────────────────────────────────
   showToast(message)                       tone is guessed from the words
   showToast(message, 5000)                 custom duration (ms)
   showToast(message, { type, title, duration, tonal })
     type      'success' | 'info' | 'warning' | 'error'
     title     bold first line; `message` then becomes the smaller second line
     tonal     true = pastel tinted pill instead of the white one
   Shortcuts: showToast.success / .info / .warning / .error (message, options)
   Pause on hover or keyboard focus. Esc dismisses the newest toast.
   Styles: css/styles.css, "TOASTS + NOTIFICATION BOXES". */
const TOAST_MAX = 3;
const TOAST_ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 11v6"/><path d="M12 7h.01"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v6"/><path d="M12 17h.01"/></svg>',
  error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
};
const TOAST_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

/* Older call sites pass only a message, so pick a tone from the wording. */
function guessToastType(msg) {
  const m = String(msg || '').toLowerCase();
  if (/fail|error|couldn.?t|could not|unable|invalid|cannot|can.?t |denied|not found|went wrong|declined|expired|try again/.test(m)) return 'error';
  if (/please|required|must |missing|select |enter |choose |sign in|log in|log into/.test(m)) return 'warning';
  if (/sent|saved|success|added|updated|copied|posted|created|booked|confirmed|accepted|done|submitted|verified|removed|deleted|welcome|thank|published|cancelled|canceled|released|funded|paid/.test(m)) return 'success';
  return 'info';
}

function toastStack() {
  let stack = document.getElementById('toastStack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toastStack';
    stack.className = 'st-toast-stack';
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      const last = stack.lastElementChild;
      if (last && last._dismiss) last._dismiss();
    });
  }
  return stack;
}

/* ── Report an error ─────────────────────────────────────────
   STReport.href(message, where)   mailto: link that opens an email to support with the error, the page, the time and the account id
   STReport.attach(el, message)    adds a "Report this error" link after the text already inside el (once)
   Used by every error toast and by the error lines on the edit-profile pages. Nothing is sent by the page itself:
   the person's own email app opens with the details filled in, and they press Send. */
const ST_REPORT_EMAIL = 'support@streettasker.com';
window.STReport = {
  email: ST_REPORT_EMAIL,
  href: function (message, where) {
    let uid = '', role = '';
    try { uid = localStorage.getItem('st_uid') || ''; role = localStorage.getItem('st_role') || ''; } catch (e) {}
    const lines = [
      'Please describe what you were doing when this happened:',
      '',
      '',
      '--- Details (please leave these in) ---',
      'Error: ' + String(message == null ? '' : message).slice(0, 600),
      where ? 'Where: ' + String(where).slice(0, 200) : '',
      'Page: ' + window.location.href.slice(0, 300),
      'Time: ' + new Date().toISOString(),
      uid ? 'Account id: ' + uid : '',
      role ? 'Account type: ' + role : '',
      'Browser: ' + String(navigator.userAgent || '').slice(0, 200)
    ].filter(function (l, i) { return l !== '' || i < 3; });
    return 'mailto:' + ST_REPORT_EMAIL + '?subject=' + encodeURIComponent('StreetTasker error report') + '&body=' + encodeURIComponent(lines.join('\n'));
  },
  link: function (message, where) {
    const a = document.createElement('a');
    a.className = 'st-report-link';
    a.href = window.STReport.href(message, where);
    a.textContent = 'Report this error';
    a.rel = 'noopener';
    return a;
  },
  attach: function (el, message, where) {
    if (!el || el.querySelector('.st-report-link')) return;
    el.appendChild(document.createTextNode(' '));
    el.appendChild(window.STReport.link(message != null ? message : el.textContent, where));
  }
};

function showToast(msg, opts) {
  const o = (typeof opts === 'number') ? { duration: opts } : (opts || {});
  const type = TOAST_ICONS[o.type] ? o.type : guessToastType((o.title || '') + ' ' + msg);
  const duration = o.duration || (type === 'error' ? 6000 : 4500);
  const stack = toastStack();
  const text = String(msg == null ? '' : msg);

  /* Same message already showing: keep that one instead of stacking a copy. */
  const dupe = Array.from(stack.children).find(el => el.dataset.key === type + '|' + (o.title || '') + '|' + text);
  if (dupe && dupe._restart) { dupe._restart(); return dupe; }

  const el = document.createElement('div');
  el.className = 'st-toast st-toast--' + type + (o.tonal ? ' st-toast--tonal' : '') + ((o.title ? text : text).length > 60 ? ' st-toast--wrap' : '');
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.dataset.key = type + '|' + (o.title || '') + '|' + text;

  const icon = document.createElement('span');
  icon.className = 'st-toast-icon';
  icon.innerHTML = TOAST_ICONS[type];
  const copy = document.createElement('div');
  copy.className = 'st-toast-copy';
  const first = document.createElement('span');
  first.className = 'st-toast-title';
  first.textContent = o.title || text;
  copy.appendChild(first);
  if (o.title && text) {
    const second = document.createElement('span');
    second.className = 'st-toast-desc';
    second.textContent = text;
    copy.appendChild(second);
  }
  /* Every error toast offers a way to report it to us */
  if (type === 'error') copy.appendChild(window.STReport.link((o.title ? o.title + ' - ' : '') + text));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'st-toast-close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.innerHTML = TOAST_CLOSE;
  el.append(icon, copy, close);

  let timer = null, gone = false;
  function dismiss() {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 260);
  }
  function arm() { clearTimeout(timer); timer = setTimeout(dismiss, duration); }
  el._dismiss = dismiss;
  el._restart = arm;
  close.addEventListener('click', dismiss);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', arm);
  el.addEventListener('focusin', () => clearTimeout(timer));
  el.addEventListener('focusout', arm);

  stack.appendChild(el);
  /* Keep at most TOAST_MAX on screen: dismiss the oldest ones that are not already leaving. */
  const live = Array.from(stack.children).filter(n => !n.classList.contains('is-leaving'));
  live.slice(0, Math.max(0, live.length - TOAST_MAX)).forEach(n => n._dismiss());
  arm();
  return el;
}
['success', 'info', 'warning', 'error'].forEach(function (t) {
  showToast[t] = function (msg, o) { return showToast(msg, Object.assign({}, o, { type: t })); };
});
window.showToast = showToast;
window.stToast = showToast;   /* stable name: pages that define their own showToast() delegate here */

/* ── Confirm box ─────────────────────────────────────────────── */
/* Centered replacement for the browser's confirm(), which opens at the top of the window.
   stConfirm('Delete this service?', { title, confirmText, cancelText, danger }) resolves true or false. */
function stConfirm(message, opts) {
  const o = opts || {};
  return new Promise(function (resolve) {
    const dlg = document.createElement('dialog');
    dlg.className = 'st-confirm';
    dlg.setAttribute('aria-labelledby', 'stConfirmTitle');
    const body = document.createElement('div');
    body.className = 'st-confirm-body';
    const title = document.createElement('h2');
    title.className = 'st-confirm-title';
    title.id = 'stConfirmTitle';
    title.textContent = o.title || 'Are you sure?';
    const text = document.createElement('p');
    text.className = 'st-confirm-text';
    text.textContent = String(message == null ? '' : message);
    const actions = document.createElement('div');
    actions.className = 'st-confirm-actions';
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'btn btn-outline';
    no.textContent = o.cancelText || 'Cancel';
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'btn ' + (o.danger === false ? 'btn-primary' : 'btn-dark');
    yes.textContent = o.confirmText || 'Confirm';
    actions.append(no, yes);
    body.append(title, text, actions);
    dlg.appendChild(body);
    let answer = false;
    no.addEventListener('click', function () { dlg.close(); });
    yes.addEventListener('click', function () { answer = true; dlg.close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });   /* click on the dimmed area */
    dlg.addEventListener('close', function () { dlg.remove(); resolve(answer); });
    document.body.appendChild(dlg);
    dlg.showModal();
    no.focus();
  });
}
window.stConfirm = stConfirm;

/* ── SVG icon helpers ────────────────────────────────────────── */
const SVG_PIN = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

function serviceIcon(service) {
  const s = (service || '').toLowerCase();
  if (s.includes('barber') || s.includes('hair')) return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="4" r="2"/><path d="m5.81 10.186 1.768-2.832L10 12l2.828-4.243L14.19 10.186A3 3 0 0 1 12 16a3 3 0 0 1-2.19-5.814"/><circle cx="18" cy="4" r="2"/></svg>`;
  if (s.includes('elec'))  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
  if (s.includes('clean')) return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/></svg>`;
  if (s.includes('mech') || s.includes('auto')) return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
  if (s.includes('make') || s.includes('beauty')) return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a5 5 0 0 1 5 5v6a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z"/></svg>`;
  if (s.includes('plumb')) return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M4 18V6a2 2 0 0 1 2-2h9l5 5v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></svg>`;
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
}

function starString(rating) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '');
}

/* ── Static fallback tasker data ─────────────────────────────── */
/*
 * const { data } = await supabase
 *   .from('tasker_profiles')
 *   .select('*, profiles(name), reviews(rating)')
 *   .eq('status', 'active')
 *   .order('avg_rating', { ascending: false })
 */
const PLACEHOLDER_TASKERS = [
  { id:'t1', initials:'AO', avatarClass:'av-1', name:'Adebayo Okafor',  service:'Electrician',   location:'Lekki, Lagos',            rating:4.9, reviews:48,  rate:'₦5,000/hr',      badges:['verified','top'] },
  { id:'t2', initials:'CF', avatarClass:'av-2', name:'Chidi Fernandez', service:'Barber',         location:'Victoria Island, Lagos',  rating:4.8, reviews:112, rate:'₦3,500/cut',     badges:['verified'] },
  { id:'t3', initials:'FM', avatarClass:'av-3', name:'Fatima Mohammed', service:'House Cleaner',  location:'Ikeja, Lagos',            rating:4.7, reviews:73,  rate:'₦4,000/session', badges:['verified'] },
  { id:'t4', initials:'EO', avatarClass:'av-4', name:'Emeka Obi',       service:'Mechanic',       location:'Surulere, Lagos',         rating:4.6, reviews:29,  rate:'₦6,000/hr',      badges:['verified'] },
  { id:'t5', initials:'SB', avatarClass:'av-5', name:'Sadia Bello',     service:'Make-up Artist', location:'Ajah, Lagos',             rating:5.0, reviews:91,  rate:'₦8,000/session', badges:['verified','top'] },
  { id:'t6', initials:'KA', avatarClass:'av-6', name:'Kingsley Adu',    service:'Plumber',        location:'Yaba, Lagos',             rating:4.5, reviews:34,  rate:'₦4,500/hr',      badges:['verified'] },
];

/* ── Build a tasker card DOM element ─────────────────────────── */
/*
 * Supabase Storage and a verified badge from DB.
 */
function buildTaskerCard(tasker) {
  const card = document.createElement('div');
  card.className = 'card tasker-card fade-up';
  card.dataset.id = tasker.id;

  const badges = tasker.badges.map(b => {
    if (b === 'top')      return `<span class="badge badge-amber">Top Rated</span>`;
    return '';
  }).join('');

  card.innerHTML = `
    <div class="tasker-card-head">
      <div class="tasker-avatar ${tasker.avatarClass}">${tasker.initials}</div>
      <div class="tasker-info">
        <div class="tasker-name">${tasker.name}</div>
        <div class="tasker-service">
          ${serviceIcon(tasker.service)}
          ${tasker.service}
        </div>
        <div class="tasker-location">
          ${SVG_PIN}
          ${tasker.location}
        </div>
      </div>
    </div>
    ${badges ? `<div class="tasker-badges">${badges}</div>` : ''}
    <div class="tasker-meta">
      <div class="tasker-rating">
        <span class="stars">${starString(tasker.rating)}</span>
        <span class="review-count">${tasker.rating} (${tasker.reviews})</span>
      </div>
      <div class="tasker-rate">${tasker.rate}</div>
    </div>
    <div class="tasker-actions">
      <button class="btn btn-outline btn-sm" onclick="window.openTaskerProfile && openTaskerProfile(tasker.id)">View Profile</button>
      <button class="btn btn-primary btn-sm" onclick="window.openBookingModal && openBookingModal(tasker.id)">Book</button>
    </div>
  `;
  return card;
}

/* ── Render tasker grid ──────────────────────────────────────── */
function renderTaskers(container, taskers = PLACEHOLDER_TASKERS) {
  if (!container) return;
  container.innerHTML = '';
  taskers.forEach((t, i) => {
    const card = buildTaskerCard(t);
    card.style.animationDelay = `${i * 0.07}s`;
    container.appendChild(card);
  });
}

/* ── Filter sidebar (UI only) ────────────────────────────────── */
/*
 */
function initFilters() {
  document.querySelectorAll('.filter-opt input, .filter-range').forEach(input => {
    input.addEventListener('change', () => {});
  });
  const reset = document.getElementById('filterReset');
  if (reset) {
    reset.addEventListener('click', () => {
      document.querySelectorAll('.filter-opt input[type="checkbox"]').forEach(cb => cb.checked = false);
      document.querySelectorAll('.filter-range').forEach(r => r.value = r.defaultValue);
      showToast('Filters cleared');
    });
  }
}

/* ── Search (placeholder) ────────────────────────────────────── */
function initSearch(formId) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    if(typeof renderTaskerGrid==='function') renderTaskerGrid(1);
  });
}

/* ============================================================
   CARD BUILDERS v2  (task / service / tasker)
   stTaskCard(task), stServiceCard(service), stTaskerCard(tasker)
   return HTML strings styled by css/tasks.css ".st-card".
   Optional fields only render when the data has them, so a card
   never shows an invented rating, distance or turnaround.
   ============================================================ */
const ST_ICON = (function () {
  const a = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  return {
    pin:      `<svg ${a}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
    clock:    `<svg ${a}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
    image:    `<svg ${a}><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4-4L5 21"/></svg>`,
    bookmark: `<svg ${a}><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/></svg>`,
    truck:    `<svg ${a}><path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11h2"/><path d="M14 9h4l4 4v4h-2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>`,
    star:     `<svg ${a}><path d="m12 2 3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5L9 8.9Z"/></svg>`,
    verified: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.5 14.6 3l3-.2 1.4 2.7 2.7 1.4-.2 3L23 12l-1.5 2.6.2 3-2.7 1.4-1.4 2.7-3-.2L12 23l-2.6-1.5-3 .2-1.4-2.7-2.7-1.4.2-3L1 12l1.5-2.6-.2-3 2.7-1.4L6.4 2.8l3 .2Z"/><path class="st-tick" d="m8.5 12.3 2.4 2.4 4.6-4.9" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    arrow:    `<svg ${a}><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>`,
    arrowUR:  `<svg ${a}><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>`,
    wrench:   `<svg ${a}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z"/></svg>`,
    globe:    `<svg ${a}><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"/></svg>`,
    left:     `<svg ${a}><path d="m15 18-6-6 6-6"/></svg>`,
    right:    `<svg ${a}><path d="m9 18 6-6-6-6"/></svg>`,
    shield:   `<svg ${a}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>`,
    alert:    `<svg ${a}><path d="m10.3 3.9-8.5 14.7A2 2 0 0 0 3.5 21.6h17a2 2 0 0 0 1.7-3l-8.5-14.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
    bolt:     `<svg ${a}><path d="M13 2 3 14h9l-1 8 10-12h-9Z"/></svg>`,
    check:    `<svg ${a}><path d="M20 6 9 17l-5-5"/></svg>`,
    send:     `<svg ${a}><path d="M3 11 22 2l-9 19-2-8-8-2Z"/></svg>`,
    plus:     `<svg ${a}><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
    heart:    `<svg ${a}><path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 12 5.7 5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/></svg>`,
    urgent:   `<svg ${a}><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>`,
  };
})();
window.ST_ICON = ST_ICON;

const ST_NGN = n => '₦' + Number(n || 0).toLocaleString('en-NG');
/* Stage 3: a price range shows as "₦5,000–₦20,000"; a fixed price (no price_max) is unchanged. */
const ST_IS_RANGE = (min, max) => Number(min) > 0 && Number(max) > Number(min);
const ST_PRICE = (min, max) => ST_IS_RANGE(min, max) ? ST_NGN(min) + '–' + ST_NGN(max) : ST_NGN(min);
const ST_CAT_EMOJI = { barber:'💈', electrician:'⚡', cleaning:'🧹', mechanic:'🔧', plumber:'🚰', plumbing:'🚰', beauty:'💄', other:'🛠️' };
/* Category picture for a card: the green icon from js/categories.js when it is loaded, else the old emoji */
function stCatPic(cat) {
  /* a known category -> its green icon; no category / unknown -> the StreetTasker logo (never a generic wrench) */
  if (window.STCat && cat && window.STCat.resolve(cat).value !== 'other') return window.STCat.iconHtml(cat, 'st-cat-ico--card');
  return '<img class="st-logo-ph" src="images/logo-mark.png" alt="" />';
}

/* Placeholder photo for a task card with no client photo: one picture per category (images/placeholders/), with the small
   StreetTasker logo at the top right so people know it is a placeholder and not the client's own photo. Other, unknown and
   uncategorised tasks get the general TASK picture. Cleaning has two pictures; the task id picks one so cards differ. */
const ST_TASK_PH = {
  cleaning: ['cleaning', 'cleaning-2'], laundry: ['cleaning-2'], grooming: ['grooming'], automotive: ['automotive'], handyman: ['handyman'],
  landscaping: ['landscaping'], hospitality: ['hospitality'], business: ['business'], it_tech: ['it_tech'], creative: ['creative'],
  logistics: ['logistics'], health: ['health'], pet: ['pet'], education: ['education'], financial: ['financial'], legal: ['legal'],
  events: ['events']
};
function stTaskPhUrl(cat, id) {
  /* Other, unknown or no category: the general "TASK" picture */
  const group = (window.STCat && cat) ? window.STCat.resolve(cat).value : 'other';
  const files = ST_TASK_PH[group] || ['general'];
  const key = String(id || '');
  let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return 'images/placeholders/task-' + files[h % files.length] + '.jpg';
}

/* "20m ago" / "3h ago" / "2d ago" */
function stAgo(iso) {
  if (!iso) return '';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  if (mins < 1440) return Math.floor(mins / 60) + 'h ago';
  return Math.floor(mins / 1440) + 'd ago';
}
const stLabel = v => String(v || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/* ── Task card ───────────────────────────────────────────────
   The card carries data-task-id; the page opens it with one delegated click
   handler (no inline JS built from user text). Reads: title, description, category, urgency, task_type, location,
   budget, created_at, photo_urls[], distance_km, offers_count. */
function stTaskCard(t) {
  if (t && t.home) return stTaskCardHome(t);   /* homepage design (Stage 1): see the HOME CARDS block at the end of this file */
  const e = window.escapeHtml || (x => String(x));
  const urg   = t.urgency || 'flexible';
  const chipCls = urg === 'immediate' ? 'st-chip--urgent' : (urg === 'scheduled' ? 'st-chip--soon' : '');
  const chipTxt = urg === 'immediate' ? 'Urgent' : (urg === 'scheduled' ? 'Scheduled' : 'Flexible');
  /* t.compact: the caller does not know the urgency or category (home pages), so nothing is invented: no "Flexible", no "Other".
     No posted date anywhere on the card, and none inside the Urgent tag. */
  const urgChip = (t.compact && urg !== 'immediate'
    ? ''
    : `<span class="st-chip ${chipCls}">${urg === 'immediate' ? ST_ICON.clock : ''}${chipTxt}</span>`)
    + (t.status === 'in_progress' ? '<span class="st-chip st-chip--soon">Booked</span>' : '');   /* B5 */
  const cat   = t.category || 'other';
  const catChip = t.compact && !t.category ? '' : `<span class="st-chip st-chip--category">${e(window.STCat ? window.STCat.label(cat) : stLabel(cat))}</span>`;
  const photos = Array.isArray(t.photo_urls) ? t.photo_urls.filter(Boolean) : [];
  const emoji = stCatPic(cat);
  const phUrl = stTaskPhUrl(cat, t.id);
  const media = photos.length
    ? `<div class="st-card-media"><img src="${e(photos[0])}" alt="" loading="lazy" />
         <span class="st-chip st-chip--glass st-card-media-tag">${ST_ICON.image}${photos.length} Client Photo${photos.length > 1 ? 's' : ''}</span></div>`
    : (phUrl
      ? `<div class="st-card-media st-card-media--ph" data-ph="${e(window.STCat ? window.STCat.resolve(cat).value : 'other')}"><img src="${e(phUrl)}" alt="" loading="lazy" />
           <img class="st-card-ph-logo" src="images/favicon.png" alt="" aria-hidden="true" /></div>`
      : `<div class="st-card-media"><div class="st-card-media-fallback" aria-hidden="true">${emoji}</div></div>`);
  const remote = (t.task_type || '') === 'remote';
  const dist = typeof t.distance_km === 'number' ? `<li><span class="st-dot" aria-hidden="true">•</span>${t.distance_km.toFixed(1)} km</li>` : '';
  const offers = Number(t.offers_count);
  const offersNote = Number.isFinite(offers) && offers > 0 ? `<span class="st-card-foot-note">${offers} offer${offers === 1 ? '' : 's'} submitted</span>` : '';
  const desc = (t.description || '').trim();
  return `<article class="st-card st-card--task${t.hideOffer ? '' : ' st-card--duo'} fade-up" data-task-id="${e(t.id)}">
    <div class="st-card-pad">
      <div class="st-card-top">
        <div class="st-card-chips">
          ${urgChip}
          ${catChip}
        </div>
        <button type="button" class="st-card-save" aria-label="Save task" aria-pressed="false">${ST_ICON.bookmark}</button>
      </div>
      ${media}
      <h3 class="st-card-title">${e(t.title || 'Untitled Task')}</h3>
      ${desc ? `<p class="st-card-desc">${e(desc)}</p>` : ''}
      ${Array.isArray(t.facts) && t.facts.length ? `<ul class="st-card-facts" aria-label="About this work">${t.facts.slice(0, 3).map(f => `<li>${e(f)}</li>`).join('')}</ul>` : ''}
      <ul class="st-card-meta">
        <li>${ST_ICON.pin}<strong>${e(t.location || 'Location TBD')}</strong></li>${dist}
        <li><span class="st-chip st-chip--mode">${remote ? ST_ICON.globe + 'Remote' : (t.category && window.STCat ? window.STCat.iconHtml(t.category) : '') + 'In-Person'}</span></li>
      </ul>
    </div>
    <div class="st-card-foot">
      <div class="st-card-foot-info"><span class="st-card-foot-label">Client Budget</span><span class="st-card-price">${Number(t.budget) > 0 ? ST_NGN(t.budget) : 'No budget'}</span>${offersNote}</div>
      <div class="st-card-actions">
        <a class="st-card-cta st-card-cta--ghost" href="task-details.html?id=${encodeURIComponent(t.id)}">View Details</a>
        ${t.hideOffer ? '' : `<button type="button" class="st-card-cta">Make an Offer ${ST_ICON.arrow}</button>`}
      </div>
    </div>
  </article>`;
}

/* ── Service card ────────────────────────────────────────────
   Reads: service_name, category label (s.categoryLabel), description, photo,
   provider, location, price, unit, rating, reviews_count, turnaround,
   perk (e.g. "Includes Doorstep Pickup"), href, user_id (provider; only used for the membership label). */
function stServiceCard(s) {
  if (s && s.home) return stServiceCardHome(s);
  const e = window.escapeHtml || (x => String(x));
  const rating = Number(s.rating);
  const reviews = Number(s.reviews_count);
  const ratingHtml = rating > 0
    ? `<span class="st-rating">${ST_ICON.star}${rating.toFixed(2).replace(/0$/, '')}${reviews > 0 ? ` <small>(${reviews}${reviews >= 100 ? '+' : ''})</small>` : ''}</span>` : '';
  /* PRO / PREMIUM label (S4i): AFTER the provider name, only when the card shows the name (no perk line), never for Local Taskers. */
  const memb = (!s.perk && s.provider && !s.isLocal && s.user_id && window.STMembership) ? window.STMembership.html(s.user_id, { small: true }) : '';
  const eyebrowHtml = s.perk ? e(s.perk) : [s.provider ? e(s.provider) + memb : '', s.location ? e(s.location) : ''].filter(Boolean).join(' · ');
  const media = s.photo
    ? `<img src="${e(s.photo)}" alt="${e(s.service_name)}" loading="lazy" data-emoji="${e(s.emoji || '')}" />`
    : `<div class="st-card-media-fallback" aria-hidden="true">${s.category ? stCatPic(s.category) : (s.emoji || ST_CAT_EMOJI.other)}</div>`;
  const priced = Number(s.price) > 0;
  return `<article class="st-card st-card--service fade-up" data-href="${e(s.href)}"${s.service_id ? ` data-service-id="${e(s.service_id)}"` : ''}>
    <div class="st-card-media">
      ${media}
      <span class="st-chip st-chip--glass st-card-media-tag st-card-media-tag--tl">${e(s.categoryLabel || '')}</span>
      ${s.turnaround ? `<span class="st-chip st-chip--dark st-card-media-tag st-card-media-tag--br">${ST_ICON.truck}${e(s.turnaround)}</span>` : ''}
    </div>
    <div class="st-card-pad">
      <div class="st-card-top"><span class="st-card-eyebrow">${eyebrowHtml}</span>${ratingHtml}</div>
      ${s.isLocal ? stLocalTags() : ''}
      <h3 class="st-card-title">${e(s.service_name)}</h3>
      ${s.description ? `<p class="st-card-desc">${e(s.description)}</p>` : ''}
      ${Array.isArray(s.facts) && s.facts.length ? `<ul class="st-card-facts" aria-label="Service details">${s.facts.slice(0, 3).map(f => `<li>${e(f)}</li>`).join('')}</ul>` : ''}
    </div>
    <div class="st-card-foot st-card-foot--plain">
      <div class="st-card-foot-info"><span class="st-card-foot-label">${s.pricing ? e(s.pricing.label) : (priced ? (ST_IS_RANGE(s.price, s.price_max) ? 'Price range' : 'Starting From') : 'Pricing')}</span>
        <span class="st-card-price">${s.pricing ? e(s.pricing.amount) + (s.pricing.unit ? ` <small>${e(s.pricing.unit)}</small>` : '') : (priced ? ST_PRICE(s.price, s.price_max) + (s.unit ? ` <small>/${e(s.unit)}</small>` : '') : 'Ask for a quote')}</span></div>
      <a href="${e(s.href)}" class="st-card-cta">Book Service</a>
    </div>
  </article>`;
}

/* ── Tasker card ─────────────────────────────────────────────
   Reads: provider_name, service_name, location, rating, reviews, verified,
   availability_status, photo, specialties[], portfolio[{image_url}],
   price, rate_unit, href, id, user_id. The PRO / PREMIUM label (js/membership-labels.js, S4h) is drawn AFTER the name
   and after the identity tick; none for Free / Starter / Local Taskers / demo cards. */
/* Local Tasker labels (stage 4C-2). Only built when the caller says isLocal, which comes from the
   database function local_tasker_public_info via js/local-tasker-public.js. Regular cards are unchanged. */
function stLocalTags() {
  const L = window.STLocal || {};
  return `<div class="st-local-tags"><span class="st-chip st-chip--local">${L.LABEL || 'Local Tasker'}</span><span class="st-chip st-chip--local-phone">${L.LABEL_PHONE || 'Phone Assisted'}</span></div>`;
}
/* Profile pictures on cards: the card only says whose picture belongs in a spot; js/local-tasker-public.js puts it there after the card is on the page. */
function stAvAttr(s, kind) {
  const uid = String((s && s.user_id) || '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid) ? ` data-avatar-user="${uid}" data-avatar-kind="${kind}"` : '';
}
const ST_AVAIL = { available_now: ['Available', true], available_today: ['Available today', true], available_this_week: ['This week', false] };
function stTaskerCard(s) {
  if (s && s.home) return stTaskerCardHome(s);
  const e = window.escapeHtml || (x => String(x));
  const name = s.provider_name || 'Provider';
  const initials = name.replace(/[^a-zA-Z ]/g, '').trim().split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'ST';
  const av = ST_AVAIL[s.availability_status] || ST_AVAIL.available_this_week;
  const rating = Number(s.rating);
  const reviews = Number(s.reviews);
  const skills = (s.specialties || []).filter(Boolean);
  const shown = skills.slice(0, 3);
  const more = skills.length - shown.length;
  const work = (s.portfolio || []).map(p => p && p.image_url).filter(Boolean).slice(0, 8);
  const unit = String(s.rate_unit || '/job').replace('/', '').trim();
  return `<article class="st-card st-card--tasker fade-up" id="svc-${e(s.id)}">
    <div class="st-card-pad">
      <div class="st-tasker-top">
        ${s.hideAvailability ? '<span></span>' : `<span class="st-chip ${av[1] ? 'st-chip--available' : ''}">${av[1] ? '<span class="st-chip-dot"></span>' : ''}${av[0]}</span>`}
        ${rating > 0 ? `<span class="st-rating">${ST_ICON.star}${rating.toFixed(1)}${reviews > 0 ? ` <small>(${reviews})</small>` : ''}</span>` : ''}
      </div>
      <div class="st-tasker-head">
        <div class="st-tasker-id">
          <h3 class="st-card-title st-tasker-name"><span>${e(name)}</span>${window.STMembership && !s.isLocal ? window.STMembership.html(s.user_id, { small: true }) : ''}</h3>
          <p class="st-tasker-role">${e(s.service_name || '')}</p>
          <p class="st-tasker-loc">${ST_ICON.pin}${e(s.location || 'Lagos')}</p>
        </div>
        <div class="st-tasker-avatar"${stAvAttr(s, 'photo')}><img class="st-logo-ph" src="images/logo-mark.png" alt="" aria-hidden="true" />${s.photo && !s.isLocal ? `<img src="${e(s.photo)}" alt="${e(name)}" loading="lazy" onerror="this.remove()" />` : ''}</div>
      </div>
      ${s.isLocal ? stLocalTags() : ''}
      ${shown.length ? `<div class="st-tasker-skills"><span class="st-card-label">Skills</span>
        <div class="st-tasker-skill-list">${shown.map(k => `<span class="st-chip st-chip--skill">${e(k)}</span>`).join('')}${more > 0 ? `<span class="st-chip st-chip--skill">+${more}</span>` : ''}</div></div>` : ''}
    </div>
    ${work.length ? `<div class="st-portfolio">
      <div class="st-portfolio-head"><span>${ST_ICON.image}My Portfolio</span>
        <span class="st-portfolio-nav"><button type="button" data-st-strip="-1" aria-label="Previous work">${ST_ICON.left}</button><button type="button" data-st-strip="1" aria-label="Next work">${ST_ICON.right}</button></span></div>
      <div class="st-portfolio-strip">${work.map(u => `<img src="${e(u)}" alt="" loading="lazy" onerror="this.remove()" />`).join('')}</div>
    </div>` : ''}
    <div class="st-card-foot st-card-foot--plain">
      <span class="st-price-pill">${ST_PRICE(s.price, s.price_max)}<i></i><small>${e(stLabel(unit) || 'Job')}</small></span>
      <a href="${e(s.href)}" class="st-card-cta">${ST_ICON.arrowUR}View Profile</a>
    </div>
  </article>`;
}

/* Portfolio arrows (works for cards added later too) */
document.addEventListener('click', function (ev) {
  const b = ev.target.closest && ev.target.closest('[data-st-strip]');
  if (!b) return;
  const strip = b.closest('.st-portfolio').querySelector('.st-portfolio-strip');
  strip.scrollBy({ left: Number(b.dataset.stStrip) * strip.clientWidth * 0.8, behavior: 'smooth' });
});


/* ============================================================
   HOME CARDS (homepage design, DESIGN-SYSTEM.md 4.15)
   Same three builders, switched on by { home: true }. Every other page is unchanged.
   Styles: css/home-cards.css. Nothing is invented: a missing rating, distance, offer count, skill or
   verified flag simply leaves that part out. No photo = category placeholder (tasks) or the StreetTasker logo (people).
   ============================================================ */
function stTaskCardHome(t) {
  const e = window.escapeHtml || (x => String(x));
  const urgent = (t.urgency || '') === 'immediate';
  /* No posted date inside the Urgent tag (or anywhere on the home card). */
  const urgChip = (urgent ? `<span class="st-chip st-chip--urgent">${ST_ICON.urgent}Urgent</span>` : '')
    + (t.status === 'in_progress' ? '<span class="st-chip st-chip--soon">Booked</span>' : '');   /* B5 */
  const catChip = t.category ? `<span class="st-chip st-chip--category">${e(window.STCat ? window.STCat.label(t.category) : stLabel(t.category))}</span>` : '';
  const cat = t.category || 'other';
  const photos = Array.isArray(t.photo_urls) ? t.photo_urls.filter(Boolean) : [];
  const phUrl = stTaskPhUrl(cat, t.id);
  const pic = photos.length
    ? `<img src="${e(photos[0])}" alt="" loading="lazy" onerror="this.remove()" />`
    : `<img src="${e(phUrl)}" alt="" loading="lazy" /><img class="st-card-ph-logo" src="images/favicon.png" alt="" aria-hidden="true" />`;
  const photoTag = photos.length ? `<span class="st-chip st-chip--glass st-home-photo-tag">${ST_ICON.image}${photos.length} Client Photo${photos.length > 1 ? 's' : ''}</span>` : '';
  const remote = (t.task_type || '') === 'remote';
  const dist = typeof t.distance_km === 'number' ? `<li class="st-home-dist"><span aria-hidden="true">•</span>${t.distance_km.toFixed(1)} km</li>` : '';
  const offers = Number(t.offers_count);
  const note = Number.isFinite(offers) && offers > 0 ? `<span class="st-home-note">${offers} offer${offers === 1 ? '' : 's'} submitted</span>` : '';
  const desc = (t.description || '').trim();
  const plus = t.offerHref && !t.hideOffer ? `<a class="st-home-plus" href="${e(t.offerHref)}" aria-label="Make an offer on ${e(t.title || 'this task')}">${ST_ICON.plus}</a>` : '';
  return `<article class="st-card st-card--task st-card--home fade-up" data-task-id="${e(t.id)}">
    <div class="st-home-media">${pic}
      <div class="st-home-chips">${urgChip}${catChip}</div>
      <button type="button" class="st-home-save" aria-label="Save task" aria-pressed="false">${ST_ICON.bookmark}</button>
      ${photoTag}
    </div>
    <div class="st-home-body">
      <h3 class="st-home-title">${e(t.title || 'Untitled Task')}</h3>
      ${desc ? `<p class="st-home-desc">${e(desc)}</p>` : ''}
      <div class="st-home-bottom">
        <ul class="st-home-meta">
          <li class="st-home-loc">${ST_ICON.pin}<strong>${e(t.location || 'Location TBD')}</strong></li>${dist}
          <li><span class="st-chip st-chip--mode">${remote ? ST_ICON.globe + 'Remote' : (t.category && window.STCat ? window.STCat.iconHtml(t.category) : '') + 'In-Person'}</span></li>
        </ul>
        <div class="st-home-row">
          <div class="st-home-info"><span class="st-home-label">Client Budget</span><span class="st-home-price">${Number(t.budget) > 0 ? ST_NGN(t.budget) : 'No budget'}</span></div>
          ${note}${plus}
        </div>
      </div>
    </div>
  </article>`;
}

function stServiceCardHome(s) {
  const e = window.escapeHtml || (x => String(x));
  const rating = Number(s.rating);
  const reviews = Number(s.reviews_count);
  const ratingHtml = rating > 0
    ? `<div class="st-home-rating"><span class="st-home-star">${ST_ICON.star}</span><strong>${rating.toFixed(1)}</strong>${reviews > 0 ? `<span>(${reviews} Review${reviews === 1 ? '' : 's'})</span>` : ''}</div>` : '';
  const media = s.photo
    ? `<img src="${e(s.photo)}" alt="${e(s.service_name)}" loading="lazy" onerror="this.remove()" />`
    : `<div class="st-card-media-fallback" aria-hidden="true">${s.category ? stCatPic(s.category) : (s.emoji || ST_CAT_EMOJI.other)}</div>`;
  const memb = (!s.isLocal && s.user_id && window.STMembership) ? window.STMembership.html(s.user_id, { small: true }) : '';
  const name = s.provider || '';
  const avatar = `<span class="st-home-avatar"${stAvAttr(s, 'chip')}><img class="st-logo-ph" src="images/logo-mark.png" alt="" aria-hidden="true" />${s.providerPhoto ? `<img src="${e(s.providerPhoto)}" alt="" loading="lazy" onerror="this.remove()" />` : ''}</span>`;
  const priced = Number(s.price) > 0;
  const unit = String(s.unit || '').replace('/', '').trim();
  const priceHtml = priced ? ST_PRICE(s.price, s.price_max) + (unit ? '/' + e(unit.charAt(0).toUpperCase() + unit.slice(1)) : '') : 'Ask for a quote';
  return `<article class="st-card st-card--service st-card--home fade-up" data-href="${e(s.href)}"${s.service_id ? ` data-service-id="${e(s.service_id)}"` : ''}>
    <div class="st-home-media">${media}
      ${s.categoryLabel ? `<div class="st-home-chips"><span class="st-chip st-chip--glass">${e(s.categoryLabel)}</span></div>` : ''}
      <button type="button" class="st-home-save st-home-save--heart" aria-label="Save service" aria-pressed="false">${ST_ICON.heart}</button>
    </div>
    <div class="st-home-body">
      ${ratingHtml}
      <h3 class="st-home-title st-home-title--svc">${e(s.service_name)}</h3>
      ${s.isLocal ? stLocalTags() : ''}
      <div class="st-home-bottom">
        <div class="st-home-row">
          <div class="st-home-info">
            ${name ? `<span class="st-home-provider">${avatar}<span class="st-home-provider-name">${e(name)}</span>${s.verified === true ? `<span class="st-home-tick" title="Verified" aria-label="Verified">${ST_ICON.verified}</span>` : ''}${memb}</span>` : ''}
            <span class="st-home-price">${priceHtml}</span>
          </div>
          <a class="st-home-plus" href="${e(s.href)}" aria-label="Book ${e(s.service_name)}">${ST_ICON.plus}</a>
        </div>
      </div>
    </div>
  </article>`;
}

function stTaskerCardHome(s) {
  const e = window.escapeHtml || (x => String(x));
  const name = s.provider_name || 'Provider';
  const rating = Number(s.rating);
  const reviews = Number(s.reviews);
  const skills = (s.specialties || []).filter(Boolean);
  const shown = skills.slice(0, 3);
  const more = skills.length - shown.length;
  const L = window.STLocal || {};
  const memb = !s.isLocal && s.user_id && window.STMembership ? window.STMembership.html(s.user_id, { small: true }) : '';
  const lead = s.isLocal ? `<span class="st-chip">${e(L.LABEL || 'Local Tasker')}</span>` : memb;
  const unit = String(s.rate_unit || '/job').replace('/', '').trim();
  return `<article class="st-card st-card--tasker st-card--home fade-up" id="svc-${e(s.id)}">
    <div class="st-home-body st-home-body--tasker">
      <div class="st-tasker-top">
        <span class="st-home-lead">${lead}</span>
        ${rating > 0 ? `<span class="st-rating">${ST_ICON.star}${rating.toFixed(1)}${reviews > 0 ? ` <small>(${reviews})</small>` : ''}</span>` : ''}
      </div>
      <div class="st-home-head">
        <div class="st-home-id">
          <h3 class="st-home-name"${s.verified !== true && !s.isLocal && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s.user_id || '')) ? ` data-verify-user="${e(s.user_id)}"` : ''}><span class="st-home-name-text">${e(name)}</span>${s.verified === true ? `<span class="st-home-tick" title="Verified" aria-label="Verified">${ST_ICON.verified}</span>` : ''}</h3>
          ${s.service_name ? `<p class="st-home-role">${e(s.service_name)}</p>` : ''}
          <p class="st-home-where">${ST_ICON.pin}<span>${e(s.location || 'Lagos')}</span></p>
        </div>
        <div class="st-home-photo"${stAvAttr(s, 'photo')}><img class="st-logo-ph" src="images/logo-mark.png" alt="" aria-hidden="true" />${s.photo && !s.isLocal ? `<img src="${e(s.photo)}" alt="${e(name)}" loading="lazy" onerror="this.remove()" />` : ''}</div>
      </div>
      ${shown.length ? `<div class="st-home-skills"><span class="st-home-skills-label">Skills</span>
        <div class="st-home-skill-list">${shown.map(k => `<span class="st-chip st-chip--skill">${e(k)}</span>`).join('')}${more > 0 ? `<span class="st-chip st-chip--skill">+${more}</span>` : ''}</div></div>` : ''}
      <div class="st-home-tasker-foot">
        ${Number(s.price) > 0 ? `<span class="st-home-pill">${ST_PRICE(s.price, s.price_max)}<i></i><small>${e(stLabel(unit) || 'Job')}</small></span>` : ''}
        <a href="${e(s.href)}" class="st-home-view">${ST_ICON.send}View Profile</a>
      </div>
    </div>
  </article>`;
}

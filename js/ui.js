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
    if (b === 'verified') return `<span class="badge badge-green">Verified</span>`;
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
  };
})();
window.ST_ICON = ST_ICON;

const ST_NGN = n => '₦' + Number(n || 0).toLocaleString('en-NG');
const ST_CAT_EMOJI = { barber:'💈', electrician:'⚡', cleaning:'🧹', mechanic:'🔧', plumber:'🚰', plumbing:'🚰', beauty:'💄', other:'🛠️' };

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
  const e = window.escapeHtml || (x => String(x));
  const urg   = t.urgency || 'flexible';
  const ago   = stAgo(t.created_at);
  const chipCls = urg === 'immediate' ? 'st-chip--urgent' : (urg === 'scheduled' ? 'st-chip--soon' : '');
  const chipTxt = urg === 'immediate' ? 'Urgent' : (urg === 'scheduled' ? 'Scheduled' : 'Flexible');
  const cat   = t.category || 'other';
  const photos = Array.isArray(t.photo_urls) ? t.photo_urls.filter(Boolean) : [];
  const emoji = ST_CAT_EMOJI[cat] || ST_CAT_EMOJI.other;
  const media = photos.length
    ? `<div class="st-card-media"><img src="${e(photos[0])}" alt="" loading="lazy" />
         <span class="st-chip st-chip--glass st-card-media-tag">${ST_ICON.image}${photos.length} Client Photo${photos.length > 1 ? 's' : ''}</span></div>`
    : `<div class="st-card-media"><div class="st-card-media-fallback" aria-hidden="true">${emoji}</div></div>`;
  const remote = (t.task_type || '') === 'remote';
  const dist = typeof t.distance_km === 'number' ? `<li><span class="st-dot" aria-hidden="true">•</span>${t.distance_km.toFixed(1)} km</li>` : '';
  const offers = Number(t.offers_count);
  const offersNote = Number.isFinite(offers) && offers > 0 ? `<span class="st-card-foot-note">${offers} offer${offers === 1 ? '' : 's'} submitted</span>` : '';
  const desc = (t.description || '').trim();
  return `<article class="st-card st-card--task fade-up" data-task-id="${e(t.id)}">
    <div class="st-card-pad">
      <div class="st-card-top">
        <div class="st-card-chips">
          <span class="st-chip ${chipCls}">${urg === 'immediate' ? ST_ICON.clock : ''}${chipTxt}${ago ? ' • ' + ago : ''}</span>
          <span class="st-chip st-chip--category">${e(stLabel(cat))}</span>
        </div>
        <button type="button" class="st-card-save" aria-label="Save task" aria-pressed="false" onclick="this.classList.toggle('active');this.setAttribute('aria-pressed',this.classList.contains('active'))">${ST_ICON.bookmark}</button>
      </div>
      ${media}
      <h3 class="st-card-title">${e(t.title || 'Untitled Task')}</h3>
      ${desc ? `<p class="st-card-desc">${e(desc)}</p>` : ''}
      <ul class="st-card-meta">
        <li>${ST_ICON.pin}<strong>${e(t.location || 'Location TBD')}</strong></li>${dist}
        <li><span class="st-chip st-chip--mode">${remote ? ST_ICON.globe + 'Remote' : ST_ICON.wrench + 'In-Person'}</span></li>
      </ul>
    </div>
    <div class="st-card-foot">
      <div class="st-card-foot-info"><span class="st-card-foot-label">Client Budget</span><span class="st-card-price">${ST_NGN(t.budget)}</span>${offersNote}</div>
      <div class="st-card-actions">
        <a class="st-card-cta st-card-cta--ghost" href="task-details.html?id=${encodeURIComponent(t.id)}">View Details</a>
        <button type="button" class="st-card-cta">Make an Offer ${ST_ICON.arrow}</button>
      </div>
    </div>
  </article>`;
}

/* ── Service card ────────────────────────────────────────────
   Reads: service_name, category label (s.categoryLabel), description, photo,
   provider, location, price, unit, rating, reviews_count, turnaround,
   perk (e.g. "Includes Doorstep Pickup"), href. */
function stServiceCard(s) {
  const e = window.escapeHtml || (x => String(x));
  const rating = Number(s.rating);
  const reviews = Number(s.reviews_count);
  const ratingHtml = rating > 0
    ? `<span class="st-rating">${ST_ICON.star}${rating.toFixed(2).replace(/0$/, '')}${reviews > 0 ? ` <small>(${reviews}${reviews >= 100 ? '+' : ''})</small>` : ''}</span>` : '';
  const eyebrow = s.perk || [s.provider, s.location].filter(Boolean).join(' · ');
  const media = s.photo
    ? `<img src="${e(s.photo)}" alt="${e(s.service_name)}" loading="lazy" data-emoji="${e(s.emoji || '')}" />`
    : `<div class="st-card-media-fallback" aria-hidden="true">${s.emoji || ST_CAT_EMOJI.other}</div>`;
  const priced = Number(s.price) > 0;
  return `<article class="st-card st-card--service fade-up" data-href="${e(s.href)}">
    <div class="st-card-media">
      ${media}
      <span class="st-chip st-chip--glass st-card-media-tag st-card-media-tag--tl">${e(s.categoryLabel || '')}</span>
      ${s.turnaround ? `<span class="st-chip st-chip--dark st-card-media-tag st-card-media-tag--br">${ST_ICON.truck}${e(s.turnaround)}</span>` : ''}
    </div>
    <div class="st-card-pad">
      <div class="st-card-top"><span class="st-card-eyebrow">${e(eyebrow)}</span>${ratingHtml}</div>
      ${s.isLocal ? stLocalTags() : ''}
      <h3 class="st-card-title">${e(s.service_name)}</h3>
      ${s.description ? `<p class="st-card-desc">${e(s.description)}</p>` : ''}
    </div>
    <div class="st-card-foot st-card-foot--plain">
      <div class="st-card-foot-info"><span class="st-card-foot-label">${priced ? 'Starting From' : 'Pricing'}</span>
        <span class="st-card-price">${priced ? ST_NGN(s.price) + (s.unit ? ` <small>/${e(s.unit)}</small>` : '') : 'Ask for a quote'}</span></div>
      <a href="${e(s.href)}" class="st-card-cta">Book Service</a>
    </div>
  </article>`;
}

/* ── Tasker card ─────────────────────────────────────────────
   Reads: provider_name, service_name, location, rating, reviews, verified,
   availability_status, photo, specialties[], portfolio[{image_url}],
   price, rate_unit, href, id. */
/* Local Tasker labels (stage 4C-2). Only built when the caller says isLocal, which comes from the
   database function local_tasker_public_info via js/local-tasker-public.js. Regular cards are unchanged. */
function stLocalTags() {
  const L = window.STLocal || {};
  return `<div class="st-local-tags"><span class="st-chip st-chip--local">${L.LABEL || 'Local Tasker'}</span><span class="st-chip st-chip--local-phone">${L.LABEL_PHONE || 'Phone Assisted'}</span></div>`;
}
const ST_AVAIL = { available_now: ['Available', true], available_today: ['Available today', true], available_this_week: ['This week', false] };
function stTaskerCard(s) {
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
        <span class="st-chip ${av[1] ? 'st-chip--available' : ''}">${av[1] ? '<span class="st-chip-dot"></span>' : ''}${av[0]}</span>
        ${rating > 0 ? `<span class="st-rating">${ST_ICON.star}${rating.toFixed(1)}${reviews > 0 ? ` <small>(${reviews})</small>` : ''}</span>` : ''}
      </div>
      <div class="st-tasker-head">
        <div class="st-tasker-id">
          <h3 class="st-card-title st-tasker-name"><span>${e(name)}</span>${s.verified ? `<span title="Verified">${ST_ICON.verified}</span>` : ''}</h3>
          <p class="st-tasker-role">${e(s.service_name || '')}</p>
          <p class="st-tasker-loc">${ST_ICON.pin}${e(s.location || 'Lagos')}</p>
        </div>
        <div class="st-tasker-avatar"><span aria-hidden="true">${initials}</span>${s.photo ? `<img src="${e(s.photo)}" alt="${e(name)}" loading="lazy" onerror="this.remove()" />` : ''}</div>
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
      <span class="st-price-pill">${ST_NGN(s.price)}<i></i><small>${e(stLabel(unit) || 'Job')}</small></span>
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

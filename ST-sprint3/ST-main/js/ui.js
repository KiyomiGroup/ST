/* ============================================================
   STREET TASKERS — ui.js v2
   UI interactions, toast, placeholder data, card builder
   Sprint 1: Frontend only
   ============================================================
   Future Sprint 2: All PLACEHOLDER_* arrays replaced by
   live Supabase queries.
   ============================================================ */

'use strict';

/* ── Toast ───────────────────────────────────────────────────── */
let _toastTimer;
function showToast(msg, dur = 3500) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('visible'), dur);
}
window.showToast = showToast;

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

/* ── Placeholder tasker data ─────────────────────────────────── */
/*
 * Future Sprint 2: Replace with Supabase query:
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
 * Future Sprint 2: Card will include real profile photo from
 * Supabase Storage and a verified badge from DB.
 * Future Sprint 3: Book button opens booking modal.
 * Future Sprint 2: View Profile navigates to /tasker/:id.
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
      <button class="btn btn-outline btn-sm" onclick="showToast('Tasker profiles coming in Sprint 2')">View Profile</button>
      <button class="btn btn-primary btn-sm" onclick="showToast('Booking system coming in Sprint 2')">Book</button>
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
 * Future Sprint 2: Filter changes will trigger Supabase query
 * with .filter(), .gte(), .lte() clauses on tasker_profiles.
 */
function initFilters() {
  document.querySelectorAll('.filter-opt input, .filter-range').forEach(input => {
    input.addEventListener('change', () => showToast('Live filtering coming in Sprint 2'));
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
    showToast('Live search coming in Sprint 2!');
  });
}

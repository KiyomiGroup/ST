/* ============================================================
   STREET TASKER — ui.js
   UI interactions, toast notifications, placeholder helpers
   Sprint 1: Frontend only — no real data
   ============================================================
   Future Sprint: Placeholder data arrays below will be replaced
   by real Supabase queries when the backend is connected.
   Future Sprint: showToast will be extended into a full
   notification system (success, error, info variants).
   ============================================================ */

'use strict';

/* ── Toast Notification ──────────────────────────────────────── */
/**
 * Shows a temporary toast message at the bottom of the screen.
 * Used across all pages for sprint-placeholder feedback.
 *
 * Future Sprint: This will evolve into a full notification system
 * supporting success, error, warning, and info states.
 */
let toastTimer;

function showToast(message, duration = 3500) {
  /* Find or create the toast element */
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add('visible');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
  }, duration);
}

/* Make showToast globally accessible (called from inline HTML handlers) */
window.showToast = showToast;

/* ── Placeholder Tasker Data ─────────────────────────────────── */
/**
 * Static placeholder data representing tasker profiles.
 *
 * Future Sprint: Replace this entire array with a Supabase query:
 * const { data: taskers } = await supabase
 *   .from('tasker_profiles')
 *   .select('*, reviews(rating), services(*)')
 *   .eq('status', 'active')
 *   .order('rating', { ascending: false })
 *   .limit(12)
 */
const PLACEHOLDER_TASKERS = [
  {
    id: 't1',
    initials: 'AO',
    avatarColor: 'linear-gradient(135deg, #4A2C9A, #7C5CBF)',
    name: 'Adebayo Okafor',
    service: 'Electrician',
    location: 'Lekki, Lagos',
    rating: 4.9,
    reviews: 48,
    rate: '₦5,000/hr',
    badges: ['verified', 'top'],
    emoji: '⚡',
  },
  {
    id: 't2',
    initials: 'CF',
    avatarColor: 'linear-gradient(135deg, #00D4FF, #0099CC)',
    name: 'Chidi Fernandez',
    service: 'Barber',
    location: 'Victoria Island, Lagos',
    rating: 4.8,
    reviews: 112,
    rate: '₦3,500/cut',
    badges: ['verified'],
    emoji: '✂️',
  },
  {
    id: 't3',
    initials: 'FM',
    avatarColor: 'linear-gradient(135deg, #F0C040, #D4A020)',
    name: 'Fatima Mohammed',
    service: 'House Cleaner',
    location: 'Ikeja, Lagos',
    rating: 4.7,
    reviews: 73,
    rate: '₦4,000/session',
    badges: ['verified'],
    emoji: '🧹',
  },
  {
    id: 't4',
    initials: 'EO',
    avatarColor: 'linear-gradient(135deg, #34D399, #10B981)',
    name: 'Emeka Obi',
    service: 'Mechanic',
    location: 'Surulere, Lagos',
    rating: 4.6,
    reviews: 29,
    rate: '₦6,000/hr',
    badges: ['verified'],
    emoji: '🔧',
  },
  {
    id: 't5',
    initials: 'SB',
    avatarColor: 'linear-gradient(135deg, #F87171, #EF4444)',
    name: 'Sadia Bello',
    service: 'Make-up Artist',
    location: 'Ajah, Lagos',
    rating: 5.0,
    reviews: 91,
    rate: '₦8,000/session',
    badges: ['verified', 'top'],
    emoji: '💄',
  },
  {
    id: 't6',
    initials: 'KA',
    avatarColor: 'linear-gradient(135deg, #A78BFA, #7C3AED)',
    name: 'Kingsley Adu',
    service: 'Plumber',
    location: 'Yaba, Lagos',
    rating: 4.5,
    reviews: 34,
    rate: '₦4,500/hr',
    badges: ['verified'],
    emoji: '🪠',
  },
];

/* ── Star Rating Helper ──────────────────────────────────────── */
function renderStars(rating) {
  const full  = Math.floor(rating);
  const half  = rating % 1 >= 0.5;
  let stars = '★'.repeat(full);
  if (half) stars += '½';
  return stars;
}

/* ── Tasker Card Builder ─────────────────────────────────────── */
/**
 * Builds a tasker card DOM element from a tasker data object.
 * Future Sprint: Will include real profile photo from Supabase Storage.
 * Future Sprint: Book button will trigger the booking flow.
 * Future Sprint: View Profile will navigate to /tasker/:id page.
 */
function buildTaskerCard(tasker) {
  const card = document.createElement('div');
  card.className = 'glass-card tasker-card anim-fade-up';
  card.dataset.taskerId = tasker.id;

  const badgesHTML = tasker.badges.map(b => {
    if (b === 'verified') return '<span class="tasker-badge badge-verified">✓ Verified</span>';
    if (b === 'top')      return '<span class="tasker-badge badge-top">⭐ Top Rated</span>';
    return '';
  }).join(' ');

  card.innerHTML = `
    <div class="tasker-card-header">
      <div class="tasker-avatar" style="background:${tasker.avatarColor}">
        ${tasker.initials}
      </div>
      <div class="tasker-info">
        <div class="tasker-name">${tasker.name}</div>
        <div class="tasker-service">${tasker.emoji} ${tasker.service}</div>
        <div class="tasker-location">📍 ${tasker.location}</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">
      ${badgesHTML}
    </div>
    <div class="tasker-rating-row">
      <div>
        <span class="tasker-stars">${renderStars(tasker.rating)}</span>
        <span class="tasker-review-count">${tasker.rating} (${tasker.reviews} reviews)</span>
      </div>
      <div class="tasker-rate">${tasker.rate}</div>
    </div>
    <div class="tasker-actions">
      <!-- Future Sprint: View Profile links to /tasker/:id page with full bio & portfolio -->
      <button class="btn btn-outline btn-sm" onclick="showToast('👤 Tasker profiles coming in Sprint 2!')">
        View Profile
      </button>
      <!-- Future Feature: Booking engine integration — triggers booking modal -->
      <button class="btn btn-primary btn-sm" onclick="showToast('📅 Booking system coming in Sprint 2!')">
        Book
      </button>
    </div>
  `;
  return card;
}

/* ── Render Tasker Grid ──────────────────────────────────────── */
/**
 * Renders the placeholder tasker grid on the find-taskers page.
 * Future Sprint: Will accept filter/sort params and re-fetch from Supabase.
 */
function renderTaskers(container, taskers = PLACEHOLDER_TASKERS) {
  if (!container) return;
  container.innerHTML = '';
  taskers.forEach((t, i) => {
    const card = buildTaskerCard(t);
    card.style.animationDelay = `${i * 0.08}s`;
    container.appendChild(card);
  });
}

/* ── Filter UI ───────────────────────────────────────────────── */
/**
 * Handles the filter sidebar interactions on find-taskers page.
 * Sprint 1: Visual-only, no actual filtering logic.
 *
 * Future Sprint: Filter changes will trigger a Supabase query
 * with appropriate .filter(), .gte(), .lte() clauses.
 */
function initFilters() {
  const filterInputs = document.querySelectorAll('.filter-option input, .filter-range');
  filterInputs.forEach(input => {
    input.addEventListener('change', () => {
      showToast('🔧 Live filtering coming in Sprint 2!');
    });
  });

  const resetBtn = document.querySelector('.filter-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      filterInputs.forEach(input => {
        if (input.type === 'checkbox') input.checked = false;
        if (input.type === 'range')    input.value   = input.defaultValue;
      });
      showToast('Filters cleared!');
    });
  }
}

/* ── Search Bar ──────────────────────────────────────────────── */
/**
 * Wires up search bar form submission.
 * Sprint 1: Shows placeholder toast.
 *
 * Future Sprint: Will call Supabase full-text search or an
 * Algolia integration for fast geo-aware service lookup.
 */
function initSearch(formId) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const service  = form.querySelector('[name="service"]')?.value  || '';
    const location = form.querySelector('[name="location"]')?.value || '';

    if (!service && !location) {
      showToast('💡 Enter a service or location to search!');
      return;
    }

    showToast(`🔍 Searching for "${service || 'all services'}" near "${location || 'your area'}" — live search in Sprint 2!`);
  });
}

/* ── Trending Cards ──────────────────────────────────────────── */
/**
 * Placeholder data for the Trending Work section (social feed preview).
 * Future Sprint: Will be populated from a Supabase 'posts' table
 * once the Instagram-style social feed is built in Sprint 3.
 */
const PLACEHOLDER_POSTS = [
  { id: 'p1', emoji: '⚡', bgClass: 'trend-img-bg1', author: 'Adebayo O.', role: 'Electrician', likes: '142', label: 'Full house rewiring job completed in Lekki' },
  { id: 'p2', emoji: '✂️', bgClass: 'trend-img-bg2', author: 'Chidi F.',   role: 'Barber',      likes: '98',  label: 'Fresh fade for the weekend 🔥' },
  { id: 'p3', emoji: '🧹', bgClass: 'trend-img-bg3', author: 'Fatima M.',  role: 'Cleaner',     likes: '67',  label: '4-bedroom deep clean done ✨' },
];

/* ── Placeholder data for Featured Services ──────────────────── */
const FEATURED_SERVICES = [
  { emoji: '✂️', name: 'Barber',        count: '200+ taskers', iconClass: 'icon-purple' },
  { emoji: '⚡', name: 'Electrician',   count: '85+ taskers',  iconClass: 'icon-blue'   },
  { emoji: '🧹', name: 'Cleaner',       count: '150+ taskers', iconClass: 'icon-gold'   },
  { emoji: '🔧', name: 'Mechanic',      count: '60+ taskers',  iconClass: 'icon-green'  },
];

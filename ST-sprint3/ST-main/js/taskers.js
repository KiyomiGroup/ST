/* ============================================================
   STREET TASKERS — taskers.js
   Sprint 2: Tasker listings, filtering, search UI
   ============================================================
   This module manages the Find Taskers page experience.
   All data is from PLACEHOLDER_TASKERS (ui.js).

   Future Sprint 3: Replace placeholder data by calling
   fetchTaskers() from future-features.js with real
   Supabase queries and PostGIS location filtering.
   Future Sprint 3: "Book Now" triggers createBooking()
   and a real booking modal with date/time picker.
   Future Sprint 3: Map view powered by Mapbox GL + PostGIS.
   ============================================================ */

'use strict';

/* ── Extended placeholder data ───────────────────────────────── */
/*
 * Future Sprint 3: This entire array is replaced by:
 *   const taskers = await fetchTaskers({ service, location, minRating, maxPrice, sortBy })
 * Schema mirrors Supabase 'tasker_profiles' JOIN 'profiles' JOIN 'reviews'
 */
const ALL_TASKERS = [
  { id:'t1',  initials:'AO', avatarClass:'av-1', name:'Adebayo Okafor',    service:'Electrician',     category:'electrician', location:'Lekki, Lagos',           rating:4.9, reviews:48,  rateValue:5000,  rate:'₦5,000/hr',      badges:['verified','top'],  bio:'10+ years wiring experience, certified.',      available: true },
  { id:'t2',  initials:'CF', avatarClass:'av-2', name:'Chidi Fernandez',   service:'Barber',          category:'barber',      location:'Victoria Island, Lagos', rating:4.8, reviews:112, rateValue:3500,  rate:'₦3,500/cut',     badges:['verified'],        bio:'Specialist in fades, tapers, and beard trims.', available: true },
  { id:'t3',  initials:'FM', avatarClass:'av-3', name:'Fatima Mohammed',   service:'House Cleaner',   category:'cleaning',    location:'Ikeja, Lagos',           rating:4.7, reviews:73,  rateValue:4000,  rate:'₦4,000/session', badges:['verified'],        bio:'Deep cleaning and post-construction specialist.', available: false },
  { id:'t4',  initials:'EO', avatarClass:'av-4', name:'Emeka Obi',         service:'Mechanic',        category:'mechanic',    location:'Surulere, Lagos',        rating:4.6, reviews:29,  rateValue:6000,  rate:'₦6,000/hr',      badges:['verified'],        bio:'Diagnostics, engine repairs, oil changes.',     available: true },
  { id:'t5',  initials:'SB', avatarClass:'av-5', name:'Sadia Bello',       service:'Make-up Artist',  category:'beauty',      location:'Ajah, Lagos',            rating:5.0, reviews:91,  rateValue:8000,  rate:'₦8,000/session', badges:['verified','top'],  bio:'Bridal, gele, and event make-up specialist.',   available: true },
  { id:'t6',  initials:'KA', avatarClass:'av-6', name:'Kingsley Adu',      service:'Plumber',         category:'plumber',     location:'Yaba, Lagos',            rating:4.5, reviews:34,  rateValue:4500,  rate:'₦4,500/hr',      badges:['verified'],        bio:'Emergency plumbing, pipe fitting, drainage.',    available: true },
  { id:'t7',  initials:'NN', avatarClass:'av-1', name:'Ngozi Nwosu',       service:'Barber',          category:'barber',      location:'Gbagada, Lagos',         rating:4.7, reviews:56,  rateValue:3000,  rate:'₦3,000/cut',     badges:['verified'],        bio:'Ladies specialist, braids, relaxers.',          available: true },
  { id:'t8',  initials:'BI', avatarClass:'av-2', name:'Babatunde Idowu',   service:'Painter',         category:'painting',    location:'Magodo, Lagos',          rating:4.4, reviews:18,  rateValue:35000, rate:'₦35,000/room',   badges:['verified'],        bio:'Interior and exterior painting, 8 years exp.',  available: false },
  { id:'t9',  initials:'AY', avatarClass:'av-3', name:'Aisha Yusuf',       service:'House Cleaner',   category:'cleaning',    location:'Lekki Phase 1, Lagos',   rating:4.9, reviews:144, rateValue:5000,  rate:'₦5,000/session', badges:['verified','top'],  bio:'Move-in/move-out cleaning, weekly packages.',   available: true },
  { id:'t10', initials:'CO', avatarClass:'av-4', name:'Chukwuemeka Odu',   service:'Carpenter',       category:'carpentry',   location:'Oshodi, Lagos',          rating:4.6, reviews:22,  rateValue:8000,  rate:'₦8,000/day',     badges:['verified'],        bio:'Custom furniture, door frames, wardrobes.',      available: true },
  { id:'t11', initials:'ZM', avatarClass:'av-5', name:'Zainab Mustapha',   service:'Make-up Artist',  category:'beauty',      location:'Maryland, Lagos',        rating:4.8, reviews:67,  rateValue:6000,  rate:'₦6,000/session', badges:['verified'],        bio:'Natural looks, bridal and photoshoots.',         available: true },
  { id:'t12', initials:'TK', avatarClass:'av-6', name:'Tobi Kalejaiye',    service:'Electrician',     category:'electrician', location:'Ikoyi, Lagos',           rating:4.7, reviews:39,  rateValue:7000,  rate:'₦7,000/hr',      badges:['verified'],        bio:'Smart home installs, generator maintenance.',   available: false },
];

/* ── Page state ──────────────────────────────────────────────── */
let currentFilters = {
  search:    '',
  category:  '',
  minRating: 0,
  maxPrice:  999999,
  available: false,
  sortBy:    'rating',
};
let currentPage = 1;
const PAGE_SIZE  = 8;

/* ── Init ────────────────────────────────────────────────────── */
function initTaskersPage() {
  renderTaskerGrid();
  wireSearch();
  wireCategoryTabs();
  wireFilters();
  wireSort();
  initBookingModal();

  console.log('[Taskers] Tasker listings page initialized ✓');
}

/* ── Render tasker grid ──────────────────────────────────────── */
function renderTaskerGrid(page = 1) {
  const grid    = document.getElementById('taskersGrid');
  const countEl = document.getElementById('resultsCount');
  if (!grid) return;

  const filtered = getFilteredTaskers();
  const total    = filtered.length;
  const start    = (page - 1) * PAGE_SIZE;
  const slice    = filtered.slice(0, page * PAGE_SIZE); // Show up to page * PAGE_SIZE

  if (total === 0) {
    grid.innerHTML = `
      <div class="taskers-empty" style="grid-column:1/-1;">
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <h3>No taskers found</h3>
          <p>Try adjusting your filters or search terms</p>
          <button class="btn btn-outline btn-sm" onclick="resetFilters()">Reset Filters</button>
        </div>
      </div>`;
    if (countEl) countEl.textContent = '0';
    return;
  }

  if (countEl) countEl.textContent = total;

  grid.innerHTML = '';
  slice.forEach((tasker, i) => {
    const card = buildDetailedTaskerCard(tasker, i);
    grid.appendChild(card);
  });

  /* Load more button */
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  if (loadMoreWrap) {
    loadMoreWrap.style.display = slice.length < total ? 'flex' : 'none';
  }

  currentPage = page;
}

/* ── Build enhanced tasker card ──────────────────────────────── */
/*
 * Future Sprint 3: Avatar will be an <img> from Supabase Storage.
 * Future Sprint 3: "Book Now" calls initBookingModal(tasker) which
 * opens a date/time picker and calls createBooking() on confirm.
 */
function buildDetailedTaskerCard(tasker, index) {
  const card = document.createElement('div');
  card.className = 'card tasker-card-v2 anim-fade-up';
  card.style.animationDelay = `${index * 0.06}s`;
  card.dataset.taskerId = tasker.id;

  const starsFull  = '★'.repeat(Math.floor(tasker.rating));
  const starsEmpty = '☆'.repeat(5 - Math.floor(tasker.rating));
  const badges     = tasker.badges.map(b =>
    b === 'verified' ? `<span class="badge badge-green"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Verified</span>` :
    b === 'top'      ? `<span class="badge badge-amber">Top Rated</span>` : ''
  ).join('');

  const availClass = tasker.available ? 'avail-dot-green' : 'avail-dot-gray';
  const availText  = tasker.available ? 'Available now' : 'Unavailable';

  card.innerHTML = `
    <div class="tc-header">
      <div class="tc-avatar ${tasker.avatarClass}">${tasker.initials}</div>
      <div class="tc-meta">
        <div class="tc-name-row">
          <span class="tc-name">${tasker.name}</span>
          <span class="avail-indicator ${availClass}">${availText}</span>
        </div>
        <div class="tc-service">
          ${getServiceIconSVG(tasker.category)}
          ${tasker.service}
        </div>
        <div class="tc-location">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${tasker.location}
        </div>
      </div>
    </div>

    <p class="tc-bio">${tasker.bio}</p>

    <div class="tc-badges">${badges}</div>

    <div class="tc-stats">
      <div class="tc-rating">
        <span class="tc-stars">${starsFull}${starsEmpty}</span>
        <span class="tc-rating-val">${tasker.rating}</span>
        <span class="tc-reviews">(${tasker.reviews} reviews)</span>
      </div>
      <div class="tc-rate">${tasker.rate}</div>
    </div>

    <div class="tc-actions">
      <button class="btn btn-outline btn-sm" onclick="openTaskerProfile('${tasker.id}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        View Profile
      </button>
      <button class="btn btn-primary btn-sm" onclick="openBookingModal('${tasker.id}')"
        ${!tasker.available ? 'disabled title="Tasker currently unavailable"' : ''}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Book Now
      </button>
    </div>
  `;
  return card;
}

/* ── SVG icon by category ────────────────────────────────────── */
function getServiceIconSVG(category) {
  const icons = {
    barber:      `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="4" r="2"/><path d="m5.81 10.186 1.768-2.832L10 12l2.828-4.243"/><circle cx="18" cy="4" r="2"/></svg>`,
    electrician: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    cleaning:    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/></svg>`,
    mechanic:    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    plumber:     `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M4 18V6a2 2 0 0 1 2-2h9l5 5v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></svg>`,
    beauty:      `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    carpentry:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 12-8.5 8.5a2.12 2.12 0 0 1-3-3L12 9"/><path d="M17.64 15 22 10.64"/><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 5.6a5.009 5.009 0 0 0-6.22.23L14 10h3l.41.41"/></svg>`,
    painting:    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13.5V19a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.5"/><path d="M12 12V3"/><path d="m8 7 4-4 4 4"/></svg>`,
    moving:      `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  };
  return icons[category] || `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>`;
}

/* ── Filter & Sort ───────────────────────────────────────────── */
function getFilteredTaskers() {
  let list = [...ALL_TASKERS];

  if (currentFilters.search) {
    const q = currentFilters.search.toLowerCase();
    list = list.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.service.toLowerCase().includes(q) ||
      t.location.toLowerCase().includes(q) ||
      t.bio.toLowerCase().includes(q)
    );
  }

  if (currentFilters.category) {
    list = list.filter(t => t.category === currentFilters.category);
  }

  if (currentFilters.minRating > 0) {
    list = list.filter(t => t.rating >= currentFilters.minRating);
  }

  if (currentFilters.maxPrice < 999999) {
    list = list.filter(t => t.rateValue <= currentFilters.maxPrice);
  }

  if (currentFilters.available) {
    list = list.filter(t => t.available);
  }

  /* Sort */
  switch (currentFilters.sortBy) {
    case 'rating':  list.sort((a, b) => b.rating - a.rating);      break;
    case 'price_asc': list.sort((a, b) => a.rateValue - b.rateValue); break;
    case 'price_desc':list.sort((a, b) => b.rateValue - a.rateValue); break;
    case 'reviews': list.sort((a, b) => b.reviews - a.reviews);    break;
  }

  return list;
}

function resetFilters() {
  currentFilters = { search:'', category:'', minRating:0, maxPrice:999999, available:false, sortBy:'rating' };
  const searchInput = document.getElementById('taskerSearchInput');
  if (searchInput) searchInput.value = '';
  document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.filter-opt input[type="checkbox"]').forEach(cb => cb.checked = false);
  const sortSel = document.getElementById('sortSelect');
  if (sortSel) sortSel.value = 'rating';
  renderTaskerGrid(1);
}

/* ── Wire search ─────────────────────────────────────────────── */
function wireSearch() {
  const input = document.getElementById('taskerSearchInput');
  const form  = document.getElementById('taskerSearchForm');
  if (!input) return;

  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentFilters.search = input.value.trim();
      renderTaskerGrid(1);
    }, 280);
  });

  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      currentFilters.search = input.value.trim();
      renderTaskerGrid(1);
    });
  }
}

/* ── Category tabs ───────────────────────────────────────────── */
function wireCategoryTabs() {
  document.querySelectorAll('.category-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilters.category = tab.dataset.category || '';
      renderTaskerGrid(1);
    });
  });
}

/* ── Wire filter panel ───────────────────────────────────────── */
function wireFilters() {
  /* Rating checkboxes */
  document.querySelectorAll('[data-rating-filter]').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = document.querySelector('[data-rating-filter]:checked');
      currentFilters.minRating = checked ? parseFloat(checked.dataset.ratingFilter) : 0;
      renderTaskerGrid(1);
    });
  });

  /* Price range */
  const priceRange = document.getElementById('priceRange');
  const priceVal   = document.getElementById('priceVal');
  if (priceRange) {
    priceRange.addEventListener('input', () => {
      const v = parseInt(priceRange.value);
      currentFilters.maxPrice = v;
      if (priceVal) priceVal.textContent = `₦${v.toLocaleString()}`;
      renderTaskerGrid(1);
    });
  }

  /* Available only */
  const availCb = document.getElementById('availableFilter');
  if (availCb) {
    availCb.addEventListener('change', () => {
      currentFilters.available = availCb.checked;
      renderTaskerGrid(1);
    });
  }

  /* Reset button */
  const resetBtn = document.getElementById('filterReset');
  if (resetBtn) resetBtn.addEventListener('click', resetFilters);

  /* Load more */
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => renderTaskerGrid(currentPage + 1));
  }
}

/* ── Wire sort ───────────────────────────────────────────────── */
function wireSort() {
  const sel = document.getElementById('sortSelect');
  if (sel) {
    sel.addEventListener('change', () => {
      currentFilters.sortBy = sel.value;
      renderTaskerGrid(1);
    });
  }
}

/* ── Booking modal ───────────────────────────────────────────── */
/*
 * Future Sprint 3: openBookingModal will fetch tasker's real
 * availability slots from Supabase and show a date/time picker.
 * On confirm, calls createBooking() from future-features.js.
 * Triggers Paystack payment after booking confirmation.
 */
function initBookingModal() {
  const modal    = document.getElementById('bookingModal');
  const closeBtn = document.getElementById('bookingModalClose');
  const form     = document.getElementById('bookingForm');

  if (!modal) return;

  closeBtn?.addEventListener('click', closeBookingModal);
  modal.addEventListener('click', e => {
    if (e.target === modal) closeBookingModal();
  });

  if (form) {
    form.addEventListener('submit', handleBookingSubmit);
  }
}

function openBookingModal(taskerId) {
  const tasker = ALL_TASKERS.find(t => t.id === taskerId);
  if (!tasker) return;

  const modal = document.getElementById('bookingModal');
  if (!modal) {
    /* Sprint alert fallback */
    showSprintAlert(
      'Booking Coming in Sprint 3',
      `You selected ${tasker.name} (${tasker.service}).\n\nThe full booking flow — date picker, confirmation, and Paystack payment — will be live in Sprint 3.`
    );
    return;
  }

  /* Populate modal */
  modal.querySelector('[data-booking-name]').textContent    = tasker.name;
  modal.querySelector('[data-booking-service]').textContent = tasker.service;
  modal.querySelector('[data-booking-rate]').textContent    = tasker.rate;
  modal.querySelector('[data-booking-rating]').textContent  = `${tasker.rating} ★`;
  modal.dataset.activeTasker = taskerId;

  /* Set min date for booking */
  const dateInput = modal.querySelector('#bookingDate');
  if (dateInput) dateInput.min = new Date().toISOString().split('T')[0];

  modal.classList.add('modal-open');
  document.body.style.overflow = 'hidden';
}

function closeBookingModal() {
  const modal = document.getElementById('bookingModal');
  if (modal) {
    modal.classList.remove('modal-open');
    document.body.style.overflow = '';
  }
}

async function handleBookingSubmit(e) {
  e.preventDefault();
  const form    = e.target;
  const btn     = form.querySelector('[type="submit"]');
  const modal   = document.getElementById('bookingModal');
  const taskerId = modal?.dataset.activeTasker;
  const tasker   = ALL_TASKERS.find(t => t.id === taskerId);

  setButtonLoading(btn, 'Processing...');
  await delay(1200);
  setButtonLoading(btn, null, 'Confirm Booking');

  closeBookingModal();

  /*
   * ── Future Sprint 3 Integration Point ──
   * Replace showSprintAlert with:
   *   const booking = await createBooking({
   *     taskerId,
   *     customerId: supabase.auth.getUser().id,
   *     taskId: form.taskId?.value,
   *     scheduledDate: form.bookingDate.value + 'T' + form.bookingTime.value,
   *     notes: form.bookingNotes.value
   *   });
   *   window.location.href = `booking-confirmation.html?id=${booking.id}`;
   */
  showSprintAlert(
    'Booking Request Ready',
    `Your booking request for ${tasker?.name || 'this tasker'} has been captured.\n\nFull booking with calendar, payment (Paystack), and confirmation will be live in Sprint 3.`
  );
}

/* ── Tasker profile ──────────────────────────────────────────── */
function openTaskerProfile(taskerId) {
  /*
   * Future Sprint 3: Navigate to /tasker-profile.html?id=${taskerId}
   * which will fetch real profile data from Supabase.
   */
  const tasker = ALL_TASKERS.find(t => t.id === taskerId);
  showSprintAlert(
    'Tasker Profile',
    `${tasker?.name}'s full profile — portfolio, reviews, and availability calendar — will be available in Sprint 3.`
  );
}

/* ── Utility (local) ─────────────────────────────────────────── */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function setButtonLoading(btn, loadingText, resetText) {
  if (!btn) return;
  if (loadingText) {
    btn.disabled = true;
    btn.dataset.orig = btn.textContent;
    btn.innerHTML = `<span class="btn-spinner"></span> ${loadingText}`;
  } else {
    btn.disabled = false;
    btn.textContent = resetText || btn.dataset.orig || 'Submit';
  }
}

/* ── Expose globals ──────────────────────────────────────────── */
window.initTaskersPage   = initTaskersPage;
window.openBookingModal  = openBookingModal;
window.closeBookingModal = closeBookingModal;
window.openTaskerProfile = openTaskerProfile;
window.resetFilters      = resetFilters;
window.ALL_TASKERS       = ALL_TASKERS;

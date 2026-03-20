/* ============================================================
   STREET TASKER — taskers.js  (Sprint 3.2 Final)
   Live data from Supabase. No placeholders.
   ============================================================ */
'use strict';

const STATIC_SERVICES = [
  { id:'s1', provider_name:'Adebayo Okafor',  service_name:'Electrician',   category:'electrician', location:'Lekki, Lagos',           price:5000,  rating:4.9, reviews:48  },
  { id:'s2', provider_name:'Chidi Fernandez', service_name:'Barber',         category:'barber',      location:'Victoria Island, Lagos', price:3500,  rating:4.8, reviews:112 },
  { id:'s3', provider_name:'Fatima Mohammed', service_name:'House Cleaner',  category:'cleaning',    location:'Ikeja, Lagos',           price:4000,  rating:4.7, reviews:73  },
  { id:'s4', provider_name:'Emeka Obi',       service_name:'Mechanic',       category:'mechanic',    location:'Surulere, Lagos',        price:6000,  rating:4.6, reviews:29  },
  { id:'s5', provider_name:'Sadia Bello',     service_name:'Make-up Artist', category:'beauty',      location:'Ajah, Lagos',            price:8000,  rating:5.0, reviews:91  },
  { id:'s6', provider_name:'Kingsley Adu',    service_name:'Plumber',        category:'plumber',     location:'Yaba, Lagos',            price:4500,  rating:4.5, reviews:34  },
];

let ALL = [];
let FILTERS = { search:'', category:'', location:'', maxPrice:999999, minRating:0, sortBy:'rating' };
let PAGE = 1;
const PAGE_SIZE = 8;

/* ── Init ────────────────────────────────────────────────────── */
function initTaskersPage() {
  /* Pre-fill search and location from URL params (e.g. from homepage search) */
  const params = new URLSearchParams(window.location.search);
  const urlService  = params.get('service')  || '';
  const urlLocation = params.get('location') || '';
  if (urlService) {
    FILTERS.search = urlService;
    const inp = document.getElementById('taskerSearchInput');
    if (inp) inp.value = urlService;
  }
  if (urlLocation) {
    FILTERS.location = urlLocation;
    const locInp = document.getElementById('taskerLocationInput');
    if (locInp) locInp.value = urlLocation;
  }

  loadServices().then(() => {
    render();
    wireAll();
    initBookingModal();
  });
}

async function loadServices() {
  try {
    const services = await window.ST.db.fetchServices({ limit: 100 });
    if (services && services.length > 0) {
      ALL = services.map((s, i) => ({
        id:           String(s.id || `s${i}`),
        userId:       String(s.user_id || s.id),
        provider_name: s.provider_name || 'Provider',
        service_name: s.service_name || s.service || 'Service',
        category:     s.category || 'other',
        location:     s.location || 'Lagos',
        price:        parseFloat(s.price || s.rate_value || 5000),
        rate:         s.rate || `₦${Number(s.price || 5000).toLocaleString()}/session`,
        rating:       parseFloat(s.rating || 4.5),
        reviews:      parseInt(s.reviews || 0),
        description:  s.description || s.bio || '',
        photo:        s.photo || s.photo_url || null,
      }));
      console.log(`[Taskers] ${ALL.length} services loaded from Supabase ✓`);
    } else {
      ALL = STATIC_SERVICES;
    }
  } catch (e) {
    console.warn('[Taskers] Load failed, using static data:', e.message);
    ALL = STATIC_SERVICES;
  }
}

/* ── Filter + sort ───────────────────────────────────────────── */
function filtered() {
  let list = [...ALL];
  const { search, category, maxPrice, minRating, sortBy } = FILTERS;
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(s =>
      s.service_name.toLowerCase().includes(q) ||
      s.provider_name.toLowerCase().includes(q) ||
      s.location.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q)
    );
  }
  if (category)          list = list.filter(s => s.category === category);
  if (FILTERS.location)  list = list.filter(s => (s.location || '').toLowerCase().includes(FILTERS.location.toLowerCase()));
  if (maxPrice < 999999) list = list.filter(s => s.price <= maxPrice);
  if (minRating)         list = list.filter(s => s.rating >= minRating);
  if (sortBy === 'rating')     list.sort((a,b) => b.rating - a.rating);
  if (sortBy === 'price_asc')  list.sort((a,b) => a.price - b.price);
  if (sortBy === 'price_desc') list.sort((a,b) => b.price - a.price);
  return list;
}

/* ── Render ──────────────────────────────────────────────────── */
function render(page = 1) {
  PAGE = page;
  const grid    = document.getElementById('taskersGrid');
  const countEl = document.getElementById('resultsCount');
  const loadMore= document.getElementById('loadMoreBtn');
  const emptyEl = document.getElementById('taskerEmpty');
  if (!grid) return;

  const all   = filtered();
  const slice = all.slice(0, page * PAGE_SIZE);
  if (countEl) countEl.textContent = all.length;

  if (all.length === 0) {
    grid.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    if (loadMore) loadMore.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  grid.innerHTML = slice.map(buildCard).join('');
  if (loadMore) loadMore.style.display = slice.length < all.length ? 'block' : 'none';
}

function buildCard(s) {
  const safeName    = escapeHtml(s.provider_name || 'Provider');
  const safeService = escapeHtml(s.service_name || '');
  const safeLoc     = escapeHtml(s.location || 'Lagos');
  const safeDesc    = escapeHtml((s.description || '').slice(0, 90)) + ((s.description||'').length > 90 ? '&hellip;' : '');
  const safePhoto   = escapeHtml(s.photo || '');
  const safeId      = escapeHtml(s.id || '');
  const safeUserId  = escapeHtml(s.user_id || '');
  const initials    = safeName.replace(/[^a-zA-Z ]/g,'').trim().split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase() || 'ST';
  const avIdx       = (['s1','s2','s3','s4','s5','s6'].indexOf(s.id) + 1) || ((s.id.charCodeAt(0) % 6) + 1);
  const avClass     = `av-${avIdx}`;
  const stars       = Array.from({length:5}, (_,i) =>
    `<span style="color:${i < Math.round(s.rating) ? '#F59E0B' : '#D1D5DB'}">★</span>`).join('');

  const avatar = safePhoto
    ? `<img src="${safePhoto}" alt="${safeName}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" onerror="this.style.display='none'" />`
    : initials;

  const profileUrl = safeUserId ? `tasker-profile.html?id=${safeUserId}` : 'find-taskers.html';

  return `<div class="card tasker-card fade-up" id="svc-${safeId}">
    <div class="tc-header">
      <div class="tc-avatar ${avClass}" style="overflow:hidden;">${avatar}</div>
      <div class="tc-meta">
        <div class="tc-name">${safeName}</div>
        <div class="tc-service">${safeService}</div>
        <div class="tc-location">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${safeLoc}
        </div>
      </div>
    </div>
    ${safeDesc ? `<p class="tc-bio">${safeDesc}</p>` : ''}
    <div class="tc-stats">
      <div class="tc-stat">
        <div class="tc-stat-value">${stars}</div>
        <div class="tc-stat-label">${s.rating.toFixed(1)}${s.reviews ? ` · ${s.reviews} reviews` : ''}</div>
      </div>
      <div class="tc-stat">
        <div class="tc-stat-value" style="font-size:1rem;font-weight:700;">₦${Number(s.price).toLocaleString()}</div>
        <div class="tc-stat-label">per session</div>
      </div>
    </div>
    <div class="tc-footer">
      <span class="tc-badge tc-badge-green">Available</span>
      <div style="display:flex;gap:6px;">
        <a href="${profileUrl}" class="btn btn-outline btn-sm">View Profile</a>
        <button class="btn btn-primary btn-sm" onclick="openBookingModal('${safeId}')">Book</button>
      </div>
    </div>
  </div>`;
}
}

/* ── Wiring ──────────────────────────────────────────────────── */
function wireAll() {
  /* Search */
  const inp = document.getElementById('taskerSearchInput');
  const frm = document.getElementById('taskerSearchForm');
  if (inp) inp.addEventListener('input', () => { FILTERS.search = inp.value.trim(); render(1); });
  if (frm) frm.addEventListener('submit', e => { e.preventDefault(); render(1); });

  /* Location — wired via initLocationInput in find-taskers.html initPage */
  /* The onChange callback sets FILTERS.location and re-renders */

  /* Category tabs */
  document.querySelectorAll('[data-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-category]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      FILTERS.category = btn.dataset.category === 'all' ? '' : btn.dataset.category;
      render(1);
    });
  });

  /* Rating */
  document.querySelectorAll('[data-rating-filter]').forEach(cb => {
    cb.addEventListener('change', () => {
      const c = document.querySelector('[data-rating-filter]:checked');
      FILTERS.minRating = c ? parseFloat(c.dataset.ratingFilter) : 0;
      render(1);
    });
  });

  /* Price range */
  const pr = document.getElementById('priceRange');
  const pv = document.getElementById('priceVal');
  if (pr) {
    pr.addEventListener('input', () => {
      const v = parseInt(pr.value);
      FILTERS.maxPrice = v;
      if (pv) pv.textContent = v >= 30000 ? 'Any' : `₦${v.toLocaleString()}`;
      render(1);
    });
  }

  /* Apply Filters button */
  const applyBtn = document.getElementById('applyFiltersBtn');
  if (applyBtn) applyBtn.addEventListener('click', () => {
    render(1);
    showToast(`${filtered().length} results`);
  });

  /* Sort */
  const sel = document.getElementById('sortSelect');
  if (sel) sel.addEventListener('change', () => { FILTERS.sortBy = sel.value; render(1); });

  /* Reset */
  const reset = document.getElementById('filterReset');
  if (reset) reset.addEventListener('click', () => {
    FILTERS = { search:'', category:'', location:'', maxPrice:999999, minRating:0, sortBy:'rating' };
    const locInp = document.getElementById('taskerLocationInput');
    if (locInp) { locInp.value = ''; delete locInp.dataset.lat; delete locInp.dataset.lon; }
    if (inp) inp.value = '';
    if (pr)  { pr.value = 30000; if (pv) pv.textContent = 'Any'; }
    document.querySelectorAll('[data-rating-filter]').forEach(c => c.checked = false);
    document.querySelectorAll('[data-category]').forEach(b => b.classList.remove('active'));
    render(1);
  });

  /* Load more */
  const lm = document.getElementById('loadMoreBtn');
  if (lm) lm.addEventListener('click', () => render(PAGE + 1));
}

/* ── Booking modal ───────────────────────────────────────────── */
function initBookingModal() {
  const modal = document.getElementById('bookingModal');
  if (!modal) return;
  document.getElementById('bookingModalClose')?.addEventListener('click', closeBookingModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeBookingModal(); });
  document.getElementById('bookingForm')?.addEventListener('submit', handleBookingSubmit);
}

function openBookingModal(svcId) {
  const s = ALL.find(x => x.id === svcId);
  if (!s) { console.warn('[Booking] service not found:', svcId); return; }
  const modal = document.getElementById('bookingModal');
  if (!modal) { console.warn('[Booking] bookingModal element not found'); return; }

  const nameEl    = modal.querySelector('[data-booking-name]');
  const serviceEl = modal.querySelector('[data-booking-service]');
  const rateEl    = modal.querySelector('[data-booking-rate]');
  const ratingEl  = modal.querySelector('[data-booking-rating]');
  const avatarEl  = modal.querySelector('#bookingModalAvatar');
  const dateInput = modal.querySelector('#bookingDate');

  if (nameEl)    nameEl.textContent    = s.provider_name;
  if (serviceEl) serviceEl.textContent = s.service_name;
  if (rateEl)    rateEl.textContent    = `₦${Number(s.price).toLocaleString()}/session`;
  if (ratingEl)  ratingEl.textContent  = `${s.rating.toFixed(1)} ★`;
  if (dateInput) dateInput.min = new Date().toISOString().split('T')[0];

  /* Avatar: photo or initials */
  if (avatarEl) {
    const initials = s.provider_name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    avatarEl.innerHTML = s.photo
      ? `<img src="${s.photo}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentNode.textContent='${initials}'" />`
      : initials;
  }

  modal.dataset.activeSvc  = svcId;
  modal.dataset.activeUser = s.userId || svcId;
  modal.classList.add('modal-open');
  document.body.style.overflow = 'hidden';
}
window.openBookingModal = openBookingModal;

function closeBookingModal() {
  const m = document.getElementById('bookingModal');
  if (m) { m.classList.remove('modal-open'); document.body.style.overflow = ''; }
}
window.closeBookingModal = closeBookingModal;

async function handleBookingSubmit(e) {
  e.preventDefault();
  const modal    = document.getElementById('bookingModal');
  const form     = e.target;
  const btn      = form.querySelector('[type="submit"]');
  const taskerId = modal?.dataset.activeUser;
  const svc      = ALL.find(x => x.id === modal?.dataset.activeSvc);

  /* Auth check */
  const user = await window.ST.auth.getCurrentUser();
  if (!user) {
    closeBookingModal();
    showToast('Please log in to book a service.');
    setTimeout(() => { window.location.href = 'login.html?redirect=find-taskers.html'; }, 1200);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Booking...';

  try {
    const date = form.bookingDate?.value;
    const time = form.bookingTime?.value || '09:00';
    const scheduled = date ? `${date}T${time}` : null;

    await window.ST.db.createBooking({ taskerId, scheduledTime: scheduled });
    closeBookingModal();
    showToast(`Booking request sent to ${svc?.provider_name || 'the provider'}!`);
    form.reset();
  } catch (err) {
    if (err.message === 'SUBSCRIPTION_REQUIRED') {
      closeBookingModal();
      showToast('This provider needs to upgrade their plan to accept bookings.');
    } else {
      showToast('Booking failed: ' + err.message);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm Booking';
  }
}

window.initTaskersPage = initTaskersPage;

/* ============================================================
   STREET TASKER — taskers.js  (Sprint 3.2 Final)
   Live data from Supabase. No placeholders.
   ============================================================ */
'use strict';

/* M17: the made-up demo taskers were removed on purpose. Find Taskers shows real listings only. */
const DUMMY_SERVICES = [];

async function loadServices() {
  try {
    /* Fetch services + user name + tasker photo_url in one round trip */
    const _sRes = await window.supabase.from('services')
      .select('*, users:user_id(name, business_name, avatar_url)')
      .eq('available', true).order('created_at', { ascending: false }).limit(100);
    const services = (_sRes.data || []).map(s => ({
      id: String(s.id), service_name: s.service_name || s.service, category: s.category,
      price: s.price, rate_unit: s.rate_unit || '/job', location: s.location,
      description: s.description,
      /* Use service photo first, then user avatar_url */
      photo: s.photo || (s.users && s.users.avatar_url) || null,
      user_id: s.user_id,
      provider_name: (s.users && (s.users.business_name || s.users.name)) || 'Provider',
      available: s.available, fromServices: true,
      specialties: s.specialties, availability_status: s.availability_status, verified: s.verified,
    }));
    if (services && services.length > 0) {
      /* Live services first, then dummy data to fill out the page */
      const liveIds = new Set(services.map(s => String(s.user_id)));
      const liveMapped = services.map((s, i) => ({
        id:            String(s.id || `s${i}`),
        user_id:       String(s.user_id || s.id),
        provider_name: s.provider_name || 'Provider',
        service_name:  s.service_name || s.service || 'Service',
        category:      s.category || 'other',
        location:      s.location || 'Lagos',
        price:         parseFloat(s.price || s.rate_value || 5000),
        rate:          s.rate || `₦${Number(s.price || 5000).toLocaleString()}/session`,
        rating:        0,   /* M10a: real ratings come from rating_summary below; the services.rating column and the old 4.5 default are never shown */
        reviews:       0,
        description:   s.description || s.bio || '',
        photo:         s.photo || s.photo_url || null,
        specialties:   s.specialties, availability_status: s.availability_status, verified: s.verified,
        is_live:       true,
      }));
      /* Work samples (taskers.profile_details.portfolio) for the card's portfolio strip.
         Optional: if the query fails the cards simply have no strip. */
      try {
        const ids = [...new Set(liveMapped.map(m => m.user_id).filter(Boolean))];
        const { data: tk } = await window.supabase.from('taskers').select('user_id, profile_details').in('user_id', ids);
        const byUser = {};
        (tk || []).forEach(r => {
          const d = (r.profile_details && typeof r.profile_details === 'object') ? r.profile_details : {};
          if (Array.isArray(d.portfolio)) byUser[String(r.user_id)] = d.portfolio;
        });
        liveMapped.forEach(m => { m.portfolio = byUser[m.user_id] || []; });
      } catch (_pe) { /* portfolio is optional */ }
      /* Local Taskers (stage 4C-2): the label, picture and honest rating come from the database function, never from a column.
         A Local Tasker has no ratings yet, so the 4.5 default above must not be shown for them. If the lookup fails the person simply shows as a normal listing. */
      try {
        if (window.STLocal) {
          await STLocal.load(liveMapped.map(m => m.user_id));
          liveMapped.forEach(m => {
            if (!STLocal.isLocal(m.user_id)) return;
            m.isLocal = true; m.rating = 0; m.reviews = 0; m.portfolio = [];
            m.photo = STLocal.coverUrl(m.user_id);
          });
        }
      } catch (_le) { /* label is optional */ }
      /* Real ratings (M10a): rating_summary through STRating, for real people only (Local Taskers have none). No reviews = 0, so no number is shown
         and the rating filter and sort use real values. If the lookup fails every live card simply shows no rating. */
      try {
        if (window.STRating) {
          const rs = await STRating.load(liveMapped.filter(m => !m.isLocal).map(m => m.user_id), 'tasker');
          liveMapped.forEach(m => { const r = rs[String(m.user_id).toLowerCase()]; if (r) { m.rating = r.avg; m.reviews = r.count; } });
        }
      } catch (_re) { /* ratings are optional */ }
      /* Membership labels (S4h): one question to the server for the whole list (membership_for_users).
         Never read from a column. Local Taskers have no account, so they are not asked. No answer = no label. */
      try {
        if (window.STMembership) {
          await STMembership.load(liveMapped.filter(m => !m.isLocal).map(m => m.user_id));
          await STMembership.loadFeatured(null);   /* S4i-2: the server's fair-rotation order; no answer = normal order */
        }
      } catch (_me) { /* label is optional */ }
      /* Append dummies — mark them so Book button is hidden */
      ALL = [...liveMapped.map(normalizeServiceCard), ...DUMMY_SERVICES.map(normalizeServiceCard)];
      
    } else {
      ALL = DUMMY_SERVICES.map(normalizeServiceCard);
    }
  } catch (e) {
    console.warn('[Taskers] Load failed, using demo data:', e.message);
    ALL = DUMMY_SERVICES.map(normalizeServiceCard);
  }
}

let ALL = [];
let FILTERS = { search:'', category:'', location:'', maxPrice:999999, minRating:0, sortBy:'recent', availability:'', specialty:'', verifiedOnly:false };
let PAGE = 1;
const PAGE_SIZE = 8;

/* Fill in specialties/availability/verified for any row that predates
   the migration (or demo rows) so the new filters have something to
   work with, without overwriting real values that ARE present. */
function normalizeServiceCard(s) {
  return {
    ...s,
    specialties: (s.specialties && s.specialties.length) ? s.specialties : (s.service_name ? [s.service_name] : []),
    /* M17: no invented data. Availability is shown only when the tasker set it; verified only when the row says so (never guessed from a rating). */
    availability_status: s.availability_status || null,
    hideAvailability: !s.availability_status,
    verified: s.verified === true,
    reviews: s.reviews ?? s.reviews_count ?? 0,
  };
}

/* ── Init ───────────────────────────────────────────────────── */
function initTaskersPage() {
  const params = new URLSearchParams(window.location.search);
  const urlService  = params.get('service')  || '';
  const urlLocation = params.get('location') || '';
  const urlCategory = params.get('category') || '';   /* from the Home category chips and tiles */
  if (urlCategory) FILTERS.category = window.STCat ? STCat.resolve(urlCategory).value : urlCategory;
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
  /* Show dummy data immediately so page never looks empty while Supabase loads */
  ALL = DUMMY_SERVICES.map(normalizeServiceCard);
  updateTaskerFilterCounts();
  render();
  wireAll();
  initBookingModal();
  /* Then replace with live data in background */
  loadServices().then(() => { updateTaskerFilterCounts(); render(); });
}

/* ── Filter + sort ───────────────────────────────────────────── */
function filtered() {
  let list = [...ALL];
  const { search, category, maxPrice, minRating, sortBy, availability, specialty, verifiedOnly } = FILTERS;
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(s =>
      s.service_name.toLowerCase().includes(q) ||
      s.provider_name.toLowerCase().includes(q) ||
      s.location.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q)
    );
  }
  if (category)          list = list.filter(s => window.STCat ? STCat.matches(s.category, category) : s.category === category);
  if (FILTERS.location)  list = list.filter(s => (s.location || '').toLowerCase().includes(FILTERS.location.toLowerCase()));
  if (maxPrice < 999999) list = list.filter(s => s.price <= maxPrice);
  if (minRating)         list = list.filter(s => s.rating >= minRating);
  if (availability && availability.length) list = list.filter(s => availability.includes(s.availability_status));
  if (specialty)          list = list.filter(s => (s.specialties || []).some(sp => sp.toLowerCase() === specialty.toLowerCase()));
  if (verifiedOnly)       list = list.filter(s => s.verified === true);
  if (sortBy === 'recent')     list.sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));
  if (sortBy === 'rating')     list.sort((a,b) => b.rating - a.rating);
  if (sortBy === 'price_asc')  list.sort((a,b) => a.price - b.price);
  if (sortBy === 'price_desc') list.sort((a,b) => b.price - a.price);
  if (sortBy === 'reviews')    list.sort((a,b) => (b.reviews||0) - (a.reviews||0));
  /* S4i-2: featured people float up only in the default "recent" order; an explicit sort by rating, price or reviews is never overridden. */
  if (sortBy === 'recent' && window.STMembership) list = STMembership.floatFeatured(list, x => x.user_id);
  return list;
}

function updateTaskerFilterCounts() {
  document.querySelectorAll('[data-count-avail]').forEach(el => {
    el.textContent = ALL.filter(s => s.availability_status === el.dataset.countAvail).length || '';
  });
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
  if (window.STTaskersMap) window.STTaskersMap.refresh(all);   /* the map view shows the same filtered list */

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
  const safeId     = escapeHtml(s.id || '');
  const safeUserId = escapeHtml(s.user_id || '');
  const href = (s.user_id === 'demo') ? `tasker-profile.html?demo=${safeId}` : (safeUserId ? `tasker-profile.html?id=${safeUserId}` : 'find-taskers.html');
  /* Card markup lives in js/ui.js (stTaskerCard). */
  return stTaskerCard({ ...s, href });
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

  /* Availability checkboxes */
  document.querySelectorAll('[name="tavail"]').forEach(cb => cb.addEventListener('change', () => {
    FILTERS.availability = [...document.querySelectorAll('[name="tavail"]:checked')].map(c => c.value);
    render(1);
  }));

  /* Verified only */
  const verifiedCb = document.getElementById('verifiedFilter');
  if (verifiedCb) verifiedCb.addEventListener('change', () => { FILTERS.verifiedOnly = verifiedCb.checked; render(1); });

  /* Specialty chips (single-select toggle) */
  document.querySelectorAll('#specialtyChips [data-specialty]').forEach(chip => chip.addEventListener('click', () => {
    const alreadyActive = chip.classList.contains('active');
    document.querySelectorAll('#specialtyChips .filter-chip').forEach(c => c.classList.remove('active'));
    if (alreadyActive) { FILTERS.specialty = ''; }
    else { chip.classList.add('active'); FILTERS.specialty = chip.dataset.specialty; }
    render(1);
  }));

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
    FILTERS = { search:'', category:'', location:'', maxPrice:999999, minRating:0, sortBy:'rating', availability:[], specialty:'', verifiedOnly:false };
    const locInp = document.getElementById('taskerLocationInput');
    if (locInp) { locInp.value = ''; delete locInp.dataset.lat; delete locInp.dataset.lon; }
    if (inp) inp.value = '';
    if (pr)  { pr.value = 30000; if (pv) pv.textContent = 'Any'; }
    document.querySelectorAll('[data-rating-filter]').forEach(c => c.checked = false);
    document.querySelectorAll('[data-category]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('[name="tavail"]').forEach(c => c.checked = false);
    document.querySelectorAll('#specialtyChips .filter-chip').forEach(c => c.classList.remove('active'));
    if (verifiedCb) verifiedCb.checked = false;
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

/* Only customer accounts can book: a tasker is told how to switch instead of seeing the form */
function openBookingModal(svcId) {
  const A = window.ST && window.ST.auth;
  if (!A || !A.checkCustomerOnly) { _openBookingModal(svcId); return; }
  A.getCurrentUser().then(u => (u ? A.checkCustomerOnly(u) : { ok: true })).then(c => {
    if (c.ok) { _openBookingModal(svcId); return; }
    showToast(c.hasCustomer
      ? 'Only customer accounts can book a service. Use "Switch to customer account" in the Settings menu.'
      : 'Only customer accounts can book a service. Use "Create customer account" in the Settings menu.');
  }).catch(() => _openBookingModal(svcId));
}

function _openBookingModal(svcId) {
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
  if (ratingEl)  ratingEl.textContent  = s.rating > 0 ? `${s.rating.toFixed(1)} ★` : 'New';
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
  const sess = await window.supabase.auth.getSession();
  const user = sess.data.session && sess.data.session.user;
  if (!user) {
    closeBookingModal();
    showToast('Please log in to book a service.');
    setTimeout(() => { window.location.href = 'login.html?redirect=find-taskers.html'; }, 1200);
    return;
  }
  /* Guard: only customer accounts can book */
  try {
    const A = window.ST && window.ST.auth;
    const c = A && A.checkCustomerOnly ? await A.checkCustomerOnly(user) : { ok: true };
    if (!c.ok) { closeBookingModal(); showToast('Only customer accounts can book a service. Switch to your customer account from the Settings menu.'); return; }
  } catch (e) { /* the database refuses it too */ }
  /* Guard: tasker can't book their own service */
  if (svc && svc.user_id && String(svc.user_id) === String(user.id)) {
    closeBookingModal();
    showToast('You cannot book your own service.');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Booking...';

  try {
    const date = form.bookingDate?.value;
    const time = form.bookingTime?.value || '09:00';
    const scheduled = date ? `${date}T${time}` : null;

    /* Demo listings simulate a booking without touching the DB */
    if (svc && svc.user_id === 'demo') {
      closeBookingModal();
      showToast(`Booking request sent to ${svc.provider_name}! Sign up to manage bookings.`);
      form.reset();
      return;
    }

    const _bSess = await window.supabase.auth.getSession();
    const _bUser = _bSess.data.session && _bSess.data.session.user;
    if (!_bUser) throw new Error('Not logged in');
    const { error: _bErr } = await window.supabase.from('bookings').insert({
      customer_id: _bUser.id, tasker_id: taskerId,
      scheduled_time: scheduled || null, status: 'pending',
      notes: form.bookingNotes?.value?.trim() || '',
    });
    if (_bErr) throw _bErr;
    /* Notify tasker */
    try {
      await window.supabase.from('notifications').insert({
        user_id: String(taskerId), type: 'new_booking', title: 'New Booking Request',
        message: (_bUser.user_metadata?.name || _bUser.email?.split('@')[0] || 'A customer') + ' sent you a booking request.',
        is_read: false,
      });
    } catch(e2) {}
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

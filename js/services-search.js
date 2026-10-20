/* ============================================================
   STREET TASKER — services-search.js
   Powers find-services.html: lists services that taskers have
   posted through post-service.html, with service-specific filters
   (category, charging unit, rate, availability, specialties).
   Live data only — no demo rows.
   ============================================================ */
'use strict';

/* Same category values as the post-service.html dropdown */
const SVC_CATEGORIES = [
  { value: 'barber',      label: 'Barber / Hair',     emoji: '💈' },
  { value: 'electrician', label: 'Electrician',       emoji: '⚡' },
  { value: 'cleaning',    label: 'House Cleaning',    emoji: '🧹' },
  { value: 'mechanic',    label: 'Mechanic / Auto',   emoji: '🔧' },
  { value: 'plumber',     label: 'Plumber',           emoji: '🚰' },
  { value: 'beauty',      label: 'Make-up / Beauty',  emoji: '💄' },
  { value: 'carpentry',   label: 'Carpentry',         emoji: '🪚' },
  { value: 'painting',    label: 'Painting',          emoji: '🎨' },
  { value: 'moving',      label: 'Moving / Delivery', emoji: '📦' },
  { value: 'other',       label: 'Other',             emoji: '🛠️' },
];
const SVC_KNOWN = new Set(SVC_CATEGORIES.map(c => c.value));
const SVC_UNIT_LABEL = { hour: 'Per hour', job: 'Per job', day: 'Per day', session: 'Per session', visit: 'Per visit', week: 'Per week', month: 'Per month' };
const SVC_AVAIL_LABEL = { available_now: 'Available now', available_today: 'Available today', available_this_week: 'Available this week' };
const SVC_PRICE_MAX = 200000;   /* slider max = "Any" */
const SVC_PAGE_SIZE = 9;

let SVC_ALL = [];
let SVC_PAGE = 1;
let SVC_FILTERS = svcDefaultFilters();

function svcDefaultFilters() {
  return { search: '', location: '', category: '', units: [], availability: [], maxPrice: SVC_PRICE_MAX, specialty: '', sortBy: 'recent' };
}

/* ── Helpers ─────────────────────────────────────────────────── */
function svcCategoryMeta(value) {
  const hit = SVC_CATEGORIES.find(c => c.value === value);
  if (hit) return hit;
  /* Custom categories typed under "Other" are saved as snake_case */
  const label = String(value || 'other').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
  return { value: value || 'other', label, emoji: '🛠️' };
}

function svcNormUnit(raw) {
  const u = String(raw || 'job').replace('/', '').trim().toLowerCase();
  return SVC_UNIT_LABEL[u] ? u : 'job';
}

function svcNormSpecialties(raw) {
  if (Array.isArray(raw)) return raw.map(x => String(x).trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map(x => x.trim()).filter(Boolean);
  return [];
}

function svcNormalize(row, user) {
  return {
    id: String(row.id),
    user_id: row.user_id ? String(row.user_id) : '',
    service_name: row.service_name || row.service || 'Service',
    category: row.category || 'other',
    price: Number(row.price) || 0,
    unit: svcNormUnit(row.rate_unit),
    location: row.location || '',
    description: row.description || '',
    photo: row.photo || null,
    specialties: svcNormSpecialties(row.specialties),
    availability: row.availability_status || 'available_this_week',
    created_at: row.created_at || null,
    provider: (user && (user.business_name || user.name)) || 'Provider',
    rating: Number(row.rating) || 0,
    reviews_count: Number(row.reviews_count) || 0,
    turnaround: row.turnaround || '',
    perk: row.perk || '',
  };
}

/* ── Data ────────────────────────────────────────────────────── */
async function svcLoad() {
  const { data, error } = await window.supabase.from('services')
    .select('*').eq('available', true)
    .order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  const rows = data || [];

  /* Provider names in one separate query (no join, so RLS on users
     can't hide the services themselves from logged-out visitors) */
  const userMap = {};
  const ids = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
  if (ids.length) {
    try {
      const { data: users } = await window.supabase.from('users')
        .select('id, name, business_name, avatar_url').in('id', ids);
      (users || []).forEach(u => { userMap[u.id] = u; });
    } catch (e) { /* names fall back to "Provider" */ }
  }

  SVC_ALL = rows.map(r => {
    const svc = svcNormalize(r, userMap[r.user_id]);
    if (!svc.photo && userMap[r.user_id] && userMap[r.user_id].avatar_url) svc.photo = userMap[r.user_id].avatar_url;
    return svc;
  });
}

/* ── Filtering ───────────────────────────────────────────────── */
function svcFiltered() {
  const f = SVC_FILTERS;
  let list = [...SVC_ALL];

  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(s =>
      s.service_name.toLowerCase().includes(q) ||
      s.provider.toLowerCase().includes(q) ||
      s.location.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      svcCategoryMeta(s.category).label.toLowerCase().includes(q) ||
      s.specialties.some(sp => sp.toLowerCase().includes(q))
    );
  }
  if (f.location) list = list.filter(s => s.location.toLowerCase().includes(f.location.toLowerCase()));
  if (f.category) {
    list = list.filter(s => f.category === 'other' ? !SVC_KNOWN.has(s.category) || s.category === 'other' : s.category === f.category);
  }
  if (f.units.length)        list = list.filter(s => f.units.includes(s.unit));
  if (f.availability.length) list = list.filter(s => f.availability.includes(s.availability));
  if (f.maxPrice < SVC_PRICE_MAX) list = list.filter(s => s.price <= f.maxPrice);
  if (f.specialty)           list = list.filter(s => s.specialties.some(sp => sp.toLowerCase() === f.specialty.toLowerCase()));

  if (f.sortBy === 'recent')     list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  if (f.sortBy === 'price_asc')  list.sort((a, b) => a.price - b.price);
  if (f.sortBy === 'price_desc') list.sort((a, b) => b.price - a.price);
  return list;
}

/* ── Filter UI that depends on the loaded data ───────────────── */
function svcBuildCategoryChips() {
  const wrap = document.getElementById('svcCategoryChips');
  if (!wrap) return;
  wrap.innerHTML = SVC_CATEGORIES.map(c =>
    `<button type="button" class="filter-chip${SVC_FILTERS.category === c.value ? ' active' : ''}" data-category="${c.value}">${c.label}</button>`
  ).join('');
}

function svcBuildSpecialtyChips() {
  const group = document.getElementById('svcSpecialtyGroup');
  const wrap  = document.getElementById('svcSpecialtyChips');
  if (!group || !wrap) return;
  const counts = {};
  SVC_ALL.forEach(s => s.specialties.forEach(sp => {
    const key = sp.toLowerCase();
    counts[key] = counts[key] || { label: sp, n: 0 };
    counts[key].n++;
  }));
  const top = Object.values(counts).sort((a, b) => b.n - a.n).slice(0, 12);
  group.hidden = top.length === 0;
  wrap.innerHTML = top.map(t =>
    `<button type="button" class="filter-chip${SVC_FILTERS.specialty.toLowerCase() === t.label.toLowerCase() ? ' active' : ''}" data-specialty="${escapeHtml(t.label)}">${escapeHtml(t.label)}</button>`
  ).join('');
}

function svcUpdateCounts() {
  document.querySelectorAll('[data-count-avail]').forEach(el => {
    el.textContent = SVC_ALL.filter(s => s.availability === el.dataset.countAvail).length || '';
  });
  document.querySelectorAll('[data-count-unit]').forEach(el => {
    el.textContent = SVC_ALL.filter(s => s.unit === el.dataset.countUnit).length || '';
  });
}

/* ── Render ──────────────────────────────────────────────────── */
function svcRender(page = 1) {
  SVC_PAGE = page;
  const grid    = document.getElementById('servicesGrid');
  const countEl = document.getElementById('serviceCount');
  const empty   = document.getElementById('serviceEmpty');
  const loadWrap = document.getElementById('serviceLoadMore');
  if (!grid) return;

  const all   = svcFiltered();
  const slice = all.slice(0, page * SVC_PAGE_SIZE);
  if (countEl) countEl.textContent = all.length === 1 ? '1 service' : `${all.length} services`;

  if (all.length === 0) {
    grid.innerHTML = '';
    if (empty) {
      const noneAtAll = SVC_ALL.length === 0;
      empty.querySelector('h3').textContent = noneAtAll ? 'No services posted yet' : 'No services match your filters';
      empty.querySelector('p').textContent  = noneAtAll
        ? 'Taskers have not listed any services yet. Check back soon.'
        : 'Try removing a filter or searching for something broader.';
      empty.style.display = 'block';
    }
    if (loadWrap) loadWrap.hidden = true;
    return;
  }
  if (empty) empty.style.display = 'none';
  grid.innerHTML = slice.map(svcBuildCard).join('');
  if (loadWrap) loadWrap.hidden = slice.length >= all.length;
}

function svcBuildCard(s) {
  const cat  = svcCategoryMeta(s.category);
  const desc = s.description.length > 100 ? s.description.slice(0, 100) + '…' : s.description;
  const href = s.user_id ? `tasker-profile.html?id=${encodeURIComponent(s.user_id)}` : 'find-services.html';
  /* Card markup lives in js/ui.js (stServiceCard). Rating, turnaround and perk only show when the row has them. */
  return stServiceCard({
    service_name: s.service_name, categoryLabel: cat.label, emoji: cat.emoji,
    description: desc, photo: s.photo, provider: s.provider, location: s.location,
    price: s.price, unit: s.unit, rating: s.rating, reviews_count: s.reviews_count,
    turnaround: s.turnaround, perk: s.perk, href,
  });
}

/* ── Wiring ──────────────────────────────────────────────────── */
function svcWire() {
  const input = document.getElementById('serviceSearchInput');
  const form  = document.getElementById('serviceSearchForm');
  if (input) input.addEventListener('input', () => { SVC_FILTERS.search = input.value.trim(); svcRender(1); });
  if (form)  form.addEventListener('submit', e => { e.preventDefault(); svcRender(1); });

  /* Category + specialty chips (single-select toggles, delegated so
     the data-built specialty chips work after they are rebuilt) */
  const toggleChip = (wrapId, attr, key) => {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    wrap.addEventListener('click', e => {
      const chip = e.target.closest(`[${attr}]`);
      if (!chip) return;
      const was = chip.classList.contains('active');
      wrap.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      SVC_FILTERS[key] = '';
      if (!was) { chip.classList.add('active'); SVC_FILTERS[key] = chip.getAttribute(attr); }
      svcRender(1);
    });
  };
  toggleChip('svcCategoryChips', 'data-category', 'category');
  toggleChip('svcSpecialtyChips', 'data-specialty', 'specialty');

  document.querySelectorAll('[name="svcAvail"]').forEach(cb => cb.addEventListener('change', () => {
    SVC_FILTERS.availability = [...document.querySelectorAll('[name="svcAvail"]:checked')].map(c => c.value);
    svcRender(1);
  }));
  document.querySelectorAll('[name="svcUnit"]').forEach(cb => cb.addEventListener('change', () => {
    SVC_FILTERS.units = [...document.querySelectorAll('[name="svcUnit"]:checked')].map(c => c.value);
    svcRender(1);
  }));

  const range = document.getElementById('priceRange');
  const rangeVal = document.getElementById('priceVal');
  if (range) range.addEventListener('input', () => {
    const v = parseInt(range.value, 10);
    SVC_FILTERS.maxPrice = v;
    if (rangeVal) rangeVal.textContent = v >= SVC_PRICE_MAX ? 'Any' : '₦' + v.toLocaleString();
    svcRender(1);
  });

  const sort = document.getElementById('sortSelect');
  if (sort) sort.addEventListener('change', () => { SVC_FILTERS.sortBy = sort.value; svcRender(1); });

  /* Apply (closes the mobile drawer; filters already apply live) */
  const apply = document.getElementById('applyFiltersBtn');
  if (apply) apply.addEventListener('click', () => {
    document.getElementById('filterSidebar')?.classList.remove('mobile-open');
    svcRender(1);
    if (typeof showToast === 'function') showToast(`${svcFiltered().length} results`);
  });
  /* Tapping the dimmed backdrop closes the mobile filter sheet */
  const sidebar = document.getElementById('filterSidebar');
  if (sidebar) sidebar.addEventListener('click', e => { if (e.target === sidebar) sidebar.classList.remove('mobile-open'); });
  const openBtn = document.getElementById('mobileFilterBtn');
  if (openBtn) openBtn.addEventListener('click', () => document.getElementById('filterSidebar')?.classList.add('mobile-open'));

  /* Clear all */
  const reset = document.getElementById('filterReset');
  if (reset) reset.addEventListener('click', () => {
    SVC_FILTERS = svcDefaultFilters();
    if (input) input.value = '';
    const loc = document.getElementById('serviceLocationInput');
    if (loc) { loc.value = ''; delete loc.dataset.lat; delete loc.dataset.lon; }
    if (range) range.value = SVC_PRICE_MAX;
    if (rangeVal) rangeVal.textContent = 'Any';
    if (sort) sort.value = 'recent';
    document.querySelectorAll('[name="svcAvail"], [name="svcUnit"]').forEach(c => { c.checked = false; });
    svcBuildCategoryChips();
    svcBuildSpecialtyChips();
    svcRender(1);
  });

  const more = document.getElementById('loadMoreBtn');
  if (more) more.addEventListener('click', () => svcRender(SVC_PAGE + 1));

  /* Whole card opens the service provider's profile */
  const grid = document.getElementById('servicesGrid');
  if (grid) {
    grid.addEventListener('click', e => {
      if (e.target.closest('a')) return;
      const card = e.target.closest('[data-href]');
      if (card) window.location.href = card.dataset.href;
    });
    /* Broken photo → category emoji (error events don't bubble, so capture) */
    grid.addEventListener('error', e => {
      const img = e.target;
      if (!img || img.tagName !== 'IMG') return;
      const badge = document.createElement('div');
      badge.className = 'st-card-media-fallback';
      badge.textContent = img.dataset.emoji || '🛠️';
      img.replaceWith(badge);
    }, true);
  }
}

/* ── Init ────────────────────────────────────────────────────── */
function initServicesPage() {
  const params = new URLSearchParams(window.location.search);
  const urlSearch = params.get('service') || params.get('q') || '';
  const urlLoc    = params.get('location') || '';
  const urlCat    = params.get('category') || '';
  if (urlSearch) { SVC_FILTERS.search = urlSearch; const i = document.getElementById('serviceSearchInput'); if (i) i.value = urlSearch; }
  if (urlLoc)    { SVC_FILTERS.location = urlLoc;  const i = document.getElementById('serviceLocationInput'); if (i) i.value = urlLoc; }
  if (urlCat)    { SVC_FILTERS.category = urlCat; }

  svcBuildCategoryChips();
  svcWire();

  svcLoad().then(() => {
    svcUpdateCounts();
    svcBuildSpecialtyChips();
    svcRender(1);
  }).catch(err => {
    console.warn('[Services] load failed:', err && err.message);
    SVC_ALL = [];
    svcRender(1);
    const empty = document.getElementById('serviceEmpty');
    if (empty) {
      empty.querySelector('h3').textContent = 'Could not load services';
      empty.querySelector('p').textContent  = 'Check your connection and try again.';
    }
  });
}

/* ============================================================
   STREET TASKER — app.js
   Core application bootstrap, component loading, navigation
   Sprint 1: Frontend Foundation
   ============================================================
   ============================================================ */

'use strict';

/* ── Component Loader ───────────────────────────────────────── */
/**
 * Fetches and injects HTML components (navbar, footer) into the page.
 * This avoids duplicating markup across every HTML file.
 *
 */
async function loadComponent(selector, url) {
  try {
    const el = document.querySelector(selector);
    if (!el) return;

    const res  = await fetch(url);
    const html = await res.text();
    el.innerHTML = html;

    /* Scripts inserted via innerHTML never execute — re-create them so
       any inline <script> shipped inside a component (e.g. the footer's
       accordion sync) actually runs. */
    el.querySelectorAll('script').forEach(oldScript => {
      const newScript = document.createElement('script');
      Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
      newScript.textContent = oldScript.textContent;
      oldScript.replaceWith(newScript);
    });

    /* After loading navbar, wire up its interactive behavior */
    if (url.includes('navbar')) {
      initNavbar();
    }

    /* After loading footer, nothing else to wire — the accordion script
       above (re-executed) handles its own setup. */
  } catch (err) {
    console.warn(`[StreetTasker] Could not load component: ${url}`, err);
  }
}

/* ── Global bottom nav loader ───────────────────────────────────
 * Unlike the navbar/footer, the bottom nav has no placeholder <div>
 * on every page — it's appended straight to <body> so every page that
 * loads app.js gets it automatically. It stays invisible (see
 * body.st-logged-in gate in css/styles.css) unless the visitor is
 * logged in, so guests never see it. */
async function loadBottomNav() {
  try {
    const res  = await fetch('components/bottom-nav.html');
    const html = await res.text();
    const wrapper = document.createElement('div');
    wrapper.id = 'bottom-nav-root';
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);

    wrapper.querySelectorAll('script').forEach(oldScript => {
      const newScript = document.createElement('script');
      Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
      newScript.textContent = oldScript.textContent;
      oldScript.replaceWith(newScript);
    });
  } catch (err) {
    console.warn('[StreetTasker] Could not load bottom nav', err);
  }
}

/* ── Navbar Logic ────────────────────────────────────────────── */
/**
 * Initializes scroll-based navbar styling and mobile menu toggle.
 * Called after the navbar component is injected into the DOM.
 */
function initNavbar() {
  const navbar    = document.getElementById('navbar');
  const toggle    = document.getElementById('navToggle');

  if (!navbar) return;

  /* Scroll: add .scrolled class to trigger glass effect */
  const onScroll = () => {
    navbar.classList.toggle('scrolled', window.scrollY > 20);
    /* Customer dashboard has its own fixed bar (.ds-topnav); keep it in step */
    const dsNav = document.querySelector('.ds-topnav');
    if (dsNav) dsNav.classList.toggle('scrolled', window.scrollY > 20);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); /* run once on load */

  /* Mobile menu: one drawer for guests, customers and taskers */
  initNavDrawer(navbar, toggle);

  /* Highlight active page link */
  setActiveNavLink();
}

/**
 * Mobile menu drawer (#navDrawer in components/navbar.html).
 * Opens from the hamburger, closes on overlay tap, the close tab, Escape,
 * a link tap, or when the screen grows past the mobile breakpoint.
 *
 * Dashboard pages can register window.ST.dashboard.openPanel(panel). When a
 * menu link has data-panel-link and points at the page we're already on, the
 * panel switches in place instead of reloading the page.
 */
function initNavDrawer(navbar, toggle) {
  const drawer  = document.getElementById('navDrawer');
  const overlay = document.getElementById('navDrawerOverlay');
  const closeBtn = document.getElementById('navDrawerClose');
  if (!drawer || !toggle) return;

  const desktop = window.matchMedia('(min-width: 769px)');
  let lastFocus = null;

  function isOpen() { return drawer.classList.contains('is-open'); }

  function setOpen(open) {
    if (open === isOpen()) return;
    drawer.classList.toggle('is-open', open);
    if (overlay) overlay.classList.toggle('is-open', open);
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    drawer.setAttribute('aria-hidden', String(!open));
    if (open) drawer.removeAttribute('inert'); else drawer.setAttribute('inert', '');
    document.body.classList.toggle('nav-drawer-open', open);

    if (open) {
      lastFocus = document.activeElement;
      const first = Array.from(drawer.querySelectorAll('a[href], button'))
        .find(el => !el.closest('[hidden]') && !el.hidden && el !== closeBtn);
      if (first) first.focus({ preventScroll: true });
    } else if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus({ preventScroll: true });
    }
  }

  toggle.addEventListener('click', () => setOpen(!isOpen()));
  if (overlay)  overlay.addEventListener('click', () => setOpen(false));
  if (closeBtn) closeBtn.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) setOpen(false); });
  const onBreakpoint = (e) => { if (e.matches) setOpen(false); };
  if (desktop.addEventListener) desktop.addEventListener('change', onBreakpoint);
  else if (desktop.addListener) desktop.addListener(onBreakpoint);

  drawer.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link) {
      if (e.target.closest('[data-nav-logout]')) setOpen(false);
      return;
    }
    const panel = link.dataset.panelLink;
    const hook  = window.ST && window.ST.dashboard && window.ST.dashboard.openPanel;
    const samePage = new URL(link.href, window.location.href).pathname === window.location.pathname;
    if (panel && typeof hook === 'function' && samePage) {
      e.preventDefault();
      setOpen(false);
      hook(panel);
      drawer.querySelectorAll('.nav-drawer-list a[aria-current]').forEach(a => a.removeAttribute('aria-current'));
      if (link.classList.contains('nav-drawer-link')) link.setAttribute('aria-current', 'page');
      return;
    }
    setOpen(false); /* normal navigation continues */
  });

  window.ST = window.ST || {};
  window.ST.navDrawer = { open: () => setOpen(true), close: () => setOpen(false), toggle: () => setOpen(!isOpen()) };
}

/**
 * Marks the correct nav link as active based on the current URL.
 */
function setActiveNavLink() {
  const page  = window.location.pathname.split('/').pop() || 'index.html';
  const links = document.querySelectorAll('.nav-link');
  links.forEach(link => {
    const href = link.getAttribute('href') || '';
    if (href && href !== '#' && page.includes(href.replace('.html', ''))) {
      link.classList.add('active');
    }
  });
}

/**
 * Entry point — runs after DOM is ready.
 * Loads shared components and then calls page-specific init.
 */
document.addEventListener('DOMContentLoaded', async () => {

  /* Step 1: Load navbar HTML. A page can opt into a different nav component
     with data-nav-src on the placeholder (landing/onboarding use nav-landing.html);
     every other page keeps components/navbar.html. */
  const navHost = document.getElementById('navbar-placeholder');
  await loadComponent('#navbar-placeholder', (navHost && navHost.dataset.navSrc) || 'components/navbar.html');

  /* Step 2: Apply auth state INSTANTLY from localStorage — zero network delay.
     This runs synchronously so the navbar never flickers. */
  if (window.ST?.auth?.initNavbarInstant) {
    window.ST.auth.initNavbarInstant();
  }

  /* Step 2b: On find-tasks.html / find-taskers.html, swap the hero into a
     "Welcome back" dashboard greeting for logged-in users. No-ops on
     every other page (the target elements simply don't exist there). */
  if (window.ST?.auth?.initDashboardWelcome) {
    window.ST.auth.initDashboardWelcome();
  }

  /* Step 2c: Notification popover (opens from the bell). Loaded once, only for logged-in users. */
  if (document.body.classList.contains('st-logged-in') && !window.ST?.notifPanel) {
    const np = document.createElement('script');
    np.src = 'js/notifications-panel.js';
    document.body.appendChild(np);
  }

  /* Step 3: Load footer — landing page only (non-blocking, doesn't affect visible UI).
     Every other page keeps an empty #footer-placeholder, so nothing renders there. */
  const _p = window.location.pathname.replace(/\/+$/, '');
  const _isLanding = _p === '' || /\/index(\.html)?$/.test(_p);
  if (_isLanding) loadComponent('#footer-placeholder', 'components/footer.html');

  /* Step 3b: Load the global mobile bottom nav (non-blocking). CSS keeps
     it hidden until body.st-logged-in is set, so guests never see it. */
  loadBottomNav();

  /* Step 4: Run page-specific init */
  if (typeof initPage === 'function') {
    initPage();
  }

  /* Step 5: Init animations */
  initScrollAnimations();

  /* Step 6: Verify auth with Supabase in background (updates if stale) */
  if (window.ST?.auth?.syncNavbarAuthState) {
    window.ST.auth.syncNavbarAuthState().catch(() => {});
  }

  /* Step 7: Keep navbar in sync on auth changes (login/logout) */
  if (window.supabase) {
    window.supabase.auth.onAuthStateChange((_event, _session) => {
      if (window.ST?.auth?.syncNavbarAuthState) {
        window.ST.auth.syncNavbarAuthState().catch(() => {});
      }
    });
  }

  /* Step 8: identity re-verification gate. A person the re-verify run flagged is sent to verify.html until VERIFIED.
     Loaded here so the 38 pages that run app.js need no edit. It is a page-level check, not a lock (database guard: V1h). */
  const gateScript = document.createElement('script');
  gateScript.src = 'js/verify-gate.js';
  gateScript.defer = true;
  document.body.appendChild(gateScript);

  console.log('[StreetTasker] App ready ✓');
});

/* ── Scroll Animations ───────────────────────────────────────── */
/**
 * Uses IntersectionObserver to trigger fade-in animations.
 * Elements with .anim-fade-up, .anim-fade-in etc. animate
 * into view when scrolled to.
 */
function initScrollAnimations() {
  const animElements = document.querySelectorAll(
    '.anim-fade-up, .anim-fade-in, .anim-scale-in'
  );

  if (!animElements.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.animationPlayState = 'running';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  animElements.forEach(el => {
    el.style.animationPlayState = 'paused';
    observer.observe(el);
  });
}

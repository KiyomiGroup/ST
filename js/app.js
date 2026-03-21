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

    /* After loading navbar, wire up its interactive behavior */
    if (url.includes('navbar')) {
      initNavbar();
    }

    /* After loading footer, nothing to wire — static markup */
  } catch (err) {
    console.warn(`[StreetTasker] Could not load component: ${url}`, err);
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
  const mobileNav = document.getElementById('navMobile');

  if (!navbar) return;

  /* Scroll: add .scrolled class to trigger glass effect */
  const onScroll = () => {
    navbar.classList.toggle('scrolled', window.scrollY > 20);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); /* run once on load */

  /* Mobile hamburger toggle */
  if (toggle && mobileNav) {
    toggle.addEventListener('click', () => {
      const isOpen = mobileNav.classList.toggle('open');
      toggle.classList.toggle('open', isOpen);
      toggle.setAttribute('aria-expanded', isOpen);
    });

    /* Close mobile menu when clicking outside */
    document.addEventListener('click', (e) => {
      if (!navbar.contains(e.target) && !mobileNav.contains(e.target)) {
        mobileNav.classList.remove('open');
        toggle.classList.remove('open');
      }
    });
  }

  /* Highlight active page link */
  setActiveNavLink();
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

/* ── App Bootstrap ───────────────────────────────────────────── */
/**
 * Entry point — runs after DOM is ready.
 * Loads shared components and then calls page-specific init.
 */
document.addEventListener('DOMContentLoaded', async () => {

  /* Step 1: Load navbar HTML */
  await loadComponent('#navbar-placeholder', 'components/navbar.html');

  /* Step 2: Apply auth state INSTANTLY from localStorage — zero network delay.
     This runs synchronously so the navbar never flickers. */
  if (window.ST?.auth?.initNavbarInstant) {
    window.ST.auth.initNavbarInstant();
  }

  /* Step 3: Load footer (non-blocking, doesn't affect visible UI) */
  loadComponent('#footer-placeholder', 'components/footer.html');

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

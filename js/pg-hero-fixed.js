/* ============================================================
   STREET TASKER — pg-hero-fixed.js
   Phones (768px and below): keeps the tasker page heroes fixed under the nav,
   like Find Tasks (see the inline script at the bottom of find-tasks.html).

   Markup: every element that stays fixed carries data-pg-fixed (top to bottom order);
   the element that holds the page content carries data-pg-fixed-pad. This script
   stacks the fixed elements under the nav and pads the content by their height.
   Also sets the browser's theme colour (green status bar for taskers only).
   ============================================================ */
'use strict';
(function () {
  var mq = window.matchMedia('(max-width: 768px)');

  function sync() {
    var pad = document.querySelector('[data-pg-fixed-pad]');
    var items = Array.prototype.slice.call(document.querySelectorAll('[data-pg-fixed]'));
    if (!pad) return;
    var visible = items.filter(function (el) { return el.getBoundingClientRect().height > 0; });
    if (!mq.matches || !visible.length) {
      items.forEach(function (el) { el.style.top = ''; });
      pad.style.paddingTop = '';
      return;
    }
    var nav = document.getElementById('navbar');
    var y = nav ? nav.getBoundingClientRect().height : 0;
    visible.forEach(function (el) {
      el.style.top = y + 'px';
      y += el.getBoundingClientRect().height;
    });
    pad.style.paddingTop = y + 'px';
  }

  /* Browser theme colour (the status-bar area on a phone): the hero green for taskers, the page colour for
     everyone else. Read from the design tokens so no colour is written here. */
  function themeColour() {
    var css = getComputedStyle(document.documentElement);
    /* body.pg-hero-nav: a page that shows the green hero to every role (customer Home, My Tasks) */
    var green = localStorage.getItem('st_role') === 'tasker' || document.body.classList.contains('pg-hero-nav') || document.body.classList.contains('cdash-overview');
    var value = css.getPropertyValue(green ? '--hero-bg-mobile' : '--color-bg').trim();
    if (!value) return;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    meta.setAttribute('content', value);
  }

  themeColour();
  /* The customer dashboard switches panels in place (body.cdash-overview toggles): keep the status bar in step */
  if (window.MutationObserver) new MutationObserver(themeColour).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('load', sync);
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
  mq.addEventListener && mq.addEventListener('change', sync);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(sync);
    document.querySelectorAll('[data-pg-fixed]').forEach(function (el) { ro.observe(el); });
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(sync);
  setTimeout(sync, 300); /* the role class (and so the hero) can appear just after load */
  setTimeout(sync, 1200);
})();

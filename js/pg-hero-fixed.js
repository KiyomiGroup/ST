/* ============================================================
   STREET TASKER — pg-hero-fixed.js
   Heroes now scroll with the page on phones (only Find Tasks keeps its hero pinned),
   so this script no longer positions anything. It only sets the browser's theme
   colour (green status bar for taskers only).
   ============================================================ */
'use strict';
(function () {
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
})();

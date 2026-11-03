/* ============================================================
   STREET TASKER — profile-prompt.js
   Floating "Complete your profile" card for taskers whose profile is not finished.
   Shown on post-service.html (where new taskers land on their first log-in).
   Same completeness rule as home-feed.html: a service and a location. The percentage uses
   the same five checks as the dashboard banner. The X hides it for this browser tab.
   Styles: css/styles.css, ".st-pf".
   ============================================================ */
'use strict';
(function () {
  var HIDE_KEY = 'st_pf_hidden';
  var CTA_URL  = 'dashboard-tasker.html?setup=1';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function build(pct, nextLabel) {
    var card = el('aside', 'st-pf');
    card.setAttribute('aria-labelledby', 'stPfTitle');
    card.style.setProperty('--pf-value', pct + '%');   /* runtime value: the progress width */

    var close = el('button', 'st-pf-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Hide this reminder');
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    close.addEventListener('click', function () {
      try { sessionStorage.setItem(HIDE_KEY, '1'); } catch (e) {}
      card.classList.add('is-leaving');
      setTimeout(function () { card.remove(); }, 220);
    });

    var icon = el('span', 'st-pf-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

    var main = el('div', 'st-pf-main');
    var title = el('h2', 'st-pf-title', 'Complete your profile');
    title.id = 'stPfTitle';
    var desc = el('p', 'st-pf-desc', nextLabel ? 'Next: add your ' + nextLabel + '. Full profiles get up to 3x more bookings.' : 'Full profiles get up to 3x more bookings.');
    main.append(title, desc);

    var bar = el('div', 'st-pf-progress');
    var track = el('div', 'st-pf-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'Profile completion');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(pct));
    track.appendChild(el('div', 'st-pf-fill'));
    bar.append(track, el('span', 'st-pf-pct', pct + '%'));

    var cta = el('a', 'st-pf-cta', 'Complete Profile');
    cta.href = CTA_URL;

    card.append(close, icon, main, bar, cta);
    return card;
  }

  async function init() {
    try {
      if (sessionStorage.getItem(HIDE_KEY)) return;
      var sess = await window.supabase.auth.getSession();
      var user = sess.data.session && sess.data.session.user;
      if (!user) return;
      var role = (user.user_metadata && user.user_metadata.role) || localStorage.getItem('st_role');
      if (role !== 'tasker') return;

      var row = (await window.ST.db.fetchMyTaskerProfile()) || {};
      if ((row.service || row.service_name) && row.location) return;   /* complete enough: no nagging */

      var steps = [
        ['profile photo', !!(row.photo_url || row.photo)],
        ['about / bio',   !!row.bio],
        ['location',      !!row.location],
        ['service type',  !!(row.service || row.service_name)],
        ['hourly rate',   Number(row.rate_value) > 0],
      ];
      var pct  = Math.round(steps.filter(function (s) { return s[1]; }).length / steps.length * 100);
      var next = steps.filter(function (s) { return !s[1]; })[0];
      document.body.appendChild(build(pct, next ? next[0] : ''));
    } catch (e) { /* unknown state: show nothing rather than nag */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

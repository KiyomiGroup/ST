/* ============================================================
   First-login tours for the logged-in homepage (home-feed.html): one for customers, one for taskers.
   Engine: js/onboarding.js. Progress: public.user_tour_progress (own rows) with a localStorage copy.

   Rules these tours follow:
   - They start by themselves only on the first visit (engine: autoStart). Skipped tours do not come back by
     themselves; completed tours do not replay. Replay lives in Help / Learn (Stage 4).
   - A step whose target is not on screen is skipped (for example "Wallet" on a phone, or "Complete your profile"
     once the profile is complete), so the same tour works on desktop and mobile.
   - Nothing here navigates away from the homepage. Post-login redirects are untouched.

   Two parts: `TOURS` (plain data, unit-tested in tests/onboarding-tours.test.js) and the browser hook that
   registers them. home-feed.html calls ST.homeTours.start() once the role is known.
   ============================================================ */
(function (root, factory) {
  var built = factory();
  if (typeof module === 'object' && module.exports) { module.exports = built; }
  else {
    root.ST = root.ST || {};
    root.ST.homeTours = built;
    if (root.ST.onboarding && root.ST.onboarding.registerAll) root.ST.onboarding.registerAll(built.TOURS);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var CUSTOMER_ID = 'customer-home';
  var TASKER_ID = 'tasker-home';

  var customer = {
    id: CUSTOMER_ID, role: 'customer', version: 1, auto: true, page: 'home-feed.html',
    title: 'Getting started on StreetTasker',
    description: 'A quick look at how to post a task, find help and keep track of your jobs.',
    steps: [
      { id: 'welcome', title: 'Welcome to StreetTasker!',
        description: 'This quick tour shows you where to post a task, find trusted local help and keep track of everything. It takes about a minute.' },
      { id: 'post-task', target: ["[data-tour='home-post-task']", '#stBnPlus'], placement: 'bottom',
        title: 'Post a task',
        description: 'Tell us what you need done, add a budget and a location, and taskers near you will send offers. Posting is free.' },
      { id: 'browse', target: ["[data-tour='home-browse']"], placement: 'bottom', optional: true,
        title: 'Browse taskers and services',
        description: 'Prefer to pick someone yourself? Browse taskers and the services they offer, then book the one you like.' },
      { id: 'search', target: ['#hfSearchForm'], placement: 'bottom',
        title: 'Search',
        description: 'Search by service or tasker name, and add your area to see people close to you.' },
      { id: 'categories', target: ["[data-tour='home-categories']"], placement: 'bottom',
        title: 'Categories',
        description: 'Tap a category such as Cleaning, Plumber or Barber to narrow the page to what you need.' },
      { id: 'feed', target: ['#hfCuRows'], placement: 'top', timeout: 4000, optional: true,
        title: 'Taskers and services near you',
        description: 'Featured taskers and services appear here. Open any card to see their work, reviews and prices.' },
      { id: 'my-tasks', target: ['#npc-tasks'], placement: 'bottom', optional: true,
        title: 'My Tasks',
        description: 'Everything you have posted lives here, along with the offers you receive.' },
      { id: 'messages', target: ['#npc-messages', '#stBnMessages'], placement: 'bottom',
        title: 'Messages',
        description: 'Chat with taskers here to agree details before you book. Keep your conversations on StreetTasker so you stay protected.' },
      { id: 'notifications', target: ['#navBellBtn', '#navMobileBell'], placement: 'bottom', optional: true,
        title: 'Notifications',
        description: 'New offers, messages and booking updates show up here so you never miss one.' },
      { id: 'menu', target: ['#navToggle'], placement: 'bottom', optional: true,
        title: 'Menu',
        description: 'Applications, Bookings, Wallet and your settings are all in this menu.' },
      { id: 'done', title: 'You are all set',
        description: 'Ready when you are: tap Post a task to get your first job started. You can replay this tour any time from Help / Learn.' }
    ]
  };

  var tasker = {
    id: TASKER_ID, role: 'tasker', version: 1, auto: true, page: 'home-feed.html',
    title: 'Getting started as a tasker',
    description: 'A quick look at how to find work, get booked and get paid.',
    steps: [
      { id: 'welcome', title: 'Welcome to StreetTasker!',
        description: 'This quick tour shows you how to find work, get booked and keep track of your jobs. It takes about a minute.' },
      { id: 'profile', target: ['#hfProfileCard'], placement: 'bottom', timeout: 3500, optional: true,
        title: 'Complete your profile',
        description: 'A full profile with your service, area and photos gets you more bookings. Finish it first, then come back to find work.' },
      { id: 'find-work', target: ["[data-tour='home-find-work']", '#stBnTasks'], placement: 'bottom',
        title: 'Find work',
        description: 'Browse open tasks near you and send an offer with your price. Quick, clear offers win more jobs.' },
      { id: 'feed', target: ['#hfTkRows'], placement: 'top', timeout: 4000, optional: true,
        title: 'Tasks picked for you',
        description: 'Urgent tasks and tasks near you appear here. Open one to read the details before you apply.' },
      { id: 'post-service', target: ["[data-tour='home-post-service']", '#stBnPlus'], placement: 'bottom',
        title: 'Post a service',
        description: 'List what you offer once and customers can find and book you at any time of day.' },
      { id: 'applications', target: ['#np-applications'], placement: 'bottom', optional: true,
        title: 'Applications',
        description: 'Track the offers you have sent and see which ones customers have accepted.' },
      { id: 'bookings', target: ['#np-bookings'], placement: 'bottom', optional: true,
        title: 'Bookings',
        description: 'Your confirmed jobs are here. Respond quickly to new bookings and keep customers updated.' },
      { id: 'messages', target: ['#np-messages', '#stBnMessages'], placement: 'bottom',
        title: 'Messages',
        description: 'Chat with customers here to agree details. Keep your conversations on StreetTasker so you stay protected.' },
      { id: 'wallet', target: ['#np-wallet'], placement: 'bottom', optional: true,
        title: 'Wallet',
        description: 'See your earnings and payments in one place.' },
      { id: 'notifications', target: ['#navBellBtn', '#navMobileBell'], placement: 'bottom', optional: true,
        title: 'Notifications',
        description: 'New tasks, messages and booking updates show up here.' },
      { id: 'menu', target: ['#navToggle'], placement: 'bottom', optional: true,
        title: 'Menu',
        description: 'Applications, Bookings, Wallet, My Services and your settings are all in this menu.' },
      { id: 'done', title: 'You are all set',
        description: 'Head to Find Work to send your first offer. You can replay this tour any time from Help / Learn.' }
    ]
  };

  var TOURS = [customer, tasker];

  /* Called by home-feed.html once the signed-in role is known. The engine only starts the tour that matches the
     person's role, and only on a first visit, so calling this on every visit is safe. */
  function start() {
    var ob = typeof window !== 'undefined' && window.ST && window.ST.onboarding;
    if (!ob) return Promise.resolve(false);
    /* A replay sent from Help / Learn (?tour=<id>) goes first; otherwise the first-visit rule applies. */
    return ob.consumeReplay().then(function (replayed) {
      return replayed || ob.autoStartFirst([CUSTOMER_ID, TASKER_ID]);
    }).catch(function () { return false; });
  }

  return { TOURS: TOURS, CUSTOMER_ID: CUSTOMER_ID, TASKER_ID: TASKER_ID, start: start };
});

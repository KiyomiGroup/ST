/* ============================================================
   Customer tutorials (onboarding Stage 5). Four guided tours, each on the real page it teaches:

     customer-post-task      post-task.html            post a task, step by step
     customer-book-service   find-services.html        find a service and book it
     customer-offers         customer-applications.html  compare offers, accept or decline
     customer-expenses       messages.html             extra costs (transport, materials, more work) in the Job Room

   Engine: js/onboarding.js. Progress: public.user_tour_progress (own rows) with a localStorage copy.

   Rules these tours follow:
   - They never start by themselves (auto: false). A customer starts them from Help / Learn (learn.html), which
     opens the right page with ?tour=<id>; this file then starts the tour once the page has loaded.
   - Nothing is submitted, paid or changed. Highlighted fields are shown, not filled in.
   - A step whose target is not on screen is skipped (phone vs desktop, empty lists), so one tour fits every screen.
     Steps that explain a screen that may be empty or a pop-up that is closed use fallback: 'center'.
   - No fee wording: customers are never shown the platform fee.

   Two parts: `TOURS` (plain data, unit-tested in tests/onboarding-tours-customer.test.js) and the browser hook.
   ============================================================ */
(function (root, factory) {
  var built = factory();
  if (typeof module === 'object' && module.exports) { module.exports = built; }
  else {
    root.ST = root.ST || {};
    root.ST.customerTours = built;
    if (root.ST.onboarding && root.ST.onboarding.registerAll) root.ST.onboarding.registerAll(built.TOURS);
    built.autoRun(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var IDS = {
    POST_TASK: 'customer-post-task',
    BOOK_SERVICE: 'customer-book-service',
    OFFERS: 'customer-offers',
    EXPENSES: 'customer-expenses'
  };

  var postTask = {
    id: IDS.POST_TASK, role: 'customer', version: 1, auto: false, page: 'post-task.html',
    title: 'How to post a task',
    description: 'Describe the job, set a budget and get offers from taskers near you.',
    steps: [
      { id: 'welcome', title: 'Post a task in a few minutes',
        description: 'Tell taskers what you need and they send you offers. Posting is free. This tour only shows you around, so nothing will be posted.' },
      { id: 'category', target: ['#taskCategory'], placement: 'bottom',
        title: 'Pick a category',
        description: 'Choose the service that fits the job, such as Cleaning, Plumber or Barber. It decides which taskers see your task.' },
      { id: 'title', target: ['#taskTitle'], placement: 'bottom',
        title: 'Give it a clear title',
        description: 'Keep it short and specific, for example “Fix a leaking kitchen tap”. A clear title gets more offers.' },
      { id: 'description', target: ['#taskDescription'], placement: 'top',
        title: 'Describe the work',
        description: 'Say what needs doing, how big the job is and anything the tasker should bring or know. The more detail, the better the offers.' },
      { id: 'location', target: ['#taskLocation'], placement: 'bottom', optional: true,
        title: 'Add your area',
        description: 'Search for your area. Only the area is shown to taskers, not your street. You can share your exact address in chat once you hire someone.' },
      { id: 'date', target: ['#schedulePanel', '#taskDeadline'], placement: 'top', optional: true,
        title: 'Choose when',
        description: 'Pick the date you want the job finished and, if it helps, a time of day.' },
      { id: 'budget', target: ['.pt-budget-field', '#taskBudget'], placement: 'top',
        title: 'Set a budget',
        description: 'Enter what you can pay in naira, or tap a suggested amount. Taskers can offer a little more or less, and you choose.' },
      { id: 'urgent', target: ['.pt-urgent'], placement: 'top', optional: true,
        title: 'Need it fast? Mark it urgent',
        description: 'Urgent is optional. It costs a one-time ₦1,500 and puts your task at the top of the tasker feed. You pay securely before the task goes up.' },
      { id: 'photos', target: ['#photosGroup'], placement: 'top', optional: true,
        title: 'Add photos',
        description: 'Optional, up to 5. A picture of the problem saves a lot of questions and helps taskers price the job properly.' },
      { id: 'post', target: ['#taskSubmitBtn'], placement: 'top',
        title: 'Post your task',
        description: 'When everything looks right, tap Post My Task. Taskers near you can then send offers, and you compare them under Applications.' },
      { id: 'done', title: 'That is it',
        description: 'You can replay this tour any time from Help / Learn. Next, try “Compare and accept offers” to see what happens after you post.' }
    ]
  };

  var bookService = {
    id: IDS.BOOK_SERVICE, role: 'customer', version: 1, auto: false, page: 'find-services.html',
    title: 'How to book a service',
    description: 'Find a service you like and book the tasker yourself.',
    steps: [
      { id: 'welcome', title: 'Book a tasker yourself',
        description: 'Instead of waiting for offers, you can pick a service and book the tasker directly. This tour shows you how.' },
      { id: 'search', target: ['#serviceSearchForm'], placement: 'bottom',
        title: 'Search for a service',
        description: 'Type a service, a specialty or a tasker’s name. Add your area to see people close to you.' },
      { id: 'filters', target: ['#svcCategoryChips'], placement: 'right', optional: true,
        title: 'Narrow it down',
        description: 'Use the category and other filters to cut the list down to what you need.' },
      { id: 'card', target: ['#servicesGrid .st-card--service'], placement: 'top', timeout: 4000, fallback: 'center',
        title: 'Read the service card',
        description: 'Each card shows the tasker or area, a short description and the starting price. Tap the card to see their work, reviews and full details first.' },
      { id: 'book', target: ['#servicesGrid .st-card--service .st-card-cta'], placement: 'top', optional: true,
        title: 'Book Service',
        description: 'Ready? Tap Book Service to open the tasker’s page and send your booking request. You can message the tasker first if you want to check availability.' },
      { id: 'form', title: 'Tell the tasker about the job',
        description: 'The booking form asks what needs doing, your area, how soon you need it, a preferred date and time, and lets you add photos. Your street address stays private until the tasker accepts.' },
      { id: 'after', title: 'What happens next',
        description: 'The tasker accepts or declines your request. After they accept, pay securely from Bookings. StreetTasker holds the money until you confirm the work is done. You can chat with the tasker in Messages at any time.' },
      { id: 'done', title: 'You are ready to book',
        description: 'Find your requests under Bookings. You can replay this tour any time from Help / Learn.' }
    ]
  };

  var offers = {
    id: IDS.OFFERS, role: 'customer', version: 1, auto: false, page: 'customer-applications.html',
    title: 'Compare and accept offers',
    description: 'See the offers on your tasks, compare them and hire the right tasker.',
    steps: [
      { id: 'welcome', title: 'Your offers live here',
        description: 'When taskers send offers on your tasks, they appear on this page. Here is how to compare them and choose.' },
      { id: 'filters', target: ['#apTabs'], placement: 'bottom', optional: true,
        title: 'Filter by status',
        description: 'Switch between offers that need your review, accepted offers and ones you have declined.' },
      { id: 'task', target: ['#apTask'], placement: 'bottom', optional: true,
        title: 'Pick a task',
        description: 'Have more than one task? Choose one to see only the offers it received.' },
      { id: 'card', target: ['#apList .ap-card'], placement: 'top', timeout: 4000, fallback: 'center',
        title: 'One card per offer',
        description: 'Each card shows who sent the offer, their price and their message. Offers appear here as soon as a tasker applies.' },
      { id: 'price', target: ['#apList .ap-figures'], placement: 'top', optional: true,
        title: 'Compare the price',
        description: 'The offer is shown next to your budget, so you can see at a glance whether it is above or below what you planned.' },
      { id: 'tasker', target: ['#apList .ap-person'], placement: 'bottom', optional: true,
        title: 'Check the tasker',
        description: 'Look at their rating and any proof of past work. Open their profile for reviews before you decide.' },
      { id: 'accept', target: ["#apList [data-act='accept']"], placement: 'top', optional: true,
        title: 'Accept the offer you like',
        description: 'Accepting hires that tasker. You then pay securely in the job’s conversation, and StreetTasker holds the money until you confirm the work is done.' },
      { id: 'decline', target: ["#apList [data-act='decline']"], placement: 'top', optional: true,
        title: 'Not the right one?',
        description: 'Decline the offers you do not want. You can still accept a different one.' },
      { id: 'done', title: 'You are all set',
        description: 'Take your time and compare. You can replay this tour any time from Help / Learn.' }
    ]
  };

  var expenses = {
    id: IDS.EXPENSES, role: 'customer', version: 1, auto: false, page: 'messages.html',
    title: 'Additional costs in the Job Room',
    description: 'What to do when a tasker asks for transport, materials or extra work.',
    steps: [
      { id: 'welcome', title: 'When a job needs extra money',
        description: 'Sometimes a job needs more than the agreed price: transport, materials, or extra work found on site. Taskers ask for it inside the job’s conversation. Here is how it works.' },
      { id: 'threads', target: ['#threadList'], placement: 'right', optional: true,
        title: 'Open the job conversation',
        description: 'Every job has its own conversation. Extra-cost requests always appear there, so open the job you are working on.' },
      { id: 'card', title: 'The request is a card in the chat',
        description: 'The tasker explains what is needed and how much it costs. You see the amount and the reason before you decide anything.' },
      { id: 'choice', title: 'You decide: Pay, Decline or Ask',
        description: 'Pay it, tap Decline Request, or tap Ask a Question if you want to know more first. Only the actions that fit are shown.' },
      { id: 'safe', title: 'Nothing is added without you',
        description: 'An extra cost is added to the job only after you pay it. If you decline, the original job and price stay as they were.' },
      { id: 'chat', target: ['#inputBar'], placement: 'top', optional: true,
        title: 'Talk it through first',
        description: 'Not sure about a cost? Ask in the chat. Keep every payment on StreetTasker so you stay protected, and never pay a tasker outside the app.' },
      { id: 'done', title: 'You know how extra costs work',
        description: 'You can replay this tour any time from Help / Learn.' }
    ]
  };

  var TOURS = [postTask, bookService, offers, expenses];

  /* Starts the tour named in ?tour=<id> when it is one of ours. Safe to call on every load. */
  function start(root) {
    var w = root || (typeof window !== 'undefined' ? window : null);
    var ob = w && w.ST && w.ST.onboarding;
    if (!ob || !ob.consumeReplay) return Promise.resolve(false);
    return ob.consumeReplay().catch(function () { return false; });
  }

  /* Pages that host these tours load this file; it only acts when the address carries ?tour=<id>. */
  function autoRun(root) {
    if (!root || !root.document || !root.location) return;
    if (!/[?&]tour=/.test(root.location.search || '')) return;
    var go = function () { root.setTimeout(function () { start(root); }, 800); };
    if (root.document.readyState === 'complete') go(); else root.addEventListener('load', go);
  }

  return { TOURS: TOURS, IDS: IDS, start: start, autoRun: autoRun };
});

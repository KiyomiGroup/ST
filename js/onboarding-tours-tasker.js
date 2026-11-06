/* ============================================================
   Tasker tutorials (onboarding Stage 6). Three guided tours, each on the real page it teaches:

     tasker-apply-task   find-tasks.html   find an open task and send an offer
     tasker-bookings     bookings.html     respond to a new booking request
     manage-work         bookings.html     keep a job moving and get paid

   Engine: js/onboarding.js. Progress: public.user_tour_progress (own rows) with a localStorage copy.

   Same rules as the customer tutorials (js/onboarding-tours-customer.js):
   - They never start by themselves (auto: false). A tasker starts them from Help / Learn (learn.html), which opens
     the page with ?tour=<id>; this file then starts the tour once the page has loaded.
   - Nothing is sent, confirmed, declined or changed. Highlighted items are shown, not used.
   - A step whose target is not on screen is skipped; steps for lists that may be empty or pop-ups that are closed
     use fallback: 'center'.

   Two parts: `TOURS` (plain data, unit-tested in tests/onboarding-tours-tasker.test.js) and the browser hook.
   ============================================================ */
(function (root, factory) {
  var built = factory();
  if (typeof module === 'object' && module.exports) { module.exports = built; }
  else {
    root.ST = root.ST || {};
    root.ST.taskerTours = built;
    if (root.ST.onboarding && root.ST.onboarding.registerAll) root.ST.onboarding.registerAll(built.TOURS);
    built.autoRun(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var IDS = { APPLY: 'tasker-apply-task', BOOKINGS: 'tasker-bookings', MANAGE: 'manage-work' };

  var apply = {
    id: IDS.APPLY, role: 'tasker', version: 1, auto: false, page: 'find-tasks.html',
    title: 'Find a task and send an offer',
    description: 'Browse open tasks near you and send an offer with your price.',
    steps: [
      { id: 'welcome', title: 'Find work and send an offer',
        description: 'Customers post tasks and taskers like you send offers. This tour shows you how to find a good task and apply. Nothing is sent during the tour.' },
      { id: 'search', target: ['#taskSearchForm'], placement: 'bottom',
        title: 'Search for tasks',
        description: 'Search by a title or keyword, and add your area to see tasks close to you.' },
      { id: 'filters', target: ['#taskCategoryChips', '#budgetRange'], placement: 'right', optional: true,
        title: 'Narrow it down',
        description: 'Filter by category or budget so you see the work that suits you.' },
      { id: 'card', target: ['#tasksGrid .st-card--task'], placement: 'top', timeout: 4000, fallback: 'center',
        title: 'Read the task card',
        description: 'Each card shows how urgent the task is, the category, the area, the client’s budget and how many offers it already has. Urgent tasks are worth a quick look.' },
      { id: 'details', target: ['#tasksGrid .st-card--task .st-card-cta--ghost'], placement: 'top', optional: true,
        title: 'View details first',
        description: 'Open the task to read the full requirements, schedule and photos before you decide to apply.' },
      { id: 'offer', target: ['#tasksGrid .st-card--task .st-card-actions .st-card-cta:not(.st-card-cta--ghost)'], placement: 'top', optional: true,
        title: 'Make an offer',
        description: 'Happy with the task? Tap Make an Offer to open the offer page.' },
      { id: 'form', title: 'Fill in your offer',
        description: 'Enter your price in naira, write a short pitch about why you are a good fit, and say when you can arrive. The page shows what you will receive after the platform fee, so there are no surprises. Tick the terms, then submit.' },
      { id: 'after', title: 'What happens next',
        description: 'Sending an offer does not award you the job. The customer compares offers and chooses one. Track yours under Applications; you get the job when yours is accepted.' },
      { id: 'done', title: 'You are ready to apply',
        description: 'Quick, clear, fairly priced offers win more work. You can replay this tour any time from Help / Learn.' }
    ]
  };

  var bookings = {
    id: IDS.BOOKINGS, role: 'tasker', version: 1, auto: false, page: 'bookings.html',
    title: 'Respond to a booking request',
    description: 'What to do when a customer books you.',
    steps: [
      { id: 'welcome', title: 'Customers can book you directly',
        description: 'When someone books one of your services, the request lands on this page. Answer quickly: fast replies win repeat customers.' },
      { id: 'tabs', target: ['#bkTabs'], placement: 'bottom',
        title: 'Filter by status',
        description: 'Pending shows requests waiting for your reply. In Progress, Sign-Off and Completed follow a job through to the end.' },
      { id: 'card', target: ['#bkList .bk-card'], placement: 'top', timeout: 4000, fallback: 'center',
        title: 'Read the request',
        description: 'Each card shows the job, the customer and when they want it. Read the details before you answer.' },
      { id: 'confirm', target: ["#bkList [data-act='confirm']"], placement: 'top', optional: true,
        title: 'Confirm the booking',
        description: 'You can take the job? Tap Confirm. The customer is then asked to pay securely. Start work only after the payment shows as confirmed.' },
      { id: 'decline', target: ["#bkList [data-act='decline']"], placement: 'top', optional: true,
        title: 'Or decline',
        description: 'Cannot do it? Decline, and the customer is told. They are not charged.' },
      { id: 'search', target: ['#bkToolbar', '#bkFilterBtn'], placement: 'bottom', optional: true,
        title: 'Search and sort',
        description: 'Find a booking by job, customer or booking ID, and filter by service or date.' },
      { id: 'done', title: 'You know how to respond',
        description: 'After you confirm, the job moves to In Progress. The next tour, “Managing bookings and jobs”, shows how to keep it moving. Replay any tour from Help / Learn.' }
    ]
  };

  var manage = {
    id: IDS.MANAGE, role: 'tasker', version: 1, auto: false, page: 'bookings.html',
    title: 'Manage a job and get paid',
    description: 'Keep a job moving from start to finish and see your money.',
    steps: [
      { id: 'welcome', title: 'From start to payment',
        description: 'Here is how a confirmed job runs, and where you see your money along the way.' },
      { id: 'snapshot', target: ['.bk-side .bk-panel'], placement: 'left', optional: true,
        title: 'Booking snapshot',
        description: 'A quick count of requests that need your reply and jobs that are active, plus the money held and the money paid out.' },
      { id: 'room', target: ["#bkList [data-act='room']"], placement: 'top', optional: true, fallback: 'center',
        title: 'Open the job room',
        description: 'Everything about a job happens in its job room, which is the conversation with your customer. Tap Open job room to go there.' },
      { id: 'progress', title: 'Keep the customer updated',
        description: 'In the job room, mark your progress as you go: on my way, arrived, start work, pause or resume, then mark the work complete. Updates build trust and better reviews.' },
      { id: 'signoff', title: 'The customer signs off',
        description: 'Once you mark the work complete, the customer reviews it. When they are happy they get a 6-digit release code and share it with you. Enter it in the job room and your payment is released.' },
      { id: 'tab', target: ["#bkTabs [data-filter='signoff']"], placement: 'bottom', optional: true,
        title: 'Sign-Off tab',
        description: 'Jobs waiting for the customer to confirm are here. If something is wrong, the customer can ask for changes or report an issue.' },
      { id: 'wallet', target: ['.bk-wallet'], placement: 'left', optional: true,
        title: 'Your money',
        description: 'Paid-out earnings show here. Open Wallet to see your balance and withdraw to your bank account.' },
      { id: 'done', title: 'You are all set',
        description: 'Keep customers updated and you will get better reviews. You can replay this tour any time from Help / Learn.' }
    ]
  };

  var TOURS = [apply, bookings, manage];

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

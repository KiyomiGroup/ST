/* ============================================================
   Help / Learn content (learn.html). Plain data plus two small helpers, unit-tested in tests/learn.test.js.

   Every statement here describes something StreetTasker really does today. If a feature changes, change the text here.

   A topic can name tours (`tours`: list of tour ids registered with ST.onboarding). The page shows a "Take the tour"
   button only for ids that are registered AND match the person's role, so naming a tour that does not exist yet is
   harmless. Ids reserved for the later stages are listed in ONBOARDING-STAGES.md.
   ============================================================ */
(function (root, factory) {
  var built = factory();
  if (typeof module === 'object' && module.exports) { module.exports = built; }
  else { root.ST = root.ST || {}; root.ST.learnContent = built; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* role: 'both' | 'customer' | 'tasker' */
  var TOPICS = [
    { id: 'getting-started', role: 'both', title: 'Getting started',
      summary: 'How StreetTasker works, in four steps.',
      tours: ['customer-home', 'tasker-home'],
      steps: [
        'Customers post a task (or pick a tasker and book a service). Taskers find tasks and send an offer with their price.',
        'Agree the details in Messages. Every job has its own conversation, called the Job Room.',
        'The customer pays through StreetTasker. The money is held safely until the work is done.',
        'When the work is finished the customer confirms it, and the payment is released to the tasker.'
      ],
      tips: ['Keep all messages, agreements and payments on StreetTasker. It is what keeps you protected.'] },

    { id: 'customer-guide', role: 'customer', title: 'Customer guide',
      summary: 'Where everything is when you hire help.',
      tours: ['customer-home'],
      steps: [
        'Home shows taskers and services near you, with search and categories.',
        'My Tasks lists the tasks you posted and the offers they received.',
        'Applications is where you review offers from taskers.',
        'Bookings lists the services you booked and their progress.',
        'Messages holds one conversation per job. Notifications (the bell) tell you about new offers, messages and updates.',
        'Wallet holds your gift cards. The menu has your settings and Invite & Earn.'
      ],
      tips: ['Complete your profile so taskers know who they are working with.'] },

    { id: 'tasker-guide', role: 'tasker', title: 'Tasker guide',
      summary: 'Where everything is when you look for work.',
      tours: ['tasker-home'],
      steps: [
        'Home shows tasks near you and what to finish on your profile.',
        'Find Tasks lists open tasks. Open one to read the details before you apply.',
        'Applications tracks the offers you sent and which ones the customer accepted.',
        'Bookings lists confirmed jobs and services customers booked with you.',
        'Messages holds one conversation per job. Wallet shows your earnings and lets you withdraw to your bank account.',
        'The menu has Post a Service, My Services, Subscription and your settings.'
      ],
      tips: ['A complete profile with your service, area and photos gets you more bookings.'] },

    { id: 'posting-tasks', role: 'customer', title: 'Posting a task',
      summary: 'Tell taskers exactly what you need.',
      tours: ['customer-post-task', 'customer-offers'],
      steps: [
        'Choose Post a task, then pick the Service Category that fits the job.',
        'Give the task a clear Task Title, and describe the work in the details.',
        'Add photos if they help. A picture of the problem saves a lot of questions.',
        'Set your Target Completion Date and an Estimated Budget in naira.',
        'Optional: Mark as Urgent for a one-time fee of ₦1,500, which puts your task at the top of the tasker feed. You pay it securely through Paystack before the task goes up.',
        'Review the details and publish. Taskers near you can now send offers.',
        'Open Applications to compare offers, look at each tasker’s profile and choose one.'
      ],
      tips: ['Accurate details and a realistic budget get you better offers, faster.', 'Posting a task is free. Only the optional Urgent upgrade has a fee.'] },

    { id: 'booking-services', role: 'customer', title: 'Booking a service',
      summary: 'Pick a tasker yourself instead of waiting for offers.',
      tours: ['customer-book-service'],
      steps: [
        'Browse taskers and services from Home or the menu, or search by service, tasker name and area.',
        'Open a service or a tasker’s profile to see their work, reviews and prices.',
        'Choose to book, and fill in the date, time and any instructions the tasker should know.',
        'Check the details, then confirm the booking.',
        'Find the booking under Bookings, and chat with the tasker in Messages.'
      ],
      tips: ['Message the tasker before you book if you want to check availability or details.'] },

    { id: 'finding-tasks', role: 'tasker', title: 'Finding and accepting tasks',
      summary: 'Send an offer that wins the job.',
      tours: ['tasker-apply-task'],
      steps: [
        'Open Find Tasks and browse open tasks. Use the filters to narrow them down.',
        'Open a task and read the requirements, location, schedule and budget.',
        'Choose to make an offer. Enter your Proposed compensation in naira.',
        'Write a short pitch: why you are a good fit, your equipment and your availability.',
        'Add your availability and arrival time, and attach proof of previous work if you have it.',
        'Submit the offer, then wait for the customer. Track it under Applications.'
      ],
      tips: ['Sending an offer does not award you the job. The job is yours when the customer accepts your offer.', 'Quick, clear, fairly priced offers win more work.'] },

    { id: 'chat-offers', role: 'both', title: 'Chat and offers',
      summary: 'Use the Job Room to agree the job.',
      tours: ['customer-chat', 'tasker-chat'],
      steps: [
        'Open Messages and choose the job conversation. Talk through the requirements before you agree anything.',
        'Use the Request button for everything beyond chatting, such as asking for a price, an update, proof of work or a new date and time. Only the actions that fit the job right now are shown.',
        'The tasker can propose the agreed price. The customer accepts or declines it.',
        'Look for the StreetTasker Safety Reminder above the message box. It is shown in every conversation.'
      ],
      tips: ['Do not share phone numbers or take the deal off the platform. Moving a job off StreetTasker breaks our policies and can lead to a permanent ban.'] },

    { id: 'payments', role: 'both', title: 'Payments and additional costs',
      summary: 'How money moves, and how extra costs are approved.',
      tours: ['payments-guide', 'customer-expenses'],
      steps: [
        'The customer pays inside the Job Room, securely through Paystack.',
        'Paid money is held by StreetTasker. It is not released to the tasker until the job is complete.',
        'Taskers should start work only after StreetTasker shows the payment as confirmed.',
        'Need transport, materials or another extra cost? The tasker sends it as a request in the chat. The customer pays it or declines it, and nothing is added to the job without the customer’s say-so.',
        'When the work is done, the tasker marks it complete. The customer reviews it, then taps Get Release Code and shares the 6-digit code with the tasker.',
        'The tasker enters the code and the payment is released. If something is wrong, the customer can choose Request Changes or Report an Issue instead.'
      ],
      tips: ['Only share the release code once you are happy with the work.'] },

    { id: 'managing-bookings', role: 'both', title: 'Managing bookings and jobs',
      summary: 'Keep a job moving from start to finish.',
      tours: ['manage-work'],
      steps: [
        'Find your jobs under Bookings. Open the job’s conversation for the latest status.',
        'Taskers update progress in the chat: on my way, arrived, start work, pause or resume, then mark work complete.',
        'Either person can ask to change the date and time. The other person accepts or declines.',
        'After completion the customer confirms the work to release the payment.'
      ],
      tips: ['Keep customers updated. It builds trust and better reviews.'] }
  ];

  var FAQ = [
    { q: 'Is it free to post a task?', a: 'Yes. Posting a task is free. The optional Urgent upgrade costs a one-time ₦1,500.' },
    { q: 'If I send an offer, have I got the job?', a: 'Not yet. The customer reviews offers and chooses one. You get the job when they accept yours.' },
    { q: 'When does the tasker get paid?', a: 'The customer pays into StreetTasker first and the money is held. It is released to the tasker after the customer confirms the work is complete.' },
    { q: 'Why must I keep everything on StreetTasker?', a: 'Payments, agreements and conversations on StreetTasker are protected and recorded. Taking a deal off the platform breaks our policies and may lead to a permanent account ban.' },
    { q: 'What if something goes wrong with a job?', a: 'In the Job Room, the customer can choose Request Changes or Report an Issue when the work is marked complete. You can also contact us from the Contact page.' },
    { q: 'Can I skip a tour?', a: 'Yes, any time. Choose Skip tour (or press Esc) and the tour closes. It will not start again by itself.' },
    { q: 'Can I replay a tour?', a: 'Yes. Open Help / Learn and choose Start tour or Replay tour on any tour you like.' },
    { q: 'Can customers withdraw money from their wallet?', a: 'No. The customer wallet holds gift cards. Withdrawals are for taskers only.' }
  ];

  /* Topics shown to a person: their role's topics plus the shared ones. Guests (role null) see everything. */
  function topicsFor(role) {
    return TOPICS.filter(function (t) { return !role || t.role === 'both' || t.role === role; });
  }

  /* Tour ids for a topic that are registered (isRegistered(id) -> bool) and fit the role. */
  function tourIdsFor(topic, role, isRegistered, roleOfTour) {
    return (topic.tours || []).filter(function (id) {
      if (!isRegistered(id)) return false;
      var r = roleOfTour ? roleOfTour(id) : 'any';
      return !role || r === 'any' || r === role;
    });
  }

  /* Button text for a saved tour status */
  function actionLabel(status) {
    if (status === 'in_progress') return 'Restart tour';
    if (status === 'completed' || status === 'skipped') return 'Replay tour';
    return 'Start tour';
  }
  function statusLabel(status) {
    return { new: 'Not started', in_progress: 'In progress', completed: 'Completed', skipped: 'Skipped' }[status] || 'Not started';
  }

  return { TOPICS: TOPICS, FAQ: FAQ, topicsFor: topicsFor, tourIdsFor: tourIdsFor, actionLabel: actionLabel, statusLabel: statusLabel };
});

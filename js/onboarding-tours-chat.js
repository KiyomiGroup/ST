/* ============================================================
   Chat tutorials (onboarding Stage 7). Three guided tours on messages.html (the Job Room):

     customer-chat    customer    the conversation, the next-step panel, safety, sharing, Actions
     tasker-chat      tasker      the same screen from the tasker's side: propose a price, location, release code, Actions
     payments-guide   any role    how the money moves: agree the price, pay, held safely, release code

   The "Actions guide" is part of the two chat tours: the Actions button (#requestBtn, the Job actions sheet) gets its own step
   and a short card that says what is inside it for that role.

   Engine: js/onboarding.js. Progress: public.user_tour_progress (own rows) with a localStorage copy.

   Rules these tours follow (same as Stages 5 and 6):
   - They never start by themselves (auto: false). A person starts them from Help / Learn (learn.html), which opens
     messages.html with ?tour=<id>; this file then starts the tour once the page has loaded.
   - Nothing is sent, paid, proposed or changed. Highlighted boxes are shown, not filled in.
   - A step whose target is not on screen (no conversation open, phone vs desktop) is skipped, or shown as a plain
     centred card when it uses fallback: 'center'. The next-step panel only shows when the job needs something, so its
     steps use fallback: 'center' and explain it in words.
   - Customer copy never mentions the platform fee (tests check this). payments-guide is for both roles, so it never does either.
   - Chat tutorials cover messages.html only, not coordinator-chat.html.

   Two parts: `TOURS` (plain data, unit-tested in tests/onboarding-tours-chat.test.js) and the browser hook.
   ============================================================ */
(function (root, factory) {
  var built = factory();
  if (typeof module === 'object' && module.exports) { module.exports = built; }
  else {
    root.ST = root.ST || {};
    root.ST.chatTours = built;
    if (root.ST.onboarding && root.ST.onboarding.registerAll) root.ST.onboarding.registerAll(built.TOURS);
    built.autoRun(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var IDS = { CUSTOMER_CHAT: 'customer-chat', TASKER_CHAT: 'tasker-chat', PAYMENTS: 'payments-guide' };

  var customerChat = {
    id: IDS.CUSTOMER_CHAT, role: 'customer', version: 1, auto: false, page: 'messages.html',
    title: 'Using the chat with your tasker',
    description: 'Talk through the job, agree the price, pay safely and share where to come.',
    steps: [
      { id: 'welcome', title: 'Every job has its own conversation',
        description: 'This is where you talk to your tasker, agree the price, pay and finish the job. This tour only shows you around, so nothing will be sent or paid.' },
      { id: 'threads', target: ['#threadList'], placement: 'right', optional: true,
        title: 'Pick the job conversation',
        description: 'Your conversations are listed here. Open the one for the job you are working on.' },
      { id: 'details', target: ['#chatHeadDetails'], placement: 'bottom', optional: true,
        title: 'Job details',
        description: 'Tap here any time to see the job, the price, what has been paid and the status in one place.' },
      { id: 'next', target: ['#jrDock'], placement: 'top', fallback: 'center',
        title: 'Your next step is always above the message box',
        description: 'A panel above the message box tells you what to do now. First you accept the tasker’s price, then you pay. Once you have paid you will also see your release code there.' },
      { id: 'pay', title: 'Pay inside StreetTasker',
        description: 'Pay with your wallet, a gift card or Paystack. The money is held safely and is not sent to the tasker until the job is done. Never pay a tasker outside the app.' },
      { id: 'code', title: 'Your release code',
        description: 'Once you have paid you get a 6-digit release code. Give it to the tasker only after the job is done and you are happy with it. The tasker enters it to get paid. Never type it in the chat.' },
      { id: 'safety', target: ['[data-tour=\'chat-safety-reminder\']', '#jrSafetyReminder'], placement: 'top', optional: true,
        title: 'The StreetTasker Safety Reminder',
        description: 'Keep every message, agreement and payment on StreetTasker. Sharing phone numbers or paying outside the app is against our rules and can lead to a permanent ban.' },
      { id: 'attach', target: ['#attachBtn'], placement: 'top', optional: true,
        title: 'Send photos, files or your location',
        description: 'Use the plus button to send a photo, a file or your location. Photos of the problem help the tasker give you the right price.' },
      { id: 'type', target: ['#msgInput'], placement: 'top', optional: true,
        title: 'Write your message',
        description: 'Describe what you need, ask questions and agree the time. Phone numbers and email addresses are blocked to keep you safe.' },
      { id: 'actions', target: ['#requestBtn'], placement: 'top', fallback: 'center',
        title: 'Actions: everything beyond chatting',
        description: 'Tap Actions for things like asking for an update, proof of work, a new date and time, or reporting a problem. Only the actions that fit the job right now are shown.' },
      { id: 'actions-inside', title: 'What is inside Actions for you',
        description: 'Ask for an update or proof of work, propose a new time, approve extra costs the tasker asks for, and Request Changes or Report an Issue if the work is not right.' },
      { id: 'done', title: 'You know how the chat works',
        description: 'You can replay this tour any time from Help / Learn.' }
    ]
  };

  var taskerChat = {
    id: IDS.TASKER_CHAT, role: 'tasker', version: 1, auto: false, page: 'messages.html',
    title: 'Using the chat with a customer',
    description: 'Propose a price, find the customer, do the job and get paid with the release code.',
    steps: [
      { id: 'welcome', title: 'Every job has its own conversation',
        description: 'Agree the price, find the customer, update them and get paid, all in one chat. This tour only shows you around, so nothing will be sent.' },
      { id: 'threads', target: ['#threadList'], placement: 'right', optional: true,
        title: 'Pick the job conversation',
        description: 'Your conversations are listed here. Open the customer you are working with.' },
      { id: 'details', target: ['#chatHeadDetails'], placement: 'bottom', optional: true,
        title: 'Job details',
        description: 'Tap here to see the job, the agreed price, what has been paid and the status.' },
      { id: 'next', target: ['#jrDock'], placement: 'top', fallback: 'center',
        title: 'Your next step is always above the message box',
        description: 'A panel above the message box tells you what to do now. It starts with a box where you propose a price. Later it shows the release-code box.' },
      { id: 'price', title: 'Propose one price for the job',
        description: 'Type the price for the whole job, add a short note on what it covers, and send it. The customer accepts it and then pays. Transport, materials and extra costs are asked for separately.' },
      { id: 'paid', title: 'Start only after they have paid',
        description: 'Do not start before the payment shows as confirmed. Agree the time to come in the chat. If you need their location, ask for it there and they can send it with the plus button.' },
      { id: 'code', title: 'Enter the release code to get paid',
        description: 'When the job is done, ask the customer for their 6-digit release code and enter it in the box above the message box. The payment is released to your wallet. Never ask for the code before the work is finished.' },
      { id: 'safety', target: ['[data-tour=\'chat-safety-reminder\']', '#jrSafetyReminder'], placement: 'top', optional: true,
        title: 'The StreetTasker Safety Reminder',
        description: 'Keep every message, agreement and payment on StreetTasker. Sharing phone numbers or taking the deal off the app is against our rules and can lead to a permanent ban.' },
      { id: 'attach', target: ['#attachBtn'], placement: 'top', optional: true,
        title: 'Send photos and files',
        description: 'Use the plus button to send a photo, a file or your location, for example a photo of the finished work.' },
      { id: 'actions', target: ['#requestBtn'], placement: 'top', fallback: 'center',
        title: 'Actions: everything beyond chatting',
        description: 'Tap Actions to change your price, request transport or extra costs, send On my way, Arrived, Start work and Mark as complete, send proof of work, or propose a new time. Only the actions that fit the job right now are shown.' },
      { id: 'actions-inside', title: 'What is inside Actions for you',
        description: 'Money actions come first, then the work updates, then the less common ones under More options. An update such as On my way keeps the customer informed without typing.' },
      { id: 'done', title: 'You know how the chat works',
        description: 'You can replay this tour any time from Help / Learn.' }
    ]
  };

  var payments = {
    id: IDS.PAYMENTS, role: 'any', version: 1, auto: false, page: 'messages.html',
    title: 'How payments work in the chat',
    description: 'Agree the price, pay, wait for the job and release the payment.',
    steps: [
      { id: 'welcome', title: 'Payments in four steps',
        description: 'Price, pay, work, release. Everything happens in the job’s conversation, so you are always protected.' },
      { id: 'next', target: ['#jrDock'], placement: 'top', fallback: 'center',
        title: 'The panel above the message box leads you',
        description: 'It always shows the next step for you: propose or accept the price, pay, and enter or hold the release code.' },
      { id: 'price', title: '1. Agree the price',
        description: 'The tasker proposes one price for the job. The customer accepts it or declines it. Extra costs such as transport or materials are separate requests.' },
      { id: 'pay', title: '2. The customer pays on StreetTasker',
        description: 'Payment is made in the chat with a wallet, a gift card or Paystack. StreetTasker holds the money safely. The tasker should start only after the payment shows as confirmed.' },
      { id: 'work', title: '3. The job is done',
        description: 'The customer and tasker agree the time in the chat, and the tasker does the work. The tasker can send updates such as On my way or Arrived from Actions.' },
      { id: 'release', title: '4. The release code pays the tasker',
        description: 'Once the customer has paid they hold a 6-digit release code. They give it to the tasker only after the job is done and they are happy. The tasker enters it and the payment is released.' },
      { id: 'problem', target: ['#requestBtn'], placement: 'top', fallback: 'center',
        title: 'Something wrong? Use Actions',
        description: 'If the work is not right, the customer can Request Changes or Report an Issue from Actions. A release code never overrides a payment that is in dispute.' },
      { id: 'extras', title: 'Extra costs need approval',
        description: 'Transport, materials or extra work are sent as a request. The customer pays it or declines it, and nothing is added without their say-so.' },
      { id: 'done', title: 'You know how payments work',
        description: 'You can replay this tour any time from Help / Learn.' }
    ]
  };

  var TOURS = [customerChat, taskerChat, payments];

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

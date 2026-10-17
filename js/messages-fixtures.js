/* ============================================================
   STREETTASKER — messages-fixtures.js   (Job Room, Stage 1)
   DEV ONLY. Renders sample messages for messages-fixtures.html using the
   real renderers in js/messages-thread.js (JRThread.preview).

   Everything here is sample data. Nothing is read from or written to the
   database, no payment is started, and the buttons on the money / request
   cards only show a note. Delete this file and the page when the card
   library (Stage 2) has its own reference page.
   ============================================================ */
'use strict';

(function () {

  var NOW = new Date().toISOString();

  /* The money and request cards call these. Stubs so the sample buttons do nothing real. */
  function note() { JRThread.toast('Sample card. This button is not connected.'); }
  window.JRMoney = {
    KINDS: { additional_cost: { title: 'Additional cost' }, full_payment: { title: 'Full payment' } },
    isAddon: function (k) { return k === 'transport' || k === 'additional_cost'; },
    pay: note, respond: note
  };
  window.JRRequests = {
    KINDS: { proof: { title: 'Proof of work requested', byMe: 'You asked for photos or proof of the work.', byOther: 'The customer would like photos or proof of the work.' } }
  };

  /* from: who sent it. Each column treats its own role as "mine". */
  var SAMPLES = [
    { from: 'system',   type: 'safety', body: '' },
    { from: 'customer', type: 'text', body: 'Hi, are you free tomorrow morning to fix the kitchen tap?' },
    { from: 'tasker',   type: 'text', body: 'Yes, I can be there by 9am. I am almost done with another job.' },
    { from: 'tasker',   type: 'image', meta: { url: 'images/illustrations/repairs.svg', alt: 'Sample photo of a repair', caption: 'Sample photo with a caption' } },
    { from: 'customer', type: 'image', meta: { url: '', caption: 'Photo not available (placeholder)' } },
    { from: 'tasker',   type: 'video', meta: { poster: 'images/lt-banner-mobile.jpg', duration: '0:24', caption: 'Sample video (poster only)' } },
    { from: 'customer', type: 'file',  meta: { name: 'Pipe-layout.pdf', size: 248000, mime: 'application/pdf' } },
    { from: 'customer', type: 'location', meta: { label: 'Job address', address: '12 Admiralty Way, Lekki, Lagos', lat: 6.4474, lng: 3.4723 } },
    { from: 'system',   type: 'system', body: 'Work started' },
    { from: 'customer', type: 'job_request', body: 'JOB_REQUEST:fxr1:proof', request: true },
    { from: 'tasker',   type: 'payment_request', body: 'PAYMENT_REQUEST:fxm1:10000', payment_request_id: 'fxm1', money: true },
    { from: 'customer', type: 'payment_confirmed', body: 'PAYMENT_CONFIRMED:123456:50000:45000:5000' }
  ];

  function render(hostId, role) {
    var host = document.getElementById(hostId);
    if (!host) return;
    JRThread.previewSetup(role, 'me-' + role);

    JRThread.registerMoney({
      id: 'fxm1', kind: 'additional_cost', amount: 10000, status: 'pending',
      reason: 'Replacement pipe and additional labour.', breakdown: { work: 7000, materials: 3000 }
    });
    JRThread.registerRequest({ id: 'fxr1', kind: 'proof', status: 'pending', requested_by: role === 'customer' ? 'me-customer' : 'customer-user' });

    SAMPLES.forEach(function (s) {
      var m = Object.assign({ created_at: NOW }, s);
      var mine = s.from === role;
      /* preview() sets sender_id from isMine; system / safety notices have no sender */
      host.appendChild(JRThread.preview(m, mine));
    });
  }

  render('fxCustomer', 'customer');
  render('fxTasker', 'tasker');

})();

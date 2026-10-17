/* ============================================================
   STREETTASKER — messages-cards-demo.js   (Job Room, Stage 2)
   DEV ONLY. Draws every card in js/messages-cards.js in every state, for
   either role, on messages-cards.html. Sample data only; buttons show a note.
   ============================================================ */
'use strict';

(function () {

  var SAMPLE = {
    payment_request:   { amount: 40000, reason: 'Agreed price for the kitchen sink repair.' },
    remaining_payment: { amount: 25000, reason: 'Remaining balance after the first payment.' },
    transport_request: { amount: 3500, agreedPrice: 40000, reason: 'To bring the replacement pump from the market.' },
    additional_cost:   { amount: 10000, agreedPrice: 40000, reason: 'Replacement pipe and additional labour.', breakdown: [{ label: 'Additional work', amount: 7000 }, { label: 'Materials', amount: 3000 }] },
    custom_expense:    { amount: 2000, agreedPrice: 40000, reason: 'Parking fee at the estate gate.' },
    invoice:           { amount: 16500, number: 'ST-10482', title: 'Kitchen Sink Repair', dueDate: '20 Oct 2026',
                         lines: [{ label: 'Labour', amount: 10000 }, { label: 'Replacement valve', amount: 4500 }, { label: 'Transport', amount: 2000 }] },
    receipt:           { number: 'RC-20931', rows: [['Paid on', '17 Oct 2026'], ['Method', 'Card'], ['For', 'Fix Kitchen Sink'], ['Amount', '₦40,000']] },
    refund_status:     { amount: 40000, reason: 'Task cancelled before work started.' },
    work_update:       { rows: [['Estimated arrival', '9:00 AM']] },
    proof_of_work:     { thumbs: ['images/illustrations/repairs.svg', 'images/illustrations/assembly.svg', 'images/illustrations/cleaning.svg'], text: '3 photos from the Tasker (optional).' },
    completion_submission: { rows: [['Task', 'Fix Kitchen Sink']] },
    release_code_entry:    { rows: [['Task', 'Fix Kitchen Sink']] },
    arrival_update:    { rows: [['Estimated arrival', '9:15 AM']] },
    reschedule_request: { by: 'tasker', rows: [['Current', 'Saturday, 10:00 AM'], ['Proposed', 'Saturday, 2:00 PM'], ['Reason', 'I need time to get the required materials.']] },
    cancellation_request: { by: 'customer', rows: [['Reason', 'No longer needed'], ['Financial result', '₦40,000 refunded to the customer']] },
    evidence_request:  { by: 'customer', rows: [['Requested', 'Photo of the finished repair']] },
    issue_report:      { rows: [['Reason', 'Work incomplete'], ['Description', 'The tap still leaks at the base.'], ['Evidence', '1 photo attached']] },
    dispute_status:    { rows: [['Task', 'Fix Kitchen Sink'], ['Amount in dispute', '₦40,000']] }
  };

  /* The customer only sees the release code if the server sent it. */
  function dataFor(kind, state, role) {
    var d = Object.assign({}, SAMPLE[kind] || {});
    if (kind === 'release_code_entry' && state === 'awaiting_code' && role === 'customer') d.code = '482915';
    return d;
  }

  var role = 'customer';

  function note(id) { JRThread.toast('Sample card. "' + id + '" is not connected.'); }

  function draw() {
    var root = document.getElementById('cardsRoot');
    var nav = document.getElementById('cardsNav');
    root.textContent = ''; nav.textContent = '';
    Object.keys(JRCards.KINDS).forEach(function (kind) {
      var def = JRCards.KINDS[kind];
      var link = document.createElement('a');
      link.className = 'jr-cards-link'; link.href = '#k-' + kind; link.textContent = def.title;
      nav.appendChild(link);

      var sec = document.createElement('section');
      sec.className = 'jr-cards-kind'; sec.id = 'k-' + kind;
      var h = document.createElement('h2'); h.textContent = def.title + ' (' + Object.keys(def.states).length + ' states)';
      sec.appendChild(h);
      var grid = document.createElement('div'); grid.className = 'jr-cards-grid';
      Object.keys(def.states).forEach(function (state) {
        var cell = document.createElement('div'); cell.className = 'jr-cards-cell';
        var lab = document.createElement('div'); lab.className = 'jr-cards-state'; lab.textContent = state;
        cell.appendChild(lab);
        cell.appendChild(JRCards.message({ kind: kind, state: state, role: role, data: dataFor(kind, state, role) }, { onAction: note }));
        grid.appendChild(cell);
      });
      sec.appendChild(grid);
      root.appendChild(sec);
    });
  }

  function setRole(r) {
    role = r;
    var c = document.getElementById('roleCustomer'), t = document.getElementById('roleTasker');
    c.setAttribute('aria-pressed', r === 'customer'); t.setAttribute('aria-pressed', r === 'tasker');
    c.classList.toggle('jr-req-btn--primary', r === 'customer');
    t.classList.toggle('jr-req-btn--primary', r === 'tasker');
    draw();
  }

  document.getElementById('roleCustomer').addEventListener('click', function () { setRole('customer'); });
  document.getElementById('roleTasker').addEventListener('click', function () { setRole('tasker'); });
  draw();

})();

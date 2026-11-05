/* ============================================================
   STREET TASKERS — drafts.js
   My drafts page (drafts.html): lists the task drafts saved on this
   device (see task-drafts.js), lets the person continue or delete one.
   Continue puts the draft in the Post a Task form and opens that page.
   ============================================================ */
'use strict';

(function () {
  var CATEGORY_LABELS = {
    cleaning: 'Home & Office Cleaning', electrician: 'Electrician', plumber: 'Plumber', mechanic: 'Mechanic / Auto',
    carpentry: 'Carpentry', barber: 'Barber / Hair', beauty: 'Make-up / Beauty', delivery: 'Delivery',
    moving: 'Moving', painting: 'Painting', other: 'Other'
  };

  function $(id) { return document.getElementById(id); }

  function ago(ts) {
    var mins = Math.floor((Date.now() - (ts || 0)) / 60000);
    if (mins < 1) return 'Saved just now';
    if (mins < 60) return 'Saved ' + mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return 'Saved ' + hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    return 'Saved ' + days + (days === 1 ? ' day ago' : ' days ago');
  }

  function naira(raw) {
    var n = parseInt(String(raw || '').replace(/[^\d]/g, ''), 10);
    return isNaN(n) ? '' : '\u20A6' + n.toLocaleString('en-NG');
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function chip(text, withPin) {
    var c = el('span', 'dr-chip');
    if (withPin) {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'pt-i'); svg.setAttribute('aria-hidden', 'true');
      var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-pin'); svg.appendChild(use); c.appendChild(svg);
    }
    c.appendChild(document.createTextNode(text));
    return c;
  }

  function card(row) {
    var d = row.data || {};
    var wrap = el('article', 'pt-card dr-card');

    var top = el('div', 'dr-card-top');
    var title = el('h2', 'dr-title' + (d.title ? '' : ' is-untitled'), d.title || 'Untitled task');
    top.appendChild(title);
    top.appendChild(el('span', 'dr-saved', ago(row.savedAt)));
    wrap.appendChild(top);

    var meta = el('div', 'dr-meta');
    if (d.category && CATEGORY_LABELS[d.category]) meta.appendChild(chip(CATEGORY_LABELS[d.category], false));
    if (d.location && d.locArea === '1') meta.appendChild(chip(d.location, true));
    if (naira(d.budget)) meta.appendChild(chip(naira(d.budget), false));
    if (meta.children.length) wrap.appendChild(meta);

    if (d.description) wrap.appendChild(el('p', 'dr-desc', d.description));

    var actions = el('div', 'dr-actions');
    var cont = el('button', 'btn btn-primary', 'Continue');
    cont.type = 'button';
    cont.addEventListener('click', function () {
      if (window.TaskDrafts && TaskDrafts.openInForm(row.id)) window.location.href = 'post-task.html';
      else if (typeof showToast === 'function') showToast('Could not open this draft. Please try again.');
    });
    var del = el('button', 'dr-delete', 'Delete');
    del.type = 'button';
    del.addEventListener('click', function () {
      if (!window.confirm('Delete this draft? This cannot be undone.')) return;
      TaskDrafts.remove(row.id);
      render();
      if (typeof showToast === 'function') showToast('Draft deleted.');
    });
    actions.appendChild(cont); actions.appendChild(del);
    wrap.appendChild(actions);
    return wrap;
  }

  function render() {
    var rows = TaskDrafts.list();
    var list = $('draftList');
    list.textContent = '';
    rows.forEach(function (r) { list.appendChild(card(r)); });
    $('draftEmpty').hidden = rows.length > 0;
  }

  TaskDrafts.init().then(render);
})();

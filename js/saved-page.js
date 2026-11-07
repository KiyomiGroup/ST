/* StreetTasker Saved & Favourites page (saved.html). Lists what STSaved holds; the filter tabs and the remove button live here.
   Every piece of text is set with textContent, and links only go to this site's own pages. */
(function () {
  'use strict';
  var doc = document;
  var NS = 'http://www.w3.org/2000/svg';
  var filter = 'all';

  function $(id) { return doc.getElementById(id); }
  function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function svg(d, extra) {
    var s = doc.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('fill', extra === 'fill' ? 'currentColor' : 'none');
    var p = doc.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p);
    return s;
  }
  var BOOKMARK = 'M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z';
  var HEART = 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 12 5.7 5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z';

  /* Only same-site relative pages, never javascript: or another site */
  function safeHref(h) {
    h = String(h || '');
    if (!h || /^[a-z][a-z0-9+.-]*:/i.test(h) || h.indexOf('//') === 0) return '';
    return h;
  }
  function safeImg(u) { u = String(u || ''); return /^(https:\/\/|images\/|\/images\/|data:image\/)/i.test(u) ? u : ''; }

  function card(item) {
    var li = el('li', 'sv-item');
    var href = safeHref(item.href);

    var thumb = el('div', 'sv-thumb');
    var img = safeImg(item.image);
    if (img) {
      var im = doc.createElement('img'); im.src = img; im.alt = ''; im.loading = 'lazy';
      im.addEventListener('error', function () { im.remove(); thumb.appendChild(svg(item.type === 'service' ? HEART : BOOKMARK)); });
      thumb.appendChild(im);
    } else thumb.appendChild(svg(item.type === 'service' ? HEART : BOOKMARK));
    li.appendChild(thumb);

    var body = el('div', 'sv-body');
    body.appendChild(el('span', 'sv-kind', item.type === 'service' ? 'Service' : 'Task'));
    var h = el('h3', 'sv-title');
    if (href) { var a = el('a', null, item.title || 'Saved item'); a.href = href; h.appendChild(a); } else h.textContent = item.title || 'Saved item';
    body.appendChild(h);
    var line = [item.type === 'service' ? item.provider : item.place, item.category].filter(Boolean).join(' · ');
    if (line) body.appendChild(el('p', 'sv-meta', line));
    if (item.price) body.appendChild(el('p', 'sv-meta sv-price', item.price));
    li.appendChild(body);

    var rm = el('button', 'sv-remove');
    rm.type = 'button';
    rm.setAttribute('aria-label', 'Remove ' + (item.title || 'item') + ' from saved');
    rm.appendChild(svg(item.type === 'service' ? HEART : BOOKMARK, 'fill'));
    rm.addEventListener('click', function () {
      window.STSaved.remove(item.type, item.id);
      if (typeof window.showToast === 'function') window.showToast('Removed from saved');
    });
    li.appendChild(rm);
    return li;
  }

  function render() {
    var all = window.STSaved ? window.STSaved.list() : [];
    var tasks = all.filter(function (x) { return x.type === 'task'; });
    var services = all.filter(function (x) { return x.type === 'service'; });
    $('svCountAll').textContent = all.length;
    $('svCountTask').textContent = tasks.length;
    $('svCountService').textContent = services.length;

    var shown = filter === 'task' ? tasks : filter === 'service' ? services : all;
    var list = $('svList');
    list.textContent = '';
    shown.forEach(function (x) { list.appendChild(card(x)); });

    var empty = $('svEmpty');
    empty.hidden = shown.length > 0;
    if (!shown.length) {
      var t = filter === 'task' ? 'No saved tasks yet' : filter === 'service' ? 'No favourite services yet' : 'Nothing saved yet';
      var d = filter === 'task' ? 'Tap the bookmark on a task and it will wait for you here.'
            : filter === 'service' ? 'Tap the heart on a service and it will wait for you here.'
            : 'Tap the bookmark on a task or the heart on a service and it will wait for you here.';
      $('svEmptyTitle').textContent = t;
      $('svEmptyText').textContent = d;
      $('svBrowseTasks').hidden = filter === 'service';
      $('svBrowseServices').hidden = filter === 'task';
    }
  }

  function init() {
    window.STSaved.migrate();
    doc.querySelectorAll('.sv-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        filter = b.getAttribute('data-filter');
        doc.querySelectorAll('.sv-tab').forEach(function (o) {
          var on = o === b; o.classList.toggle('is-on', on); o.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        render();
      });
    });
    window.addEventListener('st:saved-changed', render);
    window.addEventListener('storage', render);
    var q = new URLSearchParams(location.search).get('tab');
    if (q === 'task' || q === 'service') { var t = doc.querySelector('.sv-tab[data-filter="' + q + '"]'); if (t) t.click(); else render(); } else render();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})();

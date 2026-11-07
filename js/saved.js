/* StreetTasker saved and favourite items.
   One small store shared by every page: the bookmark on a task card, the heart on a service card and the save button on
   the task page all read and write it, and saved.html lists it.
   Saved on THIS DEVICE (localStorage), per signed-in account, the same way drafts are. Each entry keeps a small snapshot
   (title, price, place, picture, link) so the saved page can show it instantly, even offline.
   All text is set with textContent on the saved page, never innerHTML. */
(function (root) {
  'use strict';
  var doc = root.document;
  var MAX = 200;

  function uid() { try { return root.localStorage.getItem('st_uid') || 'guest'; } catch (e) { return 'guest'; } }
  function key() { return 'st_saved_items_v1:' + uid(); }

  function read() {
    try {
      var v = JSON.parse(root.localStorage.getItem(key()) || '[]');
      return Array.isArray(v) ? v.filter(function (x) { return x && x.id && (x.type === 'task' || x.type === 'service'); }) : [];
    } catch (e) { return []; }
  }
  function write(list) {
    try { root.localStorage.setItem(key(), JSON.stringify(list.slice(0, MAX))); return true; } catch (e) { return false; }
  }
  function same(a, type, id) { return a.type === type && String(a.id) === String(id); }

  /* The old task-page list (ids only) is folded in once, so nothing a person already saved is lost */
  function migrate() {
    try {
      var old = JSON.parse(root.localStorage.getItem('st_saved_task_ids') || '[]');
      if (!Array.isArray(old) || !old.length) return;
      var list = read();
      old.forEach(function (id) {
        if (!list.some(function (x) { return same(x, 'task', id); })) {
          list.push({ type: 'task', id: String(id), title: 'Saved task', href: 'task-details.html?id=' + encodeURIComponent(id), savedAt: Date.now() });
        }
      });
      write(list);
      root.localStorage.removeItem('st_saved_task_ids');
    } catch (e) {}
  }

  function has(type, id) { return read().some(function (x) { return same(x, type, id); }); }

  /* item: { type, id, title, href, price, place, image, category, provider } ; returns true when it is now saved */
  function toggle(item) {
    var list = read(), at = -1, i;
    for (i = 0; i < list.length; i++) { if (same(list[i], item.type, item.id)) { at = i; break; } }
    if (at !== -1) { list.splice(at, 1); write(list); changed(); return false; }
    item.savedAt = Date.now();
    list.unshift(item);
    if (!write(list)) return null;
    changed();
    return true;
  }
  function remove(type, id) {
    write(read().filter(function (x) { return !same(x, type, id); }));
    changed();
  }
  function changed() {
    try { root.dispatchEvent(new CustomEvent('st:saved-changed')); } catch (e) {}
  }

  /* ── Reading a card on the page ── */
  function txt(card, sel) { var n = card.querySelector(sel); return n ? (n.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function pic(card) {
    var imgs = card.querySelectorAll('.st-home-media img, .st-card-media img');
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      if (im.classList.contains('st-card-ph-logo') || im.getAttribute('aria-hidden') === 'true') continue;
      var s = im.getAttribute('src') || '';
      if (s) return s;
    }
    return '';
  }
  function fromCard(card) {
    if (!card) return null;
    var taskId = card.getAttribute('data-task-id');
    var svcId = card.getAttribute('data-service-id');
    var href = card.getAttribute('data-href') || '';
    if (taskId) {
      return {
        type: 'task', id: taskId,
        title: txt(card, '.st-home-title, .st-card-title') || 'Task',
        href: 'task-details.html?id=' + encodeURIComponent(taskId),
        price: txt(card, '.st-home-price, .st-card-price'),
        place: txt(card, '.st-home-loc, .st-card-meta li:first-child'),
        category: txt(card, '.st-chip--category'),
        image: pic(card)
      };
    }
    if (svcId || href) {
      return {
        type: 'service', id: svcId || href,
        title: txt(card, '.st-home-title, .st-card-title') || 'Service',
        href: href || '',
        price: txt(card, '.st-home-price, .st-card-price'),
        provider: txt(card, '.st-home-provider-name'),
        category: txt(card, '.st-chip--glass, .st-chip--category'),
        image: pic(card)
      };
    }
    return null;
  }

  function toast(msg) { if (root.showToast) root.showToast(msg); }

  function paintBtn(btn, on) {
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function paintAll() {
    if (!doc) return;
    var btns = doc.querySelectorAll('.st-card-save, .st-home-save');
    for (var i = 0; i < btns.length; i++) {
      var item = fromCard(btns[i].closest('article'));
      if (item) paintBtn(btns[i], has(item.type, item.id));
    }
  }

  if (doc) {
    doc.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('.st-card-save, .st-home-save');
      if (!btn) return;
      var item = fromCard(btn.closest('article'));
      if (!item) return;
      ev.preventDefault();
      var now = toggle(item);
      if (now === null) { toast('Could not save on this device.'); return; }
      paintBtn(btn, now);
      toast(now ? (item.type === 'service' ? 'Added to your favourites' : 'Task saved') : 'Removed from saved');
    });

    /* Cards are drawn after load (and again on filters and Load more): paint the ones that arrive */
    var queued = false;
    function queue() { if (queued) return; queued = true; root.setTimeout(function () { queued = false; paintAll(); }, 60); }
    function start() {
      migrate();
      paintAll();
      if (root.MutationObserver && doc.body) new MutationObserver(queue).observe(doc.body, { childList: true, subtree: true });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
    root.addEventListener('st:saved-changed', paintAll);
    root.addEventListener('storage', paintAll);
  }

  root.STSaved = { list: read, has: has, toggle: toggle, remove: remove, migrate: migrate };
})(window);

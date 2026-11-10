/* StreetTasker Admin: shared helpers for the two-step change flow (stage A5d). Used by team.html and roles.html.
   AdminChange.form(opts)          a reason box plus buttons that each ask twice (the second press shows exactly what will be asked)
   AdminChange.mine(ctx, opts)     the "Your change requests" panel: waiting requests, and approved ones with an Apply button
   Nothing here decides anything: the server (admin_*_request_change, admin_*_apply_change) checks every rule again.
   All text via textContent. */
'use strict';
(function () {
  var uid = 0;
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function words(s) { var t = String(s == null ? '' : s).replace(/[._]/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  function when(v) { var d = new Date(v); return isNaN(d) ? '' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }); }
  function left(sec) {
    if (sec == null) return '';
    if (sec <= 0) return 'Expired';
    var m = Math.floor(sec / 60), hr = Math.floor(m / 60), d = Math.floor(hr / 24);
    if (d >= 1) return 'Expires in ' + d + (d === 1 ? ' day ' : ' days ') + (hr % 24) + ' h';
    if (hr >= 1) return 'Expires in ' + hr + ' h ' + (m % 60) + ' min';
    return 'Expires in ' + Math.max(1, m) + ' min';
  }

  /* opts: { reasonLabel, buttons: [{ label, primary, min, sure, check(), fn, args(text), done }], onDone(), extra: [nodes put above the reason] } */
  function form(opts) {
    var f = h('form', 'ad-form'); f.noValidate = true;
    uid += 1; var rid = 'acWhy' + uid;
    var lab = h('label', 'ad-filter-label', opts.reasonLabel || 'Reason (at least 10 characters; it goes in the activity log)'); lab.htmlFor = rid;
    var reason = h('textarea', 'form-input'); reason.id = rid; reason.rows = 3; reason.maxLength = 300;
    var err = h('p', 'ad-error'); err.hidden = true; err.setAttribute('role', 'alert');
    var sure = h('p', 'ad-note'); sure.hidden = true; sure.setAttribute('aria-live', 'polite');
    var bar = h('div', 'ad-actions ad-actions--tight'); var armed = null; var btns = [];
    function disarm() { armed = null; sure.hidden = true; btns.forEach(function (x) { x.el.textContent = x.def.label; }); }
    opts.buttons.forEach(function (def) {
      var b = h('button', 'btn ' + (def.primary ? 'btn-primary' : 'btn-outline'), def.label); b.type = 'button';
      btns.push({ el: b, def: def });
      b.addEventListener('click', async function () {
        err.hidden = true;
        var text = reason.value.trim();
        var bad = def.check ? def.check() : null;
        if (bad) { err.textContent = bad; err.hidden = false; disarm(); return; }
        if (text.length < 10) { err.textContent = 'Write a reason of at least 10 characters.'; err.hidden = false; disarm(); return; }
        if (armed !== def) { disarm(); armed = def; b.textContent = 'Press again to confirm'; sure.textContent = def.sure(); sure.hidden = false; return; }
        btns.forEach(function (x) { x.el.disabled = true; });
        var res;
        try { res = await window.supabase.rpc(def.fn, def.args(text)); } catch (e) { res = { error: e }; }
        btns.forEach(function (x) { x.el.disabled = false; });
        disarm();
        var r = res && res.data;
        if (res.error || !r) { err.textContent = (res.error && res.error.code === '42501') ? 'You do not have permission to do this.' : 'The server could not answer. Nothing was changed.'; err.hidden = false; return; }
        if (!r.ok) { err.textContent = r.error || 'It could not be done. Nothing was changed.'; err.hidden = false; return; }
        if (opts.onDone) opts.onDone(def.done);
      });
      bar.appendChild(b);
    });
    reason.addEventListener('input', disarm);
    (opts.extra || []).forEach(function (n) { f.appendChild(n); });
    add(f, lab, reason, err, sure, bar);
    return f;
  }

  /* opts: { action, applyFn, describe(row) -> string, onDone() }.  Returns { node, load() }. */
  function mine(ctx, opts) {
    var node = h('section', 'ad-card'); node.hidden = true;
    async function load() {
      var res;
      try { res = await window.supabase.rpc('admin_team_changes_mine'); } catch (e) { res = { error: e }; }
      clear(node);
      var rows = (res && !res.error && res.data && res.data.rows || []).filter(function (r) { return r.action === opts.action; });
      if (!rows.length) { node.hidden = true; return; }
      node.hidden = false;
      node.appendChild(h('h2', 'ad-card-title', 'Your change requests'));
      node.appendChild(h('p', 'ad-note', 'A change happens only after a different Super Admin approves it on the Pending approvals page. Then you apply it here, once, before it expires.'));
      var ul = h('ul', 'ad-rows');
      rows.forEach(function (r) {
        var li = h('li');
        var box = h('div', 'ad-panel');
        var top = add(h('div', 'ad-row-top'), h('strong', null, (r.target_label || r.target_id) + ': ' + opts.describe(r)),
          h('span', 'badge ' + (r.status === 'approved' ? 'badge-green' : 'badge-blue'), r.status === 'approved' ? 'Approved' : 'Waiting for approval'));
        box.appendChild(top);
        box.appendChild(h('p', 'ad-hint', ['Asked ' + when(r.requested_at), left(r.seconds_left)].filter(Boolean).join(' \u00b7 ')));
        if (r.status === 'approved') {
          var err = h('p', 'ad-error'); err.hidden = true; err.setAttribute('role', 'alert');
          var b = h('button', 'btn btn-primary', 'Apply the approved change'); b.type = 'button'; var armed = false;
          b.addEventListener('click', async function () {
            err.hidden = true;
            if (!armed) { armed = true; b.textContent = 'Press again to apply now'; return; }
            b.disabled = true;
            var rr;
            try { rr = await window.supabase.rpc(opts.applyFn, { p_approval: r.id }); } catch (e) { rr = { error: e }; }
            b.disabled = false; armed = false; b.textContent = 'Apply the approved change';
            var d = rr && rr.data;
            if (rr.error || !d) { err.textContent = (rr.error && rr.error.code === '42501') ? 'You do not have permission to do this.' : 'The server could not answer. Nothing was changed.'; err.hidden = false; return; }
            if (!d.ok) { err.textContent = d.error || 'It could not be applied. Nothing was changed.'; err.hidden = false; return; }
            ctx.toast('The change was applied.'); if (opts.onDone) opts.onDone();
          });
          add(box, err, add(h('div', 'ad-actions ad-actions--tight'), b));
        } else {
          box.appendChild(h('p', 'ad-note', 'Waiting for another Super Admin to approve it.'));
        }
        ul.appendChild(add(li, box));
      });
      node.appendChild(ul);
    }
    return { node: node, load: load };
  }

  window.AdminChange = { form: form, mine: mine, words: words, h: h, add: add, clear: clear };
})();

/* ============================================================
   StreetTasker — coordinator-publish.js (Stage 4C-1)
   Preview and publish ONE Local Tasker: coordinator-publish.html?id=<tasker user id>
   The browser never sets a status. It asks the database:
     - local_tasker_publish_status(p_tasker)    the checklist (who may see it is decided in the database)
     - publish_local_tasker(p_tasker)           the only way to go public; refuses unless every blocking check passes
     - unpublish_local_tasker(p_tasker, p_reason)
   The preview is read under the coordinator's own access (RLS), exactly as the customer-facing
   fields will be copied by the publish function. Every failure shows its error code on screen.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  function $(id) { return document.getElementById(id); }
  var last = null, busy = false, taskerId = null, state = null;

  /* label, whether there is a place to fix it (a page), and the page */
  var CHECKS = {
    not_retired:       { label: 'Profile is active (not retired)' },
    public_name:       { label: 'Public name is set' },
    tasker_row:        { label: 'Public profile record exists' },
    agreement_profile: { label: 'Profile agreement is on record' },
    agreement_publish: { label: 'Agreement to publish their information and rate is on record', fix: 'service' },
    agreement_photos:  { label: 'Photos agreement is on record (needed when there are photos)', fix: 'photos' },
    service:           { label: 'At least one active service with an agreed price', fix: 'service' },
    private_clear:     { label: 'No private contact details on the public record' },
    verification:      { label: 'Verification recorded' },
    photo:             { label: 'At least one photo' }
  };
  var FIX_TEXT = { service: 'Add or edit a service', photos: 'Manage photos' };
  var UNIT = { '/job': 'job', '/hour': 'hour', '/day': 'day', '/visit': 'visit', '/session': 'session' };

  var MESSAGES = {
    not_found: "This Local Tasker isn't assigned to you any more, or your coordinator account isn't active. Nothing was changed.",
    not_ready: 'Not everything on the checklist is done yet. Nothing was published. The checklist above has been refreshed.',
    bad_input: 'That reason is too long. Please shorten it.',
    unauthenticated: 'Your sign-in has expired. Please sign in again, then come back to this page.',
    network: "We couldn't reach the server. Nothing was confirmed. Reload the page to see the current state before trying again.",
    server_error: 'Something went wrong on our side. Please reload the page to see the current state, then try again.',
    bad_response: 'The server answered in a way we did not expect. Reload the page to see the current state.'
  };

  function money(n) { var x = Number(n); return isFinite(x) ? '\u20A6' + x.toLocaleString('en-NG', { maximumFractionDigits: 2 }) : ''; }
  function show(which) {
    ['coEditLoading', 'coEditLoadError', 'coEditMissing', 'coEditLayout'].forEach(function (id) { var n = $(id); if (n) n.hidden = (id !== which); });
  }
  function clearMessages() { $('coPubError').hidden = true; $('coPubNotice').hidden = true; }
  function showError(code, raw) {
    $('coPubErrorText').textContent = MESSAGES[code] || 'Something went wrong. Please try again, and quote the error code if it keeps happening.';
    $('coPubErrorCode').textContent = 'Error code: ' + code + (raw ? ' (' + raw + ')' : '');
    var b = $('coPubError'); b.hidden = false; b.focus();
  }
  function showNotice(text) { $('coPubNoticeText').textContent = text; var b = $('coPubNotice'); b.hidden = false; b.focus(); }
  function fieldError(id, msg) {
    var err = $(id + 'Err'), input = $(id);
    if (!err) return;
    err.textContent = msg || ''; err.hidden = !msg;
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function failureFrom(error) {
    var hint = error && error.hint, code = error && error.code;
    if (hint) return { code: hint, message: error.message };
    if (code === '42501') return { code: 'unauthenticated', raw: code };
    if (error && (error.status === 401 || error.status === 403)) return { code: 'unauthenticated', raw: String(error.status) };
    if (code || (error && error.message && !/fetch|network/i.test(error.message))) return { code: 'server_error', raw: code || null };
    return { code: 'network' };
  }
  function fixHref(kind) {
    if (kind === 'service') return 'coordinator-service-edit.html?id=' + encodeURIComponent(taskerId);
    if (kind === 'photos') return 'coordinator-photos.html?id=' + encodeURIComponent(taskerId);
    return null;
  }

  /* ---------- checklist ---------- */
  function paintChecks(res) {
    var list = $('coPubChecks'); list.textContent = '';
    var checks = Array.isArray(res.checks) ? res.checks : [];
    var missing = 0;
    checks.forEach(function (c) {
      var meta = CHECKS[c.key] || { label: c.key };
      var advice = !c.blocking;
      var li = C.el('li', 'co-check-item' + (c.ok ? ' is-done' : '') + (!c.ok && !advice ? ' is-bad' : '') + (advice ? ' is-advice' : ''));
      li.appendChild(C.el('span', 'co-check-mark'));
      li.appendChild(C.el('span', 'co-check-text', meta.label + (advice ? ' (recommended)' : '')));
      if (!c.ok && meta.fix) {
        var a = C.el('a', 'co-fact-link', FIX_TEXT[meta.fix]); a.href = fixHref(meta.fix); li.appendChild(a);
      }
      if (!c.ok && !advice) missing++;
      list.appendChild(li);
    });
    list.hidden = !checks.length;
    var hint = $('coPubChecksHint');
    if (res.ready) { hint.textContent = 'Everything needed is done. Review the customer view, then publish.'; }
    else { hint.textContent = missing + (missing === 1 ? ' thing needs' : ' things need') + ' attention before you can publish. Items marked recommended do not block publishing.'; }
    hint.hidden = false;
  }

  /* ---------- state of the action card ---------- */
  function paintActions() {
    var s = state.status, ready = !!state.ready;
    $('coPubActionsCard').hidden = false;
    $('coPubDraftBox').hidden = !(s === 'draft' || s === 'ready');
    $('coPubLiveBox').hidden = s !== 'published';
    $('coPubRetired').hidden = s !== 'inactive';
    $('coPubUnpublishBox').hidden = true;
    $('coPubUnpublishOpen').hidden = false;
    $('coPubPublish').disabled = !ready;
    var st = $('coPubStatus'); st.textContent = '';
    st.appendChild(C.el('span', 'co-status ' + (s === 'published' ? 'co-status--published' : s === 'inactive' ? 'co-status--inactive' : 'co-status--draft'),
      s === 'published' ? 'Published' : s === 'inactive' ? 'Retired' : s === 'ready' ? 'Hidden' : 'Draft'));
    $('coPubRefresh').disabled = !ready;
    var live = $('coPubLiveText');
    live.textContent = ready ? 'This person is live. Customers can find them now.'
      : 'This person is live, but something on the checklist is no longer complete. Fix it, or unpublish.';
  }

  /* ---------- preview ---------- */
  function primaryService(rows) {
    var act = (rows || []).filter(function (s) { return s.available === true && Number(s.price) > 0; });
    act.sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')); });
    return act[0] || null;
  }
  function paintPreview(profile, publicName, services, photos, urlMap) {
    var name = publicName && String(publicName).trim();
    $('coPvName').textContent = name || 'Public name not set';
    var svc = primaryService(services);
    $('coPvAreaText').textContent = (svc && svc.location) || profile.areas_served || 'Area not set';
    var skills = $('coPvSkills'); skills.textContent = ''; skills.hidden = true;
    if (!svc) {
      $('coPvService').textContent = ''; $('coPvRate').textContent = ''; $('coPvDesc').textContent = '';
      $('coPvEmpty').hidden = false;
    } else {
      $('coPvEmpty').hidden = true;
      $('coPvService').textContent = svc.service_name || '';
      $('coPvRate').textContent = money(svc.price) + (UNIT[svc.rate_unit] ? ' per ' + UNIT[svc.rate_unit] : '');
      $('coPvDesc').textContent = svc.description || '';
      var sp = Array.isArray(svc.specialties) ? svc.specialties.filter(Boolean) : [];
      sp.forEach(function (x) { skills.appendChild(C.el('li', 'co-chip co-chip--light', x)); });
      skills.hidden = !sp.length;
    }
    var box = $('coPvPhotos'); box.textContent = ''; box.hidden = true;
    (photos || []).slice(0, 3).forEach(function (p, i) {
      var li = C.el('li', 'co-photo-thumb');
      if (urlMap[p.storage_path]) {
        var img = C.el('img'); img.src = urlMap[p.storage_path]; img.alt = p.caption || ('Photo ' + (i + 1)); img.loading = 'lazy'; li.appendChild(img);
      } else { li.appendChild(C.el('span', 'co-photo-missing', 'Unavailable')); }
      box.appendChild(li);
    });
    box.hidden = !box.childNodes.length;
  }

  async function loadPhotos() {
    try {
      var res = await window.supabase.from('local_tasker_photos')
        .select('id, storage_path, caption, is_cover, created_at')
        .eq('tasker_user_id', taskerId).is('removed_at', null)
        .order('is_cover', { ascending: false }).order('created_at', { ascending: true });
      if (res.error) throw res.error;
      var rows = (res.data || []).slice().sort(function (a, b) {
        if (!!a.is_cover !== !!b.is_cover) return a.is_cover ? -1 : 1;
        return String(a.created_at || '').localeCompare(String(b.created_at || ''));
      });
      var map = {};
      if (rows.length) {
        try {
          var s = await window.supabase.storage.from('local-tasker-photos').createSignedUrls(rows.slice(0, 3).map(function (r) { return r.storage_path; }), 3600);
          if (!s.error) (s.data || []).forEach(function (d) { if (d && d.signedUrl && !d.error) map[d.path] = d.signedUrl; });
        } catch (e) { console.error('[coordinator publish photo links]', e); }
      }
      return { rows: rows, map: map };
    } catch (e) {
      console.error('[coordinator publish photos]', e);
      return { rows: [], map: {} };
    }
  }

  async function loadStatus() {
    ['coPubChecksError'].forEach(function (x) { $(x).hidden = true; });
    $('coPubChecksLoading').hidden = false; $('coPubChecks').hidden = true; $('coPubChecksHint').hidden = true;
    try {
      var res = await window.supabase.rpc('local_tasker_publish_status', { p_tasker: taskerId });
      if (res.error) throw res.error;
      var d = res.data;
      if (!d || typeof d.ready !== 'boolean' || !Array.isArray(d.checks) || typeof d.status !== 'string') throw new Error('bad_response');
      state = d;
      $('coPubChecksLoading').hidden = true;
      paintChecks(d); paintActions();
    } catch (e) {
      console.error('[coordinator publish status]', e);
      state = null;
      $('coPubChecksLoading').hidden = true;
      $('coPubChecksError').hidden = false;
      $('coPubActionsCard').hidden = true;
    }
  }

  async function load() {
    var id = new URLSearchParams(window.location.search).get('id');
    if (!C.isUuid(id)) { show('coEditMissing'); return; }
    taskerId = id;
    show('coEditLoading');
    $('coBackLink').href = 'coordinator-tasker.html?id=' + encodeURIComponent(id);
    $('coBackText').textContent = 'Back to profile';
    try {
      var pr = await window.supabase.from('local_tasker_profiles')
        .select('tasker_user_id, full_name, areas_served, skills, status, published_at')
        .eq('tasker_user_id', id).maybeSingle();
      if (pr.error) throw pr.error;
      if (!pr.data) { show('coEditMissing'); return; }
      var profile = pr.data;
      var proxy = $('coProxyName'); if (proxy) proxy.textContent = profile.full_name || 'this Local Tasker';
      /* the preview parts are best effort: a problem in one never hides the page or the checklist */
      var um = null, svcs = [];
      try {
        var ur = await window.supabase.from('users').select('name').eq('id', id).maybeSingle();
        if (!ur.error && ur.data) um = ur.data.name;
      } catch (e) { console.error('[coordinator publish name]', e); }
      try {
        var sr = await window.supabase.from('services')
          .select('id, service_name, category, price, rate_unit, description, location, specialties, available, created_at')
          .eq('user_id', id).order('created_at', { ascending: true });
        if (!sr.error) svcs = sr.data || [];
      } catch (e) { console.error('[coordinator publish services]', e); }
      var ph = await loadPhotos();
      paintPreview(profile, um, svcs, ph.rows, ph.map);
      document.title = (um || 'Local Tasker') + ' \u2014 Publish \u2014 StreetTasker';
      show('coEditLayout');
      await loadStatus();
    } catch (e) {
      console.error('[coordinator publish]', e);
      show('coEditLoadError');
    }
  }

  /* ---------- actions ---------- */
  function setBusy(on) {
    busy = on;
    ['coPubPublish', 'coPubRefresh', 'coPubUnpublishOpen', 'coPubUnpublishConfirm', 'coPubUnpublishCancel'].forEach(function (id) {
      var b = $(id); if (!b) return;
      if (on) { b.disabled = true; } else if (id === 'coPubPublish' || id === 'coPubRefresh') { b.disabled = !(state && state.ready); } else { b.disabled = false; }
    });
  }

  async function publish(isRefresh) {
    if (busy) return;
    clearMessages();
    if (!isRefresh) {
      if (!$('coPubConfirm').checked) { fieldError('coPubConfirm', 'Tick the box to confirm they agreed.'); $('coPubConfirm').focus(); return; }
      fieldError('coPubConfirm', '');
    }
    setBusy(true);
    var btn = isRefresh ? $('coPubRefresh') : $('coPubPublish'); var label = btn.textContent;
    btn.textContent = isRefresh ? 'Updating…' : 'Publishing…';
    try {
      var res = await window.supabase.rpc('publish_local_tasker', { p_tasker: taskerId });
      if (res.error) {
        var f = failureFrom(res.error); showError(f.code, f.raw);
        if (f.code === 'not_ready') { btn.textContent = label; setBusy(false); await loadStatus(); showError(f.code, f.raw); return; }
        return;
      }
      var d = res.data;
      if (!d || d.status !== 'published' || typeof d.already_published !== 'boolean') { showError('bad_response'); return; }
      btn.textContent = label; setBusy(false);
      await loadStatus();
      showNotice(d.already_published ? 'Public listing updated. Customers now see the latest services and rates.'
        : 'Published. This person can now be found by customers, with the Local Tasker and Phone Assisted labels.');
      return;
    } catch (e) {
      console.error('[coordinator publish rpc]', e);
      var g = failureFrom(e); showError(g.code, g.raw);
    } finally {
      if (busy) { btn.textContent = label; setBusy(false); }
    }
  }

  async function unpublish() {
    if (busy) return;
    clearMessages();
    var reason = $('coPubReason').value.trim();
    if (reason.length > 300) { fieldError('coPubReason', 'Please keep the reason under 300 characters.'); $('coPubReason').focus(); return; }
    fieldError('coPubReason', '');
    setBusy(true);
    var btn = $('coPubUnpublishConfirm'); var label = btn.textContent;
    btn.textContent = 'Unpublishing…';
    try {
      var res = await window.supabase.rpc('unpublish_local_tasker', { p_tasker: taskerId, p_reason: reason || null });
      if (res.error) { var f = failureFrom(res.error); showError(f.code, f.raw); return; }
      var d = res.data;
      if (!d || typeof d.changed !== 'boolean' || typeof d.status !== 'string') { showError('bad_response'); return; }
      btn.textContent = label; setBusy(false);
      $('coPubReason').value = '';
      await loadStatus();
      showNotice(d.changed ? 'Unpublished. This person is hidden from customers again. Their profile, services and photos are kept.' : 'This person was not published, so nothing changed.');
      return;
    } catch (e) {
      console.error('[coordinator unpublish rpc]', e);
      var g = failureFrom(e); showError(g.code, g.raw);
    } finally {
      if (busy) { btn.textContent = label; setBusy(false); }
    }
  }

  document.addEventListener('coordinator:ready', function (e) { last = e.detail; load(); });
  document.addEventListener('DOMContentLoaded', function () {
    var retry = $('coEditRetry'); if (retry) retry.addEventListener('click', function () { if (last) load(); });
    $('coPubPublish').addEventListener('click', function () { publish(false); });
    $('coPubRefresh').addEventListener('click', function () { publish(true); });
    $('coPubUnpublishOpen').addEventListener('click', function () {
      clearMessages(); $('coPubUnpublishBox').hidden = false; $('coPubUnpublishOpen').hidden = true; $('coPubReason').focus();
    });
    $('coPubUnpublishCancel').addEventListener('click', function () {
      $('coPubUnpublishBox').hidden = true; $('coPubUnpublishOpen').hidden = false; fieldError('coPubReason', '');
    });
    $('coPubUnpublishConfirm').addEventListener('click', unpublish);
    $('coPubConfirm').addEventListener('change', function () { fieldError('coPubConfirm', ''); });
  });
})();

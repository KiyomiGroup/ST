/* ============================================================
   STREET TASKERS — tasks.js
   Task posting form (post-task.html)
   ============================================================
   This module owns the post-task form experience:
     - category chips + select, frequency, in-person / remote
     - when (flexible / immediate / scheduled), date, time of day
     - budget presets, reference photos (with labels)
     - "Mark as urgent": a one-time ₦1,500 fee paid through Paystack.
       The toggle only turns on after Paystack confirms payment. If the
       person closes Paystack without paying, they come back to the form
       with everything they typed and the toggle off.
     - urgent is greyed out (with a "Verify now" link) for anyone the SERVER
       says may not publish yet (idv_can_publish), so no one pays for it
       before they can use it
     - auto-saved draft (localStorage) + progress indicator

   Supabase insert: window.ST.db.postTask() in db.js.
   New columns it writes are created by sql/post-task-redesign.sql.
   ============================================================ */

'use strict';

/* ── Constants ───────────────────────────────────────────────── */
/* From js/categories.js (shared with the services pages). Falls back to Other if that file did not load. */
const TASK_CATEGORIES = window.STCat
  ? window.STCat.list.map(c => ({ value: c.value, label: c.label, short: c.short, services: c.services }))
  : [{ value: 'other', label: 'Other', short: 'Other', services: [] }];

const MAX_DESCRIPTION_LENGTH = 1000;
const MIN_DESCRIPTION_LENGTH = 20;
const MIN_BUDGET = 500;
const MAX_BUDGET = 5000000;
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const URGENT_FEE_NAIRA = 1500;
const DRAFT_KEY = 'st_task_draft';

/* ── State ───────────────────────────────────────────────────── */
let taskDraft = {};
let draftSavedAt = 0;
const taskPhotos = [];   /* { file, objectUrl, label, url } */

/* ── Small helpers ───────────────────────────────────────────── */
function $id(id) { return document.getElementById(id); }
function radioValue(name) {
  const el = document.querySelector('input[name="' + name + '"]:checked');
  return el ? el.value : '';
}
function setRadio(name, value) {
  const el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
  if (el) el.checked = true;
}
function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}
function parseBudget(raw) {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : NaN;
}
function formatBudget(n) {
  return isNaN(n) ? '' : Number(n).toLocaleString('en-NG');
}

/* ── Init ────────────────────────────────────────────────────── */
function initTaskForm() {
  const form = $id('postTaskForm');
  if (!form) return;

  if (window.TaskDrafts) TaskDrafts.init();
  populateCategorySelect();
  initTaskDetails();   /* type of work + Poster questions (Categories Stage 6c) */
  setMinDeadline();
  wireCategoryChips();
  wireCharCounter();
  wireBudget();
  wireWhen();
  wireWorkMode();
  wireUseLocation();
  wireUrgentToggle();
  wireUrgentInfo();
  wirePhotos();
  wireTitleExamples();
  wireDraft();       /* restore first, then auto-save */
  wireProgress();

  form.addEventListener('submit', handleTaskSubmit);

  const titleInput = $id('taskTitle');
  if (titleInput) titleInput.addEventListener('input', () => { if (titleInput.value.trim().length >= 5) validateTitle(titleInput); });

  syncAll();
  console.log('[Tasks] Task form initialized ✓');
}

/* One pass that brings every dependent piece of UI in line with the form */
function syncAll() {
  syncCategoryUI();
  syncWhenUI();
  syncModeUI();
  syncBudgetPresets();
  updateCharCounter();
  updateProgress();
}

/* ── Task title examples: short everyday jobs, shown one after another while the box is empty ── */
const TITLE_EXAMPLES = ['Wash my shoes', 'Fix my generator', 'Wash my clothes', 'Clean my house'];

function wireTitleExamples() {
  const input = $id('taskTitle');
  if (!input) return;
  let i = 0;
  const show = () => { input.placeholder = 'e.g. ' + TITLE_EXAMPLES[i]; };
  show();
  /* People who prefer less motion get the first example and no rotation */
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  setInterval(() => {
    if (input.value || document.activeElement === input) return;   /* never change it while someone is typing */
    i = (i + 1) % TITLE_EXAMPLES.length;
    show();
  }, 2500);
}

/* ── Type of work and the questions for it (Categories Stage 6c) ─────────────────────────────
   The Poster-worded questions come from js/task-schemas.js. Both lists redraw when the category or the type of work changes. */
function initTaskDetails() {
  const catSel = $id('taskCategory'), subSel = $id('taskSubcategory');
  if (!catSel || !subSel || !window.STCat || !window.STCatForms) return;
  if (STCatForms.useAudience) STCatForms.useAudience('poster');
  catSel.addEventListener('change', () => { fillSubcategories(); });
  subSel.addEventListener('change', () => { clearSubError(); });
  /* registered after the category listener above, so the type-of-work list is rebuilt before the questions redraw */
  STCatForms.mount({ box: 'taskCatFields', section: 'secTaskDetails', select: 'taskCategory', sub: 'taskSubcategory' });
  fillSubcategories();
}

function fillSubcategories(keep) {
  const catSel = $id('taskCategory'), subSel = $id('taskSubcategory'), wrap = $id('taskSubWrap');
  if (!catSel || !subSel || !wrap || !window.STCat) return;
  const subs = catSel.value && catSel.value !== 'other' ? (STCat.subsOf(catSel.value) || []) : [];
  subSel.innerHTML = '<option value="">Choose...</option>' + subs.map(n => '<option>' + n.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</option>').join('');
  subSel.value = keep && subs.indexOf(keep) !== -1 ? keep : '';
  wrap.hidden = !subs.length;
  clearSubError();
}

function clearSubError() { const e = $id('subcategoryError'); if (e) e.textContent = ''; }

/* A category that has types of work needs one chosen. Returns true when fine. */
function validateSubcategory() {
  const catSel = $id('taskCategory'), subSel = $id('taskSubcategory'), err = $id('subcategoryError');
  if (!catSel || !subSel || $id('taskSubWrap').hidden) return true;
  if (subSel.value) { clearSubError(); return true; }
  if (err) err.textContent = 'Please choose the kind of work';
  return false;
}

/* ── Category: select + chips ───────────────────────────────── */
function populateCategorySelect() {
  const select = $id('taskCategory');
  if (!select || select.options.length > 1) return;
  TASK_CATEGORIES.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.value;
    opt.textContent = cat.label;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => { syncCategoryUI(); validateCategory(select); });
}

function wireCategoryChips() {
  /* Quick chips: the first eight categories with their icons (the dropdown has all of them) */
  const chipBox = document.querySelector('.pt-chips[aria-label="Popular categories"]');
  if (chipBox && window.STCat) {
    chipBox.innerHTML = STCat.list.filter(c => c.value !== 'other').slice(0, 8).map(c =>
      '<button type="button" class="pt-chip" data-category="' + c.value + '" aria-pressed="false">' + STCat.iconHtml(c.value) + '<span>' + c.short + '</span></button>').join('');
  }
  document.querySelectorAll('[data-category]').forEach(chip => {
    chip.addEventListener('click', () => {
      const select = $id('taskCategory');
      if (!select) return;
      select.value = chip.dataset.category;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

function syncCategoryUI() {
  const select = $id('taskCategory');
  if (!select) return;
  const wrap = select.closest('.pt-select-wrap');
  if (wrap) wrap.classList.toggle('has-value', !!select.value);
  document.querySelectorAll('[data-category]').forEach(chip => {
    const on = chip.dataset.category === select.value;
    chip.classList.toggle('is-active', on);
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const cat = TASK_CATEGORIES.find(c => c.value === select.value);
  /* the field icon becomes the category's own icon (static markup from js/categories.js) */
  const ico = document.getElementById('categoryIcon');
  if (cat && ico && window.STCat) { ico.innerHTML = STCat.icons[cat.value] || STCat.icons.other; ico.setAttribute('viewBox', '0 0 64 64'); ico.setAttribute('fill', 'currentColor'); }
  /* a short "includes" line under the dropdown, so people see what each category covers */
  let hint = document.getElementById('categoryIncludes');
  if (!hint && select.closest('.pt-group')) { hint = document.createElement('p'); hint.id = 'categoryIncludes'; hint.className = 'pt-help'; select.closest('.pt-group').appendChild(hint); }
  if (hint) { const list = (cat && cat.services || []).slice(0, 6); hint.textContent = list.length ? 'Includes: ' + list.join(', ') + (cat.services.length > 6 ? ' and more' : '') : ''; hint.hidden = !list.length; }
}

/* ── Minimum date ───────────────────────────────────────────── */
function setMinDeadline() {
  const deadline = $id('taskDeadline');
  if (!deadline) return;
  deadline.min = todayISO();
  deadline.addEventListener('change', () => {
    updateDeadlineText();
    validateDeadline(deadline);
  });
}

function updateDeadlineText() {
  const deadline = $id('taskDeadline');
  const text = $id('deadlineText');
  if (!deadline || !text) return;
  if (!deadline.value) {
    text.textContent = 'Select a date';
    text.classList.add('is-empty');
    return;
  }
  const d = new Date(deadline.value + 'T00:00:00');
  text.textContent = d.toLocaleDateString('en-GB', { weekday: 'long' }) + ', ' +
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  text.classList.remove('is-empty');
}

/* ── When do you need it (flexible / immediate / scheduled) ── */
function wireWhen() {
  document.querySelectorAll('input[name="urgency"]').forEach(r => r.addEventListener('change', () => {
    syncWhenUI();
    updateProgress();
  }));
}

function syncWhenUI() {
  const form = $id('postTaskForm');
  const deadline = $id('taskDeadline');
  const urgency = radioValue('urgency') || 'flexible';
  if (form) form.dataset.urgency = urgency;
  if (deadline) {
    const box = deadline.closest('.pt-date');
    if (urgency === 'immediate') deadline.value = todayISO();
    if (box) box.classList.toggle('is-locked', urgency === 'immediate');
    deadline.tabIndex = urgency === 'immediate' ? -1 : 0;
  }
  updateDeadlineText();
}

/* ── In person / remote ─────────────────────────────────────── */
function wireWorkMode() {
  document.querySelectorAll('input[name="workMode"]').forEach(r => r.addEventListener('change', () => {
    syncModeUI();
    updateProgress();
  }));
}

function syncModeUI() {
  const form = $id('postTaskForm');
  const mode = radioValue('workMode') || 'in_person';
  if (form) form.dataset.mode = mode;
  const loc = $id('locationGroup');
  if (loc) loc.classList.toggle('is-hidden', mode === 'remote');
}

/* ── Use current location → AREA only ───────────────────────── */
/* GPS is turned into an area name ("Lekki Phase 1, Lagos"). Coordinates and street are never put in the form. */
function wireUseLocation() {
  const btn = $id('useLocationBtn');
  const input = $id('taskLocation');
  if (!btn || !input) return;
  btn.addEventListener('click', async () => {
    if (typeof getCurrentArea !== 'function') { showToast('Location is not available right now. Please choose your area.'); return; }
    btn.disabled = true;
    const label = btn.querySelector('.pt-desk');
    const before = label ? label.textContent : '';
    if (label) label.textContent = 'Finding your area\u2026';
    try {
      const r = await getCurrentArea();
      if (!r.ok) { showToast(r.error); return; }
      input.value = r.label;
      delete input.dataset.lat; delete input.dataset.lon;
      input.dataset.area = '1'; input.dataset.precise = '0';
      clearFieldError(input);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dataset.area = '1';   /* the input handler clears it, set it again */
      input.dispatchEvent(new Event('change', { bubbles: true }));
      saveDraft();
      updateProgress();
      showToast('Area set to ' + r.label + '. Your exact spot is not shown.');
    } finally {
      btn.disabled = false;
      if (label) label.textContent = before;
    }
  });
}

/* ── Description counter ────────────────────────────────────── */
function wireCharCounter() {
  const desc = $id('taskDescription');
  if (!desc) return;
  desc.addEventListener('input', () => {
    updateCharCounter();
    if (desc.value.trim().length >= MIN_DESCRIPTION_LENGTH) validateDescription(desc);
  });
}

function updateCharCounter() {
  const desc = $id('taskDescription');
  const counter = $id('descCharCount');
  if (!desc || !counter) return;
  const len = desc.value.length;
  counter.textContent = len + ' / ' + MAX_DESCRIPTION_LENGTH;
  const tail = document.createElement('span');
  tail.className = 'pt-desk';
  tail.textContent = ' chars (Min. ' + MIN_DESCRIPTION_LENGTH + ')';
  counter.appendChild(tail);
  counter.classList.toggle('over-limit', len > MAX_DESCRIPTION_LENGTH);
}

/* ── Budget: formatted input + presets ──────────────────────── */
/* "No budget": for customers with no price in mind. The budget is saved as 0 with no_budget = true. */
function isNoBudget() {
  const b = $id('noBudgetBtn');
  return !!(b && b.getAttribute('aria-pressed') === 'true');
}

function setNoBudget(on) {
  const btn = $id('noBudgetBtn');
  const input = $id('taskBudget');
  if (!btn || !input) return;
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  input.disabled = !!on;
  input.required = !on;
  if (on) { input.value = ''; clearFieldError(input, $id('budgetError')); }
  const note = $id('noBudgetNote');
  if (note) note.hidden = !on;
  const group = input.closest('.pt-group-budget');
  if (group) group.classList.toggle('is-no-budget', !!on);
  syncBudgetPresets();
}

function wireBudget() {
  const input = $id('taskBudget');
  if (!input) return;

  const noBtn = $id('noBudgetBtn');
  if (noBtn) noBtn.addEventListener('click', () => {
    setNoBudget(!isNoBudget());
    saveDraft();
    updateProgress();
  });

  input.addEventListener('input', () => {
    const n = parseBudget(input.value);
    input.value = formatBudget(n);
    syncBudgetPresets();
    if (!isNaN(n)) validateBudget(input);
  });

  document.querySelectorAll('[data-budget-chip]').forEach(chip => {
    chip.addEventListener('click', () => {
      if (isNoBudget()) setNoBudget(false);
      input.value = formatBudget(parseInt(chip.dataset.budgetChip, 10));
      syncBudgetPresets();
      validateBudget(input);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      saveDraft();
      updateProgress();
    });
  });
}

function syncBudgetPresets() {
  const input = $id('taskBudget');
  if (!input) return;
  const n = parseBudget(input.value);
  document.querySelectorAll('[data-budget-chip]').forEach(chip => {
    chip.classList.toggle('is-active', parseInt(chip.dataset.budgetChip, 10) === n);
  });
}

/* ── Urgent toggle → Paystack (₦1,500) ──────────────────────── */
function wireUrgentToggle() {
  const toggle = $id('urgentToggle');
  if (!toggle) return;

  toggle.addEventListener('change', () => {
    if (!toggle.checked) {
      /* Turning off: not allowed once the fee is paid (no refund flow here) */
      if (taskDraft.urgentPaid) {
        toggle.checked = true;
        showToast('Your ₦' + URGENT_FEE_NAIRA.toLocaleString() + ' urgent fee is already paid for this task.');
      }
      return;
    }
    /* Turning on: stay off until Paystack confirms payment */
    toggle.checked = false;
    startUrgentPayment();
  });
}

function setUrgentUI(state) {
  /* state: 'off' | 'pending' | 'paid' */
  const toggle = $id('urgentToggle');
  const box = document.querySelector('.pt-urgent');
  const note = $id('urgentNote');
  if (!toggle || !box) return;
  toggle.checked = state === 'paid';
  toggle.disabled = state === 'pending';
  if (note) note.hidden = state === 'off';   /* off: the explanation lives behind the info button */
  box.classList.toggle('is-pending', state === 'pending');
  box.classList.toggle('is-paid', state === 'paid');
  if (note) {
    note.textContent = state === 'paid'
      ? '✓ ₦' + URGENT_FEE_NAIRA.toLocaleString() + ' paid. Your task will be bumped to the top when you post it.'
      : state === 'pending'
        ? 'Complete the ₦' + URGENT_FEE_NAIRA.toLocaleString() + ' payment in the Paystack window…'
        : '';
  }
}

/* The (i) beside the ₦1,500 opens or closes the explanation of the fee */
function wireUrgentInfo() {
  const btn = $id('urgentInfoBtn');
  const panel = $id('urgentInfo');
  if (!btn || !panel) return;
  const set = open => { panel.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
  btn.addEventListener('click', () => set(panel.hidden));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { set(false); btn.focus(); } });
}

/* M19: ask the server to check the urgent fee with Paystack. Returns true only when it is confirmed. Never throws. */
async function confirmUrgentPayment(reference, tries) {
  if (!reference || !window.supabase || !window.supabase.functions) return false;
  for (let i = 0; i < (tries || 1); i++) {
    try {
      const res = await window.supabase.functions.invoke('urgent-verify', { body: { reference: reference } });
      if (res && res.data && res.data.ok === true) return true;
    } catch (e) { /* try again */ }
    if (i < (tries || 1) - 1) await new Promise(function (r) { setTimeout(r, 2000); });
  }
  return false;
}

async function startUrgentPayment() {
  if (taskDraft.urgentPaid) { setUrgentUI('paid'); return; }

  /* Keep everything typed so far, whatever happens next */
  saveDraft();

  let user = null;
  try {
    const res = await window.supabase.auth.getUser();
    user = res && res.data && res.data.user;
  } catch (e) { /* handled below */ }

  if (!user) {
    showToast('Please log in to pay for urgent priority. Your task details are saved.');
    setTimeout(() => { window.location.href = 'login.html?redirect=post-task.html'; }, 1400);
    return;
  }
  if (typeof PaystackPop === 'undefined' || typeof PAYSTACK_PUBLIC_KEY === 'undefined') {
    showToast('Payment could not load. Check your connection and try again.');
    return;
  }

  setUrgentUI('pending');
  const reference = 'URG-' + Date.now() + '-' + user.id.slice(0, 8);
  let settled = false;

  const handler = PaystackPop.setup({
    key:      PAYSTACK_PUBLIC_KEY,
    email:    user.email,
    amount:   URGENT_FEE_NAIRA * 100,
    ref:      reference,
    currency: 'NGN',
    metadata: { user_id: user.id, type: 'urgent_task', fee_naira: URGENT_FEE_NAIRA },
    /* Paystack v1 needs a plain function here, not an async one */
    callback: function (response) {
      settled = true;
      taskDraft.urgentPaid = true;
      taskDraft.urgentRef = response.reference || reference;
      saveDraft();
      setUrgentUI('paid');
      showToast('Urgent fee paid. Confirming your payment...');
      /* M19: the server asks Paystack; the task is urgent only if this check passes (it is repeated when the task is posted) */
      confirmUrgentPayment(taskDraft.urgentRef, 3).then(function (ok) {
        showToast(ok ? 'Urgent fee confirmed. Your task will be bumped to the top.' : 'Payment received. We will confirm it when you post your task.');
      });
    },
    onClose: function () {
      if (settled) return;
      /* Closed without paying: back to the form, toggle off, entries kept */
      setUrgentUI('off');
      showToast('Payment cancelled. Urgent is off and your task details are saved.');
    },
  });
  handler.openIframe();
}

/* ── Reference photos ───────────────────────────────────────── */
function wirePhotos() {
  const zone  = $id('taskUploadZone');
  const input = $id('taskPhotoFiles');
  const choose = $id('choosePhotosBtn');
  if (!input) return;

  input.addEventListener('change', () => { handleTaskFiles(Array.from(input.files)); input.value = ''; });
  if (choose) choose.addEventListener('click', () => input.click());

  if (zone) {
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      handleTaskFiles(Array.from(e.dataTransfer.files));
    });
  }
  renderPhotos();
}

function handleTaskFiles(files) {
  if (!files.length) return;
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
  const allowed = files.filter(f => ALLOWED.includes(f.type));
  if (!allowed.length) { showToast('Please select image files (JPG, PNG, or WebP only).'); return; }
  const tooBig = allowed.filter(f => f.size > MAX_PHOTO_BYTES);
  if (tooBig.length) showToast(tooBig.length + ' file(s) exceed 5 MB and will be skipped.');
  const valid = allowed.filter(f => f.size <= MAX_PHOTO_BYTES);
  const room = MAX_PHOTOS - taskPhotos.length;
  if (valid.length > room) showToast('You can add up to ' + MAX_PHOTOS + ' photos.');
  valid.slice(0, room).forEach(file => {
    taskPhotos.push({ file, objectUrl: URL.createObjectURL(file), label: '', url: null });
  });
  renderPhotos();
}

function renderPhotos() {
  const wrap = $id('taskPhotoPreviews');
  const count = $id('photoCountLabel');
  if (!wrap) return;
  wrap.textContent = '';
  wrap.classList.toggle('has-photos', taskPhotos.length > 0);

  taskPhotos.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'pt-thumb';

    const img = document.createElement('img');
    img.src = p.objectUrl;
    img.alt = p.label || 'Reference photo ' + (i + 1);
    item.appendChild(img);

    const label = document.createElement('input');
    label.type = 'text';
    label.className = 'pt-thumb-label';
    label.placeholder = 'Add label';
    label.maxLength = 24;
    label.value = p.label;
    label.setAttribute('aria-label', 'Label for photo ' + (i + 1));
    label.addEventListener('input', () => { p.label = label.value.trim(); });
    item.appendChild(label);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'pt-thumb-remove';
    remove.setAttribute('aria-label', 'Remove photo ' + (i + 1));
    remove.innerHTML = '<svg class="pt-i" aria-hidden="true"><use href="#i-x"/></svg>';
    remove.addEventListener('click', () => removeTaskPhoto(i));
    item.appendChild(remove);

    wrap.appendChild(item);
  });

  if (taskPhotos.length < MAX_PHOTOS) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'pt-add-photo';
    add.innerHTML = '<svg class="pt-i" aria-hidden="true"><use href="#i-camera-plus"/></svg><span>Add Photo</span>';
    add.addEventListener('click', () => { const f = $id('taskPhotoFiles'); if (f) f.click(); });
    wrap.appendChild(add);
  }

  if (count) {
    count.hidden = taskPhotos.length === 0;
    count.textContent = 'Uploaded reference items (' + taskPhotos.length + ' of ' + MAX_PHOTOS + '):';
  }
}

function removeTaskPhoto(idx) {
  const [gone] = taskPhotos.splice(idx, 1);
  if (gone && gone.objectUrl) URL.revokeObjectURL(gone.objectUrl);
  renderPhotos();
}
window.removeTaskPhoto = removeTaskPhoto;

/* Uploads every new photo; returns [{ url, label }] for the ones that worked */
async function uploadTaskPhotos() {
  const prog = $id('taskPhotoProgress');
  const pending = taskPhotos.filter(p => p.file && !p.url);
  if (pending.length && prog) prog.hidden = false;
  try {
    if (pending.length) {
      const { data: { user } } = await window.supabase.auth.getUser();
      const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      await Promise.all(pending.map(async (p, i) => {
        const ext  = extMap[p.file.type] || 'jpg';
        const name = 'tasks/' + user.id + '-' + Date.now() + '-' + i + '.' + ext;
        const { error } = await window.supabase.storage.from('task-images').upload(name, p.file, { cacheControl: '3600', upsert: true });
        if (error) { console.warn('[Upload] task photo failed:', error.message); return; }
        const { data: urlData } = window.supabase.storage.from('task-images').getPublicUrl(name);
        p.url = urlData.publicUrl;
      }));
    }
  } catch (e) {
    console.warn('[Upload] task photo upload error:', e.message);
  } finally {
    if (prog) prog.hidden = true;
  }
  return taskPhotos.filter(p => p.url).map(p => ({ url: p.url, label: p.label || '' }));
}

/* ── Draft (auto-save) ──────────────────────────────────────── */
const DRAFT_TEXT_FIELDS = {
  title: 'taskTitle', description: 'taskDescription', budget: 'taskBudget',
  location: 'taskLocation', deadline: 'taskDeadline', category: 'taskCategory',
};

function wireDraft() {
  const form = $id('postTaskForm');
  if (!form) return;

  restoreDraft();

  form.addEventListener('input',  () => { saveDraft(); updateProgress(); });
  form.addEventListener('change', () => { saveDraft(); updateProgress(); });

  const discard = $id('discardDraftBtn');
  if (discard) discard.addEventListener('click', discardDraft);
  /* Save as Draft: desktop and phone buttons both carry data-save-draft */
  document.querySelectorAll('[data-save-draft]').forEach(btn => btn.addEventListener('click', saveDraftToList));
  refreshDraftCount();
  setInterval(updateDraftAgo, 30000);
}

/* Save as Draft: keeps this task in the list on the Drafts page, and the form keeps updating it from then on */
async function saveDraftToList() {
  saveDraft();   /* brings taskDraft up to date with the form */
  if (!window.TaskDrafts || !TaskDrafts.hasContent(taskDraft)) {
    showToast('Add a title or a few details first, then save your draft.');
    return;
  }
  await TaskDrafts.init();
  if (!taskDraft.draftId) taskDraft.draftId = TaskDrafts.newId();
  taskDraft.savedToList = true;
  const ok = TaskDrafts.upsert(taskDraft.draftId, taskDraft);
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(taskDraft)); } catch (e) { /* ignore */ }
  refreshDraftCount();
  showToast(ok ? 'Draft saved. Find it under My drafts.' : 'Could not save the draft on this device. Please free some space and try again.');
}

/* "My drafts (2)": the count beside the quiet link, hidden when there are none */
async function refreshDraftCount() {
  if (!window.TaskDrafts) return;
  await TaskDrafts.init();
  const n = TaskDrafts.count();
  document.querySelectorAll('[data-drafts-count]').forEach(el => {
    el.textContent = n ? '(' + n + ')' : '';
  });
}

function readDraftFromForm() {
  const loc = $id('taskLocation');
  const d = Object.assign({}, taskDraft);
  Object.keys(DRAFT_TEXT_FIELDS).forEach(k => {
    const el = $id(DRAFT_TEXT_FIELDS[k]);
    if (el) d[k] = el.value;
  });
  d.frequency = radioValue('frequency') || 'one_off';
  d.workMode  = radioValue('workMode') || 'in_person';
  d.urgency   = radioValue('urgency') || 'flexible';
  d.timeOfDay = radioValue('timeOfDay') || '';
  d.noBudget  = isNoBudget();
  const subSel = $id('taskSubcategory');
  d.subcategory = subSel && !$id('taskSubWrap').hidden ? subSel.value : '';
  d.details = window.STCatForms && STCatForms.collect ? (STCatForms.collect() || {}) : {};   /* the answers to the category questions */
  /* never keep coordinates; only remember whether the area was confirmed */
  delete d.lat; delete d.lon; delete d.precise;
  d.locArea = (loc && loc.dataset.area === '1') ? '1' : '0';
  return d;
}

function saveDraft() {
  if (!$id('postTaskForm')) return;
  taskDraft = readDraftFromForm();
  draftSavedAt = Date.now();
  taskDraft.savedAt = draftSavedAt;
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(taskDraft)); } catch (e) { /* storage full or blocked */ }
  /* A draft already saved to the list keeps following the form, so Continue always opens the latest version */
  if (taskDraft.savedToList && taskDraft.draftId && window.TaskDrafts) TaskDrafts.upsert(taskDraft.draftId, taskDraft);
  updateDraftAgo();
}

function hasDraftContent(d) {
  return !!(d && (d.title || d.description || d.budget || d.noBudget || d.location || d.category || d.urgentPaid));
}

function restoreDraft() {
  let draft = null;
  try {
    const saved = localStorage.getItem(DRAFT_KEY) || sessionStorage.getItem(DRAFT_KEY);
    if (saved) draft = JSON.parse(saved);
  } catch (e) { return; }
  if (!hasDraftContent(draft)) return;

  taskDraft = draft;
  draftSavedAt = draft.savedAt || Date.now();

  Object.keys(DRAFT_TEXT_FIELDS).forEach(k => {
    const el = $id(DRAFT_TEXT_FIELDS[k]);
    if (!el || !draft[k]) return;
    /* An old draft may hold a street address: only an area that was confirmed comes back */
    if (k === 'location' && draft.locArea !== '1') return;
    el.value = draft[k];
    if (k === 'location') { el.dataset.area = '1'; el.dataset.precise = '0'; }
  });
  if (draft.category && $id('taskCategory')) {   /* type of work and its answers come back after the category */
    fillSubcategories(draft.subcategory || '');
    const sSel = $id('taskSubcategory');
    if (sSel && sSel.value) sSel.dispatchEvent(new Event('change', { bubbles: true }));
    else if (window.STCatForms && STCatForms.setValues) STCatForms.setValues({});
    if (window.STCatForms && STCatForms.setValues && draft.details) STCatForms.setValues(draft.details);
  }
  if (draft.frequency) setRadio('frequency', draft.frequency);
  if (draft.workMode)  setRadio('workMode', draft.workMode);
  if (draft.urgency)   setRadio('urgency', draft.urgency);
  if (draft.timeOfDay) setRadio('timeOfDay', draft.timeOfDay);

  const loc = $id('taskLocation');
  const budget = $id('taskBudget');
  if (budget && draft.budget) budget.value = formatBudget(parseBudget(draft.budget));
  if (draft.noBudget) setNoBudget(true);

  setUrgentUI(draft.urgentPaid ? 'paid' : 'off');
  syncAll();
  showDraftBanner();
}

function showDraftBanner() {
  const banner = $id('draftBanner');
  if (banner) banner.hidden = false;
  updateDraftAgo();
}

function updateDraftAgo() {
  const el = $id('draftSavedAgo');
  if (!el || !draftSavedAt) return;
  const mins = Math.floor((Date.now() - draftSavedAt) / 60000);
  el.textContent = mins < 1 ? 'just now' : mins < 60 ? mins + 'm ago' : Math.floor(mins / 60) + 'h ago';
}

function clearDraft() {
  /* Posting or discarding also removes the saved copy from the Drafts list */
  const savedId = taskDraft.draftId;
  if (savedId && window.TaskDrafts) TaskDrafts.init().then(() => { TaskDrafts.remove(savedId); refreshDraftCount(); });
  try { localStorage.removeItem(DRAFT_KEY); sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
  taskDraft = {};
  const banner = $id('draftBanner');
  if (banner) banner.hidden = true;
}

/* Discard: wipe the saved draft AND reset the form */
function discardDraft() {
  if (taskDraft.urgentPaid &&
      !window.confirm('You have already paid the ₦' + URGENT_FEE_NAIRA.toLocaleString() + ' urgent fee for this task. Discarding will lose it. Discard anyway?')) {
    return;
  }
  clearDraft();
  const form = $id('postTaskForm');
  if (form) form.reset();
  const loc = $id('taskLocation');
  if (loc) { delete loc.dataset.lat; delete loc.dataset.lon; delete loc.dataset.precise; delete loc.dataset.area; }
  while (taskPhotos.length) { const p = taskPhotos.pop(); if (p.objectUrl) URL.revokeObjectURL(p.objectUrl); }
  renderPhotos();
  document.querySelectorAll('.has-error').forEach(el => el.classList.remove('has-error'));
  document.querySelectorAll('.pt-error').forEach(el => { el.textContent = ''; });
  setUrgentUI('off');
  setNoBudget(false);
  syncAll();
  showToast('Draft discarded.');
}

/* ── Progress (4 steps) ─────────────────────────────────────── */
function wireProgress() { updateProgress(); }

function sectionStatus() {
  const mode = radioValue('workMode') || 'in_person';
  const urgency = radioValue('urgency') || 'flexible';
  const val = id => ($id(id) ? $id(id).value.trim() : '');

  const overview = [
    !!val('taskCategory'),
    val('taskTitle').length >= 5,
    val('taskDescription').length >= MIN_DESCRIPTION_LENGTH,
  ];
  const execution = [];
  if (mode === 'in_person') execution.push(!!val('taskLocation'));
  if (urgency === 'scheduled') execution.push(!!val('taskDeadline'));
  const budget = [isNoBudget() || parseBudget(val('taskBudget')) >= MIN_BUDGET];

  return [overview, execution, budget];
}

function updateProgress() {
  const bar = $id('formProgressBar');
  if (!bar) return;
  const groups = sectionStatus();
  const checks = groups.flat();
  const done = checks.filter(Boolean).length;
  const pct = checks.length ? Math.round((done / checks.length) * 100) : 0;

  /* Step = first section that still needs something (photos are optional) */
  let step = groups.findIndex(g => g.length && !g.every(Boolean)) + 1;
  if (step === 0) step = 4;

  const names = ['Task Details', 'Execution & Location', 'Budget & Pricing', 'Reference Photos'];
  /* runtime values: allowed inline */
  bar.style.width = pct + '%';
  const barMobile = $id('formProgressBarMobile');
  if (barMobile) barMobile.style.width = pct + '%';
  const numDesk = $id('progressStepNumDesktop');
  if (numDesk) numDesk.textContent = step + ' of 4';
  const nameDesk = $id('progressStepNameDesktop');
  if (nameDesk) nameDesk.textContent = names[step - 1];
  const mobStep = $id('progressStepMobile');
  if (mobStep) mobStep.textContent = 'Step ' + step + ' of 4 \u2022 ' + names[step - 1];
  const mobPct = $id('progressPctMobile');
  if (mobPct) mobPct.textContent = pct + '%';
}

/* Kept for pages that still call it */
function initPostSteps() { updateProgress(); }

/* ── Validation ──────────────────────────────────────────────── */
function fieldBox(input) {
  return input.closest('.pt-field, .pt-date') || input;
}

function setFieldError(input, errEl, message) {
  fieldBox(input).classList.add('has-error');
  if (errEl) errEl.textContent = message;
}

function clearFieldError(input, errEl) {
  fieldBox(input).classList.remove('has-error');
  if (errEl) errEl.textContent = '';
}

function validateCategory(input) {
  const err = $id('categoryError');
  if (!input.value) { setFieldError(input, err, 'Please choose a service category'); return false; }
  clearFieldError(input, err);
  return true;
}

function validateTitle(input) {
  const val = input.value.trim();
  const err = $id('titleError');
  const field = input.closest('.pt-field');
  if (val.length < 5) {
    setFieldError(input, err, 'Title must be at least 5 characters');
    if (field) field.classList.remove('is-valid');
    return false;
  }
  if (val.length > 120) {
    setFieldError(input, err, 'Title must be under 120 characters');
    if (field) field.classList.remove('is-valid');
    return false;
  }
  clearFieldError(input, err);
  if (field) field.classList.add('is-valid');
  return true;
}

function validateDescription(input) {
  const val = input.value.trim();
  const err = $id('descriptionError');
  if (val.length < MIN_DESCRIPTION_LENGTH) {
    input.classList.add('has-error');
    if (err) err.textContent = 'Please write at least ' + MIN_DESCRIPTION_LENGTH + ' characters';
    return false;
  }
  if (val.length > MAX_DESCRIPTION_LENGTH) {
    input.classList.add('has-error');
    if (err) err.textContent = 'Description must be under ' + MAX_DESCRIPTION_LENGTH + ' characters';
    return false;
  }
  input.classList.remove('has-error');
  if (err) err.textContent = '';
  return true;
}

function validateBudget(input) {
  if (isNoBudget()) { clearFieldError(input, $id('budgetError')); return true; }
  const val = parseBudget(input.value);
  const err = $id('budgetError');
  if (isNaN(val) || val < MIN_BUDGET) {
    setFieldError(input, err, 'Minimum budget is ₦' + MIN_BUDGET.toLocaleString());
    return false;
  }
  if (val > MAX_BUDGET) {
    setFieldError(input, err, 'Maximum budget is ₦' + MAX_BUDGET.toLocaleString());
    return false;
  }
  clearFieldError(input, err);
  return true;
}

function validateDeadline(input) {
  const urgency = radioValue('urgency') || 'flexible';
  const err = $id('deadlineError');
  if (urgency === 'flexible' && !input.value) { clearFieldError(input, err); return true; }
  if (urgency === 'immediate') { clearFieldError(input, err); return true; }
  if (!input.value || input.value < todayISO()) {
    setFieldError(input, err, 'Pick a date that is today or later');
    return false;
  }
  clearFieldError(input, err);
  return true;
}

/* ── Form submission ─────────────────────────────────────────── */
async function handleTaskSubmit(e) {
  e.preventDefault();

  const submitBtn   = $id('taskSubmitBtn');
  const titleInput  = $id('taskTitle');
  const descInput   = $id('taskDescription');
  const budgetInput = $id('taskBudget');
  const locInput    = $id('taskLocation');
  const dlInput     = $id('taskDeadline');
  const catInput    = $id('taskCategory');

  const workMode  = radioValue('workMode') || 'in_person';
  const frequency = radioValue('frequency') || 'one_off';
  const urgency   = radioValue('urgency') || 'flexible';
  const timeOfDay = radioValue('timeOfDay') || null;

  /* Run all validations (every one runs so every error shows) */
  const checks = [
    validateCategory(catInput),
    validateSubcategory(),
    validateTitle(titleInput),
    validateDescription(descInput),
    validateBudget(budgetInput),
    validateDeadline(dlInput),
  ];
  const isValid = checks.every(Boolean);

  if (!isValid) {
    showToast('Please fix the highlighted fields before submitting.');
    const firstBad = document.querySelector('.has-error');
    if (firstBad && firstBad.scrollIntoView) firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }

  /* The questions for this kind of work (Categories Stage 6c): mark each one that is missing and jump to the first */
  if (window.STCatForms && STCatForms.check) {
    const cf = STCatForms.check();
    if (!cf.ok) { showToast('Please answer the highlighted questions.'); if (STCatForms.focusField) STCatForms.focusField(cf.firstKey); return; }
  }

  /* Location is needed for in-person work and must be confirmed (list or GPS) */
  if (workMode === 'in_person' && typeof validateLocation === 'function') {
    const locCheck = validateLocation('taskLocation', 'area-only');
    if (!locCheck.ok) {
      setFieldError(locInput, null, '');
      showToast(locCheck.error);
      return;
    }
  }

  const taskPayload = {
    title:       titleInput.value.trim(),
    description: descInput.value.trim(),
    budget:      isNoBudget() ? 0 : parseBudget(budgetInput.value),
    noBudget:    isNoBudget(),
    location:    workMode === 'remote' ? 'Remote / Online' : locInput.value.trim(),
    deadline:    dlInput.value || null,
    category:    catInput.value || 'other',
    subcategory: ($id('taskSubWrap') && !$id('taskSubWrap').hidden && $id('taskSubcategory').value) || '',
    details:     (window.STCatForms && STCatForms.collect && STCatForms.collect()) || {},   /* Poster answers; {} when this category has no questions yet */
    urgent:      !!taskDraft.urgentPaid,
    taskType:    workMode === 'remote' ? 'remote' : 'one_off',
    urgency:     urgency,
    frequency:   frequency,
    workMode:    workMode,
    timeOfDay:   timeOfDay,
    urgentPaid:  !!taskDraft.urgentPaid,
    urgentFee:   taskDraft.urgentPaid ? URGENT_FEE_NAIRA : 0,
    urgentPaymentRef: taskDraft.urgentPaid ? (taskDraft.urgentRef || null) : null,
  };

  /* The person chose "Other" but the task clearly belongs to a category (title and description): post it under that category. */
  let autoCategory = '';
  if ((taskPayload.category === 'other' || !taskPayload.category) && window.STCat && typeof window.STCat.detect === 'function') {
    const found = window.STCat.detect(taskPayload.title, taskPayload.description);
    if (found && found !== 'other') { taskPayload.category = found; autoCategory = found; taskPayload.subcategory = ''; taskPayload.details = {}; }
  }

  setPostLoading(submitBtn, true);

  try {
    /* Require login — redirect if not authenticated */
    if (window.ST && window.ST.auth) {
      const user = await window.ST.auth.getCurrentUser();
      if (!user) {
        saveDraft();
        showToast('Please log in to post a task.');
        setTimeout(() => { window.location.href = 'login.html?redirect=post-task.html'; }, 1200);
        return;
      }
    }

    if (window.ST && window.ST.db && window.ST.db.postTask) {
      /* M19: confirm the urgent fee with the server right before saving (a repeat of the check done after payment; safe to repeat) */
      if (taskPayload.urgentPaid && taskPayload.urgentPaymentRef) await confirmUrgentPayment(taskPayload.urgentPaymentRef, 2);
      let photos = [];
      try { photos = await uploadTaskPhotos(); } catch (err) { console.warn('Photo upload skipped:', err.message); }

      const created = await window.ST.db.postTask({
        title:       taskPayload.title,
        description: taskPayload.description,
        budget:      taskPayload.budget,
        noBudget:    taskPayload.noBudget,
        location:    taskPayload.location,
        deadline:    taskPayload.deadline,
        category:    taskPayload.category,
        subcategory: taskPayload.subcategory,
        details:     taskPayload.details,
        urgent:      taskPayload.urgent,
        taskType:    taskPayload.taskType,
        urgency:     taskPayload.urgency,
        frequency:   taskPayload.frequency,
        workMode:    taskPayload.workMode,
        timeOfDay:   taskPayload.timeOfDay,
        urgentPaid:  taskPayload.urgentPaid,
        urgentFee:   taskPayload.urgentFee,
        urgentPaymentRef: taskPayload.urgentPaymentRef,
        photoUrls:   photos.map(p => p.url),
        photoLabels: photos.map(p => p.label),
      });
      /* V6b: what the server decided, for the success modal */
      taskPayload.id = created && created.id;
      taskPayload.needsVerification = !(created && created._needs_verification === false);
      /* M19: the database decides if the task is urgent. An explicit false means the payment could not be confirmed. */
      if (taskPayload.urgentPaid && created && created.urgent_paid === false) {
        showToast('We could not confirm your urgent payment, so your task was posted without the urgent tag. Your reference: ' + taskPayload.urgentPaymentRef + '. Contact support and we will sort it out.');
      }
    } else {
      /* Fallback: direct insert if db.js not loaded */
      const { data: { user } } = await window.supabase.auth.getUser();
      /* V6b: same server decision as db.js; no answer = draft */
      let canGoLive = false;
      try {
        const g = window.ST && window.ST.verify && window.ST.verify.canPublish ? await window.ST.verify.canPublish() : null;
        canGoLive = !!(g && g.can_publish === true);
      } catch (e) { canGoLive = false; }
      taskPayload.needsVerification = !canGoLive;
      const { error } = await window.supabase.from('tasks').insert({
        title:       taskPayload.title,
        description: taskPayload.description,
        budget:      taskPayload.budget,
        no_budget:   !!taskPayload.noBudget,
        location:    taskPayload.location,
        deadline:    taskPayload.deadline ? new Date(taskPayload.deadline).toISOString() : null,
        category:    taskPayload.category,
        status:      canGoLive ? 'open' : 'draft',
        customer_id: user ? user.id : null,
        user_id:     user ? user.id : null,
      });
      if (error) throw error;
    }

    clearDraft();
    console.log('[Tasks] Task inserted into Supabase ✓');
    showTaskSuccessModal(taskPayload);
    if (autoCategory && typeof showToast === 'function') showToast('We filed your task under ' + window.STCat.label(autoCategory) + '.');

  } catch (err) {
    console.error('[Tasks] Insert error:', err);
    showToast('Failed to post task: ' + (err.message || 'Unknown error. Please try again.'));
  } finally {
    setPostLoading(submitBtn, false);
  }
}

/* ── Success modal ───────────────────────────────────────────── */
async function showTaskSuccessModal(payload) {
  const modal = document.getElementById('taskSuccessModal');
  if (!modal) {
    typeof showToast === 'function' && showToast(`Task "${payload.title}" posted!`);
    setTimeout(() => { window.location.href = 'my-tasks.html'; }, 1500);
    return;
  }

  /* Set task title in both modal states */
  modal.querySelectorAll('[data-task-title]').forEach(el => { el.textContent = payload.title; });

  /* V6b: the server decided when the task was saved (payload.needsVerification). The old browser-side
     check of the verifications table (writable from the browser) and the later 'make it a draft' update
     are gone: the task is saved with the right status in the first place. */
  const isVerified = payload.needsVerification === false;
  if (payload.id) {
    try { sessionStorage.setItem('st_last_task_id', String(payload.id)); } catch(e) {}
  }

  /* Show correct modal state */
  const verifyNeeded   = document.getElementById('modalVerifyNeeded');
  const alreadyVerified = document.getElementById('modalAlreadyVerified');
  if (isVerified) {
    if (verifyNeeded)    verifyNeeded.style.display = 'none';
    if (alreadyVerified) alreadyVerified.style.display = 'block';
  } else {
    if (verifyNeeded)    verifyNeeded.style.display = 'block';
    if (alreadyVerified) alreadyVerified.style.display = 'none';
  }

  /* The live task gets a shareable link: /t/<id> shows the task as a preview card in WhatsApp and similar apps */
  if (isVerified && payload.id) setupTaskShare(payload);

  modal.classList.add('modal-open');
  document.body.style.overflow = 'hidden';
}

/* Share box on the "Task is live" screen. Link: https://streettasker.com/t/<task id> (see server/task-share-core.js) */
function setupTaskShare(payload) {
  const box = document.getElementById('taskShareBox');
  const input = document.getElementById('taskShareUrl');
  if (!box || !input) return;
  const url = window.location.origin + '/t/' + encodeURIComponent(payload.id);
  const money = !payload.noBudget && Number(payload.budget) > 0 ? ' for \u20a6' + Math.round(Number(payload.budget)).toLocaleString('en-NG') : '';
  const message = 'I need a tasker for ' + payload.title + money + '. Apply as a tasker or post your own task: ' + url;
  input.value = url;
  const wa = document.getElementById('taskShareWa');
  if (wa) wa.href = 'https://wa.me/?text=' + encodeURIComponent(message);
  const copy = document.getElementById('taskShareCopy');
  if (copy && !copy.dataset.wired) {
    copy.dataset.wired = '1';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); showToast('Task link copied'); }
      catch (e) { input.focus(); input.select(); showToast('Press Ctrl+C to copy the link'); }
    });
    input.addEventListener('focus', () => input.select());
  }
  box.hidden = false;
}

function saveDraftTask() {
  /* Task is already saved as draft in DB — just redirect to dashboard */
  closeTaskModal();
  showToast && showToast('Task saved as a draft.');
  setTimeout(() => { window.location.href = 'my-tasks.html'; }, 1400);
}
window.saveDraftTask = saveDraftTask;

function closeTaskModal() {
  const modal = document.getElementById('taskSuccessModal');
  if (modal) {
    modal.classList.remove('modal-open');
    document.body.style.overflow = '';
  }
}

/* ── Utilities ───────────────────────────────────────────────── */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* Post button: swaps only the label so the arrow icon survives */
function setPostLoading(btn, loading) {
  if (!btn) return;
  const label = btn.querySelector('.pt-post-label');
  btn.disabled = loading;
  if (label) label.textContent = loading ? 'Posting task...' : 'Post My Task';
}

function setButtonLoading(btn, loadingText, resetText) {
  if (!btn) return;
  if (loadingText) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.innerHTML = `<span class="btn-spinner"></span> ${loadingText}`;
  } else {
    btn.disabled = false;
    btn.textContent = resetText || btn.dataset.originalText || 'Submit';
  }
}

/* Global sprint alert helper */
function showSprintAlert(title, message) { if (typeof showToast === 'function') showToast(title); }

function closeSprintModal() {
  const modal = document.getElementById('sprintModal');
  if (modal) {
    modal.classList.remove('modal-open');
    document.body.style.overflow = '';
  }
}

/* ── Expose globals ──────────────────────────────────────────── */
window.initTaskForm    = initTaskForm;
window.initPostSteps   = initPostSteps;
window.showTaskSuccessModal = showTaskSuccessModal;
window.closeTaskModal  = closeTaskModal;
window.closeSprintModal = closeSprintModal;
window.clearDraft      = clearDraft;
window.showSprintAlert = showSprintAlert;

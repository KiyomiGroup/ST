/* ============================================================
   STREET TASKERS — tasks.js
   Task posting form
   ============================================================
   This module owns the post-task form experience.
   All submission handlers are wired to UI feedback only.

   Supabase inserts from future-features.js:
     postTask({ title, description, budget, location, deadline })
     /task-detail.html?id=<new_task_id>
   auth check — if no session, redirect to login.html
   ============================================================ */

'use strict';

/* ── Constants ───────────────────────────────────────────────── */
const TASK_CATEGORIES = [
  { value: 'barber',      label: 'Barber / Hair',       icon: 'scissors' },
  { value: 'electrician', label: 'Electrician',          icon: 'zap' },
  { value: 'cleaning',    label: 'House Cleaning',       icon: 'sparkles' },
  { value: 'mechanic',    label: 'Mechanic / Auto',      icon: 'wrench' },
  { value: 'plumber',     label: 'Plumber',              icon: 'droplets' },
  { value: 'beauty',      label: 'Make-up / Beauty',     icon: 'star' },
  { value: 'carpentry',   label: 'Carpentry',            icon: 'hammer' },
  { value: 'painting',    label: 'Painting',             icon: 'paintbrush' },
  { value: 'moving',      label: 'Moving / Delivery',    icon: 'truck' },
  { value: 'other',       label: 'Other',                icon: 'plus' },
];

const MAX_DESCRIPTION_LENGTH = 1000;
const MIN_BUDGET = 500;
const MAX_BUDGET = 5000000;

/* ── State ───────────────────────────────────────────────────── */
let taskDraft = {
  title:       '',
  description: '',
  budget:      '',
  location:    '',
  deadline:    '',
  category:    '',
  urgent:      false,
};

/* ── Init ────────────────────────────────────────────────────── */
function initTaskForm() {
  const form = document.getElementById('postTaskForm');
  if (!form) return;

  populateCategorySelect();
  setMinDeadline();
  wireCharCounter();
  wireBudgetSuggestions();
  wireUrgentToggle();
  wireFieldSave();   // auto-save draft to sessionStorage
  restoreDraft();    // restore any saved draft

  form.addEventListener('submit', handleTaskSubmit);

  /* Character count for title */
  const titleInput = document.getElementById('taskTitle');
  if (titleInput) {
    titleInput.addEventListener('input', () => validateTitle(titleInput));
  }

  console.log('[Tasks] Task form initialized ✓');
}

/* ── Category select population ─────────────────────────────── */
function populateCategorySelect() {
  const select = document.getElementById('taskCategory');
  if (!select) return;

  TASK_CATEGORIES.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.value;
    opt.textContent = cat.label;
    select.appendChild(opt);
  });
}

/* ── Set minimum deadline to today ──────────────────────────── */
function setMinDeadline() {
  const deadline = document.getElementById('taskDeadline');
  if (deadline) {
    const today = new Date().toISOString().split('T')[0];
    deadline.min = today;
    deadline.addEventListener('change', () => validateDeadline(deadline));
  }
}

/* ── Description character counter ──────────────────────────── */
function wireCharCounter() {
  const desc    = document.getElementById('taskDescription');
  const counter = document.getElementById('descCharCount');
  if (!desc || !counter) return;

  const update = () => {
    const len = desc.value.length;
    counter.textContent = `${len} / ${MAX_DESCRIPTION_LENGTH}`;
    counter.classList.toggle('over-limit', len > MAX_DESCRIPTION_LENGTH);
    desc.classList.toggle('input-error', len > MAX_DESCRIPTION_LENGTH);
  };
  desc.addEventListener('input', update);
  update();
}

/* ── Budget suggestion chips ─────────────────────────────────── */
function wireBudgetSuggestions() {
  const chips = document.querySelectorAll('[data-budget-chip]');
  const input = document.getElementById('taskBudget');
  if (!input) return;

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      input.value = chip.dataset.budgetChip;
      chips.forEach(c => c.classList.remove('chip-active'));
      chip.classList.add('chip-active');
      validateBudget(input);
    });
  });
}

/* ── Urgent toggle ───────────────────────────────────────────── */
function wireUrgentToggle() {
  const toggle = document.getElementById('urgentToggle');
  const badge  = document.getElementById('urgentBadge');
  if (!toggle) return;

  toggle.addEventListener('change', () => {
    taskDraft.urgent = toggle.checked;
    if (badge) badge.style.display = toggle.checked ? 'inline-flex' : 'none';
  });
}

/* ── Auto-save draft to sessionStorage ──────────────────────── */
/*
 * draft saving (INSERT with status='draft') so drafts
 * persist across devices/sessions.
 */
function wireFieldSave() {
  const fields = ['taskTitle', 'taskDescription', 'taskBudget', 'taskLocation', 'taskDeadline', 'taskCategory'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      taskDraft[id.replace('task', '').toLowerCase()] = el.value;
      sessionStorage.setItem('st_task_draft', JSON.stringify(taskDraft));
    });
  });
}

function restoreDraft() {
  try {
    const saved = sessionStorage.getItem('st_task_draft');
    if (!saved) return;
    const draft = JSON.parse(saved);
    const map = {
      title:       'taskTitle',
      description: 'taskDescription',
      budget:      'taskBudget',
      location:    'taskLocation',
      deadline:    'taskDeadline',
      category:    'taskCategory',
    };
    Object.entries(map).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el && draft[key]) el.value = draft[key];
    });
    if (Object.values(draft).some(v => v)) {
      showDraftBanner();
    }
  } catch (e) {
    // Silently ignore corrupt draft
  }
}

function showDraftBanner() {
  const banner = document.getElementById('draftBanner');
  if (banner) banner.style.display = 'flex';
}

function clearDraft() {
  sessionStorage.removeItem('st_task_draft');
  const banner = document.getElementById('draftBanner');
  if (banner) banner.style.display = 'none';
}

/* ── Validation ──────────────────────────────────────────────── */
function validateTitle(input) {
  const val = input.value.trim();
  const err = document.getElementById('titleError');
  if (val.length < 5) {
    setFieldError(input, err, 'Title must be at least 5 characters');
    return false;
  }
  if (val.length > 120) {
    setFieldError(input, err, 'Title must be under 120 characters');
    return false;
  }
  clearFieldError(input, err);
  return true;
}

function validateBudget(input) {
  const val = parseFloat(input.value);
  const err = document.getElementById('budgetError');
  if (isNaN(val) || val < MIN_BUDGET) {
    setFieldError(input, err, `Minimum budget is ₦${MIN_BUDGET.toLocaleString()}`);
    return false;
  }
  if (val > MAX_BUDGET) {
    setFieldError(input, err, `Maximum budget is ₦${MAX_BUDGET.toLocaleString()}`);
    return false;
  }
  clearFieldError(input, err);
  return true;
}

function validateDeadline(input) {
  const val   = input.value;
  const today = new Date().toISOString().split('T')[0];
  const err   = document.getElementById('deadlineError');
  if (!val || val < today) {
    setFieldError(input, err, 'Deadline must be today or in the future');
    return false;
  }
  clearFieldError(input, err);
  return true;
}

function setFieldError(input, errEl, message) {
  input.classList.add('input-error');
  if (errEl) { errEl.textContent = message; errEl.style.display = 'block'; }
}

function clearFieldError(input, errEl) {
  input.classList.remove('input-error');
  if (errEl) { errEl.style.display = 'none'; }
}

/* ── Form submission ─────────────────────────────────────────── */
async function handleTaskSubmit(e) {
  e.preventDefault();

  const form       = e.target;
  const submitBtn  = document.getElementById('taskSubmitBtn');
  const titleInput = document.getElementById('taskTitle');
  const descInput  = document.getElementById('taskDescription');
  const budgetInput= document.getElementById('taskBudget');
  const locInput   = document.getElementById('taskLocation');
  const dlInput    = document.getElementById('taskDeadline');

  /* Run all validations */
  const isValid = [
    validateTitle(titleInput),
    validateBudget(budgetInput),
    validateDeadline(dlInput),
  ].every(Boolean);

  if (!isValid) {
    showToast('Please fix the highlighted fields before submitting.');
    return;
  }

  /* Build task payload
   * from future-features.js
   */
  const taskPayload = {
    title:       titleInput.value.trim(),
    description: descInput.value.trim(),
    budget:      parseFloat(budgetInput.value),
    location:    locInput.value.trim(),
    deadline:    dlInput.value,
    category:    form.taskCategory?.value || 'other',
    urgent:      document.getElementById('urgentToggle')?.checked || false,
  };

  /* Show loading state */
  setButtonLoading(submitBtn, 'Posting task...');

  try {
    /* Require login — redirect if not authenticated */
    if (window.ST?.auth) {
      const user = await window.ST.auth.getCurrentUser();
      if (!user) {
        showToast('Please log in to post a task.');
        setTimeout(() => { window.location.href = 'login.html?redirect=post-task.html'; }, 1200);
        setButtonLoading(submitBtn, null, 'Post My Task');
        return;
      }
    }

    /* Use db.js postTask — handles auth + insert cleanly */
    if (window.ST?.db?.postTask) {
      await window.ST.db.postTask({
        title:       taskPayload.title,
        description: taskPayload.description,
        budget:      taskPayload.budget,
        location:    taskPayload.location,
        deadline:    taskPayload.deadline,
        category:    taskPayload.category,
      });
    } else {
      /* Fallback: direct insert if db.js not loaded */
      const { data: { user } } = await window.supabase.auth.getUser();
      const { error } = await window.supabase.from('tasks').insert({
        title:       taskPayload.title,
        description: taskPayload.description,
        budget:      taskPayload.budget,
        location:    taskPayload.location,
        deadline:    new Date(taskPayload.deadline).toISOString(),
        category:    taskPayload.category,
        status:      'open',
        customer_id: user?.id || null,
      });
      if (error) throw error;
    }

    /* Clear draft and show success */
    clearDraft();
    showTaskSuccessModal(taskPayload);
    console.log('[Tasks] Task inserted into Supabase ✓');

  } catch (err) {
    console.error('[Tasks] Insert error:', err);
    showToast('Failed to post task: ' + (err.message || 'Unknown error. Please try again.'));
  } finally {
    setButtonLoading(submitBtn, null, 'Post My Task');
  }
}

/* ── Success modal ───────────────────────────────────────────── */
function showTaskSuccessModal(payload) {
  const modal = document.getElementById('taskSuccessModal');
  if (modal) {
    const titleEl = modal.querySelector('[data-task-title]');
    if (titleEl) titleEl.textContent = payload.title;
    modal.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
  } else {
    /* Modal not found — show toast and redirect to dashboard */
    typeof showToast === 'function' && showToast(`Task "${payload.title}" posted successfully!`);
    setTimeout(() => { window.location.href = 'dashboard-customer.html'; }, 1500);
  }
}

function closeTaskModal() {
  const modal = document.getElementById('taskSuccessModal');
  if (modal) {
    modal.classList.remove('modal-open');
    document.body.style.overflow = '';
  }
}

/* ── Progress indicator (task post steps) ────────────────────── */
function initPostSteps() {
  const steps = document.querySelectorAll('[data-step]');
  const form  = document.getElementById('postTaskForm');
  if (!steps.length || !form) return;

  const inputs = form.querySelectorAll('input[required], textarea[required], select[required]');
  const updateProgress = () => {
    let filled = 0;
    inputs.forEach(input => { if (input.value.trim()) filled++; });
    const pct = Math.round((filled / inputs.length) * 100);
    const bar = document.getElementById('formProgressBar');
    if (bar) bar.style.width = `${pct}%`;
    const label = document.getElementById('formProgressLabel');
    if (label) label.textContent = `${pct}% complete`;
  };
  inputs.forEach(input => input.addEventListener('input', updateProgress));
  updateProgress();
}

/* ── Utilities ───────────────────────────────────────────────── */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

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

/*
 * Global sprint alert helper
function showSprintAlert(title, message) { if (typeof showToast === "function") showToast(title); }

function closeSprintModal() {
  const modal = document.getElementById('sprintModal');
  if (modal) {
    modal.classList.remove('modal-open');
    document.body.style.overflow = '';
  }
}

/* ── Expose globals ──────────────────────────────────────────── */
window.initTaskForm    = initTaskForm;
window.closeTaskModal  = closeTaskModal;
window.closeSprintModal = closeSprintModal;
window.clearDraft      = clearDraft;
window.showSprintAlert = showSprintAlert;

/* ============================================================
   STREET TASKERS — subscription.js
   Sprint 2: Subscription tier UI, free-slot counter, upgrade CTA
   ============================================================
   All interactions are UI-only in Sprint 2.

   Future Sprint 4: Replace showSprintAlert() calls with real
   Paystack payment integration:
     initiatePaystackPayment({ plan, taskerId, amount })
   Future Sprint 4: checkTaskerSubscription() from
   future-features.js drives the slot counter and gate logic.
   Future Sprint 4: Subscription status stored in Supabase
   'subscriptions' table and checked on every booking attempt.
   ============================================================ */

'use strict';

/* ── Subscription plans ──────────────────────────────────────── */
/*
 * Future Sprint 4: Plans fetched from Supabase 'subscription_plans'
 * table to allow admin-controlled pricing and limits.
 * Paystack plan codes will be stored here.
 */
const SUBSCRIPTION_PLANS = [
  {
    id:          'free',
    name:        'Free',
    price:       0,
    priceLabel:  'Free forever',
    period:      '',
    color:       'plan-free',
    highlight:   false,
    bookingLimit: 5,
    features: [
      { text: 'Up to 5 customer connections',  included: true },
      { text: 'Basic profile listing',          included: true },
      { text: 'Customer messaging',             included: true },
      { text: 'Featured on homepage',           included: false },
      { text: 'Priority search ranking',        included: false },
      { text: 'Analytics dashboard',            included: false },
      { text: 'Unlimited bookings',             included: false },
      { text: 'Verified badge',                 included: false },
    ],
    cta:         'Current Plan',
    ctaDisabled: true,
    /* Future Sprint 4: paystackPlanCode: null */
  },
  {
    id:          'starter',
    name:        'Starter',
    price:       9999,
    priceLabel:  '₦9,999',
    period:      '/month',
    color:       'plan-starter',
    highlight:   false,
    bookingLimit: 100,
    features: [
      { text: 'Up to 100 bookings/month',       included: true },
      { text: 'Enhanced profile listing',        included: true },
      { text: 'Customer messaging',             included: true },
      { text: 'Featured on homepage',           included: true },
      { text: 'Priority search ranking',        included: false },
      { text: 'Analytics dashboard',            included: false },
      { text: 'Unlimited bookings',             included: false },
      { text: 'Verified badge',                 included: true },
    ],
    cta:         'Upgrade to Starter',
    ctaDisabled: false,
    badge:       null,
    /* Future Sprint 4: paystackPlanCode: 'PLN_starter_monthly' */
  },
  {
    id:          'pro',
    name:        'Pro',
    price:       29999,
    priceLabel:  '₦29,999',
    period:      '/month',
    color:       'plan-pro',
    highlight:   true,
    bookingLimit: Infinity,
    features: [
      { text: 'Unlimited bookings',             included: true },
      { text: 'Top featured placement',         included: true },
      { text: 'Priority customer messaging',    included: true },
      { text: 'Featured on homepage',           included: true },
      { text: 'Priority search ranking',        included: true },
      { text: 'Analytics dashboard',            included: true },
      { text: 'Unlimited bookings',             included: true },
      { text: 'Verified badge + Pro badge',     included: true },
    ],
    cta:         'Upgrade to Pro',
    ctaDisabled: false,
    badge:       'Most Popular',
    /* Future Sprint 4: paystackPlanCode: 'PLN_pro_monthly' */
  },
];

/* ── Mock tasker subscription state ──────────────────────────── */
/*
 * Future Sprint 4: Replace with real data from:
 *   checkTaskerSubscription(currentUser.id)
 */
const MOCK_TASKER_STATE = {
  plan:          'free',
  usedFreeSlots: 3,   // out of 5
  totalJobs:     3,
  needsUpgrade:  false,
};

/* ── Init ────────────────────────────────────────────────────── */
function initSubscriptionPage() {
  renderPlanCards();
  renderFreeSlotMeter();
  wireToggleBilling();
  renderComparisonTable();

  console.log('[Subscription] Subscription page initialized ✓');
}

/* ── Render plan cards ───────────────────────────────────────── */
function renderPlanCards() {
  const container = document.getElementById('planCardsGrid');
  if (!container) return;

  container.innerHTML = '';
  SUBSCRIPTION_PLANS.forEach(plan => {
    const card = buildPlanCard(plan);
    container.appendChild(card);
  });
}

function buildPlanCard(plan) {
  const wrap = document.createElement('div');
  wrap.className = `plan-card ${plan.color} ${plan.highlight ? 'plan-highlighted' : ''} anim-fade-up`;

  const featuresHTML = plan.features.map(f => `
    <li class="plan-feature ${f.included ? 'feature-yes' : 'feature-no'}">
      ${f.included
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
      }
      <span>${f.text}</span>
    </li>
  `).join('');

  wrap.innerHTML = `
    ${plan.badge ? `<div class="plan-badge">${plan.badge}</div>` : ''}
    <div class="plan-header">
      <span class="plan-name">${plan.name}</span>
      <div class="plan-price">
        <span class="plan-price-amount">${plan.priceLabel}</span>
        <span class="plan-price-period">${plan.period}</span>
      </div>
      <p class="plan-desc">${getPlanDescription(plan.id)}</p>
    </div>
    <ul class="plan-features">${featuresHTML}</ul>
    <button
      class="btn ${plan.highlight ? 'btn-primary' : 'btn-outline'} btn-full plan-cta"
      data-plan-id="${plan.id}"
      ${plan.ctaDisabled ? 'disabled' : ''}
      onclick="handlePlanCTA('${plan.id}')"
    >${plan.cta}</button>
    ${plan.ctaDisabled ? `<p class="plan-current-note">You are on the Free plan</p>` : ''}
  `;
  return wrap;
}

function getPlanDescription(planId) {
  const descs = {
    free:    'Perfect for getting started. Build your reputation with your first 5 customers.',
    starter: 'Grow your business with more visibility and up to 100 bookings per month.',
    pro:     'For full-time taskers. Unlimited bookings and maximum platform exposure.',
  };
  return descs[planId] || '';
}

/* ── Plan CTA handler ────────────────────────────────────────── */
/*
 * Future Sprint 4: Replace this with real Paystack integration:
 *
 *   const handler = PaystackPop.setup({
 *     key: PAYSTACK_PUBLIC_KEY,
 *     email: currentUser.email,
 *     amount: plan.price * 100,  // kobo
 *     plan: plan.paystackPlanCode,
 *     callback: (response) => {
 *       verifySubscription(response.reference);
 *     }
 *   });
 *   handler.openIframe();
 */
function handlePlanCTA(planId) {
  if (planId === 'free') return;

  const plan = SUBSCRIPTION_PLANS.find(p => p.id === planId);
  if (!plan) return;

  const modal = document.getElementById('subscriptionModal');
  if (modal) {
    modal.querySelector('[data-plan-name]').textContent   = plan.name;
    modal.querySelector('[data-plan-price]').textContent  = plan.priceLabel + plan.period;
    modal.querySelector('[data-plan-limit]').textContent  =
      plan.bookingLimit === Infinity ? 'Unlimited' : `${plan.bookingLimit} per month`;
    modal.dataset.activePlan = planId;
    modal.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
  } else {
    showSprintAlert(
      `Upgrade to ${plan.name} — Sprint 4 Feature`,
      `Plan: ${plan.name}\nPrice: ${plan.priceLabel}${plan.period}\nBooking limit: ${plan.bookingLimit === Infinity ? 'Unlimited' : plan.bookingLimit + '/month'}\n\nPaystack subscription billing will be integrated in Sprint 4.`
    );
  }
}

function closeSubscriptionModal() {
  const modal = document.getElementById('subscriptionModal');
  if (modal) {
    modal.classList.remove('modal-open');
    document.body.style.overflow = '';
  }
}

async function handleSubscriptionConfirm() {
  const modal  = document.getElementById('subscriptionModal');
  const planId = modal?.dataset.activePlan;
  const plan   = SUBSCRIPTION_PLANS.find(p => p.id === planId);
  const btn    = document.getElementById('subscriptionConfirmBtn');

  setButtonLoading(btn, 'Redirecting to payment...');
  await delay(1400);
  setButtonLoading(btn, null, 'Proceed to Payment');
  closeSubscriptionModal();

  /*
   * ── Future Sprint 4 Integration Point ──
   * Paystack payment flow starts here.
   */
  showSprintAlert(
    'Payment Gateway — Sprint 4',
    `Paystack integration for "${plan?.name}" plan (${plan?.priceLabel}${plan?.period}) will be wired up in Sprint 4.\n\nYour selection has been logged.`
  );
  console.log('[Subscription] Plan selection captured for Sprint 4:', planId);
}

/* ── Free slot meter ─────────────────────────────────────────── */
function renderFreeSlotMeter() {
  const meter  = document.getElementById('freeSlotMeter');
  const label  = document.getElementById('freeSlotLabel');
  const notice = document.getElementById('upgradeNotice');
  if (!meter) return;

  const { usedFreeSlots, needsUpgrade } = MOCK_TASKER_STATE;
  const MAX_FREE = 5;
  const pct      = (usedFreeSlots / MAX_FREE) * 100;

  /* Render slot pips */
  meter.innerHTML = '';
  for (let i = 0; i < MAX_FREE; i++) {
    const pip = document.createElement('div');
    pip.className = `slot-pip ${i < usedFreeSlots ? 'slot-used' : 'slot-empty'}`;
    meter.appendChild(pip);
  }

  if (label) {
    label.textContent = `${usedFreeSlots} of ${MAX_FREE} free slots used`;
    label.className   = usedFreeSlots >= MAX_FREE ? 'slot-label slot-label-full' : 'slot-label';
  }

  /* Show upgrade notice when 4+ slots used */
  if (notice) {
    notice.style.display = usedFreeSlots >= 4 ? 'flex' : 'none';
    if (usedFreeSlots >= MAX_FREE) {
      notice.classList.add('notice-urgent');
      notice.querySelector('[data-notice-text]').textContent =
        'You have used all 5 free connections. Upgrade to keep receiving bookings.';
    } else {
      notice.querySelector('[data-notice-text]').textContent =
        `Only ${MAX_FREE - usedFreeSlots} free connection${MAX_FREE - usedFreeSlots === 1 ? '' : 's'} remaining. Consider upgrading soon.`;
    }
  }
}

/* ── Billing toggle (monthly / annual) ──────────────────────── */
/*
 * Future Sprint 4: Annual pricing fetched from Supabase
 * with a discount_percent field on subscription_plans.
 */
function wireToggleBilling() {
  const toggle  = document.getElementById('billingToggle');
  const monthly = document.getElementById('monthlyLabel');
  const annual  = document.getElementById('annualLabel');
  const savings = document.getElementById('annualSavings');

  if (!toggle) return;

  toggle.addEventListener('change', () => {
    const isAnnual = toggle.checked;
    if (monthly) monthly.classList.toggle('billing-active', !isAnnual);
    if (annual)  annual.classList.toggle('billing-active',  isAnnual);
    if (savings) savings.style.display = isAnnual ? 'inline-flex' : 'none';

    /* Update displayed prices */
    document.querySelectorAll('.plan-price-amount').forEach(el => {
      const planId = el.closest('[data-plan-id]')?.dataset.planId ||
                     el.closest('.plan-card')?.querySelector('[data-plan-id]')?.dataset.planId;
      const plan   = SUBSCRIPTION_PLANS.find(p => p.id === planId);
      if (!plan || plan.price === 0) return;
      const price  = isAnnual ? Math.round(plan.price * 10 * 0.8) : plan.price;
      el.textContent = `₦${price.toLocaleString()}`;
    });
    document.querySelectorAll('.plan-price-period').forEach(el => {
      if (el.textContent.includes('month')) {
        el.textContent = isAnnual ? '/year' : '/month';
      }
    });
  });
}

/* ── Comparison table ────────────────────────────────────────── */
function renderComparisonTable() {
  const table = document.getElementById('comparisonTable');
  if (!table) return;

  const features = [
    'Customer connections',
    'Profile listing',
    'Messaging',
    'Homepage featured',
    'Priority ranking',
    'Analytics',
    'Verified badge',
    'Dedicated support',
  ];

  const rows = features.map((f, i) => {
    const cells = SUBSCRIPTION_PLANS.map(plan => {
      const feat = plan.features[i];
      return `<td class="${feat?.included ? 'comp-yes' : 'comp-no'}">
        ${feat?.included
          ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
          : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--border-strong)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
        }
      </td>`;
    }).join('');
    return `<tr><td class="comp-feature">${f}</td>${cells}</tr>`;
  }).join('');

  table.innerHTML = `
    <thead>
      <tr>
        <th>Feature</th>
        ${SUBSCRIPTION_PLANS.map(p => `<th class="${p.highlight ? 'comp-highlight-head' : ''}">${p.name}</th>`).join('')}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  `;
}

/* ── Utility ─────────────────────────────────────────────────── */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function setButtonLoading(btn, loadingText, resetText) {
  if (!btn) return;
  if (loadingText) {
    btn.disabled = true;
    btn.dataset.orig = btn.textContent;
    btn.innerHTML = `<span class="btn-spinner"></span> ${loadingText}`;
  } else {
    btn.disabled = false;
    btn.textContent = resetText || btn.dataset.orig || 'Submit';
  }
}

/* ── Expose globals ──────────────────────────────────────────── */
window.initSubscriptionPage    = initSubscriptionPage;
window.handlePlanCTA           = handlePlanCTA;
window.closeSubscriptionModal  = closeSubscriptionModal;
window.handleSubscriptionConfirm = handleSubscriptionConfirm;

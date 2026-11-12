/* ============================================================
   STREETTASKER — pricing-methods.js   (Categories Stage 6a)
   The nine ways to charge from the Category Directory document (section 5), plus Price range and Per visit that the
   site already had. One list, used by Post a Service (what to ask), cards, the service page and My Services (what to show).
   Runs in the browser and in Node (tests). No DOM.

   Saved on `services`:  price (number)  price_max (number or null)  rate_unit ('/hour', '/job', '/item'...)
                         price_type (text, see METHODS)  price_unit_label (text, only for "per unit": "square metre")
   Rows saved before this stage have no price_type: one price reads as "Starting From", two prices as "Price range", no price as "Ask for a quote".
   STPricing.describe(row) -> { type, label, amount, unit, text }   e.g. { label: 'Hourly rate', amount: '₦5,000', unit: '/hour', text: '₦5,000/hour' }
   ============================================================ */
(function (root) {
  'use strict';

  var NAIRA = '\u20a6';
  /* amount: 'one' = one price asked, 'range' = From + To, 'optional' = one price, may be left empty, 'none' = no price */
  var METHODS = [
    { key: 'fixed',      label: 'Fixed price',      unit: 'job',     amount: 'one',      cardLabel: 'Fixed price',      hint: 'One price for the whole job, e.g. \u20a625,000 for a logo.' },
    { key: 'hourly',     label: 'Per hour',         unit: 'hour',    amount: 'one',      cardLabel: 'Hourly rate',      hint: 'You charge for each hour you work, e.g. \u20a65,000 per hour.' },
    { key: 'daily',      label: 'Per day',          unit: 'day',     amount: 'one',      cardLabel: 'Daily rate',       hint: 'You charge for each day, e.g. \u20a630,000 per day.' },
    { key: 'item',       label: 'Per item',         unit: 'item',    amount: 'one',      cardLabel: 'Per item',         hint: 'You charge for each thing, e.g. \u20a62,000 per chair.' },
    { key: 'session',    label: 'Per session',      unit: 'session', amount: 'one',      cardLabel: 'Per session',      hint: 'You charge for each lesson or appointment, e.g. \u20a610,000 per lesson.' },
    { key: 'visit',      label: 'Per visit',        unit: 'visit',   amount: 'one',      cardLabel: 'Per visit',        hint: 'You charge each time you come to the customer.' },
    { key: 'unit',       label: 'Per unit',         unit: 'unit',    amount: 'one',      cardLabel: 'Per unit',         hint: 'You charge by measure, e.g. \u20a65,000 per square metre. Say what the unit is.', needsLabel: true },
    { key: 'from',       label: 'Starting price',   unit: 'job',     amount: 'one',      cardLabel: 'Starting From',    hint: 'The lowest price a customer can expect, e.g. from \u20a615,000.' },
    { key: 'range',      label: 'Price range',      unit: 'job',     amount: 'range',    cardLabel: 'Price range',      hint: 'The usual lowest and highest price for the job.' },
    { key: 'negotiable', label: 'Negotiable',       unit: 'job',     amount: 'optional', cardLabel: 'Negotiable',       hint: 'The price is open to discussion. You may add a price to start from.' },
    { key: 'quote',      label: 'Custom quotation', unit: 'job',     amount: 'none',     cardLabel: 'Custom quotation', hint: 'You decide the price after seeing the job. Customers ask you for a quote.' }
  ];
  var BY = {};
  METHODS.forEach(function (m) { BY[m.key] = m; });
  var UNIT_LABEL_MAX = 30;

  function get(key) { return Object.prototype.hasOwnProperty.call(BY, key) ? BY[key] : null; }

  function ngn(n) { return NAIRA + Number(n).toLocaleString('en-NG'); }

  /* what an old row (no price_type) is */
  function typeOf(row) {
    row = row || {};
    if (get(row.price_type)) return row.price_type;
    var p = Number(row.price) || 0, mx = Number(row.price_max) || 0;
    if (p > 0 && mx > p) return 'range';
    if (p > 0) return 'from';
    return 'quote';
  }

  function unitWord(row, type) {
    var m = get(type), raw = String((row && row.rate_unit) || '').replace('/', '').trim();
    if (type === 'unit') return String((row && row.price_unit_label) || '').trim();
    if (type === 'fixed' || type === 'negotiable' || type === 'quote') return '';   /* "per job" adds nothing */
    if (type === 'from' || type === 'range') return raw && raw !== 'job' ? raw : '';
    return raw || (m ? m.unit : '');
  }

  function describe(row) {
    row = row || {};
    var type = typeOf(row), m = get(type);
    var p = Number(row.price) || 0, mx = Number(row.price_max) || 0;
    var label = m.cardLabel;
    if (type === 'unit') { var w = unitWord(row, 'unit'); label = w ? 'Per ' + w : 'Per unit'; }
    var amount;
    if (type === 'quote' || (p <= 0 && type !== 'negotiable')) amount = 'Ask for a quote';
    else if (p <= 0) amount = 'Negotiable';
    else amount = mx > p ? ngn(p) + '\u2013' + ngn(mx) : ngn(p);
    var u = p > 0 ? unitWord(row, type) : '';
    var unit = u ? '/' + u : '';
    return { type: type, label: label, amount: amount, unit: unit, hasAmount: p > 0, text: amount + unit };
  }

  /* Check what the tasker entered. Returns '' when fine, otherwise the message to show. */
  function check(type, price, priceMax, unitLabel) {
    var m = get(type);
    if (!m) return 'Please choose how you charge.';
    var p = Number(price) || 0, mx = Number(priceMax) || 0;
    if (m.amount === 'one' && !(p > 0)) return 'Please enter your price.';
    if (m.amount === 'range' && !(p > 0)) return 'Please enter the lowest price.';
    if (m.amount === 'range' && !(mx > p)) return 'For a price range, the \u201cTo\u201d amount must be more than the \u201cFrom\u201d amount.';
    if (m.amount === 'optional' && price !== '' && price != null && !(p > 0)) return 'Enter a valid price, or leave it empty.';
    if (m.needsLabel) {
      var l = String(unitLabel || '').trim();
      if (!l) return 'Say what the unit is, e.g. square metre.';
      if (l.length > UNIT_LABEL_MAX) return 'Keep the unit under ' + UNIT_LABEL_MAX + ' characters.';
    }
    return '';
  }

  /* The values to save for a method. Amount rules above must have passed. */
  function toRow(type, price, priceMax, unitLabel) {
    var m = get(type), p = Number(price) || 0, mx = Number(priceMax) || 0;
    if (!m) return null;
    if (m.amount === 'none') { p = 0; mx = 0; }
    return {
      price: p,
      price_max: m.amount === 'range' && mx > p ? mx : null,
      rate_unit: '/' + m.unit,
      price_type: m.key,
      price_unit_label: m.needsLabel ? String(unitLabel || '').trim().replace(/\s+/g, ' ') : null
    };
  }

  root.STPricing = { METHODS: METHODS, UNIT_LABEL_MAX: UNIT_LABEL_MAX, get: get, typeOf: typeOf, describe: describe, check: check, toRow: toRow };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.STPricing;
})(typeof window !== 'undefined' ? window : this);

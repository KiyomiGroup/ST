/* ============================================================
   STREETTASKER — category-forms.js   (Categories Stage 3)
   Category-specific questions for Post a Service, described as DATA and drawn by one engine.
   Needs js/categories.js (STCat) only for subcategory names in the browser; the schema part also runs in Node (tests).
   Styles: css/category-forms.css (small) + the shared .pt-* form classes. Tokens only.

   HOW TO ADD A CATEGORY (Stage 4): add one entry to SCHEMAS below. No other file changes.
     SCHEMAS.<category value> = { groups: { name: ['Sub A', 'Sub B'] }, fields: [ ...field... ] }
   A field:
     key        saved name inside services.details (letters, digits, underscore). Never rename once live.
     label      the question the tasker reads
     type       'select'  one answer (up to 5 options draw as chips, more as a dropdown)
                'multi'   several answers (chips)
                'yesno'   Yes / No (saved as true / false)
                'text'    one line      'textarea' a few lines
                'number'  a whole number (min, max, unit)
     options    for select / multi
     required   true = must be answered when the field is shown
     hint       short grey text beside the label
     placeholder, maxLength (text), min / max / unit (number)
     subs       show only for these subcategories: ['Plumbing'] or '@groupName'.  Leave out = every subcategory.
     notSubs    hide for these subcategories (same forms as subs)
     when       show only when another field has an answer: { key: 'x', equals: true }  or  { key: 'x', in: ['a', 'b'] }

   Saved shape (services.details, jsonb):   { "_v": 1, "supplies": "Either", "team_size": 3, "property_types": ["Office"], ... }
   Flat on purpose: Stage 5 filters can use details->>'supplies' and details->'property_types' ? 'Office'.
   Only fields that are SHOWN for the chosen subcategory are saved. Hidden ones are dropped.

   STCatForms.has(category)
   STCatForms.fieldsFor(category, sub, values)    the fields shown now (pure)
   STCatForms.validate(category, sub, values)     { ok, errors: { key: message }, clean }
   STCatForms.describe(category, sub, details)    [{ key, label, text }] for showing answers to customers (Stage 5)
   STCatForms.mount({ box, section, select, sub, onChange })   the page hook (browser only)
   STCatForms.setValues(details) / .collect() / .check()       draft load, save, validate-and-mark-errors
   ============================================================ */
(function (root) {
  'use strict';

  var VERSION = 1;
  var OTHER_SUB = 'Other (not listed)';
  var CHIP_MAX = 5;   /* a one-answer question with more options than this becomes a dropdown */

  /* ── The pilot schemas: Cleaning, Repairs, Moving & Delivery (picked because their shapes differ most) ── */
  var SCHEMAS = {};

  SCHEMAS.cleaning = {
    groups: {
      home:       ['House Cleaning', 'Deep Cleaning', 'Move-in / Move-out Cleaning', 'Housekeeping', 'Kitchen Cleaning', 'Bathroom Cleaning'],
      premises:   ['House Cleaning', 'Deep Cleaning', 'Move-in / Move-out Cleaning', 'Housekeeping', 'Kitchen Cleaning', 'Bathroom Cleaning', 'Office Cleaning', 'Commercial Cleaning', 'Post-Construction Cleaning', 'Window Cleaning', 'Tile & Grout Scrubbing'],
      specialist: ['Deep Cleaning', 'Post-Construction Cleaning', 'Carpet Cleaning', 'Upholstery Cleaning', 'Window Cleaning', 'Tile & Grout Scrubbing', 'Air Duct Cleaning', 'Mold Remediation', 'Chimney Sweeping'],
      regular:    ['House Cleaning', 'Housekeeping', 'Office Cleaning', 'Commercial Cleaning'],
      hazard:     ['Mold Remediation', 'Fumigation Coordination', 'Air Duct Cleaning', 'Chimney Sweeping']
    },
    fields: [
      { key: 'supplies', label: 'Cleaning supplies', type: 'select', required: true, options: ['I bring supplies', 'Client provides', 'Either'] },
      { key: 'team_size', label: 'Cleaners per visit', type: 'number', required: true, min: 1, max: 50, unit: 'people', placeholder: 'e.g. 2' },
      { key: 'property_types', label: 'Places you clean', type: 'multi', required: true, subs: '@premises', options: ['Apartment / flat', 'House / duplex', 'Office', 'Shop / commercial space', 'School, church or hall'] },
      { key: 'max_size', label: 'Largest home you take on', type: 'select', required: true, subs: '@home', options: ['Studio to 2 bedrooms', '3 to 4 bedrooms', '5 or more bedrooms', 'Whole buildings'] },
      { key: 'equipment', label: 'Equipment you bring', type: 'multi', subs: '@specialist', hint: 'Optional', options: ['Vacuum cleaner', 'Steam cleaner', 'Pressure washer', 'Floor polisher', 'Ladders / access gear'] },
      { key: 'recurring', label: 'Do you offer weekly or monthly visits?', type: 'yesno', subs: '@regular' },
      { key: 'protective_gear', label: 'Do you use protective equipment for this work?', type: 'yesno', required: true, subs: '@hazard' },
      { key: 'disposal_included', label: 'Is taking the waste to a dump site included?', type: 'yesno', required: true, subs: ['Waste Removal'] },
      { key: 'eco_products', label: 'Do you use eco-friendly products?', type: 'yesno', notSubs: '@hazard', hint: 'Optional' }
    ]
  };

  SCHEMAS.handyman = {
    groups: {
      appliances: ['Appliance Repair', 'Air Conditioning Repair', 'Generator Repair', 'Refrigerator Repair', 'Washing Machine Repair', 'Television Repair', 'Inverter & Battery Services'],
      power:      ['Solar Installation & Repairs', 'Inverter & Battery Services']
    },
    fields: [
      { key: 'tools', label: 'Do you bring your own tools?', type: 'yesno', required: true },
      { key: 'materials', label: 'Materials and spare parts', type: 'select', required: true, notSubs: ['Pest Control'], options: ['Client supplies', 'I supply (charged at cost)', 'Either'] },
      { key: 'brands', label: 'Brands you repair', type: 'text', required: true, subs: '@appliances', maxLength: 120, placeholder: 'e.g. LG, Samsung, Mikano' },
      { key: 'plumbing_jobs', label: 'Plumbing jobs you do', type: 'multi', required: true, subs: ['Plumbing'], options: ['Leaks & pipe repair', 'Toilets & sinks', 'Water heaters', 'Borehole & pumps', 'Blocked drains', 'New pipe installation'] },
      { key: 'electrical_jobs', label: 'Electrical jobs you do', type: 'multi', required: true, subs: ['Electrical Repairs'], options: ['Rewiring', 'Sockets & switches', 'Breakers & distribution boards', 'Lighting', 'Fault finding'] },
      { key: 'generator_types', label: 'Generators you work on', type: 'multi', required: true, subs: ['Generator Repair'], options: ['Small petrol', 'Diesel', 'Large / industrial'] },
      { key: 'power_systems', label: 'Systems you work on', type: 'multi', required: true, subs: '@power', options: ['Inverters', 'Solar panels', 'Batteries', 'Charge controllers', 'Full system design'] },
      { key: 'paint_types', label: 'Painting you do', type: 'multi', required: true, subs: ['Painting'], options: ['Interior walls', 'Exterior walls', 'Textured or screeded finishes', 'Wood & metal (gloss)', 'Spray painting'] },
      { key: 'lock_jobs', label: 'Locksmith work you do', type: 'multi', required: true, subs: ['Locksmith'], options: ['Door locks', 'Car keys', 'Safes', 'Smart locks', 'Lock-out help'] },
      { key: 'pest_targets', label: 'Pests you treat', type: 'multi', required: true, subs: ['Pest Control'], options: ['Cockroaches', 'Rodents', 'Termites', 'Mosquitoes', 'Bed bugs', 'Ants & other insects'] },
      { key: 'emergency', label: 'Do you take emergency call-outs?', type: 'yesno', hint: 'Optional' },
      { key: 'callout_fee', label: 'Do you charge an inspection or call-out fee?', type: 'yesno', required: true },
      { key: 'callout_amount', label: 'Call-out fee (₦)', type: 'number', required: true, min: 1, max: 10000000, when: { key: 'callout_fee', equals: true }, placeholder: 'e.g. 5000' },
      { key: 'warranty', label: 'Warranty on your work', type: 'select', options: ['None', '7 days', '30 days', '3 months', '6 months or more'], hint: 'Optional' }
    ]
  };

  SCHEMAS.logistics = {
    groups: {
      crew:     ['House Moving', 'Office Relocation', 'Furniture Moving', 'Heavy Item Transportation', 'White Glove Delivery', 'Junk Removal', 'Loading & Unloading', 'Packing & Unpacking'],
      boxes:    ['House Moving', 'Office Relocation', 'Furniture Moving', 'Packing & Unpacking'],
      parcel:   ['Local Delivery', 'Parcel Delivery', 'Dispatch Rider', 'Shopping Delivery', 'Document Delivery', 'Courier Services', 'Errand Delivery'],
      insured:  ['House Moving', 'Office Relocation', 'Furniture Moving', 'Heavy Item Transportation', 'White Glove Delivery', 'Courier Services', 'Parcel Delivery', 'International Freight Forwarding'],
      noVehicle: ['Loading & Unloading', 'Packing & Unpacking', 'Warehousing', 'International Freight Forwarding'],
      noRoute:  ['Warehousing', 'International Freight Forwarding']
    },
    fields: [
      { key: 'vehicle', label: 'What do you move things with?', type: 'select', required: true, notSubs: '@noVehicle', options: ['On foot or public transport', 'Bicycle', 'Motorbike', 'Car', 'Van', 'Pickup', 'Truck (up to 5 tonnes)', 'Truck (over 5 tonnes)'] },
      { key: 'coverage', label: 'Where do you work?', type: 'select', required: true, notSubs: '@noRoute', options: ['Within my city', 'Between cities', 'Nationwide'] },
      { key: 'max_load_kg', label: 'Heaviest load you take', type: 'number', required: true, notSubs: '@noVehicle', min: 1, max: 100000, unit: 'kg', placeholder: 'e.g. 500' },
      { key: 'crew_size', label: 'People on your crew (including you)', type: 'number', required: true, subs: '@crew', min: 1, max: 50, unit: 'people', placeholder: 'e.g. 4' },
      { key: 'packing_materials', label: 'Do you bring boxes and wrapping?', type: 'yesno', subs: '@boxes', hint: 'Optional' },
      { key: 'goods_cover', label: 'Cover for goods while you carry them', type: 'select', required: true, subs: '@insured', options: ['None', 'Basic cover', 'Full insurance'] },
      { key: 'same_day', label: 'Do you offer same-day delivery?', type: 'yesno', subs: '@parcel', hint: 'Optional' },
      { key: 'live_updates', label: 'Do you share live updates with the customer?', type: 'yesno', subs: '@parcel', hint: 'Optional' },
      { key: 'hire_mode', label: 'How is the vehicle hired?', type: 'select', required: true, subs: ['Van & Truck Hire'], options: ['With a driver', 'Self-drive', 'Both'] },
      { key: 'storage_size', label: 'Storage space you offer', type: 'text', required: true, subs: ['Warehousing'], maxLength: 80, placeholder: 'e.g. 200 sqm, 3 units' },
      { key: 'storage_features', label: 'Storage features', type: 'multi', subs: ['Warehousing'], hint: 'Optional', options: ['24-hour security', 'CCTV', 'Fire safety', 'Dry & ventilated'] },
      { key: 'freight_modes', label: 'How can you ship?', type: 'multi', required: true, subs: ['International Freight Forwarding'], options: ['Air', 'Sea', 'Road'] },
      { key: 'customs', label: 'Do you handle customs clearance?', type: 'yesno', required: true, subs: ['International Freight Forwarding'] }
    ]
  };

  /* ── Pure helpers (no DOM) ───────────────────────────────────────────────────────────────────── */
  function has(category) { return Object.prototype.hasOwnProperty.call(SCHEMAS, category); }

  function subList(schema, spec) {
    if (typeof spec === 'string' && spec.charAt(0) === '@') return (schema.groups && schema.groups[spec.slice(1)]) || [];
    return Array.isArray(spec) ? spec : [];
  }

  /* fields that apply to this subcategory, before "when" is looked at */
  function candidates(category, sub) {
    if (!has(category)) return [];
    var schema = SCHEMAS[category];
    return schema.fields.filter(function (f) {
      if (f.subs && subList(schema, f.subs).indexOf(sub) === -1) return false;
      if (f.notSubs && subList(schema, f.notSubs).indexOf(sub) !== -1) return false;
      return true;
    });
  }

  function whenOk(f, values) {
    if (!f.when) return true;
    var v = values ? values[f.when.key] : undefined;
    if (Object.prototype.hasOwnProperty.call(f.when, 'equals')) return v === f.when.equals;
    if (Array.isArray(f.when.in)) return f.when.in.indexOf(v) !== -1;
    return true;
  }

  function fieldsFor(category, sub, values) {
    return candidates(category, sub).filter(function (f) { return whenOk(f, values || {}); });
  }

  function isEmpty(f, v) {
    if (v === undefined || v === null) return true;
    if (f.type === 'multi') return !Array.isArray(v) || v.length === 0;
    if (f.type === 'text' || f.type === 'textarea') return String(v).trim() === '';
    return false;
  }

  /* Check the answers for the fields shown now. Returns { ok, errors, clean }; clean has only shown, valid answers. */
  function validate(category, sub, values) {
    var errors = {}, clean = {}, vals = values || {};
    if (!has(category)) return { ok: true, errors: errors, clean: null };
    fieldsFor(category, sub, vals).forEach(function (f) {
      var v = vals[f.key];
      if (isEmpty(f, v)) {
        if (f.required) errors[f.key] = (f.type === 'text' || f.type === 'textarea' || f.type === 'number') ? 'Please fill this in.' : 'Please choose an answer.';
        return;
      }
      if (f.type === 'yesno') {
        if (v !== true && v !== false) { errors[f.key] = 'Please choose Yes or No.'; return; }
        clean[f.key] = v;
      } else if (f.type === 'select') {
        if (f.options.indexOf(v) === -1) { errors[f.key] = 'Please choose one of the options.'; return; }
        clean[f.key] = v;
      } else if (f.type === 'multi') {
        var keep = f.options.filter(function (o) { return v.indexOf(o) !== -1; });   /* options order, unknown values dropped */
        if (!keep.length) { errors[f.key] = 'Please choose at least one.'; return; }
        clean[f.key] = keep;
      } else if (f.type === 'number') {
        var n = typeof v === 'number' ? v : parseFloat(v);
        if (isNaN(n) || n !== Math.floor(n)) { errors[f.key] = 'Enter a whole number.'; return; }
        var lo = typeof f.min === 'number' ? f.min : 0;
        if (n < lo) { errors[f.key] = 'Enter ' + lo + ' or more.'; return; }
        if (typeof f.max === 'number' && n > f.max) { errors[f.key] = 'Enter ' + f.max + ' or less.'; return; }
        clean[f.key] = n;
      } else {   /* text, textarea */
        var s = String(v).trim().replace(/\s+/g, ' ');
        var max = f.maxLength || (f.type === 'textarea' ? 400 : 120);
        if (s.length > max) { errors[f.key] = 'Keep this under ' + max + ' characters.'; return; }
        clean[f.key] = s;
      }
    });
    var ok = Object.keys(errors).length === 0;
    if (ok && Object.keys(clean).length) clean._v = VERSION;
    return { ok: ok, errors: errors, clean: ok ? (Object.keys(clean).length ? clean : null) : clean };
  }

  /* Saved details -> lines a customer can read: [{ key, label, text }] (Stage 5 uses this on cards and the service page) */
  function describe(category, sub, details) {
    var out = [];
    if (!has(category) || !details || typeof details !== 'object') return out;
    fieldsFor(category, sub, details).forEach(function (f) {
      var v = details[f.key];
      if (isEmpty(f, v)) return;
      var text;
      if (f.type === 'yesno') text = v ? 'Yes' : 'No';
      else if (f.type === 'multi') text = v.join(', ');
      else if (f.type === 'number') text = String(v) + (f.unit ? ' ' + f.unit : '');
      else text = String(v);
      out.push({ key: f.key, label: f.label.replace(/\?$/, ''), text: text });
    });
    return out;
  }

  /* ── Browser part: draws the fields and keeps the answers ────────────────────────────────────── */
  var M = null;   /* { box, section, sel, subEl, onChange, category, sub, values, rendered } */

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fid(key) { return 'cf-' + key; }

  var CHEVRON = '<svg class="pt-i pt-select-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>';

  function controlHtml(f, v) {
    var id = fid(f.key), i;
    if (f.type === 'yesno') {
      return '<div class="pt-segment cf-yesno" role="radiogroup" aria-labelledby="' + id + '-l">' +
        '<label class="pt-segment-opt"><input type="radio" name="' + id + '" value="yes"' + (v === true ? ' checked' : '') + ' /><span>Yes</span></label>' +
        '<label class="pt-segment-opt"><input type="radio" name="' + id + '" value="no"' + (v === false ? ' checked' : '') + ' /><span>No</span></label></div>';
    }
    if (f.type === 'select' && f.options.length > CHIP_MAX) {
      var opts = '<option value="">Choose...</option>' + f.options.map(function (o) { return '<option value="' + esc(o) + '"' + (v === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
      return '<div class="pt-field"><select id="' + id + '" class="pt-input pt-select" data-cf-input="' + f.key + '">' + opts + '</select>' + CHEVRON + '</div>';
    }
    if (f.type === 'select' || f.type === 'multi') {
      var multi = f.type === 'multi', chips = '';
      for (i = 0; i < f.options.length; i++) {
        var on = multi ? (Array.isArray(v) && v.indexOf(f.options[i]) !== -1) : v === f.options[i];
        chips += '<button type="button" class="pt-chip' + (on ? ' is-active' : '') + '" data-cf-chip="' + f.key + '" data-val="' + esc(f.options[i]) + '" ' +
          (multi ? 'aria-pressed="' + (on ? 'true' : 'false') + '"' : 'role="radio" aria-checked="' + (on ? 'true' : 'false') + '"') + '>' + esc(f.options[i]) + '</button>';
      }
      return '<div class="pt-chips cf-chips" role="' + (multi ? 'group' : 'radiogroup') + '" aria-labelledby="' + id + '-l">' + chips + '</div>';
    }
    if (f.type === 'textarea') {
      return '<textarea id="' + id + '" class="pt-input pt-textarea" rows="3" maxlength="' + (f.maxLength || 400) + '" data-cf-input="' + f.key + '" placeholder="' + esc(f.placeholder || '') + '">' + esc(v || '') + '</textarea>';
    }
    if (f.type === 'number') {
      return '<div class="pt-field"><input type="number" inputmode="numeric" id="' + id + '" class="pt-input" data-cf-input="' + f.key + '" min="' + (typeof f.min === 'number' ? f.min : 0) + '"' + (typeof f.max === 'number' ? ' max="' + f.max + '"' : '') +
        ' step="1" value="' + (v == null ? '' : esc(v)) + '" placeholder="' + esc(f.placeholder || '') + '" autocomplete="off" />' + (f.unit ? '<span class="cf-unit">' + esc(f.unit) + '</span>' : '') + '</div>';
    }
    return '<div class="pt-field"><input type="text" id="' + id + '" class="pt-input" data-cf-input="' + f.key + '" maxlength="' + (f.maxLength || 120) + '" value="' + esc(v || '') + '" placeholder="' + esc(f.placeholder || '') + '" autocomplete="off" /></div>';
  }

  function drawField(f, v) {
    var id = fid(f.key), plain = f.type === 'text' || f.type === 'number' || f.type === 'textarea' || (f.type === 'select' && f.options.length > CHIP_MAX);
    var req = f.required ? ' <span class="pt-req" aria-hidden="true">*</span>' : '';
    var label = plain ? '<label class="pt-label" id="' + id + '-l" for="' + id + '">' + esc(f.label) + req + '</label>' : '<span class="pt-label" id="' + id + '-l">' + esc(f.label) + req + '</span>';
    return '<div class="pt-group cf-group" data-cf="' + f.key + '"><div class="pt-label-row">' + label + (f.hint ? '<span class="pt-hint">' + esc(f.hint) + '</span>' : '') + '</div>' +
      controlHtml(f, v) + '<p class="pt-error" id="' + id + '-e" role="alert"></p></div>';
  }

  /* show or hide the "when" fields without redrawing (so the tasker never loses their place) */
  function applyWhen() {
    if (!M) return;
    candidates(M.category, M.sub).forEach(function (f) {
      var g = M.box.querySelector('[data-cf="' + f.key + '"]');
      if (g) g.hidden = !whenOk(f, M.values);
    });
  }

  function setError(key, msg) {
    var p = document.getElementById(fid(key) + '-e'); if (p) p.textContent = msg || '';
    var g = M.box.querySelector('[data-cf="' + key + '"]');
    if (g) { var inp = g.querySelector('.pt-field, .pt-textarea, .pt-segment, .cf-chips'); if (inp) inp.classList.toggle('has-error', !!msg); }
  }

  function redraw() {
    var cat = M.sel.value, sub = M.subEl ? M.subEl.value : '';
    var list = (has(cat) && sub) ? candidates(cat, sub) : [];
    if (cat !== M.category) M.values = {};     /* a different category: start clean. The same category keeps what was typed when the type of work changes. */
    M.category = cat; M.sub = sub;
    M.section.hidden = !list.length;
    M.box.innerHTML = list.map(function (f) { return drawField(f, M.values[f.key]); }).join('');
    applyWhen();
    if (typeof M.onChange === 'function') M.onChange(list.length > 0);
  }

  function onInput(e) {
    var t = e.target, key = t.getAttribute && t.getAttribute('data-cf-input');
    if (!key) {
      if (t.type === 'radio' && /^cf-/.test(t.name || '')) {       /* yes / no */
        key = t.name.slice(3); M.values[key] = t.value === 'yes';
        setError(key, ''); applyWhen();
      }
      return;
    }
    var f = candidates(M.category, M.sub).filter(function (x) { return x.key === key; })[0];
    if (!f) return;
    if (f.type === 'number') { var n = t.value === '' ? undefined : parseFloat(t.value); M.values[key] = isNaN(n) ? undefined : n; }
    else M.values[key] = t.value;
    setError(key, ''); applyWhen();
  }

  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-cf-chip]') : null;
    if (!b) return;
    var key = b.getAttribute('data-cf-chip'), val = b.getAttribute('data-val');
    var f = candidates(M.category, M.sub).filter(function (x) { return x.key === key; })[0];
    if (!f) return;
    var group = b.parentNode.querySelectorAll('[data-cf-chip]'), k;
    if (f.type === 'multi') {
      var cur = Array.isArray(M.values[key]) ? M.values[key].slice() : [], at = cur.indexOf(val);
      if (at === -1) cur.push(val); else cur.splice(at, 1);
      M.values[key] = cur;
      b.classList.toggle('is-active', at === -1); b.setAttribute('aria-pressed', at === -1 ? 'true' : 'false');
    } else {
      M.values[key] = (M.values[key] === val) ? undefined : val;    /* tap again to clear */
      for (k = 0; k < group.length; k++) {
        var on = group[k].getAttribute('data-val') === M.values[key];
        group[k].classList.toggle('is-active', on); group[k].setAttribute('aria-checked', on ? 'true' : 'false');
      }
    }
    setError(key, ''); applyWhen();
  }

  /* opts: { box: id, section: id, select: id, sub: id, onChange(hasFields) } */
  function mount(opts) {
    var el = function (id) { return document.getElementById(id); };
    M = { box: el(opts.box), section: el(opts.section), sel: el(opts.select), subEl: el(opts.sub), onChange: opts.onChange, category: '', sub: '', values: {} };
    if (!M.box || !M.section || !M.sel) { M = null; return; }
    M.sel.addEventListener('change', redraw);
    M.box.addEventListener('input', onInput);
    M.box.addEventListener('change', onInput);
    M.box.addEventListener('click', onClick);
    redraw();
  }

  /* After the page set the category and subcategory from a saved draft: draw, then fill in the saved answers */
  function setValues(details) {
    if (!M) return;
    var d = details && typeof details === 'object' ? details : {};
    M.values = {};
    Object.keys(d).forEach(function (k) { if (k !== '_v') M.values[k] = d[k]; });
    M.category = M.sel.value;   /* same category: redraw keeps the values just set */
    redraw();
  }

  /* what to save: the cleaned answers, or null when this category has no form */
  function collect() {
    if (!M || !has(M.sel.value)) return null;
    var r = validate(M.sel.value, M.subEl ? M.subEl.value : '', M.values);
    return r.clean || null;
  }

  /* validate and mark each problem under its question. Returns { ok, firstKey } */
  function check() {
    if (!M) return { ok: true, firstKey: null };
    var cat = M.sel.value, sub = M.subEl ? M.subEl.value : '';
    var r = validate(cat, sub, M.values), first = null;
    fieldsFor(cat, sub, M.values).forEach(function (f) {
      setError(f.key, r.errors[f.key] || '');
      if (r.errors[f.key] && !first) first = f.key;
    });
    return { ok: r.ok, firstKey: first, count: Object.keys(r.errors).length };
  }

  function focusField(key) {
    var g = M && M.box.querySelector('[data-cf="' + key + '"]'); if (!g) return;
    var t = g.querySelector('input:not([type=radio]), select, textarea, button');
    if (g.scrollIntoView) g.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (t && t.focus) { try { t.focus({ preventScroll: true }); } catch (x) { /* ignore */ } }
  }

  root.STCatForms = {
    VERSION: VERSION, SCHEMAS: SCHEMAS, OTHER_SUB: OTHER_SUB,
    has: has, candidates: candidates, fieldsFor: fieldsFor, validate: validate, describe: describe,
    mount: mount, setValues: setValues, collect: collect, check: check, focusField: focusField
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.STCatForms;
})(typeof window !== 'undefined' ? window : globalThis);

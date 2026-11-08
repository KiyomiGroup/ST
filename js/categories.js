/* ============================================================
   STREETTASKER — categories.js
   One shared list of service categories, their icons and the services under each.
   Used by: post-task, post-service, find-tasks, find-services, home-feed.
   Icons are inline SVG that use currentColor, so the page colour tokens style them (no hex here).
   Old saved values (electrician, plumber, barber, mechanic...) still resolve to a group via ALIASES.
   Exposes window.STCat: list, get(value), resolve(value), matches(rowCategory, groupValue),
                         iconHtml(value, cls), label(value), emoji(value), detect(title, description)
   ============================================================ */
(function (root) {
  'use strict';

  /* Each icon: 64x64 viewBox, solid shapes (fill) plus a few strokes, drawn after the reference sheet. */
  var I = {
    cleaning: '<path d="M38 4l4 2-12 28-4-2z"/><path d="M8 58l8-22 12 6-6 16z"/><path d="M4 60h56v3H4z"/><path d="M36 38h24l-3 22H39z"/><circle cx="42" cy="26" r="4"/><circle cx="52" cy="22" r="3"/><circle cx="48" cy="31" r="2.5"/>',
    laundry: '<rect x="8" y="4" width="48" height="56" rx="6"/><rect x="14" y="10" width="14" height="5" rx="2" fill="var(--color-bg)"/><circle cx="45" cy="12.5" r="2.5" fill="var(--color-bg)"/><circle cx="32" cy="38" r="17" fill="var(--color-bg)"/><circle cx="32" cy="38" r="12"/><path d="M23 40c3-3.5 6 3.5 9 0s6 3.5 9 0" fill="none" stroke="var(--color-bg)" stroke-width="2.5" stroke-linecap="round"/>',
    grooming: '<rect x="8" y="6" width="14" height="5" rx="2"/><rect x="8" y="53" width="14" height="5" rx="2"/><path d="M10 13h10v38H10z" fill-opacity=".35"/><path d="M10 16l10 6v6l-10-6zM10 30l10 6v6l-10-6z"/><circle cx="38" cy="44" r="6" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="52" cy="48" r="6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M40 40L58 8M49 44L34 10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>',
    automotive: '<path d="M6 40c0-6 4-8 10-10l8-9c2-2 4-3 7-3h12c3 0 6 1 8 3l7 9c5 1 8 3 8 8v6H6z"/><circle cx="20" cy="50" r="7" fill="var(--color-bg)" stroke="currentColor" stroke-width="3"/><circle cx="48" cy="50" r="7" fill="var(--color-bg)" stroke="currentColor" stroke-width="3"/><path d="M26 25h8v8H20zM38 25h6l5 8H38z" fill="var(--color-bg)"/><path d="M14 8h12v6H14zM38 8h12v6H38zM26 8h12v3H26z"/>',
    handyman: '<g transform="rotate(45 32 32)"><rect x="29" y="16" width="6" height="46" rx="2"/><path d="M16 6h26a4 4 0 0 1 4 4v8H16z"/><path d="M16 6c-6 0-10 4-12 8l12 0z"/></g><g transform="rotate(-45 32 32)"><rect x="29" y="22" width="6" height="40" rx="2"/><path d="M22 2h20v18c0 5-4 8-8 8h-4c-4 0-8-3-8-8z"/><rect x="29" y="0" width="6" height="12" fill="var(--color-bg)"/></g>',
    landscaping: '<path d="M6 8l8-3 8 24-8 3z"/><path d="M8 38l30-6 14 8v10H8z"/><circle cx="18" cy="52" r="7" fill="var(--color-bg)" stroke="currentColor" stroke-width="3"/><circle cx="50" cy="52" r="6" fill="var(--color-bg)" stroke="currentColor" stroke-width="3"/><path d="M52 6c-8 0-14 6-14 14 0 4 2 8 4 10l10-10-6 14c8 0 14-6 14-14 0-6-3-11-8-14z"/>',
    hospitality: '<path d="M8 8h18l-2 20c-1 5-4 7-7 7s-6-2-7-7z"/><path d="M38 8h18l-2 20c-1 5-4 7-7 7s-6-2-7-7z"/><path d="M16 35h2v18h-2zM46 35h2v18h-2z"/><path d="M8 56h18v4H8zM38 56h18v4H38z"/><path d="M30 2l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>',
    business: '<rect x="4" y="18" width="40" height="34" rx="5"/><path d="M16 18v-6c0-3 2-5 5-5h6c3 0 5 2 5 5v6h-4v-5h-8v5z"/><path d="M4 32h40" stroke="var(--color-bg)" stroke-width="3"/><rect x="20" y="29" width="8" height="7" rx="1.5" fill="var(--color-bg)"/><ellipse cx="50" cy="52" rx="10" ry="4"/><path d="M40 44h20v6H40zM40 36h20v6H40z"/>',
    it_tech: '<rect x="8" y="8" width="48" height="34" rx="4" fill="none" stroke="currentColor" stroke-width="4"/><path d="M2 46h60v4c0 3-2 5-5 5H7c-3 0-5-2-5-5z"/><circle cx="32" cy="25" r="9" fill="none" stroke="currentColor" stroke-width="5"/><path d="M29 12h6v5h-6zM29 33h6v5h-6zM19 22h5v6h-5zM40 22h5v6h-5z"/>',
    creative: '<path d="M30 6C14 6 4 18 4 32c0 12 8 22 20 22 5 0 7-3 7-6 0-4 3-6 7-6h4c8 0 14-4 14-12C56 16 44 6 30 6z"/><circle cx="18" cy="26" r="4" fill="var(--color-bg)"/><circle cx="28" cy="18" r="4" fill="var(--color-bg)"/><circle cx="40" cy="20" r="4" fill="var(--color-bg)"/><circle cx="16" cy="40" r="4" fill="var(--color-bg)"/><path d="M50 2l8 8-24 26-10 4 2-10z"/>',
    logistics: '<path d="M6 20c0-2 2-3 5-3h26l9-11h7l-6 11h7c4 0 6 1 6 3s-2 3-6 3H11c-3 0-5-1-5-3z"/><path d="M2 30h32v22H2z"/><path d="M36 36h13l9 9v7H36z"/><circle cx="14" cy="53" r="6" fill="var(--color-bg)" stroke="currentColor" stroke-width="3"/><circle cx="47" cy="53" r="6" fill="var(--color-bg)" stroke="currentColor" stroke-width="3"/><path d="M11 38l8-4 8 4v8l-8 4-8-4z" fill="var(--color-bg)"/>',
    health: '<path d="M26 56C8 44 2 35 2 26 2 18 8 13 15 13c5 0 9 3 11 7 2-4 6-7 11-7 7 0 13 5 13 13 0 9-6 18-24 30z"/><path d="M5 34h12l4-9 6 17 5-13 4 5h10" fill="none" stroke="var(--color-bg)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M50 4v14a8 8 0 0 0 8 8v8" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><circle cx="58" cy="42" r="4.5" fill="none" stroke="currentColor" stroke-width="3"/>',
    pet: '<ellipse cx="20" cy="42" rx="13" ry="11"/><ellipse cx="6" cy="29" rx="4.5" ry="6"/><ellipse cx="16" cy="19" rx="4.5" ry="6.5"/><ellipse cx="27" cy="19" rx="4.5" ry="6.5"/><ellipse cx="36" cy="29" rx="4.5" ry="6"/><path d="M38 24l12-11 12 11" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><path d="M44 32h12v5H44z"/><path d="M45 37h2v17h-2zM49 37h2v17h-2zM53 37h2v17h-2z"/>',
    education: '<path d="M4 54V34l22 6 22-6v20l-22-5z"/><path d="M26 6l24 10-24 10L2 16z"/><path d="M12 24v10l14 6 14-6V24l-14 6z"/><path d="M48 16v14" stroke="currentColor" stroke-width="3"/><circle cx="48" cy="34" r="3"/><path d="M52 8h10v38H52z" fill-opacity=".35"/><path d="M60 4l3 4-14 44-4-1z"/>',
    financial: '<rect x="4" y="6" width="34" height="52" rx="5"/><rect x="9" y="11" width="24" height="12" rx="2" fill="var(--color-bg)"/><text x="21" y="21" font-size="11" font-weight="800" text-anchor="middle" fill="currentColor" font-family="Manrope, Arial, sans-serif">$</text><path d="M10 30h6v5h-6zM20 30h6v5h-6zM30 30h4v5h-4zM10 39h6v5h-6zM20 39h6v5h-6zM30 39h4v5h-4zM10 48h6v5h-6zM20 48h6v5h-6zM30 48h4v5h-4z" fill="var(--color-bg)"/><rect x="40" y="16" width="20" height="40" rx="3" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="50" cy="36" r="8" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="50" cy="36" r="2.5"/>',
    legal: '<g transform="rotate(-40 14 46)"><rect x="2" y="36" width="24" height="11" rx="2.5"/><rect x="12" y="47" width="4" height="15" rx="1.5"/></g><path d="M2 61h24v3H2z"/><path d="M40 6h4v46h-4z"/><path d="M30 52h24v5H30z"/><circle cx="42" cy="7" r="3.5"/><path d="M25 14h34v4H25z"/><path d="M30 18l-6 14M30 18l6 14M54 18l-6 14M54 18l6 14" stroke="currentColor" stroke-width="2" fill="none"/><path d="M23 32h14a7 7 0 0 1-14 0zM47 32h14a7 7 0 0 1-14 0z"/>',
    events: '<path d="M2 3h60v6H2z"/><path d="M2 9h15c-3 12-3 26 3 46H2z"/><path d="M62 9H47c3 12 3 26-3 46h18z"/><path d="M26 9h12l-3 8H29z"/><path d="M29 17h6l9 38H20z" fill-opacity=".28"/><circle cx="26" cy="30" r="2"/><circle cx="38" cy="26" r="2"/><circle cx="33" cy="40" r="2"/><circle cx="44" cy="36" r="2"/><g transform="rotate(-12 44 52)"><rect x="30" y="45" width="28" height="14" rx="2.5"/><path d="M44 46v12" stroke="var(--color-bg)" stroke-width="2" stroke-dasharray="3 2"/></g>',
    other: '<path d="M10 54l24-24 8 8-24 24z"/><path d="M40 6a12 12 0 0 0-10 17l-6 6 10 10 6-6A12 12 0 0 0 54 20l-8 4-6-6 4-8z"/>'
  };

  /* value = what is saved on a task or service. label = what people read. */
  var LIST = [
    { value: 'cleaning',    label: 'Cleaning Services',        short: 'Cleaning',     emoji: '🧹', services: ['Deep house cleaning', 'Move-in / move-out cleaning', 'Post-construction cleaning', 'Carpet & upholstery cleaning', 'Window washing', 'Tile & grout scrubbing', 'Mold remediation', 'Air duct cleaning', 'Chimney sweeping', 'Laundry & ironing'] },
    { value: 'laundry',     label: 'Laundry Services',         short: 'Laundry',      emoji: '🧺', services: ['Wash & fold', 'Ironing & pressing', 'Dry cleaning', 'Laundry pickup & delivery', 'Duvet & bedding cleaning', 'Stain removal', 'Shoe & sneaker cleaning', 'Curtain & rug washing', 'Bulk & business laundry'] },
    { value: 'grooming',    label: 'Grooming & Barber',        short: 'Grooming',     emoji: '💈', services: ['Haircutting & styling', 'Beard trimming & shaping', 'Hair coloring', 'Manicure & pedicure', 'Facial treatments', 'Massage therapy', 'Body waxing', 'Eyebrow threading', 'Makeup application', 'Spray tanning'] },
    { value: 'automotive',  label: 'Automotive Services',      short: 'Automotive',   emoji: '🚗', services: ['Mobile car detailing', 'Oil change', 'Tire replacement & balancing', 'Brake repair', 'Engine diagnostics', 'Windshield repair', 'Auto body restoration', 'Towing', 'Roadside assistance', 'Vehicle wrapping'] },
    { value: 'handyman',    label: 'Handyman & Trades',        short: 'Handyman',     emoji: '🛠️', services: ['Plumbing repair', 'Electrical wiring', 'HVAC installation & maintenance', 'Roof repair', 'Carpentry', 'Painting & drywall', 'Locksmith services', 'Pest control', 'Pool maintenance', 'Appliance repair'] },
    { value: 'landscaping', label: 'Landscaping',              short: 'Landscaping',  emoji: '🌿', services: ['Lawn mowing & turf care', 'Tree trimming & removal', 'Garden design', 'Irrigation system installation', 'Pressure washing', 'Snow removal', 'Hardscaping & paving', 'Gutter cleaning'] },
    { value: 'hospitality', label: 'Hospitality & Catering',   short: 'Hospitality',  emoji: '🥂', services: ['Catering', 'Bartending', 'Waitstaff services', 'Private chef', 'Party equipment rental', 'Floral design', 'Venue rental'] },
    { value: 'business',    label: 'Business & Professional',  short: 'Business',     emoji: '💼', services: ['Human resources management', 'Business strategy consulting', 'Translation & interpretation', 'Virtual assistance', 'Payroll processing', 'Office administration'] },
    { value: 'it_tech',     label: 'IT & Tech Support',        short: 'IT & Tech',    emoji: '💻', services: ['Custom software development', 'Website design', 'Network administration', 'Cybersecurity auditing', 'Cloud infrastructure management', 'Hardware repair', 'Data recovery', 'Technical support'] },
    { value: 'creative',    label: 'Creative & Marketing',     short: 'Creative',     emoji: '🎨', services: ['Graphic design', 'Copywriting', 'Search engine optimization', 'Social media management', 'Brand strategy', 'Video editing', '3D modeling', 'Voiceover recording', 'Print production'] },
    { value: 'logistics',   label: 'Logistics & Freight',      short: 'Logistics',    emoji: '🚚', services: ['Local moving', 'International freight forwarding', 'Warehousing', 'Courier & parcel delivery', 'Junk removal', 'Inventory management', 'Supply chain consulting', 'White glove delivery'] },
    { value: 'health',      label: 'Health & Wellness',        short: 'Health',       emoji: '❤️', services: ['Personal fitness training', 'Nutrition coaching', 'Physical therapy', 'Mental health counseling', 'Acupuncture', 'Chiropractic care', 'Nursing assistance', 'Lactation consulting'] },
    { value: 'pet',         label: 'Pet Services',             short: 'Pets',         emoji: '🐾', services: ['Dog walking', 'Pet grooming', 'Veterinary care', 'Pet sitting', 'Animal training', 'Aquarium maintenance', 'Mobile vet care'] },
    { value: 'education',   label: 'Education & Tutoring',     short: 'Education',    emoji: '🎓', services: ['Private tutoring', 'Language instruction', 'Music lessons', 'Test preparation', 'Driving instruction', 'Career coaching', 'Corporate skill training'] },
    { value: 'financial',   label: 'Financial Services',       short: 'Financial',    emoji: '🧮', services: ['Accounting & bookkeeping', 'Tax preparation', 'Payroll processing', 'Financial planning', 'Audit support'] },
    { value: 'legal',       label: 'Legal & Advocacy',         short: 'Legal',        emoji: '⚖️', services: ['Legal consulting', 'Contract drafting & review', 'Document notarisation', 'Dispute mediation'] },
    { value: 'events',      label: 'Event Planning',           short: 'Events',       emoji: '🎉', services: ['Event planning', 'DJ & live sound', 'Photography & videography', 'Security detail', 'Decor & staging', 'MC & event hosting'] },
    { value: 'other',       label: 'Other',                    short: 'Other',        emoji: '🛠️', services: [] }
  ];

  /* Values saved before this list existed (and common free-text) -> the group they belong to */
  var ALIASES = {
    electrician: 'handyman', electrical: 'handyman', plumber: 'handyman', plumbing: 'handyman', carpentry: 'handyman', carpenter: 'handyman',
    painting: 'handyman', painter: 'handyman', repairs: 'handyman', assembly: 'handyman', appliance: 'handyman',
    barber: 'grooming', beauty: 'grooming', makeup: 'grooming', hair: 'grooming', nails: 'grooming',
    mechanic: 'automotive', auto: 'automotive', car: 'automotive',
    moving: 'logistics', delivery: 'logistics', courier: 'logistics', freight: 'logistics',
    gardening: 'landscaping', lawn: 'landscaping', garden: 'landscaping',
    cleaner: 'cleaning',
    laundromat: 'laundry', dryclean: 'laundry', drycleaning: 'laundry', ironing: 'laundry', washing: 'laundry',
    cooking: 'hospitality', chef: 'hospitality', catering: 'hospitality',
    photography: 'events', photographer: 'events', security: 'events',
    tutoring: 'education', tutor: 'education', lesson: 'education',
    tech: 'it_tech', it: 'it_tech', software: 'it_tech',
    marketing: 'creative', design: 'creative',
    accounting: 'financial', finance: 'financial', tax: 'financial',
    lawyer: 'legal', law: 'legal',
    petcare: 'pet', pets: 'pet', fitness: 'health', wellness: 'health', event: 'events', eventplanning: 'events'
  };

  var BY = {};
  LIST.forEach(function (c) { BY[c.value] = c; });

  function key(v) { return String(v || '').toLowerCase().replace(/[^a-z]/g, ''); }

  /* any saved value -> a group object (unknown free text -> Other) */
  function resolve(value) {
    var raw = String(value || '').toLowerCase().trim();
    if (BY[raw]) return BY[raw];
    var k = key(value);
    if (ALIASES[k] && BY[ALIASES[k]]) return BY[ALIASES[k]];
    for (var i = 0; i < LIST.length; i++) { if (key(LIST[i].value) === k || key(LIST[i].short) === k) return LIST[i]; }
    return BY.other;
  }

  /* Does a saved value belong to the chosen group? Old values count. Free text under Other counts as Other. */
  function matches(rowValue, groupValue) {
    if (!groupValue) return true;
    return resolve(rowValue).value === resolve(groupValue).value;
  }

  function iconHtml(value, cls) {
    var c = resolve(value);
    return '<svg class="st-cat-ico ' + (cls || '') + '" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" focusable="false">' + (I[c.value] || I.other) + '</svg>';
  }

  /* group -> every raw value that belongs to it (group value + old values), for database filters */
  function expand(groupValue) {
    var g = resolve(groupValue).value, out = [g];
    Object.keys(ALIASES).forEach(function (a) { if (ALIASES[a] === g) out.push(a); });
    return out;
  }

  /* ── Detect a category from what the person wrote (used when they pick "Other") ──────────────────────────────────
     Each word is matched at the START of a word ("plumb" finds plumber, plumbing). A trailing "!" means the whole word
     (plural "s" allowed): "car!" finds car and cars but not card or carpet; "cat!" does not find category.
     A word in the title counts 3, in the description 1 (each word once). A category needs 2 or more to win, so one passing
     mention in the description is not enough. Two categories tied: the one mentioned first wins. Still unclear: null (stays Other). */
  var KEYWORDS = {
    cleaning:    ['clean', 'mop!', 'mopping', 'scrub', 'dusting', 'disinfect', 'sanitis', 'sanitiz', 'housekeep', 'house help', 'maid!', 'carpet wash', 'janitor'],
    laundry:     ['laundry', 'launder', 'laundromat', 'ironing', 'iron my', 'dry clean', 'wash and fold', 'wash & fold', 'wash my clothes', 'wash clothes', 'washing clothes', 'wash my duvet', 'duvet', 'bedsheet', 'starch', 'garment', 'clothes!', 'shoe wash', 'sneaker clean'],
    grooming:    ['haircut', 'hair cut', 'barber', 'braid', 'hairstyl', 'hair style', 'hair!', 'wig!', 'beard', 'manicure', 'pedicure', 'gel nail', 'nail tech', 'nails done', 'makeup', 'make-up', 'facial!', 'massage', 'waxing', 'eyelash', 'eyebrow', 'lash extension', 'dreadlock', 'salon'],
    automotive:  ['car wash', 'car repair', 'car service', 'car!', 'mechanic', 'tyre', 'tire!', 'brake', 'engine', 'oil change', 'vulcaniz', 'panel beat', 'windscreen', 'windshield', 'towing', 'vehicle', 'gearbox', 'radiator', 'jump start', 'wheel alignment', 'suspension', 'auto electrician'],
    handyman:    ['plumb', 'leak', 'pipe!', 'toilet', 'faucet', 'borehole', 'electrician', 'wiring', 'rewire', 'socket!', 'circuit breaker', 'generator', 'inverter', 'ac repair', 'air condition', 'fridge repair', 'freezer repair', 'appliance', 'carpent', 'furniture assembl', 'assemble', 'paint', 'drywall', 'pop ceiling', 'tiling', 'tiler', 'roofing', 'roof!', 'locksmith', 'door lock', 'pest control', 'cockroach', 'termite', 'rodent', 'fumigat', 'welding', 'welder', 'curtain rod', 'handyman', 'washing machine repair'],
    landscaping: ['lawn', 'garden', 'grass', 'tree!', 'hedge', 'landscap', 'irrigation', 'pressure wash', 'paving', 'interlock', 'gutter', 'flower bed', 'weeding', 'compound sweep'],
    hospitality: ['catering', 'caterer', 'cook!', 'cooking', 'chef!', 'bartend', 'waiter', 'waitress', 'waitstaff', 'small chops', 'jollof', 'buffet', 'canape', 'food for', 'party food', 'party rice', 'meal prep', 'cocktail'],
    business:    ['virtual assistant', 'hr!', 'human resource', 'business plan', 'business strateg', 'translat', 'interpret', 'secretar', 'office admin', 'company registration', 'cac registration', 'consultant', 'consulting', 'data entry', 'bookkeeper for my business', 'proposal writing', 'pitch deck'],
    it_tech:     ['website', 'web site', 'web develop', 'web design', 'app develop', 'mobile app', 'software', 'laptop', 'computer', 'pc!', 'phone repair', 'screen repair', 'wifi', 'wi-fi', 'router', 'network', 'cctv', 'cyber', 'data recovery', 'install windows', 'programmer', 'developer', 'wordpress', 'tech support', 'printer', 'it support', 'hosting', 'domain name'],
    creative:    ['logo!', 'graphic', 'flyer', 'branding', 'copywrit', 'social media', 'seo!', 'video edit', 'animation', 'illustrat', 'voiceover', 'voice over', 'content writ', 'poster', 'banner', '3d model', 'photo edit', 'photoshop', 'canva', 'jingle'],
    logistics:   ['moving', 'move my', 'relocat', 'dispatch', 'courier', 'deliver', 'pick up', 'pickup', 'haulage', 'freight', 'truck', 'van hire', 'luggage', 'parcel', 'junk removal', 'warehous', 'carry my', 'shipping', 'bike rider', 'errand'],
    health:      ['physio', 'fitness', 'personal trainer', 'gym!', 'nurse!', 'nursing', 'therap', 'nutrition', 'dietitian', 'diet plan', 'counsel', 'caregiver', 'elderly care', 'midwife', 'lactation', 'yoga', 'blood pressure', 'injection', 'home care', 'workout'],
    pet:         ['dog!', 'puppy', 'puppies', 'cat!', 'kitten', 'pet!', 'vet!', 'veterinar', 'walk my dog', 'aquarium', 'fish tank', 'pet groom', 'pet sit', 'parrot'],
    education:   ['tutor', 'lesson', 'teach', 'maths', 'mathematics', 'english class', 'jamb', 'waec', 'neco', 'ielts', 'exam prep', 'coaching class', 'learn to', 'driving lesson', 'driving school', 'piano', 'guitar', 'homework', 'french class', 'coding class', 'music lesson'],
    financial:   ['accountant', 'accounting', 'bookkeep', 'tax!', 'tax return', 'audit', 'financial plan', 'invoic', 'payroll', 'vat!', 'financial statement'],
    legal:       ['lawyer', 'solicitor', 'barrister', 'legal', 'contract!', 'agreement!', 'notar', 'affidavit', 'court!', 'tenancy agreement', 'land title', 'will drafting', 'mediation', 'litigation', 'power of attorney', 'attorney'],
    events:      ['event!', 'event planner', 'wedding', 'party', 'parties', 'photograph', 'videograph', 'dj!', 'mc!', 'decor', 'bridal', 'birthday', 'usher', 'bouncer', 'bodyguard', 'security guard', 'sound system', 'canopy', 'tent!', 'chairs for', 'live band', 'anniversary', 'burial', 'naming ceremony']
  };
  var KW_RX = null;
  function kwRegexes() {
    if (KW_RX) return KW_RX;
    KW_RX = {};
    Object.keys(KEYWORDS).forEach(function (g) {
      KW_RX[g] = KEYWORDS[g].map(function (w) {
        var whole = /!$/.test(w);
        var src = w.replace(/!$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
        return new RegExp('(?:^|[^a-z0-9])' + src + (whole ? '(?:s|es)?(?![a-z0-9])' : ''), 'i');
      });
    });
    return KW_RX;
  }

  /* title + description -> a group value, or null when it is not clear */
  function detect(title, description) {
    var t = String(title || ''), d = String(description || '');
    if (!t.trim() && !d.trim()) return null;
    var rx = kwRegexes(), best = null, bestScore = 0, bestFirst = Infinity, tie = false;
    Object.keys(rx).forEach(function (g) {
      var score = 0, first = Infinity;
      rx[g].forEach(function (r) {
        var tm = r.exec(t), dm = r.exec(d);
        if (tm) { score += 3; first = Math.min(first, tm.index); }
        if (dm) { score += 1; if (!tm) first = Math.min(first, 1000 + dm.index); }
      });
      if (score < 2) return;
      if (score > bestScore || (score === bestScore && first < bestFirst)) { best = g; bestScore = score; bestFirst = first; tie = false; }
      else if (score === bestScore && first === bestFirst) { tie = true; }
    });
    return tie ? null : best;
  }

  root.STCat = {
    detect: detect,
    expand: expand,
    list: LIST, icons: I, resolve: resolve, matches: matches, iconHtml: iconHtml,
    get: function (v) { return resolve(v); },
    label: function (v) { return resolve(v).label; },
    emoji: function (v) { return resolve(v).emoji; },
    /* <option> markup for a <select> */
    optionsHtml: function () { return LIST.map(function (c) { return '<option value="' + c.value + '">' + c.label + '</option>'; }).join(''); }
  };
})(window);

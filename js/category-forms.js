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

  /* ── Pilot schemas (Stage 3): Cleaning, Repairs, Moving & Delivery. Batch A (Stage 4a) follows below. ── */
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

  /* ═══ Stage 4, batch A ═══════════════════════════════════════════════════════════════════════════
     Home & Furniture, Gardening & Outdoor, Automotive, Beauty & Personal Care, Fashion & Tailoring.
     Questions are my own design (the Category Directory "Listing fields" lists were never supplied); keys are settled once listings exist. */

  SCHEMAS.home_furniture = {
    groups: {
      design:  ['Interior Decoration', 'Interior Design'],
      fixings: ['Wall Mounting', 'TV Installation', 'Shelf Installation', 'Curtain Installation', 'Blind Installation'],
      supply:  ['Furniture Repair', 'Upholstery', 'Cabinet Installation', 'Curtain Installation', 'Blind Installation', 'Wallpaper Installation', 'Home Improvement', 'Interior Decoration'],
      pieces:  ['Furniture Assembly', 'Furniture Repair', 'Upholstery']
    },
    fields: [
      { key: 'tools', label: 'Do you bring your own tools?', type: 'yesno', required: true, notSubs: '@design' },
      { key: 'materials', label: 'Materials and fittings', type: 'select', required: true, subs: '@supply', options: ['Client supplies', 'I supply (charged at cost)', 'Either'] },
      { key: 'furniture_types', label: 'Furniture you work on', type: 'multi', required: true, subs: '@pieces', options: ['Beds & wardrobes', 'Sofas & chairs', 'Tables & desks', 'Cabinets & shelves', 'Office furniture'] },
      { key: 'wall_types', label: 'Walls you can fix into', type: 'multi', required: true, subs: '@fixings', options: ['Concrete or block', 'Drywall or POP', 'Tiled walls', 'Wood panels'] },
      { key: 'tv_size', label: 'Largest TV you mount', type: 'select', required: true, subs: ['TV Installation'], options: ['Up to 43 inch', '44 to 65 inch', '66 inch or bigger'] },
      { key: 'design_services', label: 'What do you offer?', type: 'multi', required: true, subs: '@design', options: ['Space planning', 'Colour schemes', 'Furniture sourcing', '3D visuals', 'Styling and accessories'] },
      { key: 'site_visit', label: 'Do you visit the home before quoting?', type: 'yesno', required: true, subs: '@design' },
      { key: 'organise_areas', label: 'Areas you organise', type: 'multi', required: true, subs: ['Home Organisation'], options: ['Wardrobes', 'Kitchen & pantry', 'Garage or store', 'Home office', "Children's rooms"] },
      { key: 'smart_systems', label: 'Smart systems you set up', type: 'multi', required: true, subs: ['Home Automation'], options: ['Smart lighting', 'Smart locks & doorbells', 'CCTV link-up', 'Voice assistants', 'Whole-home control'] },
      { key: 'improvement_jobs', label: 'Jobs you do', type: 'multi', required: true, subs: ['Home Improvement'], options: ['POP ceilings', 'Flooring', 'Tiling', 'Doors & windows', 'Kitchen & bathroom upgrades'] },
      { key: 'warranty', label: 'Guarantee on your work', type: 'select', options: ['None', '7 days', '30 days', '3 months', '6 months or more'], hint: 'Optional' }
    ]
  };

  SCHEMAS.landscaping = {
    groups: {
      sized:    ['Gardening', 'Landscaping', 'Lawn Mowing', 'Weed Removal', 'Garden Maintenance', 'Hedge Trimming', 'Outdoor Cleaning', 'Pressure Washing', 'Paving & Hardscaping', 'Irrigation Installation'],
      cuttings: ['Gardening', 'Lawn Mowing', 'Tree Trimming', 'Hedge Trimming', 'Weed Removal', 'Garden Maintenance'],
      build:    ['Landscaping', 'Garden Design', 'Irrigation Installation', 'Paving & Hardscaping', 'Outdoor Decoration', 'Plant Care', 'Gardening'],
      regular:  ['Gardening', 'Lawn Mowing', 'Hedge Trimming', 'Garden Maintenance', 'Pool Cleaning', 'Plant Care']
    },
    fields: [
      { key: 'equipment', label: 'Tools and equipment', type: 'select', required: true, notSubs: ['Garden Design'], options: ['I bring them', 'Client provides', 'Either'] },
      { key: 'materials', label: 'Plants, soil and materials', type: 'select', required: true, subs: '@build', options: ['Client supplies', 'I supply (charged at cost)', 'Either'] },
      { key: 'property_types', label: 'Places you work in', type: 'multi', required: true, options: ['Home gardens', 'Estates & compounds', 'Offices & commercial', 'Schools, churches & halls'] },
      { key: 'max_area', label: 'Largest area you take on', type: 'select', required: true, subs: '@sized', options: ['Up to 100 sqm', '100 to 500 sqm', '500 to 2,000 sqm', 'Over 2,000 sqm'] },
      { key: 'tree_height', label: 'Highest trees you trim', type: 'select', required: true, subs: ['Tree Trimming'], options: ['Up to 3 metres', 'Up to 6 metres', 'Above 6 metres'] },
      { key: 'safety_gear', label: 'Do you use climbing and safety equipment?', type: 'yesno', required: true, subs: ['Tree Trimming'] },
      { key: 'pool_chemicals', label: 'Are pool chemicals included in your price?', type: 'yesno', required: true, subs: ['Pool Cleaning'] },
      { key: 'irrigation_types', label: 'Systems you install', type: 'multi', required: true, subs: ['Irrigation Installation'], options: ['Drip lines', 'Sprinklers', 'Borehole or pump connection', 'Timers & controllers'] },
      { key: 'design_output', label: 'What the customer receives', type: 'multi', required: true, subs: ['Garden Design'], options: ['Layout plan', 'Plant list', '3D visual', 'Site supervision'] },
      { key: 'waste_removal', label: 'Do you take away the cuttings and waste?', type: 'yesno', required: true, subs: '@cuttings' },
      { key: 'recurring', label: 'Do you offer weekly or monthly visits?', type: 'yesno', subs: '@regular', hint: 'Optional' }
    ]
  };

  SCHEMAS.automotive = {
    groups: {
      mobileOnly: ['Vehicle Towing', 'Roadside Assistance'],
      makes:      ['Car Mechanic', 'Auto Electrician', 'Vehicle Diagnostics', 'Vehicle Servicing', 'Car Air Conditioning Repair', 'Motorcycle Repair', 'Auto Parts Installation', 'Car Body Work'],
      parts:      ['Car Mechanic', 'Auto Electrician', 'Car Body Work', 'Tyre Replacement', 'Battery Replacement', 'Car Air Conditioning Repair', 'Auto Parts Installation', 'Windscreen Repair', 'Vehicle Servicing', 'Motorcycle Repair'],
      washing:    ['Car Wash', 'Car Detailing', 'Car Interior Cleaning'],
      reports:    ['Vehicle Diagnostics', 'Vehicle Inspection']
    },
    fields: [
      { key: 'service_location', label: 'Where do you work?', type: 'select', required: true, notSubs: '@mobileOnly', options: ['At my workshop', 'I come to the customer', 'Both'] },
      { key: 'vehicle_types', label: 'Vehicles you work on', type: 'multi', required: true, notSubs: ['Motorcycle Repair'], options: ['Cars', 'SUVs & jeeps', 'Buses & vans', 'Trucks', 'Motorcycles'] },
      { key: 'makes', label: 'Makes you know well', type: 'multi', required: true, subs: '@makes', options: ['Japanese', 'European', 'American', 'Korean', 'Chinese'] },
      { key: 'parts', label: 'Spare parts', type: 'select', required: true, subs: '@parts', options: ['Client supplies', 'I supply (charged at cost)', 'Either'] },
      { key: 'scanner', label: 'Do you use a computer diagnostic scanner?', type: 'yesno', required: true, subs: ['Vehicle Diagnostics', 'Auto Electrician'] },
      { key: 'written_report', label: 'Do you give a written report?', type: 'yesno', required: true, subs: '@reports' },
      { key: 'wash_types', label: 'What is included?', type: 'multi', required: true, subs: '@washing', options: ['Exterior wash', 'Interior vacuum', 'Engine bay', 'Polish & wax', 'Ceramic coating', 'Steam cleaning'] },
      { key: 'tyre_services', label: 'Tyre services', type: 'multi', required: true, subs: ['Tyre Replacement'], options: ['Fitting', 'Balancing', 'Wheel alignment', 'Puncture repair'] },
      { key: 'body_jobs', label: 'Body work you do', type: 'multi', required: true, subs: ['Car Body Work'], options: ['Dents', 'Panel beating', 'Spray painting', 'Bumper repair', 'Rust treatment'] },
      { key: 'wrap_types', label: 'Wrapping you do', type: 'multi', required: true, subs: ['Vehicle Wrapping'], options: ['Full wrap', 'Partial wrap', 'Colour change', 'Branding & adverts', 'Paint protection film'] },
      { key: 'towing_truck', label: 'Type of tow truck', type: 'select', required: true, subs: ['Vehicle Towing'], options: ['Flatbed', 'Hook and chain', 'Both'] },
      { key: 'coverage', label: 'How far do you travel?', type: 'select', required: true, subs: '@mobileOnly', options: ['Within my city', 'Between cities'] },
      { key: 'roadside_help', label: 'Help you give on the road', type: 'multi', required: true, subs: ['Roadside Assistance'], options: ['Jump start', 'Flat tyre', 'Fuel delivery', 'Lock-out', 'Winching'] },
      { key: 'response_time', label: 'How fast can you reach a customer?', type: 'select', required: true, subs: '@mobileOnly', options: ['Within 30 minutes', 'Within 1 hour', 'Within 2 hours', 'Booked in advance only'] },
      { key: 'open_24h', label: 'Do you work day and night?', type: 'yesno', subs: '@mobileOnly', hint: 'Optional' },
      { key: 'warranty', label: 'Guarantee on your work', type: 'select', notSubs: '@mobileOnly', options: ['None', '7 days', '30 days', '3 months', '6 months or more'], hint: 'Optional' }
    ]
  };

  SCHEMAS.grooming = {
    groups: {
      hair:     ['Hair Styling', 'Hair Braiding', 'Hair Treatment', 'Hair Colouring'],
      nails:    ['Nail Technology', 'Manicure & Pedicure'],
      parties:  ['Makeup Artistry', 'Hair Styling', 'Hair Braiding', 'Nail Technology', 'Manicure & Pedicure', 'Spa Services']
    },
    fields: [
      { key: 'service_location', label: 'Where do you work?', type: 'select', required: true, options: ['At my salon or shop', 'I come to the customer', 'Both'] },
      { key: 'clients', label: 'Who do you serve?', type: 'multi', required: true, options: ['Women', 'Men', 'Children'] },
      { key: 'products', label: 'Products and materials', type: 'select', required: true, options: ['I use my own', 'Client provides', 'Either'] },
      { key: 'sterilise', label: 'Do you sterilise your tools between clients?', type: 'yesno', required: true },
      { key: 'hair_types', label: 'Hair you work with', type: 'multi', required: true, subs: '@hair', options: ['Natural hair', 'Relaxed hair', 'Weave & extensions', 'Locs', 'Wigs'] },
      { key: 'braid_styles', label: 'Styles you do', type: 'multi', required: true, subs: ['Hair Braiding'], options: ['Cornrows', 'Box braids', 'Knotless braids', 'Twists', 'Crochet', 'Ghana weaving'] },
      { key: 'barber_services', label: 'Services you offer', type: 'multi', required: true, subs: ['Barbing'], options: ['Haircut', 'Beard trim', 'Shaving', 'Hair dye', "Children's cuts"] },
      { key: 'wig_services', label: 'Wig work you do', type: 'multi', required: true, subs: ['Wig Making'], options: ['Custom wigs', 'Ventilating', 'Frontal or closure install', 'Revamping', 'Colouring'] },
      { key: 'makeup_types', label: 'Makeup you do', type: 'multi', required: true, subs: ['Makeup Artistry'], options: ['Bridal', 'Events & parties', 'Photoshoots & film', 'Special effects', 'Makeup lessons'] },
      { key: 'nail_services', label: 'Nail services', type: 'multi', required: true, subs: '@nails', options: ['Acrylic', 'Gel', 'Natural nail care', 'Nail art', 'Pedicure', 'Removal'] },
      { key: 'lash_styles', label: 'Lash styles', type: 'multi', required: true, subs: ['Eyelash Extensions'], options: ['Classic', 'Volume', 'Hybrid', 'Lash lift'] },
      { key: 'brow_services', label: 'Brow services', type: 'multi', required: true, subs: ['Eyebrow Services'], options: ['Threading', 'Waxing', 'Microblading', 'Tinting', 'Shaping'] },
      { key: 'skin_services', label: 'Skin services', type: 'multi', required: true, subs: ['Skincare Services'], options: ['Facials', 'Acne care', 'Chemical peels', 'Anti-ageing', 'Skin consultation'] },
      { key: 'massage_types', label: 'Massage types', type: 'multi', required: true, subs: ['Massage Therapy'], options: ['Relaxation', 'Deep tissue', 'Sports', 'Prenatal', 'Foot'] },
      { key: 'spa_services', label: 'Spa services', type: 'multi', required: true, subs: ['Spa Services'], options: ['Facials', 'Body scrubs & wraps', 'Steam or sauna', 'Massage', 'Full packages'] },
      { key: 'waxing_areas', label: 'Areas you wax', type: 'multi', required: true, subs: ['Body Waxing'], options: ['Face', 'Arms & legs', 'Underarms', 'Bikini area', 'Full body'] },
      { key: 'grooming_services', label: 'Services you offer', type: 'multi', required: true, subs: ['Personal Grooming'], options: ['Shaving & beard care', 'Skin & hair routine', 'Wedding grooming', 'Grooming advice'] },
      { key: 'group_bookings', label: 'Can you serve a group (for example a bridal party)?', type: 'yesno', subs: '@parties', hint: 'Optional' }
    ]
  };

  SCHEMAS.fashion = {
    groups: {
      making: ['Tailoring', 'Dressmaking', 'Suit Making', 'Traditional Wear', 'Bridal Wear', 'Fashion Design', 'Embroidery', 'Beadwork'],
      garments: ['Tailoring', 'Dressmaking', 'Suit Making', 'Traditional Wear', 'Bridal Wear', 'Fashion Design', 'Pattern Making', 'Clothing Alterations'],
      fixing: ['Clothing Alterations', 'Clothing Repairs', 'Shoe Repair', 'Bag Repair'],
      fitted: ['Tailoring', 'Dressmaking', 'Suit Making', 'Traditional Wear', 'Bridal Wear']
    },
    fields: [
      { key: 'fabric_by', label: 'Who supplies the fabric?', type: 'select', required: true, subs: '@making', options: ['Client', 'Me', 'Either'] },
      { key: 'turnaround_days', label: 'Usual turnaround', type: 'number', required: true, min: 1, max: 180, unit: 'days', placeholder: 'e.g. 7' },
      { key: 'garment_types', label: 'Clothes you make or alter', type: 'multi', required: true, subs: '@garments', options: ["Women's wear", "Men's wear", "Children's wear", 'Native & traditional', 'Corporate & uniforms'] },
      { key: 'fittings', label: 'Fittings before delivery', type: 'select', required: true, subs: ['Suit Making', 'Bridal Wear', 'Tailoring', 'Dressmaking'], options: ['One fitting', 'Two fittings', 'Three or more'] },
      { key: 'measure_home', label: "Do you take measurements at the customer's home?", type: 'yesno', subs: '@fitted', hint: 'Optional' },
      { key: 'design_services', label: 'What do you offer?', type: 'multi', required: true, subs: ['Fashion Design'], options: ['Custom designs', 'Collections', 'Sketches & tech packs', 'Sample making', 'Production runs'] },
      { key: 'pattern_outputs', label: 'What the customer receives', type: 'multi', required: true, subs: ['Pattern Making'], options: ['Paper patterns', 'Digital patterns', 'Size grading', 'Tech packs'] },
      { key: 'fix_jobs', label: 'Jobs you do', type: 'multi', required: true, subs: ['Clothing Alterations', 'Clothing Repairs'], options: ['Hemming', 'Taking in or letting out', 'Zips', 'Resizing', 'Patching & darning', 'Buttons'] },
      { key: 'shoe_jobs', label: 'Shoe work you do', type: 'multi', required: true, subs: ['Shoe Repair'], options: ['Resoling', 'Heel repair', 'Stitching', 'Cleaning & polishing', 'Stretching'] },
      { key: 'bag_jobs', label: 'Bag work you do', type: 'multi', required: true, subs: ['Bag Repair'], options: ['Zips', 'Straps & handles', 'Stitching', 'Lining', 'Leather repair'] },
      { key: 'embroidery_types', label: 'Embroidery you do', type: 'multi', required: true, subs: ['Embroidery'], options: ['Machine embroidery', 'Hand embroidery', 'Logos & monograms', 'Names & lettering'] },
      { key: 'bead_items', label: 'Beadwork you make', type: 'multi', required: true, subs: ['Beadwork'], options: ['Jewellery', 'Bridal accessories', 'Traditional caps & accessories', 'Bag & shoe decoration', 'Wall art'] },
      { key: 'styling_services', label: 'Styling you offer', type: 'multi', required: true, subs: ['Fashion Styling'], options: ['Personal wardrobe', 'Event outfits', 'Photoshoot styling', 'Shopping with the client', 'Wardrobe clear-out'] },
      { key: 'rush_orders', label: 'Do you take rush orders?', type: 'yesno', hint: 'Optional' },
      { key: 'pickup', label: 'Do you offer pickup and delivery?', type: 'yesno', hint: 'Optional' }
    ]
  };

  /* ═══ Stage 4, batch B ═══════════════════════════════════════════════════════════════════════════
     Design & Creative, Technology & IT, Business & Administration, Education & Lessons, Pet Services.
     Same rules as batch A. Veterinary Care and Mobile Vet Care ask for a registration number (text) now; holding them back until a manual check is a Stage 4d decision. */

  SCHEMAS.creative = {
    groups: {
      noTools:  ['Voiceover Recording', 'Content Creation', 'Printing & Artwork'],
      files:    ['Graphic Design', 'Logo Design', 'Illustration', 'Branding & Identity', 'Social Media Design', 'Presentation Design', 'Printing & Artwork', 'Photo Editing', '3D Design', 'Product Design'],
      interface: ['UI/UX Design', 'Web Design', 'App Design'],
      motion:   ['Motion Graphics', 'Animation']
    },
    fields: [
      { key: 'software', label: 'Software you use', type: 'multi', required: true, notSubs: '@noTools', options: ['Photoshop', 'Illustrator', 'Figma', 'CorelDRAW', 'Canva', 'Blender', 'After Effects', 'Premiere Pro or Final Cut'] },
      { key: 'revisions', label: 'Rounds of changes included', type: 'select', required: true, options: ['One round', 'Two rounds', 'Three rounds', 'Unlimited'] },
      { key: 'turnaround_days', label: 'Usual turnaround', type: 'number', required: true, min: 1, max: 180, unit: 'days', placeholder: 'e.g. 5' },
      { key: 'file_formats', label: 'Files you hand over', type: 'multi', required: true, subs: '@files', options: ['Editable source files', 'PNG or JPG', 'PDF', 'Vector (SVG or AI)'] },
      { key: 'brand_pack', label: 'What the brand package includes', type: 'multi', required: true, subs: ['Branding & Identity'], options: ['Logo', 'Colour palette', 'Fonts', 'Brand guide', 'Stationery'] },
      { key: 'social_platforms', label: 'Platforms you design for', type: 'multi', required: true, subs: ['Social Media Design'], options: ['Instagram', 'Facebook', 'TikTok', 'X (Twitter)', 'LinkedIn', 'WhatsApp status'] },
      { key: 'design_scope', label: 'What you deliver', type: 'multi', required: true, subs: '@interface', options: ['Wireframes', 'Full screen designs', 'Clickable prototype', 'Design system', 'User research'] },
      { key: 'builds_in_code', label: 'Do you also build the design in code?', type: 'yesno', subs: ['Web Design', 'App Design'], hint: 'Optional' },
      { key: 'video_types', label: 'Videos you edit', type: 'multi', required: true, subs: ['Video Editing'], options: ['Social media clips', 'Weddings & events', 'Corporate videos', 'Music videos', 'YouTube', 'Adverts'] },
      { key: 'animation_styles', label: 'Animation you do', type: 'multi', required: true, subs: '@motion', options: ['2D', '3D', 'Explainer videos', 'Logo animation', 'Character animation', 'Whiteboard'] },
      { key: 'photo_jobs', label: 'Editing you do', type: 'multi', required: true, subs: ['Photo Editing'], options: ['Retouching', 'Background removal', 'Colour correction', 'Restoring old photos', 'Product photos'] },
      { key: 'print_jobs', label: 'Print work you do', type: 'multi', required: true, subs: ['Printing & Artwork'], options: ['Flyers & posters', 'Banners & billboards', 'Business cards', 'T-shirt printing', 'Stickers & labels', 'Packaging'] },
      { key: 'prints_it_yourself', label: 'Do you do the printing yourself?', type: 'yesno', required: true, subs: ['Printing & Artwork'] },
      { key: 'three_d_types', label: '3D work you do', type: 'multi', required: true, subs: ['3D Design'], options: ['Product renders', 'Architectural visuals', 'Game assets', 'Models for 3D printing'] },
      { key: 'product_scope', label: 'What you deliver', type: 'multi', required: true, subs: ['Product Design'], options: ['Concept sketches', 'CAD models', 'Prototypes', 'Packaging design'] },
      { key: 'content_types', label: 'Content you create', type: 'multi', required: true, subs: ['Content Creation'], options: ['Short videos', 'Photos', 'Written posts', 'Social media posts', 'Podcasts'] },
      { key: 'voice_types', label: 'Voice work you do', type: 'multi', required: true, subs: ['Voiceover Recording'], options: ['Adverts', 'Audiobooks', 'Explainer videos', 'Phone & IVR prompts', 'Documentaries'] },
      { key: 'voice_languages', label: 'Languages you record in', type: 'multi', required: true, subs: ['Voiceover Recording'], options: ['English', 'Pidgin', 'Yoruba', 'Igbo', 'Hausa', 'French'] },
      { key: 'has_studio', label: 'Do you have a recording setup?', type: 'yesno', required: true, subs: ['Voiceover Recording'] }
    ]
  };

  SCHEMAS.it_tech = {
    groups: {
      remote:   ['Software Development', 'Website Development', 'Database Management', 'Cloud & Server Management', 'Cybersecurity Services'],
      dev:      ['Software Development', 'Website Development'],
      parts:    ['Laptop Repair', 'Phone Repair', 'Hardware Installation'],
      repairs:  ['Laptop Repair', 'Phone Repair', 'Data Recovery'],
      systems:  ['Computer Support', 'Technical Troubleshooting', 'IT Support', 'Software Installation']
    },
    fields: [
      { key: 'service_mode', label: 'How do you work?', type: 'select', required: true, notSubs: '@remote', options: ['At my shop', 'I visit the customer', 'Remote online', 'Any of these'] },
      { key: 'work_mode', label: 'How do you work with clients?', type: 'select', required: true, subs: '@remote', options: ['Remote online', 'Meetings in person', 'Both'] },
      { key: 'os_types', label: 'Systems you support', type: 'multi', required: true, subs: '@systems', options: ['Windows', 'Mac', 'Linux', 'Printers & peripherals'] },
      { key: 'install_types', label: 'What you install', type: 'multi', required: true, subs: ['Software Installation'], options: ['Operating systems', 'Office & business software', 'Antivirus', 'Design & video software', 'Accounting software'] },
      { key: 'it_support_types', label: 'Support you give', type: 'multi', required: true, subs: ['IT Support'], options: ['Office IT support', 'Email & accounts', 'Printers & scanners', 'Servers', 'Ongoing support contract'] },
      { key: 'laptop_repairs', label: 'Laptop repairs you do', type: 'multi', required: true, subs: ['Laptop Repair'], options: ['Screens', 'Keyboards', 'Battery & charging', 'Motherboard', 'Software & operating system', 'Overheating'] },
      { key: 'phone_repairs', label: 'Phone repairs you do', type: 'multi', required: true, subs: ['Phone Repair'], options: ['Screens', 'Battery', 'Charging port', 'Water damage', 'Software & unlocking', 'Camera'] },
      { key: 'brands', label: 'Brands you repair', type: 'text', required: true, subs: ['Laptop Repair', 'Phone Repair'], maxLength: 120, placeholder: 'e.g. HP, Dell, iPhone, Samsung' },
      { key: 'parts', label: 'Spare parts', type: 'select', required: true, subs: '@parts', options: ['Client supplies', 'I supply (charged at cost)', 'Either'] },
      { key: 'backs_up_data', label: "Do you back up the customer's data before work?", type: 'yesno', required: true, subs: ['Laptop Repair', 'Phone Repair'] },
      { key: 'recovery_media', label: 'What you recover data from', type: 'multi', required: true, subs: ['Data Recovery'], options: ['Hard drives', 'SSDs', 'Flash drives & memory cards', 'Phones', 'Servers & RAID'] },
      { key: 'no_fix_no_fee', label: 'Is it free if you cannot recover the data?', type: 'yesno', required: true, subs: ['Data Recovery'] },
      { key: 'software_types', label: 'What you build', type: 'multi', required: true, subs: ['Software Development'], options: ['Mobile apps', 'Web apps', 'Desktop software', 'Automation & scripts', 'APIs & integrations'] },
      { key: 'web_types', label: 'What you build', type: 'multi', required: true, subs: ['Website Development'], options: ['Business websites', 'Online stores', 'WordPress sites', 'Custom web apps', 'Landing pages', 'Domain & hosting setup'] },
      { key: 'languages', label: 'Languages and tools you use', type: 'multi', required: true, subs: '@dev', options: ['JavaScript or TypeScript', 'Python', 'PHP', 'Java or Kotlin', 'C# or .NET', 'Swift or Flutter'] },
      { key: 'databases', label: 'Databases you work with', type: 'multi', required: true, subs: ['Database Management'], options: ['MySQL', 'PostgreSQL', 'SQL Server', 'MongoDB', 'Firebase or Supabase', 'Oracle'] },
      { key: 'cloud_platforms', label: 'Platforms you manage', type: 'multi', required: true, subs: ['Cloud & Server Management'], options: ['AWS', 'Azure', 'Google Cloud', 'DigitalOcean', 'Linux servers', 'cPanel hosting'] },
      { key: 'security_services', label: 'Security work you do', type: 'multi', required: true, subs: ['Cybersecurity Services'], options: ['Security audit', 'Malware removal', 'Penetration testing', 'Staff training', 'Firewall & antivirus setup', 'Data protection compliance'] },
      { key: 'network_jobs', label: 'Network work you do', type: 'multi', required: true, subs: ['Network Installation'], options: ['Home Wi-Fi', 'Office network & cabling', 'Routers & switches', 'Access points', 'Network troubleshooting'] },
      { key: 'hardware_jobs', label: 'Hardware work you do', type: 'multi', required: true, subs: ['Hardware Installation'], options: ['PC & laptop upgrades', 'Printers & scanners', 'Servers & racks', 'POS terminals'] },
      { key: 'smart_systems', label: 'Smart systems you set up', type: 'multi', required: true, subs: ['Smart Home Installation'], options: ['Smart lighting', 'Smart locks & doorbells', 'CCTV link-up', 'Voice assistants', 'Whole-home control'] },
      { key: 'ongoing_support', label: 'Do you offer ongoing maintenance afterwards?', type: 'yesno', subs: '@remote', hint: 'Optional' },
      { key: 'emergency', label: 'Do you take emergency call-outs?', type: 'yesno', notSubs: '@remote', hint: 'Optional' },
      { key: 'warranty', label: 'Warranty on your work', type: 'select', subs: '@repairs', options: ['None', '7 days', '30 days', '3 months', '6 months or more'], hint: 'Optional' }
    ]
  };

  SCHEMAS.business = {
    groups: {
      office:   ['Virtual Assistant', 'Administrative Assistant', 'Data Entry', 'Email Management', 'Document Preparation', 'Spreadsheet Management', 'Project Coordination'],
      lang:     ['Virtual Assistant', 'Customer Support', 'Transcription'],
      typing:   ['Data Entry', 'Transcription'],
      research: ['Business Research', 'Market Research'],
      deskwork: ['Administrative Assistant', 'Office Assistance']
    },
    fields: [
      { key: 'work_mode', label: 'Where do you work?', type: 'select', required: true, options: ['Remote online', "At the client's office", 'Both'] },
      { key: 'engagement', label: 'How do you take work?', type: 'select', required: true, options: ['By the task or project', 'Part-time retainer', 'Full-time retainer'] },
      { key: 'software', label: 'Tools you use', type: 'multi', required: true, subs: '@office', options: ['Microsoft Office', 'Google Workspace', 'CRM (HubSpot, Zoho)', 'Project tools (Trello, Asana)', 'Accounting software'] },
      { key: 'languages', label: 'Languages you work in', type: 'multi', required: true, subs: '@lang', options: ['English', 'Pidgin', 'Yoruba', 'Igbo', 'Hausa', 'French'] },
      { key: 'typing_speed', label: 'Typing speed', type: 'number', required: true, subs: '@typing', min: 10, max: 200, unit: 'words per minute', placeholder: 'e.g. 60' },
      { key: 'data_entry_types', label: 'Data entry you do', type: 'multi', required: true, subs: ['Data Entry'], options: ['Typing from scans or paper', 'Spreadsheets', 'Databases & CRM', 'Online forms', 'Product listings'] },
      { key: 'transcription_types', label: 'Recordings you transcribe', type: 'multi', required: true, subs: ['Transcription'], options: ['Interviews', 'Meetings', 'Lectures', 'Medical', 'Legal', 'Subtitles'] },
      { key: 'support_channels', label: 'Channels you handle', type: 'multi', required: true, subs: ['Customer Support'], options: ['Phone calls', 'WhatsApp', 'Email', 'Live chat', 'Social media messages'] },
      { key: 'research_outputs', label: 'What the customer receives', type: 'multi', required: true, subs: '@research', options: ['Written report', 'Spreadsheet of data', 'Slide deck', 'Competitor analysis', 'Surveys & interviews', 'Industry overview'] },
      { key: 'email_tasks', label: 'Email work you do', type: 'multi', required: true, subs: ['Email Management'], options: ['Sorting the inbox', 'Replying for the client', 'Scheduling', 'Newsletters', 'Follow-ups'] },
      { key: 'document_types', label: 'Documents you prepare', type: 'multi', required: true, subs: ['Document Preparation'], options: ['Letters & proposals', 'CVs & cover letters', 'Contract templates', 'Reports', 'Presentations', 'Forms & applications'] },
      { key: 'sheet_skills', label: 'Spreadsheet work you do', type: 'multi', required: true, subs: ['Spreadsheet Management'], options: ['Formulas', 'Pivot tables', 'Dashboards & charts', 'Macros & automation', 'Clean-up'] },
      { key: 'coordination_scope', label: 'Coordination you do', type: 'multi', required: true, subs: ['Project Coordination'], options: ['Project plans', 'Team follow-ups', 'Vendor management', 'Progress reports'] },
      { key: 'office_tasks', label: 'Tasks you handle', type: 'multi', required: true, subs: '@deskwork', options: ['Filing', 'Reception', 'Errands', 'Stock & supplies', 'Meeting set-up'] },
      { key: 'recruitment_stages', label: 'Recruitment work you do', type: 'multi', required: true, subs: ['Recruitment Assistance'], options: ['Job adverts', 'CV screening', 'Interview scheduling', 'Interviewing', 'Reference checks'] },
      { key: 'registration_types', label: 'Registrations you handle', type: 'multi', required: true, subs: ['Business Registration'], options: ['Business name', 'Limited company', 'Tax registration', 'Trademark', 'Industry licences & permits'] },
      { key: 'nda', label: 'Will you sign a confidentiality agreement?', type: 'yesno', hint: 'Optional' }
    ]
  };

  SCHEMAS.education = {
    groups: {
      academic: ['Academic Tutoring', 'Mathematics Lessons', 'English Lessons', 'Science Lessons', 'Exam Preparation', 'Online Tutoring', 'Language Lessons'],
      ages:     ['Language Lessons', 'Computer Training', 'Music Lessons', 'Instrument Lessons', 'Dance Lessons', 'Art Lessons', 'Coding Lessons', 'Skill Development'],
      certs:    ['Computer Training', 'Coding Lessons', 'Professional Training', 'Skill Development', 'Corporate Skill Training', 'Driving Lessons'],
      subjects: ['Academic Tutoring', 'Online Tutoring']
    },
    fields: [
      { key: 'lesson_modes', label: 'How do you teach?', type: 'multi', required: true, notSubs: ['Online Tutoring'], options: ['Online', "At the student's home", 'At my place or centre'] },
      { key: 'class_size', label: 'Who do you teach?', type: 'select', required: true, options: ['One student at a time', 'Small groups', 'Large groups & classes'] },
      { key: 'levels', label: 'Levels you teach', type: 'multi', required: true, subs: '@academic', options: ['Primary', 'Junior secondary', 'Senior secondary', 'University', 'Adult learners'] },
      { key: 'ages', label: 'Ages you teach', type: 'multi', required: true, subs: '@ages', options: ['Children', 'Teenagers', 'Adults'] },
      { key: 'subjects', label: 'Subjects you teach', type: 'text', required: true, subs: '@subjects', maxLength: 120, placeholder: 'e.g. Physics, Chemistry, Biology' },
      { key: 'exams', label: 'Exams you prepare students for', type: 'multi', required: true, subs: ['Exam Preparation'], options: ['WAEC', 'NECO', 'JAMB', 'Post-UTME', 'IELTS or TOEFL', 'SAT, GRE or GMAT', 'Professional exams'] },
      { key: 'languages_taught', label: 'Languages you teach', type: 'multi', required: true, subs: ['Language Lessons'], options: ['English', 'French', 'Spanish', 'Arabic', 'Mandarin', 'Yoruba', 'Igbo', 'Hausa'] },
      { key: 'music_types', label: 'Music you teach', type: 'multi', required: true, subs: ['Music Lessons'], options: ['Singing', 'Music theory', 'Songwriting', 'Music production', 'Choir training'] },
      { key: 'instruments', label: 'Instruments you teach', type: 'multi', required: true, subs: ['Instrument Lessons'], options: ['Piano or keyboard', 'Guitar', 'Drums', 'Violin', 'Saxophone or wind', 'Bass'] },
      { key: 'dance_styles', label: 'Dance styles you teach', type: 'multi', required: true, subs: ['Dance Lessons'], options: ['Afrobeats', 'Hip hop', 'Ballet', 'Ballroom', 'Contemporary', 'Cultural & traditional'] },
      { key: 'art_types', label: 'Art you teach', type: 'multi', required: true, subs: ['Art Lessons'], options: ['Drawing', 'Painting', 'Sculpture', 'Digital art', 'Crafts'] },
      { key: 'computer_topics', label: 'What you teach', type: 'multi', required: true, subs: ['Computer Training'], options: ['Basic computer skills', 'Microsoft Office', 'Graphic design', 'Data analysis', 'Internet & email', 'Typing'] },
      { key: 'coding_languages', label: 'What you teach', type: 'multi', required: true, subs: ['Coding Lessons'], options: ['Python', 'JavaScript', 'HTML & CSS', 'Java', 'Scratch (for kids)', 'Mobile apps'] },
      { key: 'transmission', label: 'Car you teach in', type: 'multi', required: true, subs: ['Driving Lessons'], options: ['Manual', 'Automatic'] },
      { key: 'provides_car', label: 'Do you provide the car?', type: 'yesno', required: true, subs: ['Driving Lessons'] },
      { key: 'career_focus', label: 'Coaching you give', type: 'multi', required: true, subs: ['Career Coaching'], options: ['CV & cover letters', 'Interview practice', 'Changing careers', 'Job search strategy', 'LinkedIn profile'] },
      { key: 'training_topics', label: 'Training you give', type: 'multi', required: true, subs: ['Professional Training', 'Skill Development', 'Corporate Skill Training'], options: ['Leadership & management', 'Sales & customer service', 'Digital skills', 'Finance & accounting', 'Vocational & trade skills', 'Communication & soft skills'] },
      { key: 'certificate', label: 'Do students get a certificate?', type: 'yesno', subs: '@certs', hint: 'Optional' },
      { key: 'materials_included', label: 'Are learning materials included?', type: 'yesno', hint: 'Optional' }
    ]
  };

  SCHEMAS.pet = {
    groups: {
      care:     ['Pet Sitting', 'Dog Walking', 'Pet Feeding', 'Pet Boarding'],
      stays:    ['Pet Sitting', 'Dog Walking', 'Pet Boarding'],
      place:    ['Pet Sitting', 'Pet Grooming', 'Basic Pet Training', 'Pet Photography'],
      vets:     ['Veterinary Care', 'Mobile Vet Care'],
      dogSizes: ['Dog Walking', 'Pet Boarding', 'Pet Grooming', 'Basic Pet Training']
    },
    fields: [
      { key: 'pet_types', label: 'Pets you work with', type: 'multi', required: true, notSubs: ['Aquarium Maintenance'], options: ['Dogs', 'Cats', 'Birds', 'Fish', 'Small pets (rabbits, hamsters)', 'Reptiles'] },
      { key: 'dog_sizes', label: 'Dog sizes you take', type: 'multi', required: true, subs: '@dogSizes', options: ['Small', 'Medium', 'Large', 'Extra large'] },
      { key: 'service_location', label: 'Where do you work?', type: 'select', required: true, subs: '@place', options: ['At my place', 'I come to the customer', 'Both'] },
      { key: 'max_pets', label: 'Most pets you look after at once', type: 'number', required: true, subs: '@stays', min: 1, max: 50, unit: 'pets', placeholder: 'e.g. 4' },
      { key: 'walk_length', label: 'Length of a walk', type: 'select', required: true, subs: ['Dog Walking'], options: ['Up to 30 minutes', '30 to 60 minutes', 'Over 1 hour'] },
      { key: 'boarding_setup', label: 'Your boarding space', type: 'multi', required: true, subs: ['Pet Boarding'], options: ['Home with a garden', 'Indoor only', 'Kennels', 'Air-conditioned'] },
      { key: 'visits_per_day', label: 'Visits per day', type: 'select', required: true, subs: ['Pet Feeding'], options: ['Once a day', 'Twice a day', 'Three or more'] },
      { key: 'daily_updates', label: 'Do you send the owner photo updates?', type: 'yesno', subs: '@care', hint: 'Optional' },
      { key: 'medication', label: 'Can you give medication?', type: 'yesno', subs: '@care', hint: 'Optional' },
      { key: 'first_aid', label: 'Do you have pet first-aid training?', type: 'yesno', subs: '@care', hint: 'Optional' },
      { key: 'grooming_services', label: 'Grooming you do', type: 'multi', required: true, subs: ['Pet Grooming'], options: ['Bath & dry', 'Haircut or trim', 'Nail clipping', 'Ear & teeth cleaning', 'Flea & tick treatment'] },
      { key: 'training_types', label: 'Training you give', type: 'multi', required: true, subs: ['Basic Pet Training'], options: ['Basic obedience', 'Puppy training', 'House training', 'Leash training', 'Behaviour problems'] },
      { key: 'transport_vehicle', label: 'What you travel in', type: 'select', required: true, subs: ['Pet Transportation'], options: ['Car', 'Van', 'Enclosed pet taxi'] },
      { key: 'safe_carriers', label: 'Do you use safe crates or carriers?', type: 'yesno', required: true, subs: ['Pet Transportation'] },
      { key: 'coverage', label: 'How far do you travel?', type: 'select', required: true, subs: ['Pet Transportation', 'Mobile Vet Care'], options: ['Within my city', 'Between cities'] },
      { key: 'tank_waters', label: 'Water types', type: 'multi', required: true, subs: ['Aquarium Maintenance'], options: ['Freshwater', 'Saltwater', 'Ponds'] },
      { key: 'tank_jobs', label: 'Work you do', type: 'multi', required: true, subs: ['Aquarium Maintenance'], options: ['Cleaning & water changes', 'New tank set-up', 'Filter & equipment repair', 'Fish health checks'] },
      { key: 'photo_types', label: 'Photography you do', type: 'multi', required: true, subs: ['Pet Photography'], options: ['Studio', 'Outdoor', 'Events & birthdays', 'Pet portraits', 'Video'] },
      { key: 'photo_delivery', label: 'Photos delivered', type: 'select', required: true, subs: ['Pet Photography'], options: ['Within 24 hours', 'Within 3 days', 'Within a week'] },
      { key: 'vet_registration', label: 'Veterinary registration number', type: 'text', required: true, subs: '@vets', maxLength: 60, placeholder: 'Your registration number', hint: 'Checked before you go live' },
      { key: 'vet_services', label: 'Care you give', type: 'multi', required: true, subs: '@vets', options: ['Check-ups', 'Vaccinations', 'Treating illness', 'Minor surgery', 'Deworming', 'Emergency care'] },
      { key: 'years_experience', label: 'Years of experience', type: 'number', min: 0, max: 60, unit: 'years', hint: 'Optional', placeholder: 'e.g. 3' }
    ]
  };

  /* ═══ Stage 4, batch C ═══════════════════════════════════════════════════════════════════════════
     Events & Entertainment, Food & Catering, Personal Assistance & Errands, Building & Construction, Marketing & Advertising, Laundry & Dry Cleaning.
     Same rules as batches A and B. */

  SCHEMAS.events = {
    groups: {
      planners: ['Event Planning', 'Event Coordination', 'Wedding Services', 'Party Planning'],
      sized:    ['Event Planning', 'Event Coordination', 'Wedding Services', 'Party Planning', 'Event Decoration', 'Event Setup', 'MCs & Hosts'],
      own:      ['Photography', 'Videography', 'DJs', 'Live Music', 'Sound Engineering', 'Lighting'],
      music:    ['DJs', 'Live Music'],
      media:    ['Photography', 'Videography'],
      staff:    ['Ushers', 'Event Staffing'],
      noTeam:   ['Venue Rental', 'Equipment Rental'],
      noTravel: ['Venue Rental']
    },
    fields: [
      { key: 'event_types', label: 'Events you work at', type: 'multi', required: true, options: ['Weddings', 'Birthdays & parties', 'Corporate events', 'Funerals & memorials', 'Religious events', 'Concerts & shows', 'Graduations & school events'] },
      { key: 'coverage', label: 'How far do you travel?', type: 'select', required: true, notSubs: '@noTravel', options: ['Within my city', 'Between cities'] },
      { key: 'team_size', label: 'People who will work the event (including you)', type: 'number', required: true, notSubs: '@noTeam', min: 1, max: 500, unit: 'people', placeholder: 'e.g. 3' },
      { key: 'max_guests', label: 'Largest event you handle', type: 'number', required: true, subs: '@sized', min: 1, max: 100000, unit: 'guests', placeholder: 'e.g. 300' },
      { key: 'planner_services', label: 'What you do', type: 'multi', required: true, subs: '@planners', options: ['Full planning', 'Day-of coordination', 'Budget & vendor management', 'Guest list & invitations', 'Venue sourcing'] },
      { key: 'decor_types', label: 'Decoration you do', type: 'multi', required: true, subs: ['Event Decoration'], options: ['Balloons', 'Flowers', 'Lighting & drapes', 'Stage & backdrops', 'Table settings', 'Themed decor'] },
      { key: 'flower_kind', label: 'Flowers you use', type: 'select', required: true, subs: ['Floral Design'], options: ['Fresh', 'Artificial', 'Both'] },
      { key: 'floral_types', label: 'Arrangements you make', type: 'multi', required: true, subs: ['Floral Design'], options: ['Bouquets', 'Centrepieces', 'Aisle arrangements', 'Arches & backdrops', 'Car & venue decoration'] },
      { key: 'own_equipment', label: 'Do you bring your own equipment?', type: 'yesno', required: true, subs: '@own' },
      { key: 'shoot_types', label: 'What you shoot', type: 'multi', required: true, subs: ['Photography'], options: ['Weddings', 'Portraits', 'Corporate', 'Products', 'Events & parties', 'Fashion'] },
      { key: 'video_outputs', label: 'What you deliver', type: 'multi', required: true, subs: ['Videography'], options: ['Highlight film', 'Full-length video', 'Live streaming', 'Drone footage', 'Same-day edit'] },
      { key: 'delivery_time', label: 'Finished files delivered', type: 'select', required: true, subs: '@media', options: ['Same day', 'Within 3 days', 'Within 2 weeks', 'More than 2 weeks'] },
      { key: 'music_genres', label: 'Music you play', type: 'multi', required: true, subs: '@music', options: ['Afrobeats', 'Gospel', 'Highlife', 'Hip hop', 'R&B', 'Amapiano', 'Juju & Fuji', 'Jazz'] },
      { key: 'act_size', label: 'Size of your act', type: 'select', required: true, subs: ['Live Music'], options: ['Solo', 'Duo', 'Band of 3 to 5', 'Large band (6 or more)'] },
      { key: 'languages', label: 'Languages you host in', type: 'multi', required: true, subs: ['MCs & Hosts'], options: ['English', 'Pidgin', 'Yoruba', 'Igbo', 'Hausa', 'French'] },
      { key: 'performer_types', label: 'What you perform', type: 'multi', required: true, subs: ['Performers'], options: ['Dance', 'Comedy', 'Acrobatics', 'Cultural troupe', 'Magic', "Children's entertainment"] },
      { key: 'staff_roles', label: 'Roles you can fill', type: 'multi', required: true, subs: '@staff', options: ['Ushers', 'Hostesses & hosts', 'Registration desk', 'Waiters & servers', 'Crowd marshals'] },
      { key: 'setup_jobs', label: 'Set-up work you do', type: 'multi', required: true, subs: ['Event Setup'], options: ['Tents & canopies', 'Stage & backdrops', 'Chairs & tables', 'Sound & lighting rigging', 'Take-down & clean-up'] },
      { key: 'gear_types', label: 'What you rent out', type: 'multi', required: true, subs: ['Equipment Rental'], options: ['Chairs & tables', 'Tents & canopies', 'Sound & lighting', 'Generators', 'Staging', 'Cooking & serving equipment'] },
      { key: 'delivers_and_sets_up', label: 'Do you deliver and set up?', type: 'yesno', required: true, subs: ['Equipment Rental'] },
      { key: 'venue_capacity', label: 'Capacity', type: 'number', required: true, subs: ['Venue Rental'], min: 1, max: 100000, unit: 'guests', placeholder: 'e.g. 250' },
      { key: 'venue_features', label: 'What the venue has', type: 'multi', required: true, subs: ['Venue Rental'], options: ['Air conditioning', 'Parking', 'Stage', 'Backup power', 'Kitchen', 'Outdoor space'] }
    ]
  };

  SCHEMAS.hospitality = {
    groups: {
      cooks:    ['Catering', 'Private Chef', 'Home Cooking', 'Meal Preparation', 'Event Catering', 'Small Chops'],
      bakes:    ['Baking', 'Cake Making', 'Pastry Making', 'Small Chops'],
      ordered:  ['Catering', 'Private Chef', 'Meal Preparation', 'Event Catering', 'Small Chops', 'Baking', 'Cake Making', 'Pastry Making', 'Food Supply'],
      events:   ['Catering', 'Event Catering'],
      noKitchen: ['Bartending', 'Wait Staff', 'Kitchen Assistance', 'Food Delivery'],
      foodmade: ['Catering', 'Private Chef', 'Home Cooking', 'Meal Preparation', 'Event Catering', 'Small Chops', 'Baking', 'Cake Making', 'Pastry Making']
    },
    fields: [
      { key: 'kitchen_type', label: 'Where do you cook?', type: 'select', required: true, notSubs: '@noKitchen', options: ['My own kitchen', "Customer's kitchen", 'Both'] },
      { key: 'cuisines', label: 'Food you cook', type: 'multi', required: true, subs: '@cooks', options: ['Nigerian', 'Continental', 'Chinese or Asian', 'Indian', 'Grill & BBQ', 'Vegetarian & vegan'] },
      { key: 'bake_types', label: 'What you bake', type: 'multi', required: true, subs: ['Baking', 'Pastry Making'], options: ['Bread', 'Cakes', 'Pies & pastries', 'Cookies', 'Doughnuts', 'Pizza'] },
      { key: 'cake_types', label: 'Cakes you make', type: 'multi', required: true, subs: ['Cake Making'], options: ['Birthday cakes', 'Wedding cakes', "Children's themed cakes", 'Cupcakes', 'Cheesecakes'] },
      { key: 'custom_designs', label: 'Do you make custom-designed cakes?', type: 'yesno', required: true, subs: ['Cake Making'] },
      { key: 'chef_services', label: 'What you offer', type: 'multi', required: true, subs: ['Private Chef'], options: ['Dinner at home', 'Dinner parties', 'Weekly cooking', 'Cooking lessons'] },
      { key: 'meal_plans', label: 'Meal plans you offer', type: 'multi', required: true, subs: ['Meal Preparation'], options: ['Weekly meal prep', 'Daily meals', 'Corporate lunches', 'Diet & fitness meals', 'Kids and baby food'] },
      { key: 'home_meals', label: 'Meals you cook', type: 'multi', required: true, subs: ['Home Cooking'], options: ['Daily meals', 'Soups & stews', 'Rice dishes', 'Snacks', 'Traditional dishes'] },
      { key: 'service_style', label: 'How you serve', type: 'multi', required: true, subs: '@events', options: ['Buffet', 'Plated service', 'Packs or takeaway', 'Live cooking stations'] },
      { key: 'max_guests', label: 'Largest event you serve', type: 'number', required: true, subs: ['Catering', 'Event Catering', 'Small Chops'], min: 1, max: 100000, unit: 'guests', placeholder: 'e.g. 200' },
      { key: 'brings_equipment', label: 'Do you bring serving equipment (tables, warmers, plates)?', type: 'yesno', required: true, subs: '@events' },
      { key: 'lead_time', label: 'How early must orders be placed?', type: 'select', required: true, subs: '@ordered', options: ['Same day', '1 to 2 days', '3 to 7 days', 'More than a week'] },
      { key: 'dietary', label: 'Special diets you cater for', type: 'multi', subs: '@foodmade', hint: 'Optional', options: ['Halal', 'Vegetarian', 'Vegan', 'Gluten-free', 'Diabetic-friendly', 'Allergy-safe'] },
      { key: 'drink_services', label: 'What you serve', type: 'multi', required: true, subs: ['Bartending'], options: ['Cocktails', 'Mocktails', 'Spirits & mixed drinks', 'Coffee & tea bar', 'Full bar set-up'] },
      { key: 'brings_bar', label: 'Do you bring the bar equipment and glasses?', type: 'yesno', required: true, subs: ['Bartending'] },
      { key: 'staff_count', label: 'People you can supply', type: 'number', required: true, subs: ['Wait Staff'], min: 1, max: 500, unit: 'people', placeholder: 'e.g. 6' },
      { key: 'uniform', label: 'Does your team wear uniforms?', type: 'yesno', subs: ['Wait Staff'], hint: 'Optional' },
      { key: 'kitchen_tasks', label: 'Kitchen work you do', type: 'multi', required: true, subs: ['Kitchen Assistance'], options: ['Prep & chopping', 'Dishwashing', 'Plating', 'Clean-up', 'Cooking support'] },
      { key: 'supply_items', label: 'What you supply', type: 'multi', required: true, subs: ['Food Supply'], options: ['Fresh produce', 'Meat & fish', 'Grains & staples', 'Frozen foods', 'Packaged goods', 'Drinks'] },
      { key: 'bulk_orders', label: 'Do you take bulk orders?', type: 'yesno', subs: ['Food Supply'], hint: 'Optional' },
      { key: 'delivery_vehicle', label: 'What you deliver with', type: 'select', required: true, subs: ['Food Delivery'], options: ['On foot', 'Bicycle', 'Motorbike', 'Car', 'Van'] },
      { key: 'insulated', label: 'Do you use insulated bags or boxes?', type: 'yesno', required: true, subs: ['Food Delivery'] },
      { key: 'delivery_radius', label: 'How far do you deliver?', type: 'select', required: true, subs: ['Food Delivery'], options: ['Within a few kilometres', 'Across my city'] },
      { key: 'health_certificate', label: "Do you have a food handler's health certificate?", type: 'yesno', hint: 'Optional' }
    ]
  };

  SCHEMAS.assistance = {
    groups: {
      errands:  ['Personal Shopping', 'Grocery Shopping', 'Errand Running', 'Document Collection', 'Document Submission', 'Appointment Assistance', 'Event Assistance'],
      shopping: ['Personal Shopping', 'Grocery Shopping', 'Errand Running'],
      docs:     ['Document Collection', 'Document Submission'],
      queues:   ['Queue Assistance', 'Waiting Services'],
      retainer: ['Personal Assistant', 'Home Assistance']
    },
    fields: [
      { key: 'availability_days', label: 'When are you available?', type: 'multi', required: true, options: ['Weekdays', 'Evenings', 'Weekends', 'Public holidays'] },
      { key: 'transport', label: 'How do you get around?', type: 'multi', required: true, subs: '@errands', options: ['On foot', 'Public transport', 'Motorbike', 'Car'] },
      { key: 'coverage', label: 'Where do you work?', type: 'select', required: true, subs: ['Personal Shopping', 'Grocery Shopping', 'Errand Running', 'Document Collection', 'Document Submission', 'Local Guide', 'Appointment Assistance'], options: ['Within my area', 'Across my city', 'Between cities'] },
      { key: 'upfront_funds', label: 'Money for purchases', type: 'select', required: true, subs: '@shopping', options: ['Customer pays upfront', 'I pay and get refunded', 'Either'] },
      { key: 'gives_receipts', label: 'Do you give receipts for every purchase?', type: 'yesno', required: true, subs: '@shopping' },
      { key: 'doc_places', label: 'Places you go to', type: 'multi', required: true, subs: '@docs', options: ['Government offices', 'Banks', 'Embassies & immigration', 'Courts', 'Schools & universities', 'Post offices & couriers'] },
      { key: 'with_letter', label: 'Can you act for someone with an authorisation letter?', type: 'yesno', required: true, subs: '@docs' },
      { key: 'queue_places', label: 'Queues you wait in', type: 'multi', required: true, subs: '@queues', options: ['Banks', 'Government offices', 'Hospitals', 'Embassies', 'Tickets & events', 'Fuel stations'] },
      { key: 'max_wait_hours', label: 'Longest wait you take on', type: 'number', required: true, subs: '@queues', min: 1, max: 24, unit: 'hours', placeholder: 'e.g. 4' },
      { key: 'pa_services', label: 'What you do', type: 'multi', required: true, subs: ['Personal Assistant'], options: ['Calendar & appointments', 'Calls & messages', 'Travel bookings', 'Shopping & errands', 'Personal admin', 'Event organising'] },
      { key: 'engagement', label: 'How do you take work?', type: 'select', required: true, subs: '@retainer', options: ['By the task', 'Part-time retainer', 'Full-time retainer'] },
      { key: 'home_tasks', label: 'Help you give at home', type: 'multi', required: true, subs: ['Home Assistance'], options: ['Cleaning help', 'Cooking help', 'School pick-ups', 'Laundry', 'Supervising workmen', 'Paying bills'] },
      { key: 'elder_care', label: 'Help you give', type: 'multi', required: true, subs: ['Elderly Assistance'], options: ['Companionship', 'Shopping & errands', 'Hospital visits', 'Meals', 'Medication reminders', 'Light housework'] },
      { key: 'elder_experience', label: 'Have you cared for older people before?', type: 'yesno', required: true, subs: ['Elderly Assistance'] },
      { key: 'first_aid', label: 'Do you have first-aid training?', type: 'yesno', subs: ['Elderly Assistance'], hint: 'Optional' },
      { key: 'appointment_types', label: 'Appointments you help with', type: 'multi', required: true, subs: ['Appointment Assistance'], options: ['Hospital visits', 'Bank visits', 'Government offices', 'Embassy appointments', 'Booking appointments for the customer'] },
      { key: 'event_tasks', label: 'Event help you give', type: 'multi', required: true, subs: ['Event Assistance'], options: ['Guest check-in', 'Gifts & souvenirs', 'Errands during the event', 'Setting up', 'Looking after guests'] },
      { key: 'guide_types', label: 'Guiding you do', type: 'multi', required: true, subs: ['Local Guide'], options: ['City tours', 'Markets & shopping', 'Food & restaurants', 'Airport & arrival help', 'Business meetings', 'Translation'] },
      { key: 'languages', label: 'Languages you speak', type: 'multi', required: true, subs: ['Local Guide'], options: ['English', 'Pidgin', 'Yoruba', 'Igbo', 'Hausa', 'French'] },
      { key: 'same_day', label: 'Can you start on the same day?', type: 'yesno', hint: 'Optional' }
    ]
  };

  SCHEMAS.construction = {
    groups: {
      safety:  ['Roofing', 'Welding', 'Demolition', 'Structural Repairs'],
      labour:  ['General Labour'],
      noSupply: ['General Labour', 'Demolition'],
      ceilings: ['POP Installation', 'Ceiling Installation'],
      walls:   ['Masonry', 'Bricklaying']
    },
    fields: [
      { key: 'tools', label: 'Do you bring your own tools?', type: 'yesno', required: true },
      { key: 'crew_size', label: 'People on your crew (including you)', type: 'number', required: true, min: 1, max: 200, unit: 'people', placeholder: 'e.g. 4' },
      { key: 'materials', label: 'Materials', type: 'select', required: true, notSubs: '@noSupply', options: ['Client supplies', 'I supply (charged at cost)', 'Either'] },
      { key: 'job_size', label: 'Largest job you take on', type: 'select', required: true, notSubs: '@labour', options: ['Small repairs', 'A single room or small job', 'A whole house', 'Large or commercial projects'] },
      { key: 'wall_jobs', label: 'Work you do', type: 'multi', required: true, subs: '@walls', options: ['Block walls', 'Brick walls', 'Fences & perimeter walls', 'Foundations', 'Retaining walls'] },
      { key: 'carpentry_jobs', label: 'Work you do', type: 'multi', required: true, subs: ['Carpentry'], options: ['Doors & windows', 'Roof carpentry', 'Wardrobes & cabinets', 'Furniture making', 'Formwork', 'Staircases'] },
      { key: 'tile_types', label: 'Tiling you do', type: 'multi', required: true, subs: ['Tiling'], options: ['Floor tiles', 'Wall tiles', 'Bathrooms & kitchens', 'Outdoor & compound', 'Large-format or porcelain'] },
      { key: 'plaster_jobs', label: 'Plastering you do', type: 'multi', required: true, subs: ['Plastering'], options: ['Interior', 'Exterior', 'Screeding', 'Textured finishes'] },
      { key: 'ceiling_types', label: 'Ceilings you install', type: 'multi', required: true, subs: '@ceilings', options: ['POP', 'PVC', 'Wooden', 'Suspended grid', 'Gypsum board'] },
      { key: 'roof_types', label: 'Roofs you work on', type: 'multi', required: true, subs: ['Roofing'], options: ['Aluminium sheets', 'Stone-coated tiles', 'Clay or concrete tiles', 'Long-span metal', 'Flat roofs & waterproofing'] },
      { key: 'welding_jobs', label: 'Welding you do', type: 'multi', required: true, subs: ['Welding'], options: ['Gates & doors', 'Burglar proofing', 'Steel structures', 'Pipes & tanks', 'Sheet metal'] },
      { key: 'plumbing_installs', label: 'Work you do', type: 'multi', required: true, subs: ['Plumbing Installation'], options: ['Water supply piping', 'Drainage & sewage', 'Bathrooms & kitchens', 'Water tanks & boreholes', 'Gas piping'] },
      { key: 'electrical_installs', label: 'Work you do', type: 'multi', required: true, subs: ['Electrical Installation'], options: ['House wiring', 'Distribution boards', 'Lighting', 'Generator changeovers', 'Solar & inverter wiring', 'Earthing & lightning protection'] },
      { key: 'floor_types', label: 'Floors you install', type: 'multi', required: true, subs: ['Flooring'], options: ['Tiles', 'Wood & laminate', 'Vinyl', 'Epoxy', 'Terrazzo', 'Carpet'] },
      { key: 'fence_types', label: 'Fences you build', type: 'multi', required: true, subs: ['Fencing'], options: ['Block', 'Chain-link', 'Wrought iron', 'Electric fence', 'Wooden', 'Razor wire'] },
      { key: 'gate_types', label: 'Gates you install', type: 'multi', required: true, subs: ['Gate Installation'], options: ['Swing gates', 'Sliding gates', 'Automatic gates', 'Pedestrian gates'] },
      { key: 'concrete_jobs', label: 'Work you do', type: 'multi', required: true, subs: ['Concrete Work'], options: ['Slabs & floors', 'Columns & beams', 'Drainage & culverts', 'Paving & interlock', 'Foundations'] },
      { key: 'structural_jobs', label: 'Work you do', type: 'multi', required: true, subs: ['Structural Repairs'], options: ['Cracks & settlement', 'Wall strengthening', 'Column & beam repair', 'Waterproofing', 'Building assessment'] },
      { key: 'labour_jobs', label: 'Work you do', type: 'multi', required: true, subs: ['General Labour'], options: ['Loading & carrying', 'Site clearing', 'Digging', 'Mixing & carrying materials', 'Site clean-up'] },
      { key: 'demolition_jobs', label: 'Demolition you do', type: 'multi', required: true, subs: ['Demolition'], options: ['Interior strip-out', 'Walls', 'Whole buildings', 'Breaking concrete'] },
      { key: 'removes_debris', label: 'Do you take the rubble away?', type: 'yesno', required: true, subs: ['Demolition'] },
      { key: 'aluminium_jobs', label: 'Work you do', type: 'multi', required: true, subs: ['Aluminium Fabrication'], options: ['Windows', 'Doors', 'Partitions', 'Shopfronts', 'Curtain walls', 'Railings'] },
      { key: 'safety_gear', label: 'Do you use safety equipment (helmets, harness, gloves)?', type: 'yesno', required: true, subs: '@safety' },
      { key: 'site_visit', label: 'Do you visit the site and quote before starting?', type: 'yesno', notSubs: '@labour', hint: 'Optional' },
      { key: 'warranty', label: 'Guarantee on your work', type: 'select', notSubs: '@noSupply', options: ['None', '3 months', '6 months', '1 year', 'More than 1 year'], hint: 'Optional' }
    ]
  };

  SCHEMAS.marketing = {
    groups: {
      measured: ['Search Engine Optimisation', 'Social Media Management', 'Digital Advertising', 'Email Marketing', 'Influencer Marketing', 'Content Marketing'],
      social:   ['Social Media Management', 'Digital Advertising', 'Influencer Marketing', 'Content Marketing']
    },
    fields: [
      { key: 'work_mode', label: 'How do you work with clients?', type: 'select', required: true, notSubs: ['Promotions & Street Marketing'], options: ['Remote online', 'In person', 'Both'] },
      { key: 'engagement', label: 'How do you take work?', type: 'select', required: true, options: ['One-off projects', 'Monthly retainer', 'Both'] },
      { key: 'industries', label: 'Industries you have worked in', type: 'multi', required: true, options: ['Fashion & beauty', 'Food & hospitality', 'Real estate', 'Tech & finance', 'Education & health', 'Retail & e-commerce', 'Events & entertainment'] },
      { key: 'sends_reports', label: 'Do you send performance reports?', type: 'yesno', required: true, subs: '@measured' },
      { key: 'copy_types', label: 'Writing you do', type: 'multi', required: true, subs: ['Copywriting'], options: ['Website copy', 'Adverts', 'Product descriptions', 'Emails & newsletters', 'Scripts', 'Press releases'] },
      { key: 'copy_languages', label: 'Languages you write in', type: 'multi', required: true, subs: ['Copywriting'], options: ['English', 'Pidgin', 'Yoruba', 'Igbo', 'Hausa', 'French'] },
      { key: 'seo_services', label: 'SEO work you do', type: 'multi', required: true, subs: ['Search Engine Optimisation'], options: ['Keyword research', 'On-page SEO', 'Technical SEO', 'Link building', 'Google Maps (local SEO)', 'Site audits'] },
      { key: 'platforms', label: 'Platforms you work on', type: 'multi', required: true, subs: '@social', options: ['Instagram', 'Facebook', 'TikTok', 'X (Twitter)', 'LinkedIn', 'YouTube', 'WhatsApp Business'] },
      { key: 'smm_services', label: 'What you do', type: 'multi', required: true, subs: ['Social Media Management'], options: ['Posting', 'Content creation', 'Replying to followers', 'Growing followers', 'Setting up accounts'] },
      { key: 'ad_platforms', label: 'Ad platforms you run', type: 'multi', required: true, subs: ['Digital Advertising'], options: ['Meta (Facebook & Instagram)', 'Google Ads', 'TikTok Ads', 'YouTube Ads', 'LinkedIn Ads'] },
      { key: 'ad_spend', label: 'Ad spend', type: 'select', required: true, subs: ['Digital Advertising'], options: ['Customer pays the platform directly', 'I handle the ad spend', 'Either'] },
      { key: 'email_services', label: 'What you do', type: 'multi', required: true, subs: ['Email Marketing'], options: ['Newsletter design', 'Automations', 'List building', 'Campaign reports'] },
      { key: 'email_tools', label: 'Tools you use', type: 'multi', required: true, subs: ['Email Marketing'], options: ['Mailchimp', 'Brevo', 'Klaviyo', 'HubSpot', 'Zoho'] },
      { key: 'influencer_services', label: 'What you do', type: 'multi', required: true, subs: ['Influencer Marketing'], options: ['Finding influencers', 'Managing campaigns', 'Contracts & payments', 'Reporting', 'Posting on my own pages'] },
      { key: 'brand_services', label: 'What you do', type: 'multi', required: true, subs: ['Brand Strategy'], options: ['Brand positioning', 'Naming', 'Messaging & tone', 'Competitor research', 'Brand guidelines', 'Launch plans'] },
      { key: 'content_formats', label: 'Content you create', type: 'multi', required: true, subs: ['Content Marketing'], options: ['Blog posts', 'Videos', 'Podcasts', 'Infographics', 'Case studies', 'Newsletters'] },
      { key: 'street_types', label: 'What you do', type: 'multi', required: true, subs: ['Promotions & Street Marketing'], options: ['Flyer handouts', 'Product sampling', 'Roadshows', 'Brand ambassadors', 'Billboards & banners', 'Mobile vans & tricycles'] },
      { key: 'promo_team', label: 'People you can put on the street', type: 'number', required: true, subs: ['Promotions & Street Marketing'], min: 1, max: 500, unit: 'people', placeholder: 'e.g. 10' },
      { key: 'coverage', label: 'How far do you travel?', type: 'select', required: true, subs: ['Promotions & Street Marketing'], options: ['Within my city', 'Between cities'] }
    ]
  };

  SCHEMAS.laundry = {
    groups: {
      washing: ['Wash & Fold', 'Laundry & Ironing', 'Duvet & Bedding Cleaning', 'Curtain & Rug Washing', 'Bulk & Business Laundry', 'Laundry Pickup & Delivery'],
      ironing: ['Laundry & Ironing', 'Ironing & Pressing'],
      noPickup: ['Laundry Pickup & Delivery']
    },
    fields: [
      { key: 'pickup', label: 'Pickup and delivery', type: 'select', required: true, notSubs: '@noPickup', options: ['Customer drops off', 'I pick up and deliver', 'Both'] },
      { key: 'coverage', label: 'Where do you pick up and deliver?', type: 'select', required: true, subs: '@noPickup', options: ['Within my area', 'Across my city'] },
      { key: 'turnaround', label: 'Usual turnaround', type: 'select', required: true, options: ['Same day', 'Next day', '2 to 3 days', 'More than 3 days'] },
      { key: 'methods', label: 'How you wash', type: 'multi', required: true, subs: '@washing', options: ['Machine wash', 'Hand wash', 'Steam', 'Line dry', 'Tumble dry'] },
      { key: 'ironing_items', label: 'Ironing you do', type: 'multi', required: true, subs: '@ironing', options: ['Shirts & trousers', 'Native wear', 'Bedsheets', 'Uniforms', 'Suits'] },
      { key: 'dry_clean_items', label: 'What you dry clean', type: 'multi', required: true, subs: ['Dry Cleaning'], options: ['Suits & jackets', 'Dresses & gowns', 'Native & lace wear', 'Leather & suede', 'Coats', 'Wedding gowns'] },
      { key: 'onsite_machines', label: 'Do you dry clean on your own machines?', type: 'yesno', required: true, subs: ['Dry Cleaning'] },
      { key: 'bedding_items', label: 'What you clean', type: 'multi', required: true, subs: ['Duvet & Bedding Cleaning'], options: ['Duvets', 'Comforters', 'Pillows', 'Mattress covers', 'Blankets', 'Mattresses'] },
      { key: 'stain_types', label: 'Stains you treat', type: 'multi', required: true, subs: ['Stain Removal'], options: ['Food & drink', 'Ink & paint', 'Oil & grease', 'Blood & sweat', 'Old yellowing', 'Makeup'] },
      { key: 'no_result_no_fee', label: 'Is it free if the stain does not come out?', type: 'yesno', required: true, subs: ['Stain Removal'] },
      { key: 'shoe_services', label: 'What you do', type: 'multi', required: true, subs: ['Shoe & Sneaker Cleaning'], options: ['Deep cleaning', 'Whitening', 'Odour removal', 'Restoration', 'Waterproofing'] },
      { key: 'shoe_types', label: 'Shoes you clean', type: 'multi', required: true, subs: ['Shoe & Sneaker Cleaning'], options: ['Sneakers', 'Leather shoes', 'Suede', 'Heels & formal shoes', 'Canvas'] },
      { key: 'home_textiles', label: 'What you wash', type: 'multi', required: true, subs: ['Curtain & Rug Washing'], options: ['Curtains', 'Rugs & carpets', 'Cushion covers', 'Sofa covers', 'Blinds'] },
      { key: 'business_customers', label: 'Businesses you serve', type: 'multi', required: true, subs: ['Bulk & Business Laundry'], options: ['Hotels & guest houses', 'Restaurants', 'Salons & spas', 'Clinics & hospitals', 'Schools', 'Offices'] },
      { key: 'max_kg_per_day', label: 'Most you can wash in a day', type: 'number', required: true, subs: ['Bulk & Business Laundry'], min: 10, max: 100000, unit: 'kg', placeholder: 'e.g. 200' },
      { key: 'contracts', label: 'Do you offer weekly or monthly contracts?', type: 'yesno', subs: ['Bulk & Business Laundry'], hint: 'Optional' },
      { key: 'item_tags', label: 'Do you tag each item to avoid mix-ups?', type: 'yesno', hint: 'Optional' }
    ]
  };

  /* ═══ Stage 4, batch D (regulated) ═══════════════════════════════════════════════════════════════
     Professional Services, Security & Safety, Health & Wellness, Legal & Advocacy, Financial Services.
     Owner decision (2026-11-11): QUESTIONS ONLY, no publishing hold. Work that normally needs a licence asks for "licence_body" and "licence_number" (required).
     Work that does not asks an optional "has_certification" (+ details). Nothing here is checked against any register. A hold or admin check can be added later without changing these keys. */

  var LICENCE_BODY = { key: 'licence_body', label: 'Registered with', type: 'text', required: true, maxLength: 80, placeholder: 'e.g. the professional body or regulator' };
  var LICENCE_NO = { key: 'licence_number', label: 'Registration or licence number', type: 'text', required: true, maxLength: 60, placeholder: 'Your number', hint: 'Shown to customers' };
  var CERT_YN = { key: 'has_certification', label: 'Do you hold a relevant certificate or professional membership?', type: 'yesno', hint: 'Optional' };
  var CERT_TXT = { key: 'certification_details', label: 'Which one?', type: 'text', required: true, maxLength: 120, placeholder: 'Name of the certificate or body', when: { key: 'has_certification', equals: true } };
  function lic(subs) { return [Object.assign({ subs: subs }, LICENCE_BODY), Object.assign({ subs: subs }, LICENCE_NO)]; }
  function cert(notSubs) { return [Object.assign({ notSubs: notSubs }, CERT_YN), Object.assign({ notSubs: notSubs }, CERT_TXT)]; }

  SCHEMAS.professional = {
    groups: {
      licensed: ['Architecture', 'Engineering Consultancy', 'Property Consultancy'],
      writing:  ['Professional Writing', 'CV & Resume Writing', 'Grant Writing', 'Technical Writing', 'Translation']
    },
    fields: [].concat(lic('@licensed'), cert('@licensed'), [
      { key: 'work_mode', label: 'How do you work with clients?', type: 'select', required: true, options: ['Remote online', 'In person', 'Both'] },
      { key: 'turnaround', label: 'Usual turnaround for a small job', type: 'select', required: true, subs: '@writing', options: ['Within 24 hours', '2 to 3 days', 'Within a week', 'More than a week'] },
      { key: 'consult_areas', label: 'What you advise on', type: 'multi', required: true, subs: ['Business Consultancy'], options: ['Strategy', 'Operations', 'Sales growth', 'Business plans', 'Funding & investors', 'Start-ups'] },
      { key: 'translation_languages', label: 'Languages you translate', type: 'multi', required: true, subs: ['Translation', 'Interpretation'], options: ['English', 'French', 'Spanish', 'Arabic', 'Mandarin', 'Yoruba', 'Igbo', 'Hausa'] },
      { key: 'certified_translation', label: 'Do you provide certified translations?', type: 'yesno', required: true, subs: ['Translation'] },
      { key: 'interpretation_types', label: 'Interpreting you do', type: 'multi', required: true, subs: ['Interpretation'], options: ['Conferences', 'Business meetings', 'Court & legal', 'Medical', 'Online calls'] },
      { key: 'writing_types', label: 'Writing you do', type: 'multi', required: true, subs: ['Professional Writing'], options: ['Articles & blogs', 'Speeches', 'Business documents', 'Ghostwriting', 'Editing & proofreading'] },
      { key: 'cv_services', label: 'What you offer', type: 'multi', required: true, subs: ['CV & Resume Writing'], options: ['CV writing', 'Cover letters', 'LinkedIn profile', 'Interview preparation'] },
      { key: 'grant_types', label: 'Grants you write for', type: 'multi', required: true, subs: ['Grant Writing'], options: ['NGO & donor grants', 'Government grants', 'Business grants', 'Research grants', 'Proposals & reports'] },
      { key: 'tech_writing_types', label: 'Writing you do', type: 'multi', required: true, subs: ['Technical Writing'], options: ['Manuals & guides', 'API documents', 'Reports', 'Proposals', 'Standard operating procedures'] },
      { key: 'architecture_services', label: 'What you do', type: 'multi', required: true, subs: ['Architecture'], options: ['Building plans', '3D visuals', 'Site supervision', 'Renovation design', 'Planning approval drawings'] },
      { key: 'engineering_fields', label: 'Fields you cover', type: 'multi', required: true, subs: ['Engineering Consultancy'], options: ['Civil & structural', 'Electrical', 'Mechanical', 'Chemical', 'Environmental', 'Site supervision'] },
      { key: 'property_services', label: 'What you do', type: 'multi', required: true, subs: ['Property Consultancy'], options: ['Valuation', 'Sales & lettings', 'Property management', 'Investment advice'] },
      { key: 'hr_services', label: 'What you do', type: 'multi', required: true, subs: ['HR Consultancy'], options: ['Recruitment', 'Policies & handbooks', 'Payroll & contracts', 'Training', 'Staff disputes'] },
      { key: 'guidance_focus', label: 'Guidance you give', type: 'multi', required: true, subs: ['Career Guidance'], options: ['Career direction', 'Choosing subjects or courses', 'Interview practice', 'Job search', 'Changing careers'] }
    ])
  };

  SCHEMAS.security = {
    groups: {
      licensed: ['Event Security', 'Security Guard Services', 'Fire Safety Equipment Installation', 'Safety Inspection'],
      guards:   ['Event Security', 'Security Guard Services'],
      supply:   ['Access Control', 'CCTV Installation', 'Fire Safety Equipment Installation', 'Security System Maintenance']
    },
    fields: [].concat(lic('@licensed'), cert('@licensed'), [
      { key: 'coverage', label: 'How far do you travel?', type: 'select', required: true, options: ['Within my city', 'Between cities'] },
      { key: 'guard_count', label: 'Guards you can supply', type: 'number', required: true, subs: '@guards', min: 1, max: 1000, unit: 'guards', placeholder: 'e.g. 10' },
      { key: 'guards_trained', label: 'Are your guards trained?', type: 'yesno', required: true, subs: '@guards' },
      { key: 'background_checked', label: 'Do you background-check your guards?', type: 'yesno', required: true, subs: '@guards' },
      { key: 'shifts', label: 'Shifts you cover', type: 'multi', required: true, subs: '@guards', options: ['Day', 'Night', '24-hour', 'Events only'] },
      { key: 'access_types', label: 'Systems you install', type: 'multi', required: true, subs: ['Access Control'], options: ['Biometric', 'Card & key fob', 'Gate barriers', 'Intercoms', 'Turnstiles', 'Visitor management'] },
      { key: 'monitoring_modes', label: 'Monitoring you give', type: 'multi', required: true, subs: ['CCTV Monitoring'], options: ['Live monitoring', 'Recorded footage review', 'Alarm response', 'Phone app access', 'Reports'] },
      { key: 'cctv_systems', label: 'Systems you install', type: 'multi', required: true, subs: ['CCTV Installation'], options: ['Analogue', 'IP cameras', 'Wireless', 'Solar powered'] },
      { key: 'fire_items', label: 'What you install', type: 'multi', required: true, subs: ['Fire Safety Equipment Installation'], options: ['Extinguishers', 'Alarms & detectors', 'Sprinklers', 'Hydrants & hose reels', 'Emergency lighting', 'Safety signs'] },
      { key: 'inspection_types', label: 'Inspections you do', type: 'multi', required: true, subs: ['Safety Inspection'], options: ['Fire safety', 'Electrical safety', 'Building safety', 'Workplace safety'] },
      { key: 'written_report', label: 'Do you give a written report?', type: 'yesno', required: true, subs: ['Safety Inspection'] },
      { key: 'workplace_services', label: 'What you do', type: 'multi', required: true, subs: ['Workplace Safety Assistance'], options: ['Safety audits', 'Staff safety training', 'Safety policies', 'First aid', 'Risk assessments'] },
      { key: 'maintenance_types', label: 'Systems you maintain', type: 'multi', required: true, subs: ['Security System Maintenance'], options: ['CCTV', 'Alarms', 'Access control', 'Electric fences', 'Gates'] },
      { key: 'equipment_supply', label: 'Equipment and parts', type: 'select', required: true, subs: '@supply', options: ['I supply', 'Client supplies', 'Either'] },
      { key: 'emergency', label: 'Do you take emergency call-outs?', type: 'yesno', hint: 'Optional' }
    ])
  };

  SCHEMAS.health = {
    groups: {
      licensed: ['Physiotherapy', 'Mental Health Counselling', 'Acupuncture', 'Chiropractic Care', 'Nursing Assistance'],
      sessions: ['Personal Fitness Training', 'Yoga Instruction']
    },
    fields: [].concat(lic('@licensed'), cert('@licensed'), [
      { key: 'service_location', label: 'Where do you work?', type: 'select', required: true, options: ['At my clinic or studio', 'I visit the client', 'Online', 'Any of these'] },
      { key: 'client_groups', label: 'Who do you work with?', type: 'multi', required: true, options: ['Adults', 'Children', 'Older people', 'Women & new mothers', 'Athletes'] },
      { key: 'session_types', label: 'Sessions you offer', type: 'multi', required: true, subs: '@sessions', options: ['One-to-one', 'Small groups', 'Classes'] },
      { key: 'fitness_goals', label: 'Goals you train for', type: 'multi', required: true, subs: ['Personal Fitness Training'], options: ['Weight loss', 'Muscle building', 'Strength', 'Sports performance', 'General fitness', 'Recovery'] },
      { key: 'yoga_styles', label: 'Styles you teach', type: 'multi', required: true, subs: ['Yoga Instruction'], options: ['Hatha', 'Vinyasa', 'Yin', 'Prenatal', 'Meditation', "Children's yoga"] },
      { key: 'nutrition_goals', label: 'Goals you coach for', type: 'multi', required: true, subs: ['Nutrition Coaching'], options: ['Weight loss', 'Weight gain', 'Diabetes-friendly eating', 'Sports nutrition', 'Family & kids', 'Pregnancy nutrition'] },
      { key: 'written_meal_plans', label: 'Do you give written meal plans?', type: 'yesno', required: true, subs: ['Nutrition Coaching'] },
      { key: 'physio_conditions', label: 'Conditions you treat', type: 'multi', required: true, subs: ['Physiotherapy'], options: ['Back & neck pain', 'Sports injuries', 'Stroke recovery', 'After surgery', 'Joint pain', "Children's physiotherapy"] },
      { key: 'counselling_focus', label: 'What you help with', type: 'multi', required: true, subs: ['Mental Health Counselling'], options: ['Anxiety & stress', 'Depression', 'Relationships', 'Grief', 'Trauma', 'Work stress', 'Substance use'] },
      { key: 'confidential', label: 'Do you keep sessions confidential?', type: 'yesno', required: true, subs: ['Mental Health Counselling'] },
      { key: 'acupuncture_conditions', label: 'Conditions you treat', type: 'multi', required: true, subs: ['Acupuncture'], options: ['Pain relief', 'Stress & sleep', 'Migraines', 'Digestive problems', 'Fertility support'] },
      { key: 'chiro_conditions', label: 'Conditions you treat', type: 'multi', required: true, subs: ['Chiropractic Care'], options: ['Back pain', 'Neck pain', 'Headaches', 'Posture', 'Sports injuries'] },
      { key: 'nursing_services', label: 'What you do', type: 'multi', required: true, subs: ['Nursing Assistance'], options: ['Wound dressing', 'Injections', 'Blood pressure & sugar checks', 'Care after surgery', 'Medication administration', 'Elderly care'] },
      { key: 'caregiving_services', label: 'What you do', type: 'multi', required: true, subs: ['Caregiving & Home Care'], options: ['Personal care', 'Meals', 'Medication reminders', 'Mobility help', 'Companionship', 'Overnight care'] },
      { key: 'shift_types', label: 'Shifts you work', type: 'multi', required: true, subs: ['Caregiving & Home Care'], options: ['Hourly', 'Day shift', 'Night shift', 'Live-in'] },
      { key: 'lactation_services', label: 'What you help with', type: 'multi', required: true, subs: ['Lactation Consulting'], options: ['Breastfeeding support', 'Pumping & storage', 'Newborn feeding', 'Weaning advice'] },
      { key: 'first_aid', label: 'Do you have first-aid training?', type: 'yesno', required: true, subs: ['Caregiving & Home Care', 'Nursing Assistance'] }
    ])
  };

  SCHEMAS.legal = {
    groups: {
      advice: ['Legal Consultation', 'Dispute Mediation']
    },
    fields: [
      { key: 'licence_body', label: 'Called to the bar / registered with', type: 'text', required: true, maxLength: 80, placeholder: 'e.g. the bar association or regulator' },
      { key: 'licence_number', label: 'Enrolment or registration number', type: 'text', required: true, maxLength: 60, placeholder: 'Your number', hint: 'Shown to customers' },
      { key: 'consult_mode', label: 'How do you meet clients?', type: 'select', required: true, options: ['Online', 'In my office', 'I visit the client', 'Any of these'] },
      { key: 'practice_areas', label: 'Areas of law', type: 'multi', required: true, subs: '@advice', options: ['Property & land', 'Family', 'Business & contracts', 'Employment', 'Criminal', 'Immigration', 'Intellectual property'] },
      { key: 'contract_types', label: 'Contracts you handle', type: 'multi', required: true, subs: ['Contract Drafting & Review'], options: ['Business contracts', 'Employment contracts', 'Partnership agreements', 'NDAs', 'Supply & service agreements', 'Loan agreements'] },
      { key: 'notary_documents', label: 'Documents you notarise', type: 'multi', required: true, subs: ['Document Notarisation'], options: ['Affidavits', 'Declarations', 'Powers of attorney', 'Certified true copies', 'Documents for use abroad'] },
      { key: 'mediation_types', label: 'Disputes you mediate', type: 'multi', required: true, subs: ['Dispute Mediation'], options: ['Family', 'Business & commercial', 'Landlord and tenant', 'Neighbours', 'Workplace'] },
      { key: 'tenancy_services', label: 'What you do', type: 'multi', required: true, subs: ['Tenancy Agreements'], options: ['Landlord agreements', 'Tenant agreements', 'Eviction notices', 'Commercial leases', 'Reviewing existing agreements'] },
      { key: 'land_documents', label: 'What you handle', type: 'multi', required: true, subs: ['Land & Property Documents'], options: ['Deeds of assignment', 'Title searches', 'Survey plan checks', 'Governor consent', 'Certificate of occupancy', 'Sale agreements'] },
      { key: 'free_first_meeting', label: 'Is the first meeting free?', type: 'yesno', hint: 'Optional' }
    ]
  };

  SCHEMAS.financial = {
    groups: {
      licensed: ['Accounting', 'Audit Support', 'Tax Preparation', 'Financial Planning', 'Financial Consultancy'],
      books:    ['Accounting', 'Bookkeeping', 'Payroll Processing', 'Audit Support'],
      advice:   ['Financial Planning', 'Financial Consultancy']
    },
    fields: [].concat(lic('@licensed'), cert('@licensed'), [
      { key: 'work_mode', label: 'How do you work with clients?', type: 'select', required: true, options: ['Remote online', 'In person', 'Both'] },
      { key: 'client_types', label: 'Who do you work for?', type: 'multi', required: true, options: ['Individuals', 'Small businesses', 'Large companies', 'NGOs & churches', 'Start-ups'] },
      { key: 'accounting_software', label: 'Software you use', type: 'multi', required: true, subs: '@books', options: ['QuickBooks', 'Sage', 'Zoho Books', 'Xero', 'Excel'] },
      { key: 'accounting_services', label: 'What you do', type: 'multi', required: true, subs: ['Accounting'], options: ['Financial statements', 'Management accounts', 'Budgeting', 'Reconciliation', 'Year-end accounts'] },
      { key: 'bookkeeping_frequency', label: 'How often do you update the books?', type: 'select', required: true, subs: ['Bookkeeping'], options: ['Daily', 'Weekly', 'Monthly', 'As needed'] },
      { key: 'tax_types', label: 'Taxes you handle', type: 'multi', required: true, subs: ['Tax Preparation'], options: ['Personal income tax', 'Company income tax', 'VAT', 'PAYE', 'Withholding tax', 'Tax clearance'] },
      { key: 'planning_areas', label: 'What you advise on', type: 'multi', required: true, subs: ['Financial Planning'], options: ['Budgeting & savings', 'Retirement', 'Investment guidance', 'Education funds', 'Debt management', 'Insurance review'] },
      { key: 'consultancy_areas', label: 'What you advise on', type: 'multi', required: true, subs: ['Financial Consultancy'], options: ['Business finances', 'Funding & loans', 'Cash flow', 'Investor reports', 'Cost control'] },
      { key: 'sells_products', label: 'Do you also sell investment or insurance products?', type: 'yesno', required: true, subs: '@advice' },
      { key: 'audit_types', label: 'Support you give', type: 'multi', required: true, subs: ['Audit Support'], options: ['Preparing for an audit', 'Internal audit', 'Compliance checks', 'Fraud checks', 'Answering audit queries'] },
      { key: 'payroll_services', label: 'What you do', type: 'multi', required: true, subs: ['Payroll Processing'], options: ['Salary calculation', 'Payslips', 'PAYE & pension remittance', 'Staff records', 'Statutory returns'] },
      { key: 'max_employees', label: 'Largest team you handle', type: 'number', required: true, subs: ['Payroll Processing'], min: 1, max: 100000, unit: 'employees', placeholder: 'e.g. 50' },
      { key: 'nda', label: 'Will you sign a confidentiality agreement?', type: 'yesno', hint: 'Optional' }
    ])
  };

  /* Optional registration questions added to older schemas (owner decision 2026-11-11) */
  SCHEMAS.education.fields.push({ key: 'licence_number', label: 'Driving school or instructor registration number', type: 'text', maxLength: 60, subs: ['Driving Lessons'], hint: 'Optional', placeholder: 'Your number' });
  SCHEMAS.construction.fields.push({ key: 'licence_number', label: 'Trade registration or licence number', type: 'text', maxLength: 60, subs: ['Electrical Installation', 'Plumbing Installation'], hint: 'Optional', placeholder: 'Your number (also for gas work)' });

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

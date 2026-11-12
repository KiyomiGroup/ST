/* ============================================================
   STREETTASKER — task-schemas.js   (Categories Stage 6c)
   The category questions worded for the person who needs the work done (the Poster), for Post a Task.
   Same engine and same file format as the Tasker questions in js/category-forms.js; load it AFTER that file.
   Groups (which subcategories share a question) are shared with the Tasker side, so both sides always agree on them.

   Saved in tasks.details (jsonb), flat, like services.details:  { "_v": 1, "supplies": "I will provide them", "cleaners_wanted": 2 }
   Keys that mean the same thing on both sides keep the same key (supplies, materials, coverage, same_day...), but the OPTIONS are worded
   for the Poster, so matching a task to a service is a later step (Stage 6d), not a string compare.

   Pilot (like Stage 3): Cleaning, Repairs & Maintenance (handyman), Moving & Delivery (logistics). To add another category: copy its Tasker
   schema from category-forms.js, reword each label and option for the Poster, keep `groups` as W.<category>.groups, and add a test line.
   ============================================================ */
(function (root) {
  'use strict';
  var F = root.STCatForms || (typeof require !== 'undefined' ? require('./category-forms.js') : null);
  if (!F) return;
  var W = F.SCHEMAS;        /* the Tasker schemas (the Tasker audience object never changes) */
  var P = {};

  P.cleaning = {
    groups: W.cleaning.groups,
    fields: [
      { key: 'supplies', label: 'Who brings the cleaning supplies?', type: 'select', required: true, options: ['The cleaner brings them', 'I will provide them', 'No preference'] },
      { key: 'property_type', label: 'What place needs cleaning?', type: 'select', required: true, subs: '@premises', options: ['Apartment / flat', 'House / duplex', 'Office', 'Shop / commercial space', 'School, church or hall'] },
      { key: 'home_size', label: 'How big is the home?', type: 'select', required: true, subs: '@home', options: ['Studio to 2 bedrooms', '3 to 4 bedrooms', '5 or more bedrooms', 'Whole building'] },
      { key: 'cleaners_wanted', label: 'How many cleaners do you need?', type: 'number', min: 1, max: 50, unit: 'people', hint: 'Optional', placeholder: 'e.g. 2' },
      { key: 'recurring', label: 'Do you want this cleaning to repeat every week or month?', type: 'yesno', subs: '@regular', hint: 'Optional' },
      { key: 'disposal_included', label: 'Do you need the waste taken to a dump site?', type: 'yesno', required: true, subs: ['Waste Removal'] },
      { key: 'eco_products', label: 'Do you want eco-friendly products used?', type: 'yesno', notSubs: '@hazard', hint: 'Optional' }
    ]
  };

  P.handyman = {
    groups: W.handyman.groups,
    fields: [
      { key: 'materials', label: 'Who buys the materials and spare parts?', type: 'select', required: true, notSubs: ['Pest Control'], options: ['I will buy them', 'The tasker supplies them (I pay at cost)', 'No preference'] },
      { key: 'brands', label: 'Brand of the item to be fixed', type: 'text', subs: '@appliances', maxLength: 80, hint: 'Optional', placeholder: 'e.g. LG, Samsung, Mikano' },
      { key: 'plumbing_jobs', label: 'What plumbing work is needed?', type: 'multi', required: true, subs: ['Plumbing'], options: ['Leaks & pipe repair', 'Toilets & sinks', 'Water heaters', 'Borehole & pumps', 'Blocked drains', 'New pipe installation'] },
      { key: 'electrical_jobs', label: 'What electrical work is needed?', type: 'multi', required: true, subs: ['Electrical Repairs'], options: ['Rewiring', 'Sockets & switches', 'Breakers & distribution boards', 'Lighting', 'Fault finding'] },
      { key: 'generator_types', label: 'What kind of generator is it?', type: 'multi', required: true, subs: ['Generator Repair'], options: ['Small petrol', 'Diesel', 'Large / industrial'] },
      { key: 'power_systems', label: 'What system needs work?', type: 'multi', required: true, subs: '@power', options: ['Inverters', 'Solar panels', 'Batteries', 'Charge controllers', 'Full system design'] },
      { key: 'paint_types', label: 'What painting is needed?', type: 'multi', required: true, subs: ['Painting'], options: ['Interior walls', 'Exterior walls', 'Textured or screeded finishes', 'Wood & metal (gloss)', 'Spray painting'] },
      { key: 'lock_jobs', label: 'What locksmith work is needed?', type: 'multi', required: true, subs: ['Locksmith'], options: ['Door locks', 'Car keys', 'Safes', 'Smart locks', 'Lock-out help'] },
      { key: 'pest_targets', label: 'What pests need treating?', type: 'multi', required: true, subs: ['Pest Control'], options: ['Cockroaches', 'Rodents', 'Termites', 'Mosquitoes', 'Bed bugs', 'Ants & other insects'] },
      { key: 'emergency', label: 'Is this an emergency?', type: 'yesno', hint: 'Optional' },
      { key: 'callout_ok', label: 'Are you happy to pay an inspection or call-out fee?', type: 'yesno', hint: 'Optional' }
    ]
  };

  P.logistics = {
    groups: W.logistics.groups,
    fields: [
      { key: 'vehicle_needed', label: 'What do you need to move it with?', type: 'select', required: true, notSubs: '@noVehicle', options: ['Any is fine', 'Bicycle or motorbike', 'Car', 'Van', 'Pickup', 'Truck (up to 5 tonnes)', 'Truck (over 5 tonnes)'] },
      { key: 'coverage', label: 'Where does it need to go?', type: 'select', required: true, notSubs: '@noRoute', options: ['Within my city', 'Between cities', 'Nationwide'] },
      { key: 'load_kg', label: 'About how heavy is the load?', type: 'number', min: 1, max: 100000, unit: 'kg', hint: 'Optional', notSubs: '@noVehicle', placeholder: 'e.g. 500' },
      { key: 'helpers_needed', label: 'How many people do you need to help carry?', type: 'number', min: 1, max: 50, unit: 'people', hint: 'Optional', subs: '@crew', placeholder: 'e.g. 3' },
      { key: 'packing_materials', label: 'Do you want boxes and wrapping brought?', type: 'yesno', subs: '@boxes', hint: 'Optional' },
      { key: 'goods_cover', label: 'Do you need your goods covered while they are carried?', type: 'select', subs: '@insured', hint: 'Optional', options: ['No', 'Basic cover', 'Full insurance'] },
      { key: 'same_day', label: 'Do you need it delivered the same day?', type: 'yesno', subs: '@parcel', hint: 'Optional' },
      { key: 'live_updates', label: 'Do you want live updates on the delivery?', type: 'yesno', subs: '@parcel', hint: 'Optional' },
      { key: 'hire_mode', label: 'How do you want to hire the vehicle?', type: 'select', required: true, subs: ['Van & Truck Hire'], options: ['With a driver', 'Self-drive'] },
      { key: 'storage_size', label: 'How much storage do you need?', type: 'text', required: true, subs: ['Warehousing'], maxLength: 80, placeholder: 'e.g. 20 sqm, 5 pallets' },
      { key: 'freight_modes', label: 'How should it be shipped?', type: 'multi', required: true, subs: ['International Freight Forwarding'], options: ['Air', 'Sea', 'Road'] },
      { key: 'customs', label: 'Do you need customs clearance handled?', type: 'yesno', required: true, subs: ['International Freight Forwarding'] }
    ]
  };

  F.registerAudience('poster', P);
  root.STTaskSchemas = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : this);

/* ============================================================
   STREETTASKER — task-schemas.js   (Categories Stage 6c, extended in 6d and 6e)
   The category questions worded for the person who needs the work done (the Poster), for Post a Task.
   Same engine and same file format as the Tasker questions in js/category-forms.js; load it AFTER that file.
   Groups (which subcategories share a question) are shared with the Tasker side, so both sides always agree on them.

   Saved in tasks.details (jsonb), flat, like services.details:  { "_v": 1, "supplies": "I will provide them", "cleaners_wanted": 2 }
   Keys that mean the same thing on both sides keep the same key (supplies, materials, coverage, same_day...), but the OPTIONS are worded
   for the Poster, so matching a task to a service is a later step (Stage 6d), not a string compare.

   Pilot (Stage 6c): Cleaning, Repairs & Maintenance (handyman), Moving & Delivery (logistics). Batch A (Stage 6d): home_furniture, landscaping, automotive, grooming, fashion (written out in full).
   Stage 6e: the other 16 categories (batches B, C, D) via derive() at the bottom: same keys, groups and rules as the Tasker side, Poster wording from a short table.
   Only Sales and Other have no Poster questions. To add a category: copy a Tasker schema's keys into a derive() table, reword, add it to the tests.
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
      { key: 'storage_features', label: 'What must the storage have?', type: 'multi', subs: ['Warehousing'], hint: 'Optional', options: ['24-hour security', 'CCTV', 'Fire safety', 'Dry & ventilated'] },
      { key: 'freight_modes', label: 'How should it be shipped?', type: 'multi', required: true, subs: ['International Freight Forwarding'], options: ['Air', 'Sea', 'Road'] },
      { key: 'customs', label: 'Do you need customs clearance handled?', type: 'yesno', required: true, subs: ['International Freight Forwarding'] }
    ]
  };

  /* ═══ Stage 6d, batch A ═══════════════════════════════════════════════════════════════════════════
     Home & Furniture, Gardening & Outdoor, Automotive, Beauty & Personal Care, Fashion & Tailoring (Tasker keys: home_furniture, landscaping, automotive, grooming, fashion).
     Same keys as the Tasker side. Questions that are a promise from the Tasker (sterilising, guarantee) are optional wishes here. */

  var SUPPLY_BY = ['I will supply them', 'The tasker supplies them (I pay at cost)', 'No preference'];
  var GUARANTEE = ['No guarantee needed', 'At least 7 days', 'At least 30 days', 'At least 3 months', '6 months or more'];

  P.home_furniture = {
    groups: W.home_furniture.groups,
    fields: [
      { key: 'tools', label: 'Do you need the tasker to bring their own tools?', type: 'yesno', required: true, notSubs: '@design' },
      { key: 'materials', label: 'Who supplies the materials and fittings?', type: 'select', required: true, subs: '@supply', options: SUPPLY_BY },
      { key: 'furniture_types', label: 'What furniture is it?', type: 'multi', required: true, subs: '@pieces', options: ['Beds & wardrobes', 'Sofas & chairs', 'Tables & desks', 'Cabinets & shelves', 'Office furniture'] },
      { key: 'wall_types', label: 'What kind of wall is it going on?', type: 'multi', required: true, subs: '@fixings', options: ['Concrete or block', 'Drywall or POP', 'Tiled walls', 'Wood panels', 'Not sure'] },
      { key: 'tv_size', label: 'How big is the TV?', type: 'select', required: true, subs: ['TV Installation'], options: ['Up to 43 inch', '44 to 65 inch', '66 inch or bigger'] },
      { key: 'design_services', label: 'What help do you want?', type: 'multi', required: true, subs: '@design', options: ['Space planning', 'Colour schemes', 'Furniture sourcing', '3D visuals', 'Styling and accessories'] },
      { key: 'site_visit', label: 'Do you want the designer to visit before quoting?', type: 'yesno', subs: '@design', hint: 'Optional' },
      { key: 'organise_areas', label: 'Which areas need organising?', type: 'multi', required: true, subs: ['Home Organisation'], options: ['Wardrobes', 'Kitchen & pantry', 'Garage or store', 'Home office', "Children's rooms"] },
      { key: 'smart_systems', label: 'What do you want set up?', type: 'multi', required: true, subs: ['Home Automation'], options: ['Smart lighting', 'Smart locks & doorbells', 'CCTV link-up', 'Voice assistants', 'Whole-home control'] },
      { key: 'improvement_jobs', label: 'What work is needed?', type: 'multi', required: true, subs: ['Home Improvement'], options: ['POP ceilings', 'Flooring', 'Tiling', 'Doors & windows', 'Kitchen & bathroom upgrades'] },
      { key: 'warranty', label: 'How long a guarantee do you want on the work?', type: 'select', options: GUARANTEE, hint: 'Optional' }
    ]
  };

  P.landscaping = {
    groups: W.landscaping.groups,
    fields: [
      { key: 'equipment', label: 'Who brings the tools and equipment?', type: 'select', required: true, notSubs: ['Garden Design'], options: ['The tasker brings them', 'I will provide them', 'No preference'] },
      { key: 'materials', label: 'Who supplies the plants, soil and materials?', type: 'select', required: true, subs: '@build', options: SUPPLY_BY },
      { key: 'property_types', label: 'What kind of place is it?', type: 'select', required: true, options: ['Home garden', 'Estate or compound', 'Office or commercial', 'School, church or hall'] },
      { key: 'max_area', label: 'About how big is the area?', type: 'select', required: true, subs: '@sized', options: ['Up to 100 sqm', '100 to 500 sqm', '500 to 2,000 sqm', 'Over 2,000 sqm'] },
      { key: 'tree_height', label: 'How tall are the trees?', type: 'select', required: true, subs: ['Tree Trimming'], options: ['Up to 3 metres', 'Up to 6 metres', 'Above 6 metres'] },
      { key: 'safety_gear', label: 'Is the work high up, so climbing and safety equipment is needed?', type: 'yesno', required: true, subs: ['Tree Trimming'] },
      { key: 'pool_chemicals', label: 'Do you want pool chemicals included in the price?', type: 'yesno', required: true, subs: ['Pool Cleaning'] },
      { key: 'irrigation_types', label: 'What kind of system do you want?', type: 'multi', required: true, subs: ['Irrigation Installation'], options: ['Drip lines', 'Sprinklers', 'Borehole or pump connection', 'Timers & controllers'] },
      { key: 'design_output', label: 'What do you want to receive?', type: 'multi', required: true, subs: ['Garden Design'], options: ['Layout plan', 'Plant list', '3D visual', 'Site supervision'] },
      { key: 'waste_removal', label: 'Do you want the cuttings and waste taken away?', type: 'yesno', required: true, subs: '@cuttings' },
      { key: 'recurring', label: 'Do you want this done every week or month?', type: 'yesno', subs: '@regular', hint: 'Optional' }
    ]
  };

  P.automotive = {
    groups: W.automotive.groups,
    fields: [
      { key: 'service_location', label: 'Where should the work be done?', type: 'select', required: true, notSubs: '@mobileOnly', options: ["At the tasker's workshop", 'The tasker comes to me', 'No preference'] },
      { key: 'vehicle_types', label: 'What kind of vehicle is it?', type: 'select', required: true, notSubs: ['Motorcycle Repair'], options: ['Car', 'SUV or jeep', 'Bus or van', 'Truck', 'Motorcycle'] },
      { key: 'makes', label: 'What make is the vehicle?', type: 'select', required: true, subs: '@makes', options: ['Japanese', 'European', 'American', 'Korean', 'Chinese'] },
      { key: 'parts', label: 'Who supplies the spare parts?', type: 'select', required: true, subs: '@parts', options: SUPPLY_BY },
      { key: 'scanner', label: 'Do you want a computer diagnostic scan?', type: 'yesno', subs: ['Vehicle Diagnostics', 'Auto Electrician'], hint: 'Optional' },
      { key: 'written_report', label: 'Do you want a written report?', type: 'yesno', subs: '@reports', hint: 'Optional' },
      { key: 'wash_types', label: 'What do you want included?', type: 'multi', required: true, subs: '@washing', options: ['Exterior wash', 'Interior vacuum', 'Engine bay', 'Polish & wax', 'Ceramic coating', 'Steam cleaning'] },
      { key: 'tyre_services', label: 'What tyre work is needed?', type: 'multi', required: true, subs: ['Tyre Replacement'], options: ['Fitting', 'Balancing', 'Wheel alignment', 'Puncture repair'] },
      { key: 'body_jobs', label: 'What body work is needed?', type: 'multi', required: true, subs: ['Car Body Work'], options: ['Dents', 'Panel beating', 'Spray painting', 'Bumper repair', 'Rust treatment'] },
      { key: 'wrap_types', label: 'What wrapping do you want?', type: 'multi', required: true, subs: ['Vehicle Wrapping'], options: ['Full wrap', 'Partial wrap', 'Colour change', 'Branding & adverts', 'Paint protection film'] },
      { key: 'towing_truck', label: 'What kind of tow truck is needed?', type: 'select', required: true, subs: ['Vehicle Towing'], options: ['Flatbed', 'Hook and chain', 'No preference'] },
      { key: 'coverage', label: 'Where is the job?', type: 'select', required: true, subs: '@mobileOnly', options: ['Within my city', 'Between cities'] },
      { key: 'roadside_help', label: 'What help do you need on the road?', type: 'multi', required: true, subs: ['Roadside Assistance'], options: ['Jump start', 'Flat tyre', 'Fuel delivery', 'Lock-out', 'Winching'] },
      { key: 'response_time', label: 'How fast do you need someone to reach you?', type: 'select', required: true, subs: '@mobileOnly', options: ['Within 30 minutes', 'Within 1 hour', 'Within 2 hours', 'I can book in advance'] },
      { key: 'open_24h', label: 'Do you need help at night or at the weekend?', type: 'yesno', subs: '@mobileOnly', hint: 'Optional' },
      { key: 'warranty', label: 'How long a guarantee do you want on the work?', type: 'select', notSubs: '@mobileOnly', options: GUARANTEE, hint: 'Optional' }
    ]
  };

  P.grooming = {
    groups: W.grooming.groups,
    fields: [
      { key: 'service_location', label: 'Where should it be done?', type: 'select', required: true, options: ["At the tasker's salon or shop", 'The tasker comes to me', 'No preference'] },
      { key: 'clients', label: 'Who is it for?', type: 'multi', required: true, options: ['Women', 'Men', 'Children'] },
      { key: 'products', label: 'Who supplies the products and materials?', type: 'select', required: true, options: ['The tasker uses their own', 'I will provide them', 'No preference'] },
      { key: 'sterilise', label: 'Do you want the tasker to sterilise their tools between clients?', type: 'yesno', hint: 'Optional' },
      { key: 'hair_types', label: 'What kind of hair is it?', type: 'multi', required: true, subs: '@hair', options: ['Natural hair', 'Relaxed hair', 'Weave & extensions', 'Locs', 'Wigs'] },
      { key: 'braid_styles', label: 'What style do you want?', type: 'multi', required: true, subs: ['Hair Braiding'], options: ['Cornrows', 'Box braids', 'Knotless braids', 'Twists', 'Crochet', 'Ghana weaving'] },
      { key: 'barber_services', label: 'What do you want done?', type: 'multi', required: true, subs: ['Barbing'], options: ['Haircut', 'Beard trim', 'Shaving', 'Hair dye', "Children's cuts"] },
      { key: 'wig_services', label: 'What wig work do you need?', type: 'multi', required: true, subs: ['Wig Making'], options: ['Custom wigs', 'Ventilating', 'Frontal or closure install', 'Revamping', 'Colouring'] },
      { key: 'makeup_types', label: 'What is the makeup for?', type: 'multi', required: true, subs: ['Makeup Artistry'], options: ['Bridal', 'Events & parties', 'Photoshoots & film', 'Special effects', 'Makeup lessons'] },
      { key: 'nail_services', label: 'What nail work do you want?', type: 'multi', required: true, subs: '@nails', options: ['Acrylic', 'Gel', 'Natural nail care', 'Nail art', 'Pedicure', 'Removal'] },
      { key: 'lash_styles', label: 'Which lash style do you want?', type: 'multi', required: true, subs: ['Eyelash Extensions'], options: ['Classic', 'Volume', 'Hybrid', 'Lash lift'] },
      { key: 'brow_services', label: 'What brow work do you want?', type: 'multi', required: true, subs: ['Eyebrow Services'], options: ['Threading', 'Waxing', 'Microblading', 'Tinting', 'Shaping'] },
      { key: 'skin_services', label: 'What skin care do you want?', type: 'multi', required: true, subs: ['Skincare Services'], options: ['Facials', 'Acne care', 'Chemical peels', 'Anti-ageing', 'Skin consultation'] },
      { key: 'massage_types', label: 'What kind of massage do you want?', type: 'multi', required: true, subs: ['Massage Therapy'], options: ['Relaxation', 'Deep tissue', 'Sports', 'Prenatal', 'Foot'] },
      { key: 'spa_services', label: 'What spa treatment do you want?', type: 'multi', required: true, subs: ['Spa Services'], options: ['Facials', 'Body scrubs & wraps', 'Steam or sauna', 'Massage', 'Full packages'] },
      { key: 'waxing_areas', label: 'Which areas do you want waxed?', type: 'multi', required: true, subs: ['Body Waxing'], options: ['Face', 'Arms & legs', 'Underarms', 'Bikini area', 'Full body'] },
      { key: 'grooming_services', label: 'What do you want help with?', type: 'multi', required: true, subs: ['Personal Grooming'], options: ['Shaving & beard care', 'Skin & hair routine', 'Wedding grooming', 'Grooming advice'] },
      { key: 'group_bookings', label: 'Is it for a group (for example a bridal party)?', type: 'yesno', subs: '@parties', hint: 'Optional' }
    ]
  };

  P.fashion = {
    groups: W.fashion.groups,
    fields: [
      { key: 'fabric_by', label: 'Who supplies the fabric?', type: 'select', required: true, subs: '@making', options: ['I will buy it', 'The tasker buys it (I pay at cost)', 'No preference'] },
      { key: 'turnaround_days', label: 'In how many days do you need it?', type: 'number', min: 1, max: 180, unit: 'days', hint: 'Optional', placeholder: 'e.g. 7' },
      { key: 'garment_types', label: 'What clothing is it?', type: 'multi', required: true, subs: '@garments', options: ["Women's wear", "Men's wear", "Children's wear", 'Native & traditional', 'Corporate & uniforms'] },
      { key: 'fittings', label: 'How many fittings do you expect?', type: 'select', subs: ['Suit Making', 'Bridal Wear', 'Tailoring', 'Dressmaking'], hint: 'Optional', options: ['One fitting', 'Two fittings', 'Three or more'] },
      { key: 'measure_home', label: 'Do you want measurements taken at your home?', type: 'yesno', subs: '@fitted', hint: 'Optional' },
      { key: 'design_services', label: 'What help do you need?', type: 'multi', required: true, subs: ['Fashion Design'], options: ['Custom designs', 'Collections', 'Sketches & tech packs', 'Sample making', 'Production runs'] },
      { key: 'pattern_outputs', label: 'What do you want to receive?', type: 'multi', required: true, subs: ['Pattern Making'], options: ['Paper patterns', 'Digital patterns', 'Size grading', 'Tech packs'] },
      { key: 'fix_jobs', label: 'What needs doing?', type: 'multi', required: true, subs: ['Clothing Alterations', 'Clothing Repairs'], options: ['Hemming', 'Taking in or letting out', 'Zips', 'Resizing', 'Patching & darning', 'Buttons'] },
      { key: 'shoe_jobs', label: 'What shoe work is needed?', type: 'multi', required: true, subs: ['Shoe Repair'], options: ['Resoling', 'Heel repair', 'Stitching', 'Cleaning & polishing', 'Stretching'] },
      { key: 'bag_jobs', label: 'What bag work is needed?', type: 'multi', required: true, subs: ['Bag Repair'], options: ['Zips', 'Straps & handles', 'Stitching', 'Lining', 'Leather repair'] },
      { key: 'embroidery_types', label: 'What embroidery do you want?', type: 'multi', required: true, subs: ['Embroidery'], options: ['Machine embroidery', 'Hand embroidery', 'Logos & monograms', 'Names & lettering'] },
      { key: 'bead_items', label: 'What beadwork do you want?', type: 'multi', required: true, subs: ['Beadwork'], options: ['Jewellery', 'Bridal accessories', 'Traditional caps & accessories', 'Bag & shoe decoration', 'Wall art'] },
      { key: 'styling_services', label: 'What styling do you want?', type: 'multi', required: true, subs: ['Fashion Styling'], options: ['Personal wardrobe', 'Event outfits', 'Photoshoot styling', 'Shopping together', 'Wardrobe clear-out'] },
      { key: 'rush_orders', label: 'Is this a rush order?', type: 'yesno', hint: 'Optional' },
      { key: 'pickup', label: 'Do you want the tasker to collect and deliver?', type: 'yesno', hint: 'Optional' }
    ]
  };

  /* ═══ Stage 6e: batches B, C and D ════════════════════════════════════════════════════════════════
     B: creative, it_tech, business, education, pet.  C: events, hospitality, assistance, construction, marketing, laundry.
     D (regulated): professional, security, health, legal, financial.

     These are DERIVED from the Tasker schema so the keys, groups, subs / notSubs, min / max and units can never drift apart:
     derive(category, spec, front) takes each Tasker field and applies the Poster wording from `spec`:
       l = label, o = options, t = type (when a Tasker "several answers" becomes a Poster "one answer"), r = required (default: as the Tasker),
       h = hint (optional questions get "Optional"), p = placeholder, u = unit, w = a `when` follow-up, null = this Tasker question has no Poster twin.
     A key missing from `spec` keeps the Tasker wording (a test fails on that, so it cannot ship by accident).
     Rules used throughout: what DEFINES the job (type of work, how many guests, what is to be fixed) stays required; a Tasker promise
     (software used, guarantee, turnaround, receipts, equipment brought, safety kit) becomes an OPTIONAL wish; one place / one person / one vehicle
     is a one-answer question on the Poster side even when the Tasker side takes several. Matching (Stage 6f) must map one-of to any-of. */

  function derive(category, spec, front) {
    var out = (front || []).slice();
    W[category].fields.forEach(function (f) {
      var s = spec[f.key];
      if (s === null) return;
      if (!s) { out.push(f); return; }
      var n = {};
      Object.keys(f).forEach(function (k) { n[k] = f[k]; });
      delete n.hint; delete n.when; delete n.required;
      n.label = s.l || f.label;
      if (s.t) n.type = s.t;
      if (s.o) n.options = s.o;
      if (s.p) n.placeholder = s.p;
      if (s.u) n.unit = s.u;
      if (s.w) n.when = s.w;
      var req = typeof s.r === 'boolean' ? s.r : !!f.required;
      if (req) n.required = true; else n.hint = s.h || 'Optional';
      out.push(n);
    });
    return { groups: W[category].groups, fields: out };
  }

  var WORK_DOING = ['I will supply them', 'The tasker supplies them (I pay at cost)', 'No preference'];
  var WARRANTY_WISH = ['No guarantee needed', 'At least 7 days', 'At least 30 days', 'At least 3 months', '6 months or more'];
  var HOW_FAR = ['Within my city', 'Between cities'];
  var WORK_MODE = ['Remote online', 'In person', 'Both'];
  var LANGS = ['English', 'Pidgin', 'Yoruba', 'Igbo', 'Hausa', 'French'];

  /* ── Batch B ─────────────────────────────────────────────────────────────────────────────────── */
  P.creative = derive('creative', {
    software:          { l: 'Which software should it be made in?', r: false },
    revisions:         { l: 'How many rounds of changes do you expect?', r: false },
    turnaround_days:   { l: 'In how many days do you need it?', r: false },
    file_formats:      { l: 'Which files do you want to receive?', r: false },
    brand_pack:        { l: 'What should the brand package include?' },
    social_platforms:  { l: 'Which platforms is it for?' },
    design_scope:      { l: 'What do you need designed?' },
    builds_in_code:    { l: 'Do you also want the design built in code?' },
    video_types:       { l: 'What kind of video is it?' },
    animation_styles:  { l: 'What kind of animation do you want?' },
    photo_jobs:        { l: 'What editing do you need?' },
    print_jobs:        { l: 'What do you need printed?' },
    prints_it_yourself: { l: 'Do you want the tasker to do the printing too?' },
    three_d_types:     { l: 'What 3D work do you need?' },
    product_scope:     { l: 'What do you need?' },
    content_types:     { l: 'What content do you want created?' },
    voice_types:       { l: 'What is the voice work for?' },
    voice_languages:   { l: 'Which language should it be recorded in?' },
    has_studio:        { l: 'Does the tasker need their own recording setup?', r: false }
  });

  P.it_tech = derive('it_tech', {
    service_mode:      { l: 'Where should the work be done?', o: ["At the tasker's shop", 'At my place', 'Remote online', 'Any of these'] },
    work_mode:         { l: 'How do you want to work together?', o: ['Remote online', 'Meetings in person', 'Both'] },
    os_types:          { l: 'What system is it on?' },
    install_types:     { l: 'What do you need installed?' },
    it_support_types:  { l: 'What support do you need?' },
    laptop_repairs:    { l: 'What is wrong with the laptop?' },
    phone_repairs:     { l: 'What is wrong with the phone?' },
    brands:            { l: 'What brand and model is it?', p: 'e.g. HP EliteBook, iPhone 13, Samsung A54' },
    parts:             { l: 'Who supplies the spare parts?', o: WORK_DOING },
    backs_up_data:     { l: 'Do you want your data backed up before the work starts?', r: false },
    recovery_media:    { l: 'What do you need the data recovered from?' },
    no_fix_no_fee:     { l: 'Do you only want to pay if the data is recovered?', r: false },
    software_types:    { l: 'What do you want built?' },
    web_types:         { l: 'What do you want built?' },
    languages:         { l: 'Any languages or tools it must be built with?', r: false },
    databases:         { l: 'Which databases are involved?' },
    cloud_platforms:   { l: 'Which platforms need managing?' },
    security_services: { l: 'What security work do you need?' },
    network_jobs:      { l: 'What network work do you need?' },
    hardware_jobs:     { l: 'What hardware work do you need?' },
    smart_systems:     { l: 'What do you want set up?' },
    ongoing_support:   { l: 'Do you want ongoing maintenance afterwards?' },
    emergency:         { l: 'Is this an emergency call-out?' },
    warranty:          { l: 'How long a warranty do you want on the repair?', o: WARRANTY_WISH }
  });

  P.business = derive('business', {
    work_mode:           { l: 'Where should the work be done?', o: ['Remote online', 'At my office', 'Either is fine'] },
    engagement:          { l: 'How do you want to hire?', r: false, o: ['By the task or project', 'Part-time retainer', 'Full-time retainer'] },
    software:            { l: 'Which tools should they use?', r: false },
    languages:           { l: 'Which languages do you need?' },
    typing_speed:        { l: 'How fast must the typing be?', r: false },
    data_entry_types:    { l: 'What data needs entering?' },
    transcription_types: { l: 'What are the recordings?' },
    support_channels:    { l: 'Which channels need handling?' },
    research_outputs:    { l: 'What do you want to receive?' },
    email_tasks:         { l: 'What email help do you need?' },
    document_types:      { l: 'What documents do you need prepared?' },
    sheet_skills:        { l: 'What spreadsheet work do you need?' },
    coordination_scope:  { l: 'What coordination do you need?' },
    office_tasks:        { l: 'What tasks do you need handled?' },
    recruitment_stages:  { l: 'What recruitment help do you need?' },
    registration_types:  { l: 'What do you need registered?' },
    nda:                 { l: 'Do you need the tasker to sign a confidentiality agreement?' }
  });

  P.education = derive('education', {
    lesson_modes:      { l: 'How would you like to be taught?', o: ['Online', 'At my home', "At the tutor's place or centre"] },
    class_size:        { l: 'Who is the lesson for?', o: ['One student', 'A small group', 'A large group or class'] },
    levels:            { l: 'What level is the student?', t: 'select', o: ['Primary', 'Junior secondary', 'Senior secondary', 'University', 'Adult learner'] },
    ages:              { l: 'How old is the learner?', t: 'select', o: ['Child', 'Teenager', 'Adult'] },
    subjects:          { l: 'Which subjects do you need help with?' },
    exams:             { l: 'Which exams is it for?' },
    languages_taught:  { l: 'Which language do you want to learn?' },
    music_types:       { l: 'What do you want to learn?' },
    instruments:       { l: 'Which instrument?' },
    dance_styles:      { l: 'Which dance styles?' },
    art_types:         { l: 'What art do you want to learn?' },
    computer_topics:   { l: 'What do you want to learn?' },
    coding_languages:  { l: 'What do you want to learn?' },
    transmission:      { l: 'What kind of car do you want to learn in?', t: 'select', o: ['Manual', 'Automatic'] },
    provides_car:      { l: 'Do you need the instructor to provide the car?' },
    career_focus:      { l: 'What coaching do you need?' },
    training_topics:   { l: 'What training do you need?' },
    certificate:       { l: 'Do you want a certificate at the end?' },
    materials_included: { l: 'Do you want learning materials included?' },
    licence_number:    null
  });

  P.pet = derive('pet', {
    pet_types:         { l: 'What pet is it?', t: 'select', o: ['Dog', 'Cat', 'Bird', 'Fish', 'Small pet (rabbit, hamster)', 'Reptile'] },
    dog_sizes:         { l: 'How big is your dog?', t: 'select', o: ['Small', 'Medium', 'Large', 'Extra large'], w: { key: 'pet_types', equals: 'Dog' } },
    service_location:  { l: 'Where should it happen?', o: ["At the tasker's place", 'At my place', 'Either'] },
    max_pets:          { l: 'How many pets need looking after?', p: 'e.g. 2' },
    walk_length:       { l: 'How long should each walk be?' },
    boarding_setup:    { l: 'What kind of boarding space do you want?', r: false },
    visits_per_day:    { l: 'How many visits a day do you need?' },
    daily_updates:     { l: 'Do you want photo updates?' },
    medication:        { l: 'Does your pet need medication given?' },
    first_aid:         { l: 'Do you want someone with pet first-aid training?' },
    grooming_services: { l: 'What grooming does your pet need?' },
    training_types:    { l: 'What training do you want?' },
    transport_vehicle: { l: 'What should your pet travel in?', r: false },
    safe_carriers:     { l: 'Do you need a safe crate or carrier used?', r: false },
    coverage:          { l: 'Where will the work take place?', o: HOW_FAR },
    tank_waters:       { l: 'What kind of water is it?', t: 'select', o: ['Freshwater', 'Saltwater', 'Pond'] },
    tank_jobs:         { l: 'What work does the aquarium need?' },
    photo_types:       { l: 'What kind of photos do you want?' },
    photo_delivery:    { l: 'How soon do you need the photos?', r: false },
    vet_registration:  null,
    vet_services:      { l: 'What care does your pet need?' },
    years_experience:  { l: 'How many years of experience should they have?' }
  });
  P.pet.fields.push({ key: 'must_be_registered', label: 'Must the vet be registered with the veterinary council?', type: 'yesno', subs: '@vets', hint: 'Optional' });

  /* ── Batch C ─────────────────────────────────────────────────────────────────────────────────── */
  P.events = derive('events', {
    event_types:       { l: 'What kind of event is it?', t: 'select', o: ['Weddings', 'Birthdays & parties', 'Corporate events', 'Funerals & memorials', 'Religious events', 'Concerts & shows', 'Graduations & school events'] },
    coverage:          { l: 'Where is the event?', o: ['In my own city', 'In a different city'] },
    team_size:         { l: 'How many people do you need to work the event?', r: false },
    max_guests:        { l: 'How many guests are expected?' },
    planner_services:  { l: 'What help do you need?' },
    decor_types:       { l: 'What decoration do you want?' },
    flower_kind:       { l: 'Do you want fresh or artificial flowers?', r: false, o: ['Fresh', 'Artificial', 'Either'] },
    floral_types:      { l: 'What arrangements do you need?' },
    own_equipment:     { l: 'Do you want the tasker to bring their own equipment?', r: false },
    shoot_types:       { l: 'What is the shoot for?' },
    video_outputs:     { l: 'What do you want to receive?' },
    delivery_time:     { l: 'How soon do you need the finished files?', r: false },
    music_genres:      { l: 'What music do you want played?' },
    act_size:          { l: 'How big should the act be?' },
    languages:         { l: 'Which languages should the host use?' },
    performer_types:   { l: 'What would you like performed?' },
    staff_roles:       { l: 'What roles do you need filled?' },
    setup_jobs:        { l: 'What set-up work do you need?' },
    gear_types:        { l: 'What do you want to rent?' },
    delivers_and_sets_up: { l: 'Do you want it delivered and set up?' },
    venue_capacity:    { l: 'How many guests must the venue hold?' },
    venue_features:    { l: 'What must the venue have?', r: false }
  });

  P.hospitality = derive('hospitality', {
    kitchen_type:      { l: 'Where should the food be cooked?', o: ["At the tasker's kitchen", 'In my kitchen', 'No preference'] },
    cuisines:          { l: 'What food do you want?' },
    bake_types:        { l: 'What do you want baked?' },
    cake_types:        { l: 'What cake do you want?' },
    custom_designs:    { l: 'Do you want a custom-designed cake?' },
    chef_services:     { l: 'What do you need the chef for?' },
    meal_plans:        { l: 'What meals do you need?' },
    home_meals:        { l: 'What meals do you want cooked?' },
    service_style:     { l: 'How should the food be served?' },
    max_guests:        { l: 'How many guests are you feeding?' },
    brings_equipment:  { l: 'Do you want serving equipment (tables, warmers, plates) brought?', r: false },
    lead_time:         { l: 'How soon do you need it?' },
    dietary:           { l: 'Any special diets to cater for?' },
    drink_services:    { l: 'What drinks do you want served?' },
    brings_bar:        { l: 'Do you want the bar equipment and glasses brought?', r: false },
    staff_count:       { l: 'How many staff do you need?' },
    uniform:           { l: 'Do you want the staff in uniform?' },
    kitchen_tasks:     { l: 'What kitchen help do you need?' },
    supply_items:      { l: 'What do you need supplied?' },
    bulk_orders:       { l: 'Is this a bulk order?' },
    delivery_vehicle:  { l: 'How should it be delivered?', r: false, o: ['On foot', 'Bicycle', 'Motorbike', 'Car', 'Van'] },
    insulated:         { l: 'Do you need it kept hot or cold in insulated bags?', r: false },
    delivery_radius:   { l: 'How far does it need to go?' },
    health_certificate: { l: "Do you want someone with a food handler's health certificate?" }
  });

  P.assistance = derive('assistance', {
    availability_days: { l: 'When do you need help?' },
    transport:         { l: 'What does the tasker need to get around?', t: 'select', r: false, o: ['Any is fine', 'Public transport', 'Motorbike', 'Car'] },
    coverage:          { l: 'Where does it need to happen?' },
    upfront_funds:     { l: 'How will purchases be paid for?', o: ['I pay upfront', 'The tasker pays and I refund them', 'No preference'] },
    gives_receipts:    { l: 'Do you want a receipt for every purchase?', r: false },
    doc_places:        { l: 'Where do the documents need to go?' },
    with_letter:       { l: 'Do you have an authorisation letter for the tasker?' },
    queue_places:      { l: 'Where is the queue?', t: 'select' },
    max_wait_hours:    { l: 'How long do you expect the wait to be?' },
    pa_services:       { l: 'What help do you need?' },
    engagement:        { l: 'How do you want to hire?', r: false, o: ['By the task', 'Part-time retainer', 'Full-time retainer'] },
    home_tasks:        { l: 'What help do you need at home?' },
    elder_care:        { l: 'What help does the person need?' },
    elder_experience:  { l: 'Do you want someone who has cared for older people before?', r: false },
    first_aid:         { l: 'Do you want someone with first-aid training?' },
    appointment_types: { l: 'What appointment is it?' },
    event_tasks:       { l: 'What help do you need at the event?' },
    guide_types:       { l: 'What do you want guided?' },
    languages:         { l: 'Which languages should the guide speak?' },
    same_day:          { l: 'Do you need the tasker to start the same day?' }
  });

  P.construction = derive('construction', {
    tools:             { l: 'Do you need the tasker to bring their own tools?' },
    crew_size:         { l: 'How many people do you need on the job?', r: false },
    materials:         { l: 'Who supplies the materials?', o: WORK_DOING },
    job_size:          { l: 'How big is the job?' },
    wall_jobs:         { l: 'What work do you need?' },
    carpentry_jobs:    { l: 'What work do you need?' },
    tile_types:        { l: 'What tiling do you need?' },
    plaster_jobs:      { l: 'What plastering do you need?' },
    ceiling_types:     { l: 'What kind of ceiling do you want?' },
    roof_types:        { l: 'What kind of roof is it?' },
    welding_jobs:      { l: 'What welding do you need?' },
    plumbing_installs: { l: 'What work do you need?' },
    electrical_installs: { l: 'What work do you need?' },
    floor_types:       { l: 'What floor do you want installed?' },
    fence_types:       { l: 'What kind of fence do you want?' },
    gate_types:        { l: 'What kind of gate do you want?' },
    concrete_jobs:     { l: 'What work do you need?' },
    structural_jobs:   { l: 'What work do you need?' },
    labour_jobs:       { l: 'What work do you need?' },
    demolition_jobs:   { l: 'What needs demolishing?' },
    removes_debris:    { l: 'Do you want the rubble taken away?' },
    aluminium_jobs:    { l: 'What work do you need?' },
    safety_gear:       { l: 'Must the tasker use safety equipment (helmets, harness, gloves)?', r: false },
    site_visit:        { l: 'Do you want the tasker to visit the site and quote before starting?' },
    warranty:          { l: 'How long a guarantee do you want on the work?', o: ['No guarantee needed', 'At least 3 months', 'At least 6 months', 'At least 1 year', 'More than 1 year'] },
    licence_number:    null
  });

  P.marketing = derive('marketing', {
    work_mode:           { l: 'How do you want to work together?', o: WORK_MODE },
    engagement:          { l: 'How do you want to hire?', r: false, o: ['One-off project', 'Monthly retainer', 'Not sure yet'] },
    industries:          { l: 'What industry is your business in?', t: 'select' },
    sends_reports:       { l: 'Do you want performance reports?', r: false },
    copy_types:          { l: 'What do you need written?' },
    copy_languages:      { l: 'Which languages should it be written in?' },
    seo_services:        { l: 'What SEO work do you need?' },
    platforms:           { l: 'Which platforms is it for?' },
    smm_services:        { l: 'What help do you need?' },
    ad_platforms:        { l: 'Which platforms do you want to advertise on?' },
    ad_spend:            { l: 'Who pays the ad platform?', o: ['I pay the platform directly', 'The tasker handles the ad spend', 'No preference'] },
    email_services:      { l: 'What help do you need?' },
    email_tools:         { l: 'Which email tool do you already use?', r: false },
    influencer_services: { l: 'What help do you need?' },
    brand_services:      { l: 'What help do you need?' },
    content_formats:     { l: 'What content do you want?' },
    street_types:        { l: 'What do you want done?' },
    promo_team:          { l: 'How many people do you need on the street?' },
    coverage:            { l: 'Where will the promotion take place?', o: HOW_FAR }
  });

  P.laundry = derive('laundry', {
    pickup:            { l: 'How will the laundry get there and back?', o: ['I will drop it off and collect it', 'I need pickup and delivery', 'Either'] },
    coverage:          { l: 'Where should it be picked up and delivered?' },
    turnaround:        { l: 'How soon do you need it back?' },
    methods:           { l: 'How should it be washed?', r: false },
    ironing_items:     { l: 'What needs ironing?' },
    dry_clean_items:   { l: 'What needs dry cleaning?' },
    onsite_machines:   { l: "Do you want it dry cleaned on the tasker's own machines?", r: false },
    bedding_items:     { l: 'What needs cleaning?' },
    stain_types:       { l: 'What kind of stain is it?' },
    no_result_no_fee:  { l: 'Do you only want to pay if the stain comes out?', r: false },
    shoe_services:     { l: 'What do you want done?' },
    shoe_types:        { l: 'What shoes are they?' },
    home_textiles:     { l: 'What needs washing?' },
    business_customers: { l: 'What kind of business are you?', t: 'select' },
    max_kg_per_day:    { l: 'About how much washing a day?' },
    contracts:         { l: 'Do you want a weekly or monthly contract?' },
    item_tags:         { l: 'Do you want each item tagged to avoid mix-ups?' }
  });

  /* ── Batch D (regulated) ─────────────────────────────────────────────────────────────────────────
     A Poster does not hold a licence, so the Tasker's licence_body / licence_number / has_certification / certification_details have no twin.
     Instead the Poster can say they WANT a registered professional (`must_be_registered`, for work that normally needs a licence) or a certified one
     (`must_be_certified`, for the rest). Optional, and nothing is checked against any register (same owner decision as Stage 4d). */
  function mustBeRegistered(subs, label) { var f = { key: 'must_be_registered', label: label || 'Must they be registered or licensed?', type: 'yesno', hint: 'Optional' }; if (subs) f.subs = subs; return f; }
  function mustBeCertified(notSubs) { return { key: 'must_be_certified', label: 'Do you want someone with a relevant certificate or professional membership?', type: 'yesno', notSubs: notSubs, hint: 'Optional' }; }
  var NO_LICENCE = { licence_body: null, licence_number: null, has_certification: null, certification_details: null };
  function withNoLicence(spec) { Object.keys(NO_LICENCE).forEach(function (k) { spec[k] = null; }); return spec; }

  P.professional = derive('professional', withNoLicence({
    work_mode:             { l: 'How do you want to work together?', o: WORK_MODE },
    turnaround:            { l: 'How soon do you need it?', r: false },
    consult_areas:         { l: 'What do you want advice on?' },
    translation_languages: { l: 'Which languages are involved?' },
    certified_translation: { l: 'Do you need a certified translation?' },
    interpretation_types:  { l: 'What is the interpreting for?' },
    writing_types:         { l: 'What do you need written?' },
    cv_services:           { l: 'What do you need?' },
    grant_types:           { l: 'What is the grant for?' },
    tech_writing_types:    { l: 'What do you need written?' },
    architecture_services: { l: 'What do you need?' },
    engineering_fields:    { l: 'Which fields does the job involve?' },
    property_services:     { l: 'What do you need?' },
    hr_services:           { l: 'What do you need?' },
    guidance_focus:        { l: 'What guidance do you need?' }
  }), [mustBeRegistered('@licensed'), mustBeCertified('@licensed')]);

  P.security = derive('security', withNoLicence({
    coverage:          { l: 'Where is it needed?', o: ['In my own city', 'In a different city'] },
    guard_count:       { l: 'How many guards do you need?' },
    guards_trained:    { l: 'Must the guards be trained?', r: false },
    background_checked: { l: 'Must the guards be background-checked?', r: false },
    shifts:            { l: 'Which shifts do you need covered?' },
    access_types:      { l: 'What do you want installed?' },
    monitoring_modes:  { l: 'What monitoring do you need?' },
    cctv_systems:      { l: 'What kind of system do you want?' },
    fire_items:        { l: 'What do you want installed?' },
    inspection_types:  { l: 'What needs inspecting?' },
    written_report:    { l: 'Do you want a written report?', r: false },
    workplace_services: { l: 'What help do you need?' },
    maintenance_types: { l: 'What needs maintaining?' },
    equipment_supply:  { l: 'Who supplies the equipment and parts?', o: ['The tasker supplies them', 'I will supply them', 'No preference'] },
    emergency:         { l: 'Is this an emergency?' }
  }), [mustBeRegistered('@licensed'), mustBeCertified('@licensed')]);

  P.health = derive('health', withNoLicence({
    service_location:  { l: 'Where should it happen?', o: ['At the clinic or studio', 'At my home', 'Online', 'Any of these'] },
    client_groups:     { l: 'Who is it for?', t: 'select', o: ['Adult', 'Child', 'Older person', 'Woman or new mother', 'Athlete'] },
    session_types:     { l: 'What kind of sessions do you want?' },
    fitness_goals:     { l: 'What are your goals?' },
    yoga_styles:       { l: 'Which styles do you want?' },
    nutrition_goals:   { l: 'What are your goals?' },
    written_meal_plans: { l: 'Do you want a written meal plan?', r: false },
    physio_conditions: { l: 'What does it need to treat?' },
    counselling_focus: { l: 'What do you want help with?' },
    confidential:      { l: 'Do you need the sessions kept confidential?', r: false },
    acupuncture_conditions: { l: 'What do you want treated?' },
    chiro_conditions:  { l: 'What do you want treated?' },
    nursing_services:  { l: 'What do you need?' },
    caregiving_services: { l: 'What care do you need?' },
    shift_types:       { l: 'Which shifts do you need?' },
    lactation_services: { l: 'What do you want help with?' },
    first_aid:         { l: 'Do you want someone with first-aid training?', r: false }
  }), [mustBeRegistered('@licensed'), mustBeCertified('@licensed')]);

  P.legal = derive('legal', {
    licence_body:      null,
    licence_number:    null,
    consult_mode:      { l: 'How would you like to meet?', o: ["At the lawyer's office", 'The lawyer visits me', 'Online', 'Any of these'] },
    practice_areas:    { l: 'What area of law is it?', t: 'select' },
    contract_types:    { l: 'What kind of contract is it?' },
    notary_documents:  { l: 'What needs notarising?' },
    mediation_types:   { l: 'What kind of dispute is it?', t: 'select' },
    tenancy_services:  { l: 'What do you need?' },
    land_documents:    { l: 'What do you need handled?' },
    free_first_meeting: { l: 'Would you prefer a free first meeting?' }
  }, [mustBeRegistered(null, 'Must the lawyer be called to the bar?')]);

  P.financial = derive('financial', withNoLicence({
    work_mode:             { l: 'How do you want to work together?', o: WORK_MODE },
    client_types:          { l: 'What kind of client are you?', t: 'select', o: ['Individual', 'Small business', 'Large company', 'NGO or church', 'Start-up'] },
    accounting_software:   { l: 'Which software do you already use?', r: false },
    accounting_services:   { l: 'What do you need?' },
    bookkeeping_frequency: { l: 'How often should the books be updated?' },
    tax_types:             { l: 'Which taxes do you need handled?' },
    planning_areas:        { l: 'What do you want advice on?' },
    consultancy_areas:     { l: 'What do you want advice on?' },
    sells_products:        { l: 'Are you happy for them to also recommend investment or insurance products?', r: false },
    audit_types:           { l: 'What support do you need?' },
    payroll_services:      { l: 'What do you need?' },
    max_employees:         { l: 'How many employees need paying?' },
    nda:                   { l: 'Do you need a confidentiality agreement signed?' }
  }), [mustBeRegistered('@licensed'), mustBeCertified('@licensed')]);


  F.registerAudience('poster', P);
  root.STTaskSchemas = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : this);

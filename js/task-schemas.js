/* ============================================================
   STREETTASKER — task-schemas.js   (Categories Stage 6c, extended in 6d)
   The category questions worded for the person who needs the work done (the Poster), for Post a Task.
   Same engine and same file format as the Tasker questions in js/category-forms.js; load it AFTER that file.
   Groups (which subcategories share a question) are shared with the Tasker side, so both sides always agree on them.

   Saved in tasks.details (jsonb), flat, like services.details:  { "_v": 1, "supplies": "I will provide them", "cleaners_wanted": 2 }
   Keys that mean the same thing on both sides keep the same key (supplies, materials, coverage, same_day...), but the OPTIONS are worded
   for the Poster, so matching a task to a service is a later step (Stage 6d), not a string compare.

   Pilot (Stage 6c): Cleaning, Repairs & Maintenance (handyman), Moving & Delivery (logistics). Batch A (Stage 6d): home_furniture, landscaping, automotive, grooming, fashion. To add another category: copy its Tasker
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

  F.registerAudience('poster', P);
  root.STTaskSchemas = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : this);

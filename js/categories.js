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
    sales: '<path d="M8 22h48l3 36H5z"/><path d="M20 28v-8a12 12 0 0 1 24 0v8" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
    construction: '<path d="M4 46h56v8H4z"/><path d="M10 46c0-15 9-26 22-26s22 11 22 26z"/><path d="M27 12h10v12H27z"/><path d="M30 24h4v22h-4z" fill="var(--color-bg)"/>',
    home_furniture: '<rect x="12" y="14" width="40" height="18" rx="6"/><rect x="4" y="26" width="14" height="24" rx="6"/><rect x="46" y="26" width="14" height="24" rx="6"/><rect x="14" y="34" width="36" height="16" rx="3"/><path d="M12 50h5v8h-5zM47 50h5v8h-5z"/>',
    fashion: '<path d="M22 6L3 16l6 13 8-4v33h30V25l8 4 6-13L42 6c-1 5-5 8-10 8s-9-3-10-8z"/>',
    assistance: '<rect x="10" y="9" width="44" height="52" rx="5"/><rect x="22" y="3" width="20" height="11" rx="3"/><path d="M19 32l6 6 11-12" fill="none" stroke="var(--color-bg)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 50h26" stroke="var(--color-bg)" stroke-width="4" stroke-linecap="round"/>',
    professional: '<path d="M10 60V14l26-9v55z"/><path d="M36 24h18v36H36z"/><path d="M18 18h6v6h-6zM18 30h6v6h-6zM18 42h6v6h-6zM42 32h6v6h-6zM42 44h6v6h-6z" fill="var(--color-bg)"/>',
    security: '<path d="M32 3l23 8v17c0 15-9 27-23 33C18 55 9 43 9 28V11z"/><path d="M20 31l8 8 16-17" fill="none" stroke="var(--color-bg)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>',
    marketing: '<path d="M5 25h15l27-15v44L20 39H5z"/><path d="M20 39l4 19h9l-4-19z"/><path d="M53 24c5 4 5 14 0 18" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
    other: '<path d="M10 54l24-24 8 8-24 24z"/><path d="M40 6a12 12 0 0 0-10 17l-6 6 10 10 6-6A12 12 0 0 0 54 20l-8 4-6-6 4-8z"/>'
  };

  /* One category: C(value, label, short, emoji, subcategories, extra).
     subcategories = "Name|word,word;Name|word" : the words after | are things people type that should find that subcategory
     (plumber finds Plumbing). Each subcategory lives in ONE category; search reaches it from any word that fits.
     Every category also offers "Other (not listed)" (OTHER_SUB), added by the picker, so no service is left without a home. */
  var OTHER_SUB = 'Other (not listed)';
  function C(value, label, short, emoji, subs, extra) {
    var list = subs.split(';').map(function (item) {
      var p = item.split('|');
      return { name: p[0].trim(), words: (p[1] || '').split(',').map(function (w) { return w.trim().toLowerCase(); }).filter(Boolean) };
    }).filter(function (x) { return x.name; });
    var c = { value: value, label: label, short: short, emoji: emoji, subs: list, services: list.map(function (x) { return x.name; }) };
    if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) c[k] = extra[k]; } }
    return c;
  }

  /* value = what is saved on a task or service (old values kept, so saved data still matches). label = what people read. */
  var LIST = [
    C('cleaning',    'Cleaning & Housekeeping',      'Cleaning',     '🧹', 'House Cleaning|cleaner,maid;Deep Cleaning;Office Cleaning;Commercial Cleaning;Post-Construction Cleaning;Move-in / Move-out Cleaning;Carpet Cleaning;Upholstery Cleaning|sofa;Window Cleaning;Housekeeping|house help;Kitchen Cleaning;Bathroom Cleaning|toilet;Fumigation Coordination|fumigation;Waste Removal|refuse,rubbish;Tile & Grout Scrubbing;Mold Remediation|mould;Air Duct Cleaning;Chimney Sweeping'),
    C('handyman',    'Repairs & Maintenance',        'Repairs',      '🛠️', 'Plumbing|plumber,pipe,leak,borehole;Electrical Repairs|electrician,wiring,socket;Appliance Repair;Air Conditioning Repair|ac,hvac,aircon;Generator Repair|generator,gen;Refrigerator Repair|fridge,freezer;Washing Machine Repair;Television Repair|tv;Locksmith|lock,key;Painting|painter,paint;Roofing Repairs|roof,leaking roof;Window Repairs;Door Repairs;Pest Control|cockroach,rat,termite;Water System Repairs|water tank,pump;Solar Installation & Repairs|solar,inverter;Inverter & Battery Services|inverter,ups'),
    C('construction','Building & Construction',     'Construction', '🏗️', 'Masonry|mason;Bricklaying|bricklayer;Carpentry|carpenter,woodwork;Tiling|tiler,tiles;Plastering;POP Installation|pop,ceiling;Roofing;Welding|welder;Plumbing Installation;Electrical Installation;Flooring;Ceiling Installation;Fencing;Gate Installation;Concrete Work|concrete;Structural Repairs;General Labour|labourer,labor;Demolition;Aluminium Fabrication|aluminum,aluminium'),
    C('logistics',   'Moving & Delivery',            'Moving',       '🚚', 'House Moving|movers;Office Relocation;Furniture Moving;Local Delivery;Parcel Delivery;Dispatch Rider|rider,bike;Shopping Delivery;Document Delivery;Heavy Item Transportation|haulage;Loading & Unloading;Packing & Unpacking;Courier Services|courier;Errand Delivery;International Freight Forwarding|freight,shipping;Warehousing|warehouse;Junk Removal;White Glove Delivery;Van & Truck Hire|truck,van'),
    C('sales',       'Sales & Products',             'Sales',        '🛍️', 'Phones & Accessories|phone;Computers & Electronics|laptop;Home Appliances;Fashion & Clothing|clothes;Shoes & Footwear|shoes;Bags & Accessories|bag;Furniture;Home & Kitchen;Beauty & Cosmetics;Personal Care Products;Food & Groceries|snacks;Drinks & Beverages;Sports & Fitness Equipment;Books & Stationery;Toys & Games;Baby Products;Building Materials;Automotive Parts|spare parts;Agricultural Products|farm;Handmade Products|crafts;Other Products', { sellers: true }),
    C('creative',    'Design & Creative',            'Design',       '🎨', 'Graphic Design|graphics,flyer;Logo Design|logo;UI/UX Design|ui,ux;Web Design;App Design;Illustration;Branding & Identity|brand;Motion Graphics;Video Editing;Animation;Photo Editing|photoshop;Social Media Design;Presentation Design|slides;Printing & Artwork|print;3D Design|3d;Product Design;Content Creation|content creator;Voiceover Recording|voice over'),
    C('it_tech',     'Technology & IT',              'IT & Tech',    '💻', 'Computer Support;Laptop Repair;Phone Repair|screen;Software Installation;Software Development|developer,programmer;Website Development|website,web developer;IT Support;Network Installation|wifi,router;Data Recovery;Database Management;Cybersecurity Services|cyber;Hardware Installation;Smart Home Installation;Technical Troubleshooting;Cloud & Server Management'),
    C('events',      'Events & Entertainment',       'Events',       '🎉', 'Event Planning|planner;Event Coordination;Event Decoration|decor;Photography|photographer;Videography|videographer;DJs|dj;MCs & Hosts|mc,host,emcee;Live Music|band;Performers|dancer,comedian;Ushers;Event Setup;Equipment Rental|canopy,chairs,tent;Sound Engineering|sound;Lighting;Wedding Services|wedding;Party Planning|birthday;Event Staffing;Venue Rental|hall;Floral Design|flowers'),
    C('grooming',    'Beauty & Personal Care',       'Beauty',       '💈', 'Hair Styling|hairdresser,stylist;Hair Braiding|braids,braider;Barbing|barber,haircut;Makeup Artistry|makeup,mua;Nail Technology|nails;Manicure & Pedicure;Skincare Services|facial;Massage Therapy|massage;Personal Grooming;Eyelash Extensions|lashes;Eyebrow Services|brows;Wig Making|wig;Hair Treatment;Spa Services|spa;Body Waxing;Hair Colouring|dye'),
    C('education',   'Education & Lessons',          'Education',    '🎓', 'Academic Tutoring|tutor;Mathematics Lessons|maths;English Lessons;Science Lessons;Language Lessons|french,yoruba;Computer Training;Music Lessons;Instrument Lessons|piano,guitar;Dance Lessons;Art Lessons;Exam Preparation|jamb,waec,neco;Professional Training;Skill Development;Coding Lessons|coding;Driving Lessons|driving;Online Tutoring;Career Coaching;Corporate Skill Training'),
    C('landscaping', 'Gardening & Outdoor',          'Gardening',    '🌿', 'Gardening|gardener;Landscaping;Lawn Mowing|grass;Tree Trimming|tree;Plant Care;Garden Design;Irrigation Installation;Outdoor Cleaning;Hedge Trimming;Weed Removal;Garden Maintenance;Pool Cleaning|swimming pool;Outdoor Decoration;Pressure Washing;Paving & Hardscaping|interlock;Gutter Cleaning'),
    C('automotive',  'Automotive Services',          'Automotive',   '🚗', 'Car Mechanic|mechanic;Auto Electrician;Car Wash;Car Detailing;Car Body Work|panel beater;Vehicle Diagnostics;Tyre Replacement|tire,vulcanizer;Battery Replacement;Vehicle Towing|towing;Motorcycle Repair|bike repair;Vehicle Servicing|oil change;Car Air Conditioning Repair;Auto Parts Installation;Vehicle Inspection;Car Interior Cleaning;Windscreen Repair|windshield;Vehicle Wrapping;Roadside Assistance'),
    C('home_furniture','Home & Furniture',          'Home',         '🛋️', 'Furniture Assembly;Furniture Repair;Interior Decoration;Interior Design;Wall Mounting;TV Installation|tv mount;Curtain Installation|curtains;Blind Installation|blinds;Shelf Installation;Cabinet Installation;Upholstery|upholsterer;Home Organisation|organiser,declutter;Wallpaper Installation;Home Automation;Home Improvement'),
    C('business',    'Business & Administration',    'Business',     '💼', 'Virtual Assistant|va;Data Entry;Administrative Assistant|secretary;Business Research;Market Research;Customer Support;Email Management;Document Preparation;Transcription|transcriber;Project Coordination;Spreadsheet Management|excel;Office Assistance;Recruitment Assistance|recruiter,hiring;Business Registration|cac'),
    C('fashion',     'Fashion & Tailoring',          'Fashion',      '👗', 'Tailoring|tailor,seamstress;Fashion Design|fashion designer;Clothing Alterations|alteration;Dressmaking;Suit Making;Traditional Wear|native,aso ebi;Bridal Wear;Clothing Repairs;Embroidery;Shoe Repair|cobbler;Bag Repair;Fashion Styling;Pattern Making;Beadwork'),
    C('pet',         'Pet Services',                 'Pets',         '🐾', 'Pet Sitting;Dog Walking;Pet Grooming;Pet Feeding;Pet Boarding;Pet Transportation;Basic Pet Training|dog training;Aquarium Maintenance|fish tank;Pet Photography;Veterinary Care|vet;Mobile Vet Care'),
    C('assistance',  'Personal Assistance & Errands','Errands',      '🧾', 'Personal Shopping;Grocery Shopping|groceries;Errand Running|errand;Queue Assistance|queue;Personal Assistant|pa;Home Assistance;Document Collection;Document Submission;Appointment Assistance;Elderly Assistance|elderly;Event Assistance;Local Guide|guide;Waiting Services'),
    C('professional','Professional Services',       'Professional', '🏢', 'Business Consultancy|consultant;Translation|translator;Interpretation|interpreter;Professional Writing|writer;CV & Resume Writing|cv,resume;Grant Writing;Technical Writing;Architecture|architect;Engineering Consultancy|engineer;Property Consultancy|estate agent,surveyor;HR Consultancy;Career Guidance'),
    C('hospitality', 'Food & Catering',              'Food',         '🥂', 'Catering|caterer;Private Chef|chef;Home Cooking|cook;Meal Preparation|meal prep;Baking|baker;Cake Making|cakes;Small Chops;Food Supply;Bartending|bartender;Wait Staff|waiter,waitress;Kitchen Assistance;Food Delivery;Event Catering;Pastry Making'),
    C('security',    'Security & Safety',            'Security',     '🛡️', 'Event Security|bouncer;Security Guard Services|guard;Access Control;CCTV Monitoring;CCTV Installation|cctv,camera;Fire Safety Equipment Installation|fire extinguisher;Safety Inspection;Workplace Safety Assistance;Security System Maintenance|alarm'),
    C('laundry',     'Laundry & Dry Cleaning',       'Laundry',      '🧺', 'Wash & Fold|washing;Laundry & Ironing|iron;Ironing & Pressing;Dry Cleaning;Laundry Pickup & Delivery;Duvet & Bedding Cleaning;Stain Removal;Shoe & Sneaker Cleaning|sneakers;Curtain & Rug Washing;Bulk & Business Laundry'),
    C('health',      'Health & Wellness',            'Health',       '❤️', 'Personal Fitness Training|personal trainer,gym,fitness;Nutrition Coaching|nutritionist,dietitian;Physiotherapy|physio;Mental Health Counselling|counsellor,therapist;Acupuncture;Chiropractic Care;Nursing Assistance|nurse;Caregiving & Home Care|caregiver;Lactation Consulting;Yoga Instruction|yoga'),
    C('financial',   'Financial Services',           'Financial',    '🧮', 'Accounting|accountant;Bookkeeping|bookkeeper;Tax Preparation|tax;Financial Planning;Financial Consultancy;Audit Support|audit;Payroll Processing|payroll'),
    C('legal',       'Legal & Advocacy',             'Legal',        '⚖️', 'Legal Consultation|lawyer;Contract Drafting & Review|contract;Document Notarisation|notary;Dispute Mediation|mediation;Tenancy Agreements;Land & Property Documents|land title'),
    C('marketing',   'Marketing & Advertising',      'Marketing',    '📣', 'Copywriting|copywriter;Search Engine Optimisation|seo;Social Media Management|social media;Brand Strategy;Digital Advertising|ads;Email Marketing;Influencer Marketing|influencer;Content Marketing;Promotions & Street Marketing|flyer distribution'),
    C('other',       'Other',                        'Other',        '🛠️', '')
  ];

  /* Values saved before this list existed (and common free-text) -> the group they belong to */
  var ALIASES = {
    electrician: 'handyman', electrical: 'handyman', plumber: 'handyman', plumbing: 'handyman', painting: 'handyman', painter: 'handyman',
    repairs: 'handyman', repair: 'handyman', maintenance: 'handyman', appliance: 'handyman', handyman: 'handyman', trades: 'handyman', assembly: 'handyman',
    carpentry: 'construction', carpenter: 'construction', mason: 'construction', bricklayer: 'construction', tiler: 'construction', welder: 'construction', builder: 'construction', building: 'construction',
    barber: 'grooming', beauty: 'grooming', makeup: 'grooming', hair: 'grooming', nails: 'grooming', salon: 'grooming', personalcare: 'grooming',
    mechanic: 'automotive', auto: 'automotive', car: 'automotive',
    moving: 'logistics', delivery: 'logistics', courier: 'logistics', freight: 'logistics', dispatch: 'logistics',
    gardening: 'landscaping', lawn: 'landscaping', garden: 'landscaping', outdoor: 'landscaping',
    cleaner: 'cleaning', housekeeping: 'cleaning',
    laundromat: 'laundry', dryclean: 'laundry', drycleaning: 'laundry', ironing: 'laundry', washing: 'laundry',
    cooking: 'hospitality', chef: 'hospitality', catering: 'hospitality', food: 'hospitality', foodcatering: 'hospitality',
    photography: 'events', photographer: 'events', entertainment: 'events', wedding: 'events', eventplanning: 'events',
    security: 'security', guard: 'security', safety: 'security',
    tutoring: 'education', tutor: 'education', lesson: 'education', lessons: 'education',
    tech: 'it_tech', it: 'it_tech', software: 'it_tech', technology: 'it_tech',
    design: 'creative', graphics: 'creative',
    marketing: 'marketing', advertising: 'marketing',
    accounting: 'financial', finance: 'financial', tax: 'financial',
    lawyer: 'legal', law: 'legal',
    tailor: 'fashion', tailoring: 'fashion', seamstress: 'fashion', fashiondesigner: 'fashion',
    errands: 'assistance', errand: 'assistance', personalassistant: 'assistance', personalshopping: 'assistance',
    consultant: 'professional', consulting: 'professional', translator: 'professional', architect: 'professional', engineer: 'professional',
    furniture: 'home_furniture', interior: 'home_furniture', homeimprovement: 'home_furniture', upholstery: 'home_furniture',
    administration: 'business', admin: 'business',
    petcare: 'pet', pets: 'pet', fitness: 'health', wellness: 'health', nurse: 'health', physio: 'health', event: 'events'
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
    it_tech:     ['website', 'web site', 'web develop', 'web design', 'app develop', 'mobile app', 'software', 'laptop', 'computer', 'pc!', 'phone repair', 'screen repair', 'wifi', 'wi-fi', 'router', 'network', 'cyber', 'data recovery', 'install windows', 'programmer', 'developer', 'wordpress', 'tech support', 'printer', 'it support', 'hosting', 'domain name'],
    creative:    ['logo!', 'graphic', 'flyer', 'branding', 'copywrit', 'social media', 'seo!', 'video edit', 'animation', 'illustrat', 'voiceover', 'voice over', 'content writ', 'poster', 'banner', '3d model', 'photo edit', 'photoshop', 'canva', 'jingle'],
    logistics:   ['moving', 'move my', 'relocat', 'dispatch', 'courier', 'deliver', 'pick up', 'pickup', 'haulage', 'freight', 'truck', 'van hire', 'luggage', 'parcel', 'junk removal', 'warehous', 'carry my', 'shipping', 'bike rider', 'errand'],
    health:      ['physio', 'fitness', 'personal trainer', 'gym!', 'nurse!', 'nursing', 'therap', 'nutrition', 'dietitian', 'diet plan', 'counsel', 'caregiver', 'elderly care', 'midwife', 'lactation', 'yoga', 'blood pressure', 'injection', 'home care', 'workout'],
    pet:         ['dog!', 'puppy', 'puppies', 'cat!', 'kitten', 'pet!', 'vet!', 'veterinar', 'walk my dog', 'aquarium', 'fish tank', 'pet groom', 'pet sit', 'parrot'],
    education:   ['tutor', 'lesson', 'teach', 'maths', 'mathematics', 'english class', 'jamb', 'waec', 'neco', 'ielts', 'exam prep', 'coaching class', 'learn to', 'driving lesson', 'driving school', 'piano', 'guitar', 'homework', 'french class', 'coding class', 'music lesson'],
    financial:   ['accountant', 'accounting', 'bookkeep', 'tax!', 'tax return', 'audit', 'financial plan', 'invoic', 'payroll', 'vat!', 'financial statement'],
    legal:       ['lawyer', 'solicitor', 'barrister', 'legal', 'contract!', 'agreement!', 'notar', 'affidavit', 'court!', 'tenancy agreement', 'land title', 'will drafting', 'mediation', 'litigation', 'power of attorney', 'attorney'],
    events:      ['event!', 'event planner', 'wedding', 'party', 'parties', 'photograph', 'videograph', 'dj!', 'mc!', 'decor', 'bridal', 'birthday', 'usher', 'sound system', 'canopy', 'tent!', 'chairs for', 'live band', 'anniversary', 'burial', 'naming ceremony']
,
    construction:['mason!', 'bricklay', 'tiling', 'tiler', 'plaster', 'pop ceiling', 'welding', 'welder', 'concrete', 'foundation', 'demolition', 'fencing', 'screeding', 'building work', 'construction', 'aluminium', 'aluminum'],
    home_furniture: ['furniture assembly', 'assemble my', 'wall mount', 'mount my tv', 'tv bracket', 'curtain!', 'blinds', 'wallpaper', 'interior design', 'upholster', 'shelf install', 'shelves', 'wardrobe install'],
    fashion:     ['tailor', 'seamstress', 'dressmak', 'sew!', 'sewing', 'alteration', 'ankara', 'aso ebi', 'asoebi', 'embroider', 'beadwork', 'fashion design', 'shoe repair', 'cobbler'],
    assistance:  ['errand!', 'personal shopper', 'queue for me', 'stand in line', 'grocery shopping', 'personal assistant', 'collect my document', 'run an errand', 'elderly assist'],
    professional:['architect', 'surveyor', 'cv writing', 'resume writing', 'grant writ', 'technical writ', 'engineering consult', 'property consult', 'career guidance', 'professional writ'],
    security:    ['security guard', 'bouncer', 'bodyguard', 'cctv', 'access control', 'fire extinguisher', 'fire safety', 'safety inspection', 'alarm system', 'security system', 'guard!'],
    marketing:   ['marketing', 'advert', 'influencer', 'email campaign', 'brand strateg', 'promotion!', 'flyer distribution', 'google ads', 'facebook ads', 'instagram ads']
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


  /* ── Search for the category picker ────────────────────────────────────────────────────────────────────────
     search("plumber") -> [{ value: 'handyman', label: 'Repairs & Maintenance', sub: 'Plumbing', score }, ...]
     Looks at subcategory names, the extra words listed after | in each subcategory, and category names.
     A typed word matches the START of a word ("plumb" finds Plumbing); endings like -er, -ers, -ing are also tried
     ("plumber" -> "plumb"). Every typed word must match. Best match first. opts.sellers = false hides Sales. */
  function norm(s) { return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function variants(w) {
    var out = [w];
    ['ers', 'er', 'ing', 'ian', 'ist', 'or', 's'].forEach(function (suf) {
      if (w.length - suf.length >= 3 && w.slice(-suf.length) === suf) out.push(w.slice(0, -suf.length));
    });
    return out;
  }
  function wordHit(targetWords, vars) {
    for (var i = 0; i < targetWords.length; i++) for (var j = 0; j < vars.length; j++) if (targetWords[i].indexOf(vars[j]) === 0) return true;
    return false;
  }
  function allTokensHit(tokens, text) {
    var words = norm(text).split(' ');
    for (var t = 0; t < tokens.length; t++) if (!wordHit(words, variants(tokens[t]))) return false;
    return true;
  }
  function search(query, opts) {
    var q = norm(query), out = [];
    if (!q) return out;
    var tokens = q.split(' ').filter(function (t) { return t.length > 0; });
    var withSales = !(opts && opts.sellers === false);
    LIST.forEach(function (c, order) {
      if (c.sellers && !withSales) return;
      if (c.value === 'other') return;
      var catScore = 0;
      if (norm(c.label) === q || norm(c.short) === q) catScore = 90;
      else if (norm(c.label).indexOf(q) === 0 || norm(c.short).indexOf(q) === 0) catScore = 70;
      else if (allTokensHit(tokens, c.label + ' ' + c.short)) catScore = 45;
      if (catScore) out.push({ value: c.value, label: c.label, sub: null, score: catScore, order: order });
      c.subs.forEach(function (sub) {
        var n = norm(sub.name), score = 0;
        if (n === q) score = 100;
        else if (n.indexOf(q) === 0) score = 85;
        else if (allTokensHit(tokens, sub.name)) score = 65;
        else if (sub.words.some(function (w) { return allTokensHit(tokens, w); })) score = 60;
        else if (tokens.length > 1 && allTokensHit(tokens, sub.name + ' ' + sub.words.join(' ') + ' ' + c.label)) score = 40;
        if (score) out.push({ value: c.value, label: c.label, sub: sub.name, score: score, order: order });
      });
    });
    /* nothing by name: fall back to the keyword detector the "Other" box uses (it knows full phrases) */
    if (!out.length) {
      var g = detect(query, '');
      if (!g) { g = detect('', query); }
      if (g && BY[g] && !(BY[g].sellers && !withSales)) out.push({ value: g, label: BY[g].label, sub: null, score: 20, order: LIST.indexOf(BY[g]) });
    }
    out.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
    return out.slice(0, 12);
  }

  /* subcategory names of a category, ending with "Other (not listed)" (Other itself has none) */
  function subsOf(value) {
    var c = resolve(value);
    if (c.value === 'other') return [];
    return c.subs.map(function (x) { return x.name; }).concat([OTHER_SUB]);
  }

  root.STCat = {
    detect: detect,
    search: search,
    subsOf: subsOf,
    OTHER_SUB: OTHER_SUB,
    popular: ['cleaning', 'handyman', 'logistics', 'grooming', 'hospitality', 'fashion', 'automotive', 'sales'],
    expand: expand,
    list: LIST.filter(function (c) { return !c.sellers; }),   /* task side: no Sales */
    serviceList: LIST,                                         /* service side: with Sales */
    icons: I, resolve: resolve, matches: matches, iconHtml: iconHtml,
    get: function (v) { return resolve(v); },
    label: function (v) { return resolve(v).label; },
    emoji: function (v) { return resolve(v).emoji; },
    /* <option> markup for a <select> */
    optionsHtml: function () { return LIST.filter(function (c) { return !c.sellers; }).map(function (c) { return '<option value="' + c.value + '">' + c.label + '</option>'; }).join(''); }
  };
})(window);

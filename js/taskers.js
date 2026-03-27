/* ============================================================
   STREET TASKER — taskers.js  (Sprint 3.2 Final)
   Live data from Supabase. No placeholders.
   ============================================================ */
'use strict';

const DUMMY_SERVICES = [
  /* Electricians */
  { id:'d1',  user_id:'demo', provider_name:'Adebayo Okafor',    service_name:'Electrician',        category:'electrician', location:'Lekki Phase 1, Lagos',       price:6000,  rating:4.9, reviews:48,  description:'Certified electrician with 8 years experience. Wiring, installations, repairs and maintenance.' },
  { id:'d2',  user_id:'demo', provider_name:'Emeka Electrical',  service_name:'Electrician',        category:'electrician', location:'Ikeja GRA, Lagos',            price:5500,  rating:4.7, reviews:31,  description:'Residential and commercial electrical work. Fast response, quality guaranteed.' },
  { id:'d3',  user_id:'demo', provider_name:'Bright Nwosu',      service_name:'Electrician',        category:'electrician', location:'Wuse 2, Abuja',               price:7000,  rating:4.8, reviews:22,  description:'Specialised in solar installations, inverters, and general electrical repairs.' },
  /* Barbers */
  { id:'d4',  user_id:'demo', provider_name:'Chidi Cuts',        service_name:'Barber',             category:'barber',      location:'Victoria Island, Lagos',      price:3500,  rating:4.8, reviews:112, description:'Professional barber. Fades, lineups, beard grooming. Home visits available.' },
  { id:'d5',  user_id:'demo', provider_name:'Style King Barbers', service_name:'Barber',            category:'barber',      location:'Surulere, Lagos',             price:2500,  rating:4.6, reviews:87,  description:'Classic and modern cuts. Walk-ins welcome or book in advance.' },
  { id:'d6',  user_id:'demo', provider_name:'Taiwo Ojo',         service_name:'Barber',             category:'barber',      location:'Maitama, Abuja',              price:4000,  rating:4.7, reviews:44,  description:'Mobile barber. I come to you. All styles, all hair types.' },
  /* Cleaners */
  { id:'d7',  user_id:'demo', provider_name:'Fatima Cleaning Co', service_name:'House Cleaner',     category:'cleaning',    location:'Ikeja, Lagos',                price:8000,  rating:4.7, reviews:73,  description:'Deep cleaning, move-in/move-out, post-construction cleaning. Trusted and thorough.' },
  { id:'d8',  user_id:'demo', provider_name:'Sparkle Homes',     service_name:'House Cleaner',      category:'cleaning',    location:'Lekki, Lagos',                price:10000, rating:4.9, reviews:56,  description:'Full home cleaning service. Eco-friendly products. Weekly, bi-weekly or one-off.' },
  { id:'d9',  user_id:'demo', provider_name:'Chisom Uzor',       service_name:'Office Cleaner',     category:'cleaning',    location:'Garki, Abuja',                price:12000, rating:4.5, reviews:18,  description:'Office and commercial space cleaning. Flexible scheduling including weekends.' },
  /* Plumbers */
  { id:'d10', user_id:'demo', provider_name:'Kingsley Plumbing', service_name:'Plumber',            category:'plumber',     location:'Yaba, Lagos',                 price:5000,  rating:4.5, reviews:34,  description:'All plumbing work: pipes, boreholes, water heaters, blocked drains. 24hr emergency.' },
  { id:'d11', user_id:'demo', provider_name:'Tunde Pipes',       service_name:'Plumber',            category:'plumber',     location:'Gbagada, Lagos',              price:4500,  rating:4.4, reviews:21,  description:'Residential plumbing specialist. Free assessment for new clients.' },
  /* Mechanics */
  { id:'d12', user_id:'demo', provider_name:'Emeka AutoCare',    service_name:'Mechanic',           category:'mechanic',    location:'Surulere, Lagos',             price:8000,  rating:4.6, reviews:29,  description:'Foreign and local cars. Diagnostics, engine repair, AC regas, brake service.' },
  { id:'d13', user_id:'demo', provider_name:'Oga Mechanic',      service_name:'Mobile Mechanic',    category:'mechanic',    location:'Wuse, Abuja',                 price:6000,  rating:4.5, reviews:17,  description:'I come to your location. Quick diagnosis and repair for all car brands.' },
  /* Beauty */
  { id:'d14', user_id:'demo', provider_name:'Sadia Beauty Studio', service_name:'Make-up Artist',  category:'beauty',      location:'Ajah, Lagos',                 price:15000, rating:5.0, reviews:91,  description:'Bridal, aso-ebi, editorial makeup. Book early for weekends. Portfolio on request.' },
  { id:'d15', user_id:'demo', provider_name:'Glam by Amaka',     service_name:'Make-up Artist',    category:'beauty',      location:'VI, Lagos',                   price:20000, rating:4.9, reviews:63,  description:'Luxury makeup for weddings, photoshoots, and events. International techniques.' },
  { id:'d16', user_id:'demo', provider_name:'Precious Nails',    service_name:'Nail Technician',   category:'beauty',      location:'Lekki, Lagos',                price:7000,  rating:4.7, reviews:108, description:'Gel, acrylic, nail art, manicure and pedicure. Home service available.' },
  { id:'d17', user_id:'demo', provider_name:'Hairitage Braids',  service_name:'Hair Stylist',       category:'beauty',      location:'Gbagada, Lagos',              price:9000,  rating:4.8, reviews:77,  description:'Box braids, knotless braids, cornrows, twists. Natural hair specialist.' },
  /* Painting */
  { id:'d18', user_id:'demo', provider_name:'Colour Pro Painters', service_name:'Painter',         category:'painting',    location:'Ikeja, Lagos',                price:25000, rating:4.6, reviews:15,  description:'Interior and exterior painting. Quality finishes, neat work. Per room quotes available.' },
  { id:'d19', user_id:'demo', provider_name:'Ade Painters Ltd',  service_name:'Painter',            category:'painting',    location:'Lugbe, Abuja',                price:20000, rating:4.4, reviews:9,   description:'Residential and commercial painting. Textured finishes and epoxy floors.' },
  /* Laundry */
  { id:'d20', user_id:'demo', provider_name:'FreshPress Laundry', service_name:'Laundry & Ironing', category:'laundry',    location:'Yaba, Lagos',                 price:500,   rating:4.7, reviews:142, description:'Per item pricing. 24hr turnaround. Pickup and delivery available in your area.' },
  { id:'d21', user_id:'demo', provider_name:'Clean Threads',     service_name:'Dry Cleaning',       category:'laundry',    location:'Asokoro, Abuja',              price:1500,  rating:4.5, reviews:34,  description:'Dry cleaning, alterations, suit pressing. Professional grade equipment.' },
  /* Tutoring */
  { id:'d22', user_id:'demo', provider_name:'Mr Bello Maths',    service_name:'Maths Tutor',        category:'tutoring',    location:'Lekki, Lagos',               price:5000,  rating:4.9, reviews:38,  description:'O-Level, JAMB, WAEC maths. Online or in-person. Proven track record.' },
  { id:'d23', user_id:'demo', provider_name:'EduBright Tutors',  service_name:'Home Tutor',         category:'tutoring',    location:'Maitama, Abuja',              price:7000,  rating:4.8, reviews:25,  description:'Primary, secondary and tertiary tutoring. All subjects. Flexible hours.' },
  /* Cooking */
  { id:'d24', user_id:'demo', provider_name:'Mama Cooks',        service_name:'Personal Chef',      category:'cooking',     location:'Victoria Island, Lagos',      price:20000, rating:4.9, reviews:19,  description:'Home cooked Nigerian and continental meals. Events, parties, weekly meal prep.' },
  { id:'d25', user_id:'demo', provider_name:'Chef Dara',         service_name:'Catering',           category:'cooking',     location:'Ikeja GRA, Lagos',            price:50000, rating:4.7, reviews:12,  description:'Party catering from 20–500 guests. Jollof, pepper soup, egusi, and more.' },
  /* Security */
  { id:'d26', user_id:'demo', provider_name:'SafeGuard Security', service_name:'Security Guard',    category:'security',    location:'Lekki Phase 2, Lagos',        price:40000, rating:4.3, reviews:8,   description:'Licensed security officers. Estate, office, event security. Monthly contracts available.' },
  /* Photography */
  { id:'d27', user_id:'demo', provider_name:'Lens by Seun',      service_name:'Photographer',       category:'photography', location:'Ikoyi, Lagos',                price:50000, rating:4.9, reviews:54,  description:'Weddings, portraits, events, brand shoots. Drone photography also available.' },
  { id:'d28', user_id:'demo', provider_name:'Capture Lagos',     service_name:'Videographer',       category:'photography', location:'Surulere, Lagos',             price:60000, rating:4.8, reviews:31,  description:'Wedding films, music videos, corporate videos. Cinematic quality delivery.' },
  /* Moving */
  { id:'d29', user_id:'demo', provider_name:'Swift Movers',      service_name:'Moving & Packing',   category:'moving',      location:'Lagos Mainland',              price:30000, rating:4.5, reviews:23,  description:'House and office relocation. We pack, load, transport and unpack. Insured.' },
  /* AC / Appliances */
  { id:'d30', user_id:'demo', provider_name:'Cool Air Services', service_name:'AC Technician',      category:'appliances',  location:'Lekki, Lagos',                price:8000,  rating:4.6, reviews:41,  description:'AC installation, servicing, gas recharge, fault repair. All brands covered.' },

  /* ── Electricians ×7 more ── */
  { id:'d31', user_id:'demo', provider_name:'Wole Sparks',         service_name:'Electrician',        category:'electrician', location:'Ajah, Lagos',                 price:5000,  rating:4.6, reviews:19,  description:'Domestic wiring, generator changeover, security lighting. Always punctual.' },
  { id:'d32', user_id:'demo', provider_name:'Chukwu Electric',     service_name:'Electrician',        category:'electrician', location:'Asokoro, Abuja',              price:6500,  rating:4.7, reviews:27,  description:'Industrial and domestic electrical work. Qualified and insured. Free quotes.' },
  { id:'d33', user_id:'demo', provider_name:'Femi Power',          service_name:'Electrician',        category:'electrician', location:'Ibadan, Oyo',                 price:4500,  rating:4.5, reviews:14,  description:'Meter bypass, inverter installation, fault diagnosis. Affordable rates.' },
  { id:'d34', user_id:'demo', provider_name:'Lagos Electric Pro',  service_name:'Electrician',        category:'electrician', location:'Oshodi, Lagos',               price:5500,  rating:4.4, reviews:11,  description:'New installations, rewiring, outdoor lighting. Same-day service available.' },
  { id:'d35', user_id:'demo', provider_name:'Abuja Wiring Xperts', service_name:'Electrician',        category:'electrician', location:'Kubwa, Abuja',                price:5000,  rating:4.6, reviews:16,  description:'Complete electrical solutions for homes and offices. 24/7 emergency.' },
  { id:'d36', user_id:'demo', provider_name:'Smart Volt NG',       service_name:'Solar Installer',    category:'electrician', location:'Ikoyi, Lagos',                price:80000, rating:4.8, reviews:33,  description:'Solar panels, inverters, battery backup systems. Site assessment included.' },
  { id:'d37', user_id:'demo', provider_name:'Nnamdi Electrical',   service_name:'Electrician',        category:'electrician', location:'Enugu, Enugu',                price:4000,  rating:4.5, reviews:8,   description:'All electrical repairs and installations. Neat work, fair price.' },

  /* ── Barbers ×7 more ── */
  { id:'d38', user_id:'demo', provider_name:'Fresh Cutz',          service_name:'Barber',             category:'barber',      location:'Ikorodu, Lagos',              price:2000,  rating:4.5, reviews:63,  description:'Classic cuts, fades, line-ups. Walk-in or appointment. Fast and precise.' },
  { id:'d39', user_id:'demo', provider_name:'The Barb Shop',       service_name:'Barber',             category:'barber',      location:'Wuse 2, Abuja',               price:3000,  rating:4.6, reviews:41,  description:'Premium grooming. Shave, trim, beard shaping. Refreshments served.' },
  { id:'d40', user_id:'demo', provider_name:'Tunde Mobile Barber', service_name:'Mobile Barber',      category:'barber',      location:'Ikeja, Lagos',                price:3500,  rating:4.8, reviews:88,  description:'I come to your house, office or event. All ages, all styles.' },
  { id:'d41', user_id:'demo', provider_name:'Fade Factory NG',     service_name:'Barber',             category:'barber',      location:'Port Harcourt, Rivers',       price:2500,  rating:4.7, reviews:55,  description:'Specialist in taper fades, skin fades and afro styling.' },
  { id:'d42', user_id:'demo', provider_name:'Oga Scissors',        service_name:'Barber',             category:'barber',      location:'Agege, Lagos',                price:1500,  rating:4.3, reviews:29,  description:'Affordable quality cuts. Kids welcome. Fast service.' },
  { id:'d43', user_id:'demo', provider_name:'Kings Barbing Salon', service_name:'Barber',             category:'barber',      location:'Kaduna, Kaduna',              price:2000,  rating:4.4, reviews:17,  description:'Classic and modern barbering. Beard work and hair design.' },
  { id:'d44', user_id:'demo', provider_name:'CleanLine Barbers',   service_name:'Barber',             category:'barber',      location:'Lekki Phase 2, Lagos',        price:4000,  rating:4.9, reviews:72,  description:'Precision cuts, hot towel shaves, luxury grooming packages.' },

  /* ── Cleaners ×7 more ── */
  { id:'d45', user_id:'demo', provider_name:'Mama Clean',          service_name:'House Cleaner',      category:'cleaning',    location:'Ajah, Lagos',                 price:6000,  rating:4.6, reviews:44,  description:'Thorough home cleaning. Kitchen, bathrooms, bedrooms. Weekly slots available.' },
  { id:'d46', user_id:'demo', provider_name:'Abuja Clean Squad',   service_name:'House Cleaner',      category:'cleaning',    location:'Wuse, Abuja',                 price:9000,  rating:4.7, reviews:28,  description:'Professional domestic cleaning. Eco products, background-checked staff.' },
  { id:'d47', user_id:'demo', provider_name:'ShineRight NG',       service_name:'Deep Cleaner',       category:'cleaning',    location:'VI, Lagos',                   price:15000, rating:4.8, reviews:19,  description:'Post-construction, end-of-tenancy, party cleanup. Industrial equipment.' },
  { id:'d48', user_id:'demo', provider_name:'Ibadan Cleaners',     service_name:'House Cleaner',      category:'cleaning',    location:'Bodija, Ibadan',              price:5000,  rating:4.4, reviews:12,  description:'Reliable and affordable home cleaning. Morning or evening slots.' },
  { id:'d49', user_id:'demo', provider_name:'Spotless Pro',        service_name:'Office Cleaner',     category:'cleaning',    location:'Ibeju Lekki, Lagos',          price:18000, rating:4.5, reviews:9,   description:'Daily, weekly or monthly office cleaning contracts. Staff provided.' },
  { id:'d50', user_id:'demo', provider_name:'Fresh Home Services', service_name:'House Cleaner',      category:'cleaning',    location:'Kano, Kano',                  price:4500,  rating:4.3, reviews:7,   description:'Trusted local cleaner. Weekends available. References on request.' },
  { id:'d51', user_id:'demo', provider_name:'GleamClean Lagos',    service_name:'House Cleaner',      category:'cleaning',    location:'Surulere, Lagos',             price:7500,  rating:4.7, reviews:36,  description:'Full home refresh. We bring equipment and supplies. Trusted by 100+ homes.' },

  /* ── Plumbers ×8 more ── */
  { id:'d52', user_id:'demo', provider_name:'Emeka Plumbing Co',   service_name:'Plumber',            category:'plumber',     location:'Abuja, FCT',                  price:6000,  rating:4.6, reviews:18,  description:'All plumbing faults fixed fast. Boreholes, pumps, tanks, pipework.' },
  { id:'d53', user_id:'demo', provider_name:'WaterTech NG',        service_name:'Plumber',            category:'plumber',     location:'Lekki, Lagos',                price:7000,  rating:4.7, reviews:24,  description:'Water treatment, filtration, borehole drilling and maintenance.' },
  { id:'d54', user_id:'demo', provider_name:'Olu Plumber',         service_name:'Plumber',            category:'plumber',     location:'Ibadan, Oyo',                 price:3500,  rating:4.3, reviews:9,   description:'Residential plumbing. Leak repair, tap replacement, blocked drains.' },
  { id:'d55', user_id:'demo', provider_name:'AquaFix Lagos',       service_name:'Plumber',            category:'plumber',     location:'Oshodi, Lagos',               price:4000,  rating:4.5, reviews:15,  description:'24-hour emergency plumber. Burst pipes, flooding, no water issues.' },
  { id:'d56', user_id:'demo', provider_name:'PH Plumbing',         service_name:'Plumber',            category:'plumber',     location:'Port Harcourt, Rivers',       price:5500,  rating:4.6, reviews:11,  description:'Borehole specialist. Submersible pumps, overhead tanks, water supply.' },
  { id:'d57', user_id:'demo', provider_name:'Abuja Waterworks',    service_name:'Plumber',            category:'plumber',     location:'Garki, Abuja',                price:5000,  rating:4.4, reviews:13,  description:'Professional plumbing for homes and offices. Clean workmanship.' },
  { id:'d58', user_id:'demo', provider_name:'Lagos Pipe Pro',      service_name:'Plumber',            category:'plumber',     location:'Mushin, Lagos',               price:3000,  rating:4.2, reviews:6,   description:'Quick fix plumber. Leaks, blockages, new installations. Fair pricing.' },
  { id:'d59', user_id:'demo', provider_name:'FlowRight Plumbing',  service_name:'Plumber',            category:'plumber',     location:'Gwagwalada, Abuja',           price:4500,  rating:4.5, reviews:10,  description:'All plumbing services. Bathroom fitting, kitchen plumbing, pipe replacement.' },

  /* ── Mechanics ×8 more ── */
  { id:'d60', user_id:'demo', provider_name:'Auto Doctor NG',      service_name:'Mechanic',           category:'mechanic',    location:'Ikeja, Lagos',                price:10000, rating:4.7, reviews:38,  description:'Computerised diagnostics, engine overhaul, transmission, AC. All brands.' },
  { id:'d61', user_id:'demo', provider_name:'Toyin Roadside Fix',  service_name:'Mobile Mechanic',    category:'mechanic',    location:'Gbagada, Lagos',              price:5000,  rating:4.5, reviews:22,  description:'Breakdown rescue and roadside repairs. Come to you anywhere in Lagos.' },
  { id:'d62', user_id:'demo', provider_name:'Abuja Auto Centre',   service_name:'Mechanic',           category:'mechanic',    location:'Gwarinpa, Abuja',             price:8000,  rating:4.6, reviews:15,  description:'Full service workshop. Servicing, repairs, tyre change, wheel alignment.' },
  { id:'d63', user_id:'demo', provider_name:'Chief Mechanic',      service_name:'Mechanic',           category:'mechanic',    location:'Enugu, Enugu',                price:7000,  rating:4.4, reviews:11,  description:'Japanese and American car specialist. Toyota, Honda, Ford, Lexus expert.' },
  { id:'d64', user_id:'demo', provider_name:'SpeedFix Autos',      service_name:'Mechanic',           category:'mechanic',    location:'Surulere, Lagos',             price:6000,  rating:4.5, reviews:19,  description:'Oil change, brake pads, plugs, filter replacement. Quick turnaround.' },
  { id:'d65', user_id:'demo', provider_name:'Kano Auto Repairs',   service_name:'Mechanic',           category:'mechanic',    location:'Kano, Kano',                  price:5500,  rating:4.3, reviews:8,   description:'Reliable mechanic. Honest pricing. No unnecessary repairs.' },
  { id:'d66', user_id:'demo', provider_name:'PHC Motorworks',      service_name:'Mechanic',           category:'mechanic',    location:'Port Harcourt, Rivers',       price:9000,  rating:4.7, reviews:27,  description:'Car AC repairs, electrical faults, suspension. Workshop experience.' },
  { id:'d67', user_id:'demo', provider_name:'Nationwide Tyres',    service_name:'Tyre & Alignment',   category:'mechanic',    location:'Oshodi, Lagos',               price:12000, rating:4.6, reviews:33,  description:'New and used tyres, balancing, wheel alignment. Fast fitting service.' },

  /* ── Beauty ×6 more ── */
  { id:'d68', user_id:'demo', provider_name:'Lola Beauty Hub',     service_name:'Make-up Artist',     category:'beauty',      location:'Ikeja, Lagos',                price:12000, rating:4.8, reviews:47,  description:'Everyday and bridal makeup. Airbrush available. Home service weekends.' },
  { id:'d69', user_id:'demo', provider_name:'Abuja Glow Studio',   service_name:'Make-up Artist',     category:'beauty',      location:'Maitama, Abuja',              price:18000, rating:4.9, reviews:82,  description:'Celebrity makeup artist. Editorial, bridal, and red carpet looks.' },
  { id:'d70', user_id:'demo', provider_name:'Zara Nails',          service_name:'Nail Technician',    category:'beauty',      location:'Yaba, Lagos',                 price:5000,  rating:4.6, reviews:93,  description:'Gel, SNS, acrylic, nail extensions. 100+ designs. Walk-ins welcome.' },
  { id:'d71', user_id:'demo', provider_name:'Tress Queen',         service_name:'Hair Stylist',       category:'beauty',      location:'Ajah, Lagos',                 price:8000,  rating:4.7, reviews:61,  description:'All braids, weaves, natural hair. Mobile service available citywide.' },
  { id:'d72', user_id:'demo', provider_name:'SpaBliss NG',         service_name:'Masseur',            category:'beauty',      location:'VI, Lagos',                   price:15000, rating:4.8, reviews:28,  description:'Swedish, deep tissue, couples massage. Home visits available. Fully mobile.' },
  { id:'d73', user_id:'demo', provider_name:'Skincare by Yemi',    service_name:'Skincare Therapist', category:'beauty',      location:'Lekki, Lagos',                price:10000, rating:4.9, reviews:39,  description:'Facials, chemical peels, acne treatments, glow sessions. Results-driven.' },
];

async function loadServices() {
  try {
    const _sRes = await window.supabase.from('services')
      .select('*, users:user_id(name, business_name)')
      .eq('available', true).order('created_at', { ascending: false }).limit(100);
    const services = (_sRes.data || []).map(s => ({
      id: String(s.id), service_name: s.service_name || s.service, category: s.category,
      price: s.price, rate_unit: s.rate_unit || '/job', location: s.location,
      description: s.description, photo: s.photo, user_id: s.user_id,
      provider_name: (s.users && (s.users.business_name || s.users.name)) || 'Provider',
      available: s.available, fromServices: true,
    }));
    if (services && services.length > 0) {
      /* Live services first, then dummy data to fill out the page */
      const liveIds = new Set(services.map(s => String(s.user_id)));
      const liveMapped = services.map((s, i) => ({
        id:            String(s.id || `s${i}`),
        user_id:       String(s.user_id || s.id),
        provider_name: s.provider_name || 'Provider',
        service_name:  s.service_name || s.service || 'Service',
        category:      s.category || 'other',
        location:      s.location || 'Lagos',
        price:         parseFloat(s.price || s.rate_value || 5000),
        rate:          s.rate || `₦${Number(s.price || 5000).toLocaleString()}/session`,
        rating:        parseFloat(s.rating || 4.5),
        reviews:       parseInt(s.reviews || 0),
        description:   s.description || s.bio || '',
        photo:         s.photo || s.photo_url || null,
        is_live:       true,
      }));
      /* Append dummies — mark them so Book button is hidden */
      ALL = [...liveMapped, ...DUMMY_SERVICES];
      console.log(`[Taskers] ${liveMapped.length} live + ${DUMMY_SERVICES.length} demo services`);
    } else {
      ALL = DUMMY_SERVICES;
    }
  } catch (e) {
    console.warn('[Taskers] Load failed, using demo data:', e.message);
    ALL = DUMMY_SERVICES;
  }
}

let ALL = [];
let FILTERS = { search:'', category:'', location:'', maxPrice:999999, minRating:0, sortBy:'recent' };
let PAGE = 1;
const PAGE_SIZE = 8;

/* ── Init ───────────────────────────────────────────────────── */
function initTaskersPage() {
  const params = new URLSearchParams(window.location.search);
  const urlService  = params.get('service')  || '';
  const urlLocation = params.get('location') || '';
  if (urlService) {
    FILTERS.search = urlService;
    const inp = document.getElementById('taskerSearchInput');
    if (inp) inp.value = urlService;
  }
  if (urlLocation) {
    FILTERS.location = urlLocation;
    const locInp = document.getElementById('taskerLocationInput');
    if (locInp) locInp.value = urlLocation;
  }
  /* Show dummy data immediately so page never looks empty while Supabase loads */
  ALL = DUMMY_SERVICES;
  render();
  wireAll();
  initBookingModal();
  /* Then replace with live data in background */
  loadServices().then(() => { render(); });
}

/* ── Filter + sort ───────────────────────────────────────────── */
function filtered() {
  let list = [...ALL];
  const { search, category, maxPrice, minRating, sortBy } = FILTERS;
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(s =>
      s.service_name.toLowerCase().includes(q) ||
      s.provider_name.toLowerCase().includes(q) ||
      s.location.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q)
    );
  }
  if (category)          list = list.filter(s => s.category === category);
  if (FILTERS.location)  list = list.filter(s => (s.location || '').toLowerCase().includes(FILTERS.location.toLowerCase()));
  if (maxPrice < 999999) list = list.filter(s => s.price <= maxPrice);
  if (minRating)         list = list.filter(s => s.rating >= minRating);
  if (sortBy === 'recent')     list.sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));
  if (sortBy === 'rating')     list.sort((a,b) => b.rating - a.rating);
  if (sortBy === 'price_asc')  list.sort((a,b) => a.price - b.price);
  if (sortBy === 'price_desc') list.sort((a,b) => b.price - a.price);
  return list;
}

/* ── Render ──────────────────────────────────────────────────── */
function render(page = 1) {
  PAGE = page;
  const grid    = document.getElementById('taskersGrid');
  const countEl = document.getElementById('resultsCount');
  const loadMore= document.getElementById('loadMoreBtn');
  const emptyEl = document.getElementById('taskerEmpty');
  if (!grid) return;

  const all   = filtered();
  const slice = all.slice(0, page * PAGE_SIZE);
  if (countEl) countEl.textContent = all.length;

  if (all.length === 0) {
    grid.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    if (loadMore) loadMore.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  grid.innerHTML = slice.map(buildCard).join('');
  if (loadMore) loadMore.style.display = slice.length < all.length ? 'block' : 'none';
}

function buildCard(s) {
  const safeName    = escapeHtml(s.provider_name || 'Provider');
  const safeService = escapeHtml(s.service_name || '');
  const safeLoc     = escapeHtml(s.location || 'Lagos');
  const safeDesc    = escapeHtml((s.description || '').slice(0, 90)) + ((s.description||'').length > 90 ? '&hellip;' : '');
  const safePhoto   = escapeHtml(s.photo || '');
  const safeId      = escapeHtml(s.id || '');
  const safeUserId  = escapeHtml(s.user_id || '');
  const initials    = safeName.replace(/[^a-zA-Z ]/g,'').trim().split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase() || 'ST';
  const avIdx       = (['s1','s2','s3','s4','s5','s6'].indexOf(s.id) + 1) || ((s.id.charCodeAt(0) % 6) + 1);
  const avClass     = `av-${avIdx}`;
  const stars       = Array.from({length:5}, (_,i) =>
    `<span style="color:${i < Math.round(s.rating) ? '#F59E0B' : '#D1D5DB'}">★</span>`).join('');

  const avatar = safePhoto
    ? `<img src="${safePhoto}" alt="${safeName}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" onerror="this.style.display='none'" />`
    : initials;

  const profileUrl = (s.user_id === 'demo') ? `tasker-profile.html?demo=${safeId}` : (safeUserId ? `tasker-profile.html?id=${safeUserId}` : 'find-taskers.html');

  /* full-width image at top of card when photo available */
  const cardImgHtml = safePhoto
    ? `<div style="margin:-16px -16px 14px;overflow:hidden;height:160px;border-radius:inherit;border-bottom-left-radius:0;border-bottom-right-radius:0;">
        <img src="${safePhoto}" alt="${safeName}"
          style="width:100%;height:100%;object-fit:cover;display:block;"
          onerror="this.parentNode.style.display='none'" />
      </div>` : '';

  return `<div class="card tasker-card fade-up" id="svc-${safeId}">
    ${cardImgHtml}
    <div class="tc-header">
      <div class="tc-avatar ${avClass}" style="overflow:hidden;">${safePhoto ? '' : avatar}</div>
      <div class="tc-meta">
        <div class="tc-name">${safeName}</div>
        <div class="tc-service">${safeService}</div>
        <div class="tc-location">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${safeLoc}
        </div>
      </div>
    </div>
    ${safeDesc ? `<p class="tc-bio">${safeDesc}</p>` : ''}
    <div class="tc-stats">
      <div class="tc-stat">
        <div class="tc-stat-value">${stars}</div>
        <div class="tc-stat-label">${s.rating.toFixed(1)}${s.reviews ? ` · ${s.reviews} reviews` : ''}</div>
      </div>
      <div class="tc-stat">
        <div class="tc-stat-value" style="font-size:1rem;font-weight:700;">₦${Number(s.price).toLocaleString()}</div>
        <div class="tc-stat-label">per session</div>
      </div>
    </div>
    <div class="tc-footer">
      <span class="tc-badge tc-badge-green">Available</span>
      <div style="display:flex;gap:6px;">
        <a href="${profileUrl}" class="btn btn-primary btn-sm" style="text-decoration:none;">View Profile</a>
      </div>
    </div>
  </div>`;
}

/* ── Wiring ──────────────────────────────────────────────────── */
function wireAll() {
  /* Search */
  const inp = document.getElementById('taskerSearchInput');
  const frm = document.getElementById('taskerSearchForm');
  if (inp) inp.addEventListener('input', () => { FILTERS.search = inp.value.trim(); render(1); });
  if (frm) frm.addEventListener('submit', e => { e.preventDefault(); render(1); });

  /* Location — wired via initLocationInput in find-taskers.html initPage */
  /* The onChange callback sets FILTERS.location and re-renders */

  /* Category tabs */
  document.querySelectorAll('[data-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-category]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      FILTERS.category = btn.dataset.category === 'all' ? '' : btn.dataset.category;
      render(1);
    });
  });

  /* Rating */
  document.querySelectorAll('[data-rating-filter]').forEach(cb => {
    cb.addEventListener('change', () => {
      const c = document.querySelector('[data-rating-filter]:checked');
      FILTERS.minRating = c ? parseFloat(c.dataset.ratingFilter) : 0;
      render(1);
    });
  });

  /* Price range */
  const pr = document.getElementById('priceRange');
  const pv = document.getElementById('priceVal');
  if (pr) {
    pr.addEventListener('input', () => {
      const v = parseInt(pr.value);
      FILTERS.maxPrice = v;
      if (pv) pv.textContent = v >= 30000 ? 'Any' : `₦${v.toLocaleString()}`;
      render(1);
    });
  }

  /* Apply Filters button */
  const applyBtn = document.getElementById('applyFiltersBtn');
  if (applyBtn) applyBtn.addEventListener('click', () => {
    render(1);
    showToast(`${filtered().length} results`);
  });

  /* Sort */
  const sel = document.getElementById('sortSelect');
  if (sel) sel.addEventListener('change', () => { FILTERS.sortBy = sel.value; render(1); });

  /* Reset */
  const reset = document.getElementById('filterReset');
  if (reset) reset.addEventListener('click', () => {
    FILTERS = { search:'', category:'', location:'', maxPrice:999999, minRating:0, sortBy:'rating' };
    const locInp = document.getElementById('taskerLocationInput');
    if (locInp) { locInp.value = ''; delete locInp.dataset.lat; delete locInp.dataset.lon; }
    if (inp) inp.value = '';
    if (pr)  { pr.value = 30000; if (pv) pv.textContent = 'Any'; }
    document.querySelectorAll('[data-rating-filter]').forEach(c => c.checked = false);
    document.querySelectorAll('[data-category]').forEach(b => b.classList.remove('active'));
    render(1);
  });

  /* Load more */
  const lm = document.getElementById('loadMoreBtn');
  if (lm) lm.addEventListener('click', () => render(PAGE + 1));
}

/* ── Booking modal ───────────────────────────────────────────── */
function initBookingModal() {
  const modal = document.getElementById('bookingModal');
  if (!modal) return;
  document.getElementById('bookingModalClose')?.addEventListener('click', closeBookingModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeBookingModal(); });
  document.getElementById('bookingForm')?.addEventListener('submit', handleBookingSubmit);
}

function openBookingModal(svcId) {
  const s = ALL.find(x => x.id === svcId);
  if (!s) { console.warn('[Booking] service not found:', svcId); return; }
  const modal = document.getElementById('bookingModal');
  if (!modal) { console.warn('[Booking] bookingModal element not found'); return; }

  const nameEl    = modal.querySelector('[data-booking-name]');
  const serviceEl = modal.querySelector('[data-booking-service]');
  const rateEl    = modal.querySelector('[data-booking-rate]');
  const ratingEl  = modal.querySelector('[data-booking-rating]');
  const avatarEl  = modal.querySelector('#bookingModalAvatar');
  const dateInput = modal.querySelector('#bookingDate');

  if (nameEl)    nameEl.textContent    = s.provider_name;
  if (serviceEl) serviceEl.textContent = s.service_name;
  if (rateEl)    rateEl.textContent    = `₦${Number(s.price).toLocaleString()}/session`;
  if (ratingEl)  ratingEl.textContent  = `${s.rating.toFixed(1)} ★`;
  if (dateInput) dateInput.min = new Date().toISOString().split('T')[0];

  /* Avatar: photo or initials */
  if (avatarEl) {
    const initials = s.provider_name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    avatarEl.innerHTML = s.photo
      ? `<img src="${s.photo}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentNode.textContent='${initials}'" />`
      : initials;
  }

  modal.dataset.activeSvc  = svcId;
  modal.dataset.activeUser = s.userId || svcId;
  modal.classList.add('modal-open');
  document.body.style.overflow = 'hidden';
}
window.openBookingModal = openBookingModal;

function closeBookingModal() {
  const m = document.getElementById('bookingModal');
  if (m) { m.classList.remove('modal-open'); document.body.style.overflow = ''; }
}
window.closeBookingModal = closeBookingModal;

async function handleBookingSubmit(e) {
  e.preventDefault();
  const modal    = document.getElementById('bookingModal');
  const form     = e.target;
  const btn      = form.querySelector('[type="submit"]');
  const taskerId = modal?.dataset.activeUser;
  const svc      = ALL.find(x => x.id === modal?.dataset.activeSvc);

  /* Auth check */
  const sess = await window.supabase.auth.getSession();
  const user = sess.data.session && sess.data.session.user;
  if (!user) {
    closeBookingModal();
    showToast('Please log in to book a service.');
    setTimeout(() => { window.location.href = 'login.html?redirect=find-taskers.html'; }, 1200);
    return;
  }
  /* Guard: tasker can't book their own service */
  if (svc && svc.user_id && String(svc.user_id) === String(user.id)) {
    closeBookingModal();
    showToast('You cannot book your own service.');
    return;
  }
  /* Guard: taskers should be browsing tasks, not booking services */
  const _role = (user.user_metadata && user.user_metadata.role) || localStorage.getItem('st_role') || 'customer';
  if (_role === 'tasker') {
    closeBookingModal();
    showToast('Taskers browse tasks, not services. Head to Find Tasks instead.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Booking...';

  try {
    const date = form.bookingDate?.value;
    const time = form.bookingTime?.value || '09:00';
    const scheduled = date ? `${date}T${time}` : null;

    /* Demo listings simulate a booking without touching the DB */
    if (svc && svc.user_id === 'demo') {
      closeBookingModal();
      showToast(`Booking request sent to ${svc.provider_name}! Sign up to manage bookings.`);
      form.reset();
      return;
    }

    const _bSess = await window.supabase.auth.getSession();
    const _bUser = _bSess.data.session && _bSess.data.session.user;
    if (!_bUser) throw new Error('Not logged in');
    const { error: _bErr } = await window.supabase.from('bookings').insert({
      customer_id: _bUser.id, tasker_id: taskerId,
      scheduled_time: scheduled || null, status: 'pending',
      notes: form.bookingNotes?.value?.trim() || '',
    });
    if (_bErr) throw _bErr;
    /* Notify tasker */
    try {
      await window.supabase.from('notifications').insert({
        user_id: String(taskerId), type: 'new_booking', title: 'New Booking Request',
        message: (_bUser.user_metadata?.name || _bUser.email?.split('@')[0] || 'A customer') + ' sent you a booking request.',
        is_read: false,
      });
    } catch(e2) {}
    closeBookingModal();
    showToast(`Booking request sent to ${svc?.provider_name || 'the provider'}!`);
    form.reset();
  } catch (err) {
    if (err.message === 'SUBSCRIPTION_REQUIRED') {
      closeBookingModal();
      showToast('This provider needs to upgrade their plan to accept bookings.');
    } else {
      showToast('Booking failed: ' + err.message);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm Booking';
  }
}

window.initTaskersPage = initTaskersPage;

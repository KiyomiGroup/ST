/* ============================================================
   STREETTASKER — product-fields.js   (Categories Stage 6b: Sales upgrade)
   What a seller can say about each product, which questions fit which kind of product, and how stock and delivery read.
   Runs in the browser and in Node (tests). No DOM.

   Per product (table `service_products`, new columns from sql/categories/s1-sales-products.sql):
     condition, brand, model, colour, size, expiry_date, quantity, stock_status, negotiable, was_price
     (price stays the price the customer pays; was_price is the higher "before" price when the product is discounted)
   Per Sales listing (saved in services.details, no new column):
     { _v:1, delivery:true|false, pickup:true|false, delivery_fee:number|null, delivery_time:'1-2 days' }

   STProducts.fieldsFor(subcategory) -> ['condition','brand',...] only the questions that fit (size for clothes, expiry for food...)
   ============================================================ */
(function (root) {
  'use strict';

  var NAIRA = '\u20a6';
  var CONDITIONS = ['Brand New', 'Fairly Used', 'Refurbished'];
  var STOCK = [
    { key: 'in_stock',     label: 'In stock' },
    { key: 'out_of_stock', label: 'Out of stock' },
    { key: 'sold',         label: 'Sold' },
    { key: 'paused',       label: 'Paused' }
  ];
  var DELIVERY_TIMES = ['Same day', '1-2 days', '3-5 days', 'Over 5 days'];
  var LIMITS = { brand: 40, model: 40, colour: 30, size: 30, quantity: 99999, deliveryFee: 1000000 };

  /* which questions fit which kind of product (subcategory names from js/categories.js) */
  var GROUPS = {
    tech:       { subs: ['Phones & Accessories', 'Computers & Electronics', 'Home Appliances'], fields: ['condition', 'brand', 'model', 'colour'] },
    wear:       { subs: ['Fashion & Clothing', 'Shoes & Footwear', 'Bags & Accessories'],       fields: ['condition', 'brand', 'size', 'colour'] },
    consumable: { subs: ['Beauty & Cosmetics', 'Personal Care Products', 'Food & Groceries', 'Drinks & Beverages', 'Baby Products'], fields: ['brand', 'expiry'] },
    home:       { subs: ['Furniture', 'Home & Kitchen'],                                        fields: ['condition', 'brand', 'size', 'colour'] },
    gear:       { subs: ['Sports & Fitness Equipment', 'Toys & Games', 'Automotive Parts', 'Building Materials'], fields: ['condition', 'brand'] },
    other:      { subs: ['Books & Stationery', 'Agricultural Products', 'Handmade Products', 'Other Products'], fields: ['condition'] }
  };
  var DEFAULT_FIELDS = ['condition'];

  function fieldsFor(sub) {
    var s = String(sub || '');
    for (var g in GROUPS) if (GROUPS[g].subs.indexOf(s) !== -1) return GROUPS[g].fields.slice();
    return DEFAULT_FIELDS.slice();
  }
  function has(sub, field) { return fieldsFor(sub).indexOf(field) !== -1; }

  function ngn(n) { return NAIRA + Number(n).toLocaleString('en-NG'); }
  function clean(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
  function validDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z')); }

  /* p = what the seller typed for one product (strings or numbers). Returns '' when fine, otherwise the message. */
  function check(p, sub) {
    p = p || {};
    var price = Number(p.price) || 0, was = p.was_price === '' || p.was_price == null ? 0 : Number(p.was_price);
    if (!(price > 0)) return 'needs a price.';
    if (p.was_price !== '' && p.was_price != null && !(was > price)) return 'the original price must be higher than the selling price.';
    if (p.quantity !== '' && p.quantity != null) {
      var q = Number(p.quantity);
      if (!isFinite(q) || q < 0 || q !== Math.floor(q) || q > LIMITS.quantity) return 'quantity must be a whole number, 0 or more.';
    }
    if (p.stock_status && !STOCK.some(function (s) { return s.key === p.stock_status; })) return 'choose a valid availability.';
    if (has(sub, 'condition') && p.condition && CONDITIONS.indexOf(p.condition) === -1) return 'choose a valid condition.';
    if (has(sub, 'expiry') && p.expiry_date && !validDate(p.expiry_date)) return 'enter the expiry date as a real date.';
    return '';
  }

  /* The columns to save. Questions that do not fit this kind of product are saved empty. */
  function toRow(p, sub) {
    p = p || {};
    var f = fieldsFor(sub);
    var q = p.quantity === '' || p.quantity == null ? null : Math.floor(Number(p.quantity));
    var was = p.was_price === '' || p.was_price == null ? null : Number(p.was_price);
    return {
      condition:   f.indexOf('condition') !== -1 && CONDITIONS.indexOf(p.condition) !== -1 ? p.condition : null,
      brand:       f.indexOf('brand')  !== -1 ? clean(p.brand,  LIMITS.brand)  || null : null,
      model:       f.indexOf('model')  !== -1 ? clean(p.model,  LIMITS.model)  || null : null,
      colour:      f.indexOf('colour') !== -1 ? clean(p.colour, LIMITS.colour) || null : null,
      size:        f.indexOf('size')   !== -1 ? clean(p.size,   LIMITS.size)   || null : null,
      expiry_date: f.indexOf('expiry') !== -1 && validDate(String(p.expiry_date || '')) ? String(p.expiry_date) : null,
      quantity:    q,
      stock_status: STOCK.some(function (s) { return s.key === p.stock_status; }) ? p.stock_status : 'in_stock',
      negotiable:  !!p.negotiable,
      was_price:   was
    };
  }

  /* what a customer can do with a saved product row */
  function stockOf(row) {
    row = row || {};
    var s = STOCK.some(function (x) { return x.key === row.stock_status; }) ? row.stock_status : 'in_stock';
    if (s === 'in_stock' && row.quantity === 0) return 'out_of_stock';
    return s;
  }
  function stockLabel(row) { var k = stockOf(row); return STOCK.filter(function (s) { return s.key === k; })[0].label; }
  function canOrder(row) { return stockOf(row) === 'in_stock'; }
  /* the most a customer may ask for: the stock the seller said they have, never more than 50 per order */
  function maxQty(row) { var q = row && row.quantity; return typeof q === 'number' && q > 0 ? Math.min(50, q) : 50; }

  /* short labels shown under a product name: condition, brand, size, colour, model */
  function badges(row, sub) {
    row = row || {};
    var f = fieldsFor(sub), out = [];
    if (f.indexOf('condition') !== -1 && row.condition) out.push(row.condition);
    ['brand', 'model', 'size', 'colour'].forEach(function (k) { if (f.indexOf(k) !== -1 && row[k]) out.push(String(row[k])); });
    if (f.indexOf('expiry') !== -1 && row.expiry_date) out.push('Expires ' + row.expiry_date);
    return out;
  }

  /* price line: { now:'₦8,000', was:'₦10,000' | '', negotiable:true|false } */
  function priceParts(row) {
    row = row || {};
    var now = Number(row.price) || 0, was = Number(row.was_price) || 0;
    return { now: now > 0 ? ngn(now) : '', was: was > now && now > 0 ? ngn(was) : '', negotiable: !!row.negotiable };
  }

  /* ── delivery and pickup (whole listing) ── */
  function checkFulfilment(d) {
    d = d || {};
    if (!d.delivery && !d.pickup) return 'Choose delivery, pickup or both.';
    if (d.delivery && d.delivery_fee !== '' && d.delivery_fee != null) {
      var fee = Number(d.delivery_fee);
      if (!isFinite(fee) || fee < 0 || fee > LIMITS.deliveryFee) return 'Enter the delivery fee as an amount, 0 or more.';
    }
    if (d.delivery && d.delivery_time && DELIVERY_TIMES.indexOf(d.delivery_time) === -1) return 'Choose a delivery time from the list.';
    return '';
  }

  function toDetails(d) {
    d = d || {};
    var delivery = !!d.delivery, hasFee = delivery && d.delivery_fee !== '' && d.delivery_fee != null;
    return {
      _v: 1,
      delivery: delivery,
      pickup: !!d.pickup,
      delivery_fee: hasFee ? Number(d.delivery_fee) : null,
      delivery_time: delivery && DELIVERY_TIMES.indexOf(d.delivery_time) !== -1 ? d.delivery_time : null
    };
  }

  /* lines for the service page: [{ key, label, text }] */
  function describeFulfilment(details) {
    var d = details && typeof details === 'object' ? details : null;
    if (!d || (d.delivery === undefined && d.pickup === undefined)) return [];
    var out = [];
    var how = [];
    if (d.delivery) how.push('Delivery');
    if (d.pickup) how.push('Pickup');
    if (how.length) out.push({ key: 'how', label: 'How you get it', text: how.join(' and ') });
    if (d.delivery) {
      if (typeof d.delivery_fee === 'number') out.push({ key: 'delivery_fee', label: 'Delivery fee', text: d.delivery_fee === 0 ? 'Free' : ngn(d.delivery_fee) });
      else out.push({ key: 'delivery_fee', label: 'Delivery fee', text: 'Agreed in the chat' });
      if (d.delivery_time) out.push({ key: 'delivery_time', label: 'Delivery time', text: d.delivery_time });
    }
    return out;
  }

  /* two short chips for a card */
  function cardBadges(details) {
    var d = details && typeof details === 'object' ? details : {}, out = [];
    if (d.delivery) out.push(d.delivery_fee === 0 ? 'Free delivery' : 'Delivery available');
    if (d.pickup) out.push('Pickup available');
    return out;
  }

  root.STProducts = {
    CONDITIONS: CONDITIONS, STOCK: STOCK, DELIVERY_TIMES: DELIVERY_TIMES, LIMITS: LIMITS, GROUPS: GROUPS,
    fieldsFor: fieldsFor, check: check, toRow: toRow, stockOf: stockOf, stockLabel: stockLabel, canOrder: canOrder, maxQty: maxQty,
    badges: badges, priceParts: priceParts, checkFulfilment: checkFulfilment, toDetails: toDetails, describeFulfilment: describeFulfilment, cardBadges: cardBadges
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.STProducts;
})(typeof window !== 'undefined' ? window : this);

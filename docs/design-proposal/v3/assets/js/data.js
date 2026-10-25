/* Sample data for the prototype. Everything here is SAMPLE content: bracketed names and prices,
 * a made-up size chart and fake orders. Nothing is real, nothing is sent anywhere. */
(function () {
  'use strict';

  var TYPES = [
    { slug: 'gown', name: '[Gown]', keywords: 'gown dress evening', tile: 'p01' },
    { slug: 'dress', name: '[Dress]', keywords: 'dress day', tile: 'p02' },
    { slug: 'blazer', name: '[Blazer]', keywords: 'blazer jacket', tile: 'p03' },
    { slug: 'shirt', name: '[Shirt]', keywords: 'shirt top', tile: 'p04' },
    { slug: 'suit', name: '[Suit]', keywords: 'suit tailored', tile: 'p05' },
  ];

  /* profile: which measurements the outfit needs (sample chart below). null = no Blueprint. */
  var P = [
    ['p01', 'gown', 'female', 48000, 'M', { S: 3, M: 6, L: 4, XL: 2 }],
    ['p02', 'dress', 'female', 36500, 'L', { S: 5, M: 5, L: 1, XL: 0 }],
    ['p03', 'blazer', 'male', 52000, 'M', { M: 7, L: 3, XL: 2, XXL: 1 }],
    ['p04', 'shirt', 'male', 24500, 'L', { S: 4, M: 8, L: 6, XL: 3, XXL: 2 }],
    ['p05', 'suit', 'male', 89000, 'M', { M: 2, L: 2, XL: 1 }],
    ['p06', 'blazer', 'male', 46000, 'L', { M: 0, L: 0, XL: 0, XXL: 0 }],
    ['p07', 'gown', 'female', 58500, 'S', { S: 2, M: 3, L: 3, XL: 1 }],
    ['p08', 'shirt', null, 21000, 'M', { S: 6, M: 9, L: 7, XL: 4 }],
    ['p09', 'dress', 'female', 33000, 'M', { S: 4, M: 6, L: 5, XL: 2 }],
    ['p10', 'gown', 'female', 63500, 'L', { S: 1, M: 2, L: 2, XL: 1 }],
  ];

  var PRODUCTS = P.map(function (row, i) {
    var n = i + 1;
    var stock = row[5];
    var total = 0;
    Object.keys(stock).forEach(function (k) { total += stock[k]; });
    return {
      id: row[0],
      slug: 'sample-outfit-' + (n < 10 ? '0' : '') + n,
      no: (n < 10 ? '0' : '') + n,
      name: '[Sample outfit ' + (n < 10 ? '0' : '') + n + ']',
      type: row[1],
      profile: row[2],
      priceNaira: row[3],
      usualSize: row[4],
      stock: stock,
      sizes: Object.keys(stock),
      soldOut: total === 0,
      lowSize: null,
    };
  });

  var SIZE_ORDER = ['S', 'M', 'L', 'XL', 'XXL'];

  /* SAMPLE size chart, inches (upper bound of each size). NOT the client's real chart. */
  var CHART = {
    note: 'Sample chart for the prototype only. The real chart comes from the client’s tailor.',
    female: {
      label: 'Female dress and gown',
      measures: [
        { key: 'bust', label: 'Bust', min: 20, max: 70, bounds: { S: 35, M: 38, L: 41, XL: 44 } },
        { key: 'waist', label: 'Waist', min: 15, max: 70, bounds: { S: 28, M: 31, L: 34, XL: 37 } },
        { key: 'hip', label: 'Hip', min: 20, max: 80, bounds: { S: 38, M: 41, L: 44, XL: 47 } },
        { key: 'length', label: 'Length', min: 20, max: 80, bounds: { S: 56, M: 58, L: 60, XL: 62 } },
      ],
      sizes: ['S', 'M', 'L', 'XL'],
      sample: { bust: '37', waist: '30', hip: '40', length: '57' },
    },
    male: {
      label: 'Male top, blazer and suit',
      measures: [
        { key: 'chest', label: 'Chest', min: 25, max: 70, bounds: { S: 38, M: 42, L: 46, XL: 50, XXL: 54 } },
        { key: 'shoulder', label: 'Shoulder', min: 10, max: 30, bounds: { S: 16, M: 17, L: 18, XL: 19, XXL: 20 } },
        { key: 'sleeve', label: 'Sleeve', min: 15, max: 40, bounds: { S: 23, M: 24, L: 25, XL: 26, XXL: 27 } },
        { key: 'length', label: 'Length', min: 20, max: 45, bounds: { S: 27, M: 28, L: 29, XL: 30, XXL: 31 } },
      ],
      sizes: SIZE_ORDER.slice(),
      sample: { chest: '42', shoulder: '17', sleeve: '24', length: '28' },
    },
  };

  var ZONES = [
    { code: 'island', name: '[Sample zone: Island]', feeNaira: 2500, days: '1–2 days' },
    { code: 'mainland', name: '[Sample zone: Mainland]', feeNaira: 2000, days: '1–3 days' },
    { code: 'outside', name: '[Sample zone: Outside the city]', feeNaira: 4500, days: '3–5 days' },
  ];

  var STATUSES = ['Being prepared', 'Sent out', 'Delivered'];

  /* Fake orders shown in "My orders" for a signed-in sample customer. */
  var SEED_ORDERS = [
    { id: 'UI-[0003]', placed: '[date]', status: 2, total: 75500, lines: [{ product: 'p03', size: 'M', qty: 1 }], zone: 'island' },
    { id: 'UI-[0004]', placed: '[date]', status: 1, total: 41000, lines: [{ product: 'p04', size: 'L', qty: 1 }, { product: 'p08', size: 'M', qty: 1 }], zone: 'mainland' },
  ];

  function money(n) {
    return '₦ [' + Number(n).toLocaleString('en-NG') + ']';
  }
  function byId(id) {
    return PRODUCTS.filter(function (p) { return p.id === id; })[0] || null;
  }
  function bySlug(slug) {
    return PRODUCTS.filter(function (p) { return p.slug === slug; })[0] || null;
  }
  function typeOf(slug) {
    return TYPES.filter(function (t) { return t.slug === slug; })[0] || null;
  }
  function plain(s) {
    return String(s).replace(/[\[\]]/g, '').toLowerCase();
  }

  /* ---- state (sessionStorage; sample only, no personal data is ever stored) ---- */
  var KEY = 'ui-proto-v3';
  function fresh() {
    return {
      signedIn: false,
      cart: [{ product: 'p01', size: 'M', qty: 1, fit: 'recommended' }],
      orders: [],
      fits: {},
      checkout: { zone: 'island' },
    };
  }
  var state;
  try {
    state = JSON.parse(sessionStorage.getItem(KEY) || 'null') || fresh();
  } catch (e) {
    state = fresh();
  }
  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode: fine */ }
  }
  function reset() {
    state = fresh();
    save();
  }

  window.PROTO = {
    TYPES: TYPES, PRODUCTS: PRODUCTS, CHART: CHART, ZONES: ZONES, STATUSES: STATUSES,
    SEED_ORDERS: SEED_ORDERS, SIZE_ORDER: SIZE_ORDER,
    money: money, byId: byId, bySlug: bySlug, typeOf: typeOf, plain: plain,
    get state() { return state; },
    save: save, reset: reset,
  };
})();

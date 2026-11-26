/* StockCup product catalogue: brand -> product -> pack size, used by the dropdowns in the add-product form and by the text/photo parsers.

   STATUS: a hand-compiled STARTER list, not authoritative. It was checked against public product listings (retailer and brand pages found by web search)
   but NOT against each brand's own site, because those hosts were unreachable when it was written. Rules used:
     * names are only included when they were seen in a listing;
     * numbers (intensity, cup size, caffeine, pack sizes) are filled only when known. A number that is recalled but not confirmed is listed in `est`,
       and the form tells the user to check it against their box. Unknown numbers are simply absent (never a placeholder);
     * pack sizes marked `sizesTypical` are common sizes offered as choices, never silently pre-selected.
   Every dropdown also has "Other (type it)", and anything typed becomes part of "Your brands" next time.
   To add or correct something, edit the lists below and run `npm test` (tests/catalog.test.js checks the shape of every entry). */
const CATALOG = (function (SC) {
  'use strict';
  const entries = []; const brandInfo = {};
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  function brand(name, categories, aliases) { brandInfo[name] = { brand: name, categories: categories, aliases: aliases || [] }; }
  // add(brand, category, line, [name | [name, extra]], common)
  function add(b, category, line, items, common) {
    items.forEach((it) => {
      const name = Array.isArray(it) ? it[0] : it; const extra = Array.isArray(it) ? it[1] : {};
      const e = Object.assign({ brand: b, category: category, line: line, name: name }, common || {}, extra || {});
      e.id = 'cat_' + slug(b) + '_' + slug(line) + '_' + slug(name); entries.push(e);
    });
  }

  // ---------- Nespresso capsules ----------
  brand('Nespresso', ['capsule'], ['Nespresso Original', 'Nespresso Vertuo', 'Vertuoline', 'Original Line']);
  const orig = { system: 'original', shots: 1, sizes: [10], sizesConfirmed: true };
  add('Nespresso', 'capsule', 'Original · Classics', [
    ['Ristretto', { cupSize: 25 }],                       // intensity differs between sources (9 or 10): left for the user to read off the sleeve
    ['Arpeggio', { intensity: 9, est: ['intensity'] }], ['Roma', { intensity: 8, est: ['intensity'] }], ['Livanto', { intensity: 6, est: ['intensity'] }],
    ['Capriccio', { intensity: 5 }],                      // 5 confirmed on Nespresso's own page (via search)
    ['Volluto', { intensity: 4, est: ['intensity'] }], ['Cosi', { intensity: 4, est: ['intensity'] }], ['Dharkan', { intensity: 11, est: ['intensity'] }],
    ['Kazaar', { intensity: 12, cupSize: 25, est: ['intensity', 'cupSize'] }],
  ], orig);
  add('Nespresso', 'capsule', 'Original · Ispirazione', [['Napoli', { intensity: 13, est: ['intensity'] }], ['Venezia', { intensity: 8, est: ['intensity'] }]], orig);
  add('Nespresso', 'capsule', 'Original · Master Origins', [
    ['Colombia', { intensity: 6 }], ['Ethiopia', { intensity: 4 }], ['Indonesia', { intensity: 8 }], ['Nicaragua', { intensity: 5 }], // confirmed on Nespresso pages (via search)
    'India', 'Costa Rica', 'Peru Organic',
  ], orig);
  add('Nespresso', 'capsule', 'Original · Decaffeinato', [
    ['Ristretto Decaffeinato', { intensity: 10, cupSize: 25, caffeine: 5, est: ['cupSize', 'caffeine'] }],
    ['Arpeggio Decaffeinato', { intensity: 9, caffeine: 5, est: ['intensity', 'caffeine'] }], ['Volluto Decaffeinato', { intensity: 4, caffeine: 5, est: ['intensity', 'caffeine'] }],
  ], orig);
  const vert = { system: 'vertuo', sizes: [8, 10], sizesTypical: true };
  add('Nespresso', 'capsule', 'Vertuo · Espresso (40 ml)', [['Altissio', { cupSize: 40, shots: 1 }], ['Diavolitto', { cupSize: 40, shots: 1 }], ['Voltesso', { cupSize: 40, shots: 1 }], ['Espresso Forte', { cupSize: 40, shots: 1, est: ['name'] }]], vert);
  add('Nespresso', 'capsule', 'Vertuo · Double Espresso (80 ml)', [['Double Espresso Scuro', { cupSize: 80, shots: 2 }], ['Double Espresso Chiaro', { cupSize: 80, shots: 2 }], ['Double Espresso Dolce', { cupSize: 80, shots: 2 }],
    ['Double Espresso Chiaro Decaffeinato', { cupSize: 80, shots: 2, caffeine: 10, est: ['caffeine'] }]], vert);
  add('Nespresso', 'capsule', 'Vertuo · Mug (230 ml)', [['Solelio', { cupSize: 230, shots: 1 }]], vert);
  add('Nespresso', 'capsule', 'Vertuo · More coffees', [['Melozio', { shots: 1 }], ['Odacio', { shots: 1 }], ['Stormio', { shots: 1 }], ['Melozio Decaffeinato', { shots: 1, caffeine: 5, est: ['caffeine'] }],
    ['Altissio Decaffeinato', { cupSize: 40, shots: 1, caffeine: 5, est: ['caffeine'] }]], vert);
  add('Nespresso', 'capsule', 'Vertuo · Barista Creations', [['Bianco Forte', { shots: 1 }], ['Bianco Doppio', { shots: 1 }], ['Bianco Piccolo', { shots: 1 }]], vert);

  // ---------- Matcha and hojicha ----------
  const typical = { sizes: [20, 30, 40, 100], sizesTypical: true, distinct: true }; // distinct: the product name alone identifies it (Wako, Ummon...)
  brand('Marukyu Koyamaen', ['matcha', 'hojicha'], ['Marukyu-Koyamaen', 'Marukyu']);
  add('Marukyu Koyamaen', 'matcha', 'Matcha', ['Isuzu', 'Aoarashi', 'Yugen', 'Wako', 'Kinrin', 'Chigi no Shiro'], typical);
  add('Marukyu Koyamaen', 'hojicha', 'Hojicha powder', ['Hojicha Powder A', 'Hojicha Powder B'], { sizes: [40, 100, 200], sizesTypical: true });
  brand('Ippodo', ['matcha', 'tea'], []);
  add('Ippodo', 'matcha', 'Matcha', [['Ummon-no-mukashi', { sizes: [20, 40], sizesConfirmed: true }], ['Sayaka-no-mukashi', { sizes: [20, 40, 100], sizesConfirmed: true }]], { distinct: true });
  add('Ippodo', 'tea', 'Roasted green tea (leaves)', [['Gokujo Hojicha', { sizes: [80, 100], sizesTypical: true }]]);
  brand('Yamamasa Koyamaen', ['matcha'], ['Yamamasa', 'Yamamasa-Koyamaen']);
  add('Yamamasa Koyamaen', 'matcha', 'Matcha', [['Matsukaze', { sizes: [30, 100], sizesTypical: false, sizesConfirmed: true }], ['Ogurayama', { sizes: [40, 100], sizesTypical: false, sizesConfirmed: true }], 'Samidori', 'Yomo no Kaori', 'Tennouzan', 'Wakakusa'], typical);
  // Names as listed on shopkumatcha.com and sizes as told by the user (the site itself could not be reached): everything is a 30 g tin, only Honmei and Yabukita also come as 100 g.
  // Many are cultivar names (Okumidori, Yabukita, Samidori, Yutakamidori, Sayamakaori, Kirari 31, ...), several are shared with other brands, so none of these
  // is matched on the product name alone: the brand has to be in the text.
  brand('Kumatcha', ['matcha'], ['Shop Kumatcha', 'shopkumatcha']); // no alias containing the bare word "matcha": it would make every "X matcha" look like a Kumatcha product
  add('Kumatcha', 'matcha', 'Matcha (cultivars and blends)', ['Okashi', ['Honmei', { sizes: [30, 100] }], 'Mitsu', 'Haru', 'Kanaya Midori', 'Okumidori 2.0', 'Okumidori', 'Aki', 'Kirei', 'Yugen', 'Koi', 'Asahi', 'Samidori', 'Uji Hikari', 'Kasumi', 'Oyatsu',
    'Sayamakaori', 'Yutakamidori', 'Ren', 'Uji No Mukashi', ['Yabukita', { sizes: [30, 100] }], 'Sora', 'Tsuki', 'Gokou', 'Kirari 31', 'Wet Market Exclusive'], { sizes: [30], sizesConfirmed: true, distinct: false });
  brand('Aiya', ['matcha'], ['AIYA', 'Aiya America']);
  add('Aiya', 'matcha', 'Matcha', [['Organic Ceremonial Grade', { sizes: [30, 100], sizesConfirmed: true }], ['Premium First Harvest Ceremonial Grade', { sizes: [30, 100], sizesConfirmed: true }], ['Organic Culinary Grade', { sizes: [100], sizesConfirmed: true }]]);

  // ---------- Syrups ----------
  // Top Creamery syrups: the list below is the shop's own price list (supplied by the user), all in 750 ml bottles. Caramel and Creamy Vanilla were also seen in 250 ml on their site.
  // The groups are ours (the price list is flat), chosen to keep a 50-item dropdown easy to scan. Green Mango, Macadamia Nut and Cane Sugar come from their website listing, not the price list.
  brand('Top Creamery', ['syrup'], ['TOP Series', 'TOP Series Classique', 'TOP Creamery']);
  const tc = { sizes: [750], sizesConfirmed: true };
  add('Top Creamery', 'syrup', 'Classic and dessert', ['Almond', ['Caramel', { sizes: [750, 250] }], ['Creamy Vanilla', { sizes: [750, 250] }], 'Cheesecake', 'Chocolate', 'Crème Brûlée', 'Cookie Dough', 'Creamy Coconut', 'Espresso', 'French Vanilla',
    'Hazelnut', 'Macadamia Nut', 'Salted Caramel', 'Tiramisu', 'White Chocolate'], tc);
  add('Top Creamery', 'syrup', 'Sugar', ['Sugar', 'Brown Sugar', 'Cane Sugar', 'Muscovado'], tc);
  add('Top Creamery', 'syrup', 'Fruit', ['Banana', 'Blueberry', 'Cucumber', 'Green Apple', 'Green Mango', 'Kiwi', 'Lemon', 'Lychee', 'Mango', 'Orange', 'Passion Fruit', 'Peach', 'Peach Mango', 'Philippine Mango', 'Raspberry',
    'Strawberry', 'Sweet Grapes', 'Watermelon', 'Wintermelon', 'Yuzu'], tc);
  add('Top Creamery', 'syrup', 'Tea, floral, herbal and spice', ['Jasmine Tea', 'Hibiscus', 'Lavender', 'Lemongrass', 'Peppermint', 'Spearmint', 'Rose', 'Cinnamon', 'Pumpkin Spice'], tc);
  add('Top Creamery', 'syrup', 'More', ['Blue Curacao', 'Grenadine', 'Ube', 'Yogurt'], tc);

  // ---------- Coffee beans ----------
  brand('Lavazza', ['coffee'], []);
  add('Lavazza', 'coffee', 'Whole beans', ['Qualità Oro', 'Super Crema', 'Crema e Aroma', 'Qualità Rossa', 'Tierra'], { sizes: [250, 500, 1000], sizesTypical: true });
  brand('illy', ['coffee'], ['Illy', 'illy caffè', 'illycaffè']);
  add('illy', 'coffee', 'Whole beans', ['Classico', 'Intenso'], { sizes: [250, 500], sizesTypical: true });
  brand('Starbucks', ['coffee'], []);
  add('Starbucks', 'coffee', 'Whole beans', ['Pike Place Roast', 'Veranda Blend', 'Caffè Verona', 'Espresso Roast'], { sizes: [340, 510], sizesTypical: true }); // 12 oz and 18 oz bags

  // ---------- Tea ----------
  brand('Twinings', ['tea'], []);
  add('Twinings', 'tea', 'Tea bags', ['Earl Grey', 'English Breakfast', 'Pure Green Tea', 'Darjeeling', 'Lady Grey', ['Pure Camomile', { caffeine: 0 }]], { sizes: [40, 100, 200], sizesTypical: true });

  // ---------- helpers ----------
  const byBrandKey = (b) => String(b).toLowerCase();
  function brands(category, opts) {
    opts = opts || {}; const seen = {}; const out = [];
    entries.forEach((e) => {
      if (e.category !== category) return; if (opts.systems && e.system && !opts.systems.has(e.system)) return;
      if (!seen[e.brand]) { seen[e.brand] = true; out.push(e.brand); }
    });
    return out.sort((a, b) => a.localeCompare(b));
  }
  // products of one brand for a category, grouped by line (the dropdown's option groups)
  function products(b, category, opts) {
    opts = opts || {}; const lines = []; const idx = {};
    entries.forEach((e) => {
      if (e.brand !== b || e.category !== category) return; if (opts.systems && e.system && !opts.systems.has(e.system)) return;
      if (!(e.line in idx)) { idx[e.line] = lines.length; lines.push({ line: e.line, items: [] }); } lines[idx[e.line]].items.push(e);
    });
    return lines;
  }
  const byId = (id) => entries.find((e) => e.id === id) || null;
  const defaultSize = (e) => (e.sizes && e.sizes.length === 1 && !e.sizesTypical ? e.sizes[0] : '');
  function displayName(e) { return e.system ? (e.system === 'original' ? 'Original ' : 'Vertuo ') + e.name : e.name; }
  // The same form object SC.presetToForm builds, so the existing form, validator and builder are reused unchanged.
  function toForm(e, size) {
    const C = SC.CATEGORIES[e.category];
    const sz = size === undefined || size === null || size === '' ? defaultSize(e) : size;
    return {
      category: e.category, brand: e.brand, name: displayName(e), size: sz === undefined ? '' : sz, unit: C.unit, dairy: C.dairy, density: C.density,
      shelfLifeDays: e.shelf !== undefined ? e.shelf : (C.shelf === null ? '' : C.shelf), caffeine: e.caffeine !== undefined ? e.caffeine : '',
      system: e.system || '', intensity: e.intensity !== undefined ? e.intensity : '', cupSize: e.cupSize !== undefined ? e.cupSize : '', shots: e.shots !== undefined ? e.shots : 1,
    };
  }
  const EST_LABEL = { intensity: 'intensity', cupSize: 'cup size', caffeine: 'caffeine', name: 'name' };
  // A short note for the form when something here is recalled rather than confirmed, or sizes are only typical.
  function hint(e) {
    if (!e) return ''; const parts = [];
    if (e.est && e.est.length) parts.push((e.est.map((k) => EST_LABEL[k] || k).join(', ')) + ' ' + (e.est.length > 1 ? 'are' : 'is') + ' approximate');
    if (e.sizesTypical) parts.push('the pack sizes listed are typical');
    return parts.length ? 'Check your box: ' + parts.join('; ') + '.' : '';
  }
  function allBrandNames() { return Object.keys(brandInfo).sort((a, b) => a.localeCompare(b)); }
  return { entries, brandInfo, brands, products, byId, toForm, hint, displayName, allBrandNames };
})(typeof module !== 'undefined' ? require('./core.js') : SC);
if (typeof module !== 'undefined') module.exports = CATALOG;

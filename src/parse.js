/* StockCup parsers: quick-add lines, receipt text, pasted recipe text. Rule-based, on-device, imperfect on purpose:
   everything they produce goes through a confirm screen. */
const SCP = (function (SC) {
  'use strict';
  const CATS = SC.CATEGORIES;

  // ---------- shared text helpers ----------
  const FRAC = { '½': ' 1/2', '¼': ' 1/4', '¾': ' 3/4', '⅓': ' 1/3', '⅔': ' 2/3', '⅛': ' 1/8' };
  function normalize(s) {
    return String(s).replace(/[  ​]/g, ' ').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
      .replace(/(\d)([½¼¾⅓⅔⅛])/g, '$1 $2').replace(/[½¼¾⅓⅔⅛]/g, (m) => FRAC[m]).replace(/[ \t]+/g, ' ').trim();
  }
  function numFrom(str) {
    str = str.trim();
    let m = str.match(/^(\d+)\s+(\d+)\/(\d+)$/); if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
    m = str.match(/^(\d+)\/(\d+)$/); if (m) return Number(m[1]) / Number(m[2]);
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(str)) return Number(str.replace(/,/g, ''));
    return Number(str.replace(',', '.'));
  }
  const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5, single: 1, double: 2, triple: 3 };
  const titleCase = (s) => String(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  const stripEmoji = (s) => s.replace(/[\u2600-\u27BF\uFE0F\u{1F000}-\u{1FAFF}]/gu, '').replace(/\s+/g, ' ').trim();

  // ---------- product lines (quick-add, receipts) ----------
  const CAT_KW = [
    ['capsule', /\b(capsules?|caps|pods?|nespresso|vertuo|sleeves?|livanto|arpeggio|ristretto|volluto|kazaar|dharkan|capriccio|cosi|melozio|stormio|diavolo|altissio|roma)\b/],
    ['hojicha', /\b(hojicha|houjicha)\b/],
    ['matcha', /\bmatcha\b/],
    ['icecream', /\b(ice[- ]?cream|gelato)\b/],
    ['tonic', /\btonic\b/],
    ['syrup', /\b(syrup|sauce|sweetener)\b/],
    ['milk', /\b(milk|oat|soy|soya|almond|barista|creamer|lactose)\b/],
    ['coffee', /\b(coffee|beans|grounds|arabica|espresso|ground)\b/],
  ];
  const STOP = new Set(['the', 'of', 'and', 'a', 'an', 'pack', 'pcs', 'pc', 'caps', 'capsules', 'capsule', 'pods', 'pod', 'sleeve', 'sleeves', 'powder', 'drink']);
  const SKIP_LINE = /\b(sub-?total|total|cash|change|vat|tax|tin|invoice|receipt|thank|discount|card|visa|master|balance|tendered|cashier|store|branch|address|tel|date|time|amount due|items?|qty|ref|terminal|pos)\b/i;

  function categoryOf(text) {
    const l = text.toLowerCase();
    for (let i = 0; i < CAT_KW.length; i++) if (CAT_KW[i][1].test(l)) return CAT_KW[i][0];
    return null;
  }
  function tokensOf(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9à-ÿ ]+/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t) && !/^\d+(g|ml|l|kg|cl|oz|x)?$/.test(t));
  }
  function jaccard(a, b) {
    if (!a.length || !b.length) return 0;
    const A = new Set(a), B = new Set(b); let i = 0; A.forEach((t) => { if (B.has(t)) i++; });
    return i / (A.size + B.size - i);
  }
  function matchCatalogue(text, category, state) {
    const q = tokensOf(text); let best = { score: 0 };
    const consider = (kind, obj) => {
      if (category && obj.category !== category) return;
      let sc = jaccard(q, tokensOf(obj.brand + ' ' + obj.name));
      if (sc > best.score) best = { score: sc, kind: kind, obj: obj };
    };
    if (state) state.products.forEach((p) => consider('product', p));
    SC.PRESETS.forEach((p) => consider('preset', p));
    return best.score >= 0.5 ? best : null;
  }

  // Parse one typed or OCR'd product line. Returns a draft row for the confirm screen.
  function parseProductLine(raw, state) {
    let s = normalize(raw); if (!s) return null;
    const orig = s; let price = null, qty = null, size = null, unit = null, sleeves = null, loose = null, packSize = null;
    // price
    let m = s.match(/(?:@|\bfor\b|\bat\b)\s*(?:[$₱€£]|php|usd|p)?\s*(\d+(?:\.\d+)?)\s*(?:each|ea)?\s*$/i);
    if (m) { price = Number(m[1]); s = s.replace(m[0], ' '); }
    else {
      const prices = []; s = s.replace(/(?:[$₱€£]|php\s?)?\s*\b(\d{1,3}(?:,\d{3})+|\d+)[.,](\d{2})\b/gi, (all, a, b) => { prices.push(Number(a.replace(/,/g, '') + '.' + b)); return ' '; });
      if (prices.length) price = prices.length > 1 ? Math.min.apply(null, prices) : prices[0];
      else { m = s.match(/(?:[$₱€£]|php\s?)\s*(\d+(?:\.\d+)?)/i); if (m) { price = Number(m[1]); s = s.replace(m[0], ' '); } }
    }
    // loose / sleeves for capsules
    m = s.match(/(\d+)\s*loose\b/i); if (m) { loose = Number(m[1]); s = s.replace(m[0], ' '); }
    m = s.match(/(\d+)\s*sleeves?\b/i); if (m) { sleeves = Number(m[1]); s = s.replace(m[0], ' '); }
    // quantity of packs
    m = s.match(/\bx\s*(\d+)\b/i) || s.match(/\b(\d+)\s*x(?=\s|$)/i) || s.match(/\b(\d+)\s*@/) || s.match(/\bqty:?\s*(\d+)\b/i);
    if (m) { qty = Number(m[1]); s = s.replace(m[0], ' '); }
    // size
    m = s.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilograms?|grams?|gr|g|liters?|litres?|ltr|lt|l|ml|cl|oz)\b/i);
    if (m) { size = Number(m[1].replace(',', '.')); unit = m[2].toLowerCase(); s = s.replace(m[0], ' '); }
    m = s.match(/(\d+)\s*(?:caps|capsules?|pods?|pcs|s)\b/i);
    if (m && /\b(caps|capsules?|pods?)\b|nespresso|vertuo/i.test(orig)) { packSize = Number(m[1]); s = s.replace(m[0], ' '); }
    // leading count on receipts: "2 OATLY ..."
    if (qty === null) { m = s.match(/^\s*(\d{1,2})\s+(?=[a-z])/i); if (m) { qty = Number(m[1]); s = s.replace(m[0], ' '); } }
    s = s.replace(/\s+/g, ' ').replace(/^[\s\-:.,|]+|[\s\-:.,|]+$/g, '');
    const category = categoryOf(orig);
    const match = matchCatalogue(s, category, state);
    const row = { raw: raw, include: true, category: category, brand: '', name: '', size: null, unit: null, packs: qty || 1, sleeves: null, loose: loose, price: price,
      matchedProductId: null, presetId: null, dairy: null, f: null, confidence: 0 };
    // convert size
    const toBase = (v, u, cat) => {
      if (u === 'kg' || /^kilogram/.test(u)) return { v: v * 1000, u: 'g' };
      if (/^(g|gr|gram)/.test(u)) return { v: v, u: 'g' };
      if (/^(l|lt|ltr|liter|litre)/.test(u)) return { v: v * 1000, u: 'ml' };
      if (u === 'cl') return { v: v * 10, u: 'ml' };
      if (u === 'ml') return { v: v, u: 'ml' };
      if (u === 'oz') { return CATS[cat] && CATS[cat].unit === 'ml' ? { v: Math.round(v * 29.57), u: 'ml' } : { v: Math.round(v * 28.35), u: 'g' }; }
      return null;
    };
    if (match) {
      const o = match.obj; row.category = o.category; row.brand = o.brand; row.name = o.name; row.confidence = match.score;
      if (match.kind === 'preset' && o.category !== 'capsule') {
        // keep a brand the user typed (e.g. "Oatly") but reuse the preset's specs
        const have = new Set(tokensOf(o.brand + ' ' + o.name)); const kw = CAT_KW.find((k) => k[0] === o.category)[1];
        const words = s.split(' ').filter(Boolean); const kwIdx = words.findIndex((w) => kw.test(w.toLowerCase()));
        const pre = (kwIdx > 0 ? words.slice(0, kwIdx) : []).filter((w) => !have.has(w.toLowerCase().replace(/[^a-z0-9]/g, '')));
        if (pre.length) row.brand = titleCase(pre.slice(0, 3).join(' '));
      }
      if (match.kind === 'product') { row.matchedProductId = o.id; row.size = o.size; row.unit = o.unit; row.dairy = o.dairy; }
      else { row.presetId = o.id; row.size = o.size; row.unit = o.unit; row.dairy = o.dairy; }
    }
    if (row.category) {
      const C = CATS[row.category];
      if (row.category === 'capsule') {
        row.unit = 'capsule'; if (packSize) { row.size = packSize; if (row.matchedProductId) { const mp = state.products.find((x) => x.id === row.matchedProductId); if (mp && mp.size !== packSize) row.matchedProductId = null; } }
        else if (!row.size) row.size = C.size;
        row.sleeves = sleeves !== null ? sleeves : (loose !== null ? 0 : (qty || 1)); row.packs = row.sleeves;
      } else if (size !== null) {
        const b = toBase(size, unit, row.category);
        if (b) { if (row.matchedProductId) { const mp = state.products.find((x) => x.id === row.matchedProductId); if (mp && (Math.abs(mp.size - b.v) > 0.5 || mp.unit !== b.u)) row.matchedProductId = null; } row.size = b.v; row.unit = b.u; }
      }
      if (!row.size) { row.size = C.size; row.unit = C.unit; row.sizeGuessed = true; }
      if (!row.unit) row.unit = C.unit;
    }
    if (!match) {
      // derive brand and name from leftover words
      const words = s.split(' ').filter(Boolean); let kwIdx = -1;
      if (row.category) {
        const kw = CAT_KW.find((k) => k[0] === row.category)[1];
        kwIdx = words.findIndex((w) => kw.test(w.toLowerCase()));
      }
      if (kwIdx > 0) { row.brand = titleCase(words.slice(0, Math.min(kwIdx, 3)).join(' ')); row.name = titleCase(words.slice(Math.min(kwIdx, 3)).join(' ')); }
      else if (kwIdx === 0 || kwIdx === -1) { row.brand = ''; row.name = titleCase(words.join(' ')); }
      if (row.category === 'capsule' && /nespresso/i.test(orig) && !row.brand) { row.brand = 'Nespresso'; row.name = titleCase(words.filter((w) => !/nespresso/i.test(w)).join(' ')); }
      if (!row.name && row.category) row.name = CATS[row.category].label;
      row.confidence = row.category ? 0.5 : 0;
      if (row.category) row.dairy = CATS[row.category].dairy;
    }
    row.relevant = !!row.category && !SKIP_LINE.test(orig.replace(/\b(items?)\b/gi, ''));
    if (!orig) return null;
    return row;
  }
  function parseQuickAdd(text, state) {
    return String(text).split(/\n|;/).map((l) => l.trim()).filter(Boolean).map((l) => parseProductLine(l, state)).filter(Boolean);
  }
  function parseReceipt(text, state) {
    const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 2);
    const rows = [], other = [];
    lines.forEach((l) => {
      const r = parseProductLine(l, state);
      if (r && r.relevant) rows.push(r); else other.push(l);
    });
    return { rows: rows, other: other };
  }
  // turn a confirm row into form data for SC.validateProductInput
  function rowToForm(row) {
    const C = CATS[row.category] || CATS.other; const preset = row.presetId ? SC.PRESETS.find((p) => p.id === row.presetId) : null;
    const f = preset ? SC.presetToForm(preset) : { category: row.category, density: C.density, shelfLifeDays: C.shelf, dairy: row.dairy !== null ? row.dairy : C.dairy, caffeine: '', shots: 1 };
    f.brand = row.brand; f.name = row.name; f.size = row.size; f.unit = row.unit; f.price = row.price === null || row.price === undefined ? '' : row.price; f.category = row.category;
    if (row.dairy !== null && row.dairy !== undefined) f.dairy = row.dairy;
    if (row.category === 'capsule') { f.sleeves = row.sleeves || 0; f.loose = row.loose || 0; if (!f.system) f.system = /vertuo/i.test(row.name + row.brand) ? 'vertuo' : 'original'; if (!f.intensity) f.intensity = 6; }
    else { f.sealed = row.packs; f.openMode = 'none'; }
    return f;
  }

  // ---------- recipe text ----------
  const UNIT_RE = '(tsp|teaspoons?|tbsp|tablespoons?|cups?|grams?|gr|g|millilit(?:er|re)s?|ml|liters?|litres?|l|fl\\.?\\s?oz|oz|ounces?|shots?|scoops?|pinch(?:es)?|dash(?:es)?|splash(?:es)?|handfuls?|capsules?|pods?|cubes?|drops?)';
  const NUM_RE = '(\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)';
  const QTY_UNIT = new RegExp(NUM_RE + '\\s*(?:-|to)?\\s*(?:' + NUM_RE + ')?\\s*' + UNIT_RE + '\\b', 'i');
  const VAGUE = /\b(splash|dash|pinch|drizzle|handful|little|bit|some|few|touch|dollop|to taste|scoops?|drops?|squirt|glug)\b/i;
  const TYPE_KW = [
    ['icecream', /ice[- ]?cream|gelato/],
    ['hojicha', /hojicha|houjicha/],
    ['matcha', /matcha/],
    ['espresso', /espresso|nespresso|ristretto|\bshots?\b|lungo|capsules?|\bpods?\b/],
    ['coffee', /cold brew|coffee|beans|grounds|instant/],
    ['tonic', /tonic|soda water|sparkling water/],
    ['milk', /milk|\boat\b|\bsoy\b|almond|creamer|\bcream\b|half[- ]and[- ]half|oatly/],
    ['syrup', /syrup|honey|sugar|sweetener|agave|caramel|vanilla|simple/],
  ];
  function typeOf(text) {
    const l = text.toLowerCase();
    for (let i = 0; i < TYPE_KW.length; i++) if (TYPE_KW[i][1].test(l)) return TYPE_KW[i][0];
    return null;
  }
  const STEP_VERB = /\b(then|until|stir|pour|whisk|add|mix|heat|steam|pull|fill|top|serve|shake|blend|brew|steep|strain|sift|combine|cover|scoop|froth|press|let|wait)\b/i;
  function isIce(l) { return /\bice\b(?![- ]?cream)|\bice cubes?\b|\biced\b/.test(l) && !/ice[- ]?cream/.test(l); }
  function isWater(l) { return /\bwater\b/.test(l) && !/tonic|soda|sparkling/.test(l); }
  function tempOf(l) {
    let m = l.match(/(\d{2,3})\s*°?\s*c\b/i); if (m) return Number(m[1]);
    m = l.match(/(\d{2,3})\s*°\s*f\b|(\d{2,3})\s*f\b/i); if (m) return Math.round(((Number(m[1] || m[2]) - 32) * 5) / 9);
    if (/\b(hot|boiling|warm)\b/.test(l)) return 80;
    return null;
  }
  function toMl(v, unit) {
    if (/^(ml|millilit)/.test(unit)) return v; if (/^(l$|lit)/.test(unit)) return v * 1000;
    if (/^(tsp|teaspoon)/.test(unit)) return v * 5; if (/^(tbsp|tablespoon)/.test(unit)) return v * 15; if (/^cup/.test(unit)) return v * 240;
    if (/oz|ounce/.test(unit)) return v * 29.57; return null;
  }
  // Parse one ingredient line into a draft row.
  function parseIngredientLine(raw) {
    let l = normalize(raw).toLowerCase().replace(/^[\s\-•*·▪●✔✓☐□>]+/, '').replace(/^\d+[.)]\s+(?=\D)/, '').trim();
    if (!l) return null;
    const row = { raw: raw, kind: 'ingredient', type: null, label: '', amount: null, unit: null, vague: false, optional: false, dairyPossible: false, notes: [] };
    if (/\boptional\b|if you (like|want)|\bto taste\b/.test(l)) row.optional = true;
    const clean = l.replace(/\(.*?\)/g, ' ');
    if (isIce(clean) && !typeOf(clean.replace(/\bice\b/g, ''))) { row.kind = 'ice'; return row; }
    // quantity
    let value = null, unit = null, vague = VAGUE.test(clean), m = clean.match(QTY_UNIT), rangeNote = false;
    if (m) {
      value = numFrom(m[1]); unit = m[3].toLowerCase(); if (m[2]) rangeNote = true;
      if (/^(scoop|pinch|dash|splash|handful|drop|cube)/.test(unit)) { vague = unit.indexOf('cube') < 0 || vague; if (unit.indexOf('cube') === 0) vague = false; unit = unit.replace(/s$/, ''); if (!/^cube/.test(unit)) { value = null; vague = true; } }
    } else {
      const wm = clean.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|half|single|double|triple|a|an)\b\s+(?:(?:fl\.? ?)?(shots?|tsp|teaspoons?|tbsp|tablespoons?|cups?)\b|(espresso|ristretto|lungo)\b|(?:shot|splash|dash|pinch|drizzle|bit|touch|little|dollop|glug|handful)\b)?/);
      const nm = clean.match(/^(\d+(?:[.,]\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)\s+(?=[a-z])/);
      if (nm) { value = numFrom(nm[1]); }
      else if (wm && (wm[2] || wm[3])) { value = wm[1] === 'a' || wm[1] === 'an' ? 1 : WORDNUM[wm[1]]; if (wm[2]) unit = wm[2].replace(/s$/, ''); }
      if (/\bsingle (espresso|shot)|\bdouble (espresso|shot)|\btriple (espresso|shot)/.test(clean)) { const dm = clean.match(/\b(single|double|triple)\b/); value = WORDNUM[dm[1]]; unit = 'shot'; }
    }
    const type = typeOf(clean);
    if (isWater(clean) && !type) {
      row.kind = 'water'; row.tempC = tempOf(l);
      if (value !== null && unit) { const ml = toMl(value, unit); if (ml !== null) row.amount = Math.round(ml); }
      if (row.amount === null) row.notes.push('Water amount unclear; set it in the recipe form.');
      return row;
    }
    row.type = type;
    if (!type) { row.notes.push('Could not tell which ingredient this is. Pick one.'); }
    if (type === 'milk' || type === 'icecream') row.dairyPossible = true;
    row.label = clean.replace(QTY_UNIT, '').replace(/^\W+|\W+$/g, '').replace(/\b(of|optional)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (rangeNote) row.notes.push('Range found. Using the first number.');
    // convert to recipe units
    if (value !== null) {
      let u = unit; let v = value;
      if (type === 'espresso') {
        if (!u || /^(shot|capsule|pod)/.test(u)) { row.amount = v; row.unit = 'shot'; if (u && /^(capsule|pod)/.test(u)) row.notes.push('Assuming 1 shot per capsule.'); }
        else { const ml = toMl(v, u); if (ml !== null) { row.amount = Math.max(1, Math.round(ml / 30)); row.unit = 'shot'; row.notes.push('Converted from volume at 30 ml per shot.'); } else if (/^(g|gr|gram)/.test(u)) { row.amount = Math.max(1, Math.round(v / SC.GRAMS_PER_SHOT)); row.unit = 'shot'; row.notes.push('Converted from grams at 9 g per shot.'); } }
        if (row.unit === 'shot' && row.amount !== null && /\bdouble\b/.test(clean) && !m) { row.amount = 2; }
      } else if (u && /^(tsp|teaspoon)/.test(u)) { row.amount = v; row.unit = 'tsp'; }
      else if (u && /^(tbsp|tablespoon)/.test(u)) { row.amount = v; row.unit = 'tbsp'; }
      else if (u && /^cup/.test(u)) { row.amount = v; row.unit = 'cup'; }
      else if (u && /^(g|gr|gram)/.test(u)) { row.amount = v; row.unit = 'g'; }
      else if (u && /^(ml|millilit)/.test(u)) { row.amount = v; row.unit = 'ml'; }
      else if (u && /^(l$|lit)/.test(u)) { row.amount = v * 1000; row.unit = 'ml'; }
      else if (u && /oz|ounce/.test(u)) {
        const liquid = type === 'milk' || type === 'syrup' || type === 'tonic';
        row.amount = Math.round(v * (liquid ? 29.57 : 28.35) * 10) / 10; row.unit = liquid ? 'ml' : 'g'; row.notes.push('Converted from ounces.');
      } else if (!u) { row.amount = v; row.unit = null; row.notes.push('No unit found. Pick one.'); }
    }
    if (type === 'espresso' && row.amount === null && !vague && /\b(espresso|shot)\b/.test(clean)) { row.amount = 1; row.unit = 'shot'; row.notes.push('No number given; assuming 1 shot.'); }
    if (row.amount === null || !row.unit) { row.vague = row.amount === null; if (row.amount === null) row.notes.push('Needs a number before it can be saved.'); }
    if (!row.unit && type) { row.unit = SC.BASE_UNIT[type] === 'shot' ? 'shot' : SC.BASE_UNIT[type]; }
    if (type === 'other' || !type) row.unit = row.unit || 'g';
    return row;
  }

  function parseRecipeText(text) {
    const out = { title: '', servings: null, ingredients: [], water: null, ice: false, steps: [], link: '', warnings: [] };
    let lines = String(text).split(/\r?\n/).map((l) => normalize(l)).filter(Boolean);
    // links
    lines = lines.filter((l) => { const m = l.match(/https?:\/\/\S+/i); if (m) { out.link = out.link || m[0]; return l.replace(m[0], '').replace(/\W/g, '').length > 3; } return true; }).map((l) => l.replace(/https?:\/\/\S+/gi, '').trim());
    // merge split overlay lines: "2 tsp" / "matcha powder", "oat milk" / "150 ml"
    const hasQty = (l) => QTY_UNIT.test(l) || /^\d+(?:[.,]\d+)?\s+\S/.test(l);
    const isHeader = (l) => /^(ingredients?|what you need|you('ll| will) need|steps?|method|instructions?|directions?|how to( make)?|preparation|recipe)\s*:?\s*$/i.test(l);
    const merged = [];
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i], b = lines[i + 1];
      if (b !== undefined && a.length < 18 && b.length < 28 && !isHeader(a) && !isHeader(b) && !/^\d+[.)]\s/.test(a) && !/^\d+[.)]\s/.test(b) &&
        ((hasQty(a) && !typeOf(a) && !isWater(a) && !isIce(a) && typeOf(b) && !hasQty(b)) || (typeOf(a) && !hasQty(a) && a.split(' ').length <= 3 && hasQty(b) && !typeOf(b) && b.split(' ').length <= 3))) { merged.push(hasQty(a) ? a + ' ' + b : b + ' ' + a); i++; } else merged.push(a);
    }
    lines = merged;
    let mode = null; let firstLine = true;
    const pushIngredient = (l) => {
      const parts = l.split(/;\s*|,\s+(?=[\d½¼¾a-z])|\s+\+\s+/i).filter((x) => x.trim());
      const useParts = parts.length > 1 && parts.every((x) => hasQty(x) || typeOf(x) || isIce(x) || isWater(x));
      (useParts ? parts : [l]).forEach((x) => {
        const r = parseIngredientLine(x); if (!r) return;
        if (r.kind === 'ice') out.ice = true;
        else if (r.kind === 'water') { out.water = { ml: r.amount, tempC: r.tempC }; if (r.amount === null) out.water.ml = null; }
        else out.ingredients.push(r);
      });
    };
    lines.forEach((line) => {
      let l = line;
      const sv = l.match(/\b(?:serves?|servings?|makes|yields?)\s*:?\s*(\d+)/i);
      if (sv && l.length < 40) { out.servings = Number(sv[1]); firstLine = false; return; }
      if (isHeader(l)) { mode = /^(ingredients?|what you need|you)/i.test(l) ? 'ingr' : /^recipe/i.test(l) ? null : 'steps'; firstLine = false; return; }
      const hm = l.match(/^(ingredients?|steps?|method|instructions?|directions?)\s*:\s*(.+)$/i);
      if (hm) { mode = /^ingredient/i.test(hm[1]) ? 'ingr' : 'steps'; l = hm[2]; }
      const numbered = /^\d+[.)]\s+/.test(l); const stripped = l.replace(/^[\s\-•*·▪●✔✓☐□>]+/, '');
      if (firstLine && !mode && !out.title && !hasQty(stripped) && !VAGUE.test(stripped) && !/^[-•*·▪●✔✓☐□]/.test(l) && stripEmoji(stripped).length <= 60 && stripEmoji(stripped).length > 1 && lines.some(hasQty)) {
        out.title = titleCase(stripEmoji(stripped).replace(/[:!]+$/, '')); firstLine = false; return;
      }
      const ingredientLike = (hasQty(stripped) || ((typeOf(stripped) || isIce(stripped) || isWater(stripped)) && stripped.length < 45 && !STEP_VERB.test(stripped.split(' ')[0] || ''))) && !numbered;
      const stepLike = numbered || mode === 'steps' || (stripped.length > 45 && STEP_VERB.test(stripped)) || (/[.!]$/.test(stripped) && stripped.length > 30 && STEP_VERB.test(stripped));
      if (mode === 'ingr' ? !stepLike || ingredientLike : (ingredientLike && !stepLike)) { pushIngredient(stripped); }
      else if (stepLike) { out.steps.push(stripped.replace(/^\d+[.)]\s+/, '').replace(/^[-•*·▪●]\s*/, '')); }
      else if (firstLine && stripped.length <= 60 && !hasQty(stripped)) { out.title = titleCase(stripEmoji(stripped).replace(/[:!]+$/, '')); }
      else if (mode !== 'ingr') { out.steps.push(stripped); }
      firstLine = false;
    });
    if (!out.ice && out.steps.some((x) => /\bice\b(?![- ]?cream)/i.test(x))) out.ice = true;
    if (!out.ingredients.length) out.warnings.push('No ingredients found. Check the text or add them by hand.');
    return out;
  }

  // Draft -> per-serving recipe. rows: [{type,label,amount,unit,optional,dairyPossible,intensity}]
  function draftToRecipe(d) {
    const errors = []; const servings = SC.parseNum(d.servings, { min: 0, minExclusive: true, max: 100 });
    if (!servings.ok) errors.push({ row: -1, msg: 'Servings: ' + servings.error });
    const name = String(d.name || '').trim(); if (!name) errors.push({ row: -1, msg: 'Give the recipe a name.' });
    const ings = [];
    (d.ingredients || []).forEach((r, i) => {
      if (!r.type || SC.SLOT_TYPES.indexOf(r.type) < 0) { errors.push({ row: i, msg: 'Choose an ingredient type.' }); return; }
      const a = SC.parseNum(r.amount, { min: 0, minExclusive: true, max: 100000 });
      if (!a.ok) { errors.push({ row: i, msg: 'Needs a number: ' + a.error + '.' }); return; }
      if (SC.RECIPE_UNITS.indexOf(r.unit) < 0) { errors.push({ row: i, msg: 'Choose a unit.' }); return; }
      if (r.type === 'espresso' && r.unit !== 'shot') { errors.push({ row: i, msg: 'Espresso is measured in shots.' }); return; }
      const ing = { type: r.type, amount: SC.round(a.value / (servings.ok ? servings.value : 1), 3), unit: r.unit };
      if (r.type === 'other' && r.label) ing.label = String(r.label).slice(0, 40);
      if (r.dairyPossible) ing.dairyPossible = true; if (r.optional) ing.optional = true; if (r.intensity) ing.intensity = r.intensity;
      ings.push(ing);
    });
    if (!ings.length && !errors.length) errors.push({ row: -1, msg: 'Add at least one ingredient.' });
    let water = null;
    if (d.waterMl !== '' && d.waterMl !== null && d.waterMl !== undefined) {
      const w = SC.parseNum(d.waterMl, { min: 0, max: 5000, blank: true });
      if (!w.ok) errors.push({ row: -1, msg: 'Water: ' + w.error }); else if (w.value) {
        let t = null; if (d.waterTemp !== '' && d.waterTemp !== null && d.waterTemp !== undefined) { const tt = SC.parseNum(d.waterTemp, { min: 0, max: 100, blank: true }); if (!tt.ok) errors.push({ row: -1, msg: 'Water temperature: ' + tt.error }); else t = tt.value; }
        water = { ml: SC.round(w.value / (servings.ok ? servings.value : 1), 1), tempC: t };
      }
    }
    if (errors.length) return { ok: false, errors: errors };
    return { ok: true, recipe: { id: d.id || SC.uid(), name: name, builtin: false, fav: !!d.fav, serve: d.serve === 'iced' ? 'iced' : 'hot', ingredients: ings, water: water, ice: !!d.ice,
      steps: (d.steps || []).map((s) => String(s).trim()).filter(Boolean), note: String(d.note || '').slice(0, 300), sourceLink: d.sourceLink ? String(d.sourceLink).slice(0, 300) : '' } };
  }

  return { normalize, categoryOf, tokensOf, parseProductLine, parseQuickAdd, parseReceipt, rowToForm, parseIngredientLine, parseRecipeText, draftToRecipe, typeOf };
})(typeof module !== 'undefined' ? require('./core.js') : SC);
if (typeof module !== 'undefined') module.exports = SCP;

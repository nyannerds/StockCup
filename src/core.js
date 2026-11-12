/* StockCup core logic: pure functions, no DOM. Tested in Node (tests/), bundled into index.html by build.js. */
const SC = (function () {
  'use strict';

  const APP_VERSION = 1;
  const EPS = 1e-6;
  const SHOT_CAFFEINE = 63; // mg per espresso shot, commonly cited average
  const GRAMS_PER_SHOT = 9;
  const FILL = { full: 1, half: 0.5, quarter: 0.25, almost: 0.1 };
  const FILL_LABEL = { full: 'Full', half: 'Half', quarter: 'Quarter', almost: 'Almost empty' };
  const VOL_ML = { ml: 1, tsp: 5, tbsp: 15, cup: 240 };

  // ---------- small helpers ----------
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const round = (n, d) => { const f = Math.pow(10, d === undefined ? 3 : d); return Math.round((n + Number.EPSILON) * f) / f; };
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pad = (n) => String(n).padStart(2, '0');
  function localDate(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function localDateTime(d) { d = d || new Date(); return localDate(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dayNum(iso) { const p = String(iso).slice(0, 10).split('-').map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000); }
  function daysBetween(a, b) { return dayNum(b) - dayNum(a); }
  function addDays(iso, n) { const d = new Date((dayNum(iso) + n) * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addMonths(iso, n) {
    const p = iso.slice(0, 10).split('-').map(Number); let m = p[1] - 1 + n; const y = p[0] + Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return y + '-' + pad(m + 1) + '-' + pad(Math.min(p[2], last));
  }
  function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(Date.parse(s.slice(0, 10))); }
  function fmtNum(n, d) { if (n === null || n === undefined || !isFinite(n)) return '?'; const v = round(n, d === undefined ? 2 : d); return String(v); }

  // ---------- validation ----------
  // Strict numeric parser: rejects blank, NaN, Infinity, exponents, negatives (unless min allows), words.
  function parseNum(v, o) {
    o = o || {};
    const min = o.min === undefined ? 0 : o.min, max = o.max === undefined ? 1e9 : o.max;
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
      return o.blank ? { ok: true, value: null } : { ok: false, error: 'Required' };
    }
    let n;
    if (typeof v === 'number') n = v;
    else {
      const s = String(v).trim().replace(/^(\d+),(\d{1,2})$/, '$1.$2');
      if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return { ok: false, error: 'Enter a number' };
      n = Number(s);
    }
    if (!isFinite(n)) return { ok: false, error: 'Enter a number' };
    if (o.int && Math.floor(n) !== n) return { ok: false, error: 'Whole numbers only' };
    if (o.minExclusive ? n <= min : n < min) return { ok: false, error: o.minExclusive ? 'Must be more than ' + min : 'Must be ' + min + ' or more' };
    if (n > max) return { ok: false, error: 'Must be ' + max + ' or less' };
    return { ok: true, value: n };
  }

  // ---------- units ----------
  function convert(amount, from, to, density) {
    if (from === to) return amount;
    const d = density > 0 ? density : 1;
    let ml;
    if (from in VOL_ML) ml = amount * VOL_ML[from];
    else if (from === 'g') ml = amount / d;
    else throw new Error('Cannot convert from ' + from);
    if (to in VOL_ML) return ml / VOL_ML[to];
    if (to === 'g') return ml * d;
    throw new Error('Cannot convert to ' + to);
  }

  // ---------- categories & recipe slot types ----------
  const CATEGORIES = {
    matcha: { label: 'Matcha powder', unit: 'g', size: 30, density: 0.4, shelf: 40, caf: 30, thr: 20, dairy: false },
    hojicha: { label: 'Hojicha powder', unit: 'g', size: 50, density: 0.4, shelf: 60, caf: 7, thr: 20, dairy: false },
    coffee: { label: 'Coffee beans / grounds', unit: 'g', size: 250, density: 0.5, shelf: 30, caf: 7, thr: 100, dairy: false },
    capsule: { label: 'Nespresso capsules', unit: 'capsule', size: 10, density: 1, shelf: null, caf: SHOT_CAFFEINE, thr: 10, dairy: false },
    milk: { label: 'Milk', unit: 'ml', size: 1000, density: 1.03, shelf: 7, caf: 0, thr: 300, dairy: true },
    syrup: { label: 'Syrup', unit: 'ml', size: 750, density: 1.3, shelf: 180, caf: 0, thr: 100, dairy: false },
    tonic: { label: 'Tonic water', unit: 'ml', size: 500, density: 1.0, shelf: 3, caf: 0, thr: 300, dairy: false },
    icecream: { label: 'Ice cream', unit: 'g', size: 450, density: 0.55, shelf: 60, caf: 0, thr: null, dairy: true },
    other: { label: 'Other', unit: 'g', size: 100, density: 1, shelf: 30, caf: 0, thr: null, dairy: false },
  };
  const SLOT_TYPES = ['matcha', 'hojicha', 'espresso', 'coffee', 'milk', 'syrup', 'tonic', 'icecream', 'other'];
  const SLOT_LABEL = { matcha: 'matcha powder', hojicha: 'hojicha powder', espresso: 'espresso', coffee: 'coffee beans / grounds', milk: 'milk', syrup: 'syrup', tonic: 'tonic water', icecream: 'ice cream', other: 'other' };
  const BASE_UNIT = { matcha: 'g', hojicha: 'g', coffee: 'g', espresso: 'shot', milk: 'ml', syrup: 'ml', tonic: 'ml', icecream: 'g', other: 'g' };
  const RECIPE_UNITS = ['g', 'ml', 'tsp', 'tbsp', 'cup', 'shot'];

  // ---------- built-in recipes ----------
  const BUILTIN_RECIPES = [
    { id: 'r_matcha_latte', name: 'Matcha latte', serve: 'hot',
      ingredients: [{ type: 'matcha', amount: 2, unit: 'g' }, { type: 'milk', amount: 150, unit: 'ml', dairyPossible: true }],
      water: { ml: 40, tempC: 80 }, ice: false,
      steps: ['Sift 2 g matcha into a bowl.', 'Add 40 ml water at 80 °C and whisk in a zig-zag for 20 seconds until frothy.', 'Heat 150 ml milk until steaming, about 60 to 65 °C, and froth it.', 'Pour the matcha into a mug and top with the milk.'],
      note: 'Classic hot matcha latte.' },
    { id: 'r_iced_matcha', name: 'Iced matcha', serve: 'iced',
      ingredients: [{ type: 'matcha', amount: 2, unit: 'g' }, { type: 'milk', amount: 150, unit: 'ml', dairyPossible: true }, { type: 'syrup', amount: 10, unit: 'ml', optional: true }],
      water: { ml: 40, tempC: 80 }, ice: true,
      steps: ['Sift 2 g matcha into a bowl.', 'Whisk with 40 ml water at 80 °C until smooth and frothy.', 'Fill a glass with ice, add the optional syrup, then pour in 150 ml cold milk.', 'Pour the matcha over the top.'],
      note: 'Syrup is optional.' },
    { id: 'r_dirty_matcha', name: 'Dirty matcha', serve: 'iced',
      ingredients: [{ type: 'matcha', amount: 2, unit: 'g' }, { type: 'milk', amount: 120, unit: 'ml', dairyPossible: true }, { type: 'espresso', amount: 1, unit: 'shot', intensity: 'high' }],
      water: { ml: 40, tempC: 80 }, ice: true,
      steps: ['Whisk 2 g matcha with 40 ml water at 80 °C.', 'Fill a glass with ice and 120 ml milk.', 'Pour the matcha over the milk.', 'Pull 1 espresso shot and pour it on top.'],
      note: 'A bold, high-intensity espresso works best.' },
    { id: 'r_espresso_tonic', name: 'Espresso tonic', serve: 'iced',
      ingredients: [{ type: 'espresso', amount: 1, unit: 'shot', intensity: 'medium' }, { type: 'tonic', amount: 150, unit: 'ml' }],
      water: null, ice: true,
      steps: ['Fill a glass with ice.', 'Pour in 150 ml chilled tonic water.', 'Pull 1 espresso shot and pour it slowly over the back of a spoon.'],
      note: 'Do not stir; it looks best layered.' },
    { id: 'r_flat_white', name: 'Flat white', serve: 'hot',
      ingredients: [{ type: 'espresso', amount: 2, unit: 'shot', intensity: 'low' }, { type: 'milk', amount: 120, unit: 'ml', dairyPossible: true }],
      water: null, ice: false,
      steps: ['Pull 2 espresso shots into a warm cup.', 'Steam 120 ml milk to a thin, glossy microfoam at about 60 to 65 °C.', 'Pour the milk over the espresso.'],
      note: 'A smoother, lower-intensity espresso suits this drink.' },
    { id: 'r_cold_brew', name: 'Cold brew', serve: 'iced',
      ingredients: [{ type: 'coffee', amount: 25, unit: 'g' }, { type: 'milk', amount: 50, unit: 'ml', dairyPossible: true, optional: true }],
      water: { ml: 300, tempC: null }, ice: true,
      steps: ['Combine 25 g coarse ground coffee with 300 ml cold water.', 'Cover and steep for 12 hours in the fridge.', 'Strain through a filter, then pour over ice. Add milk if you like.'],
      note: 'Start it the night before.' },
    { id: 'r_hojicha_latte', name: 'Hojicha latte', serve: 'hot',
      ingredients: [{ type: 'hojicha', amount: 2, unit: 'g' }, { type: 'milk', amount: 150, unit: 'ml', dairyPossible: true }],
      water: { ml: 40, tempC: 80 }, ice: false,
      steps: ['Sift 2 g hojicha powder into a bowl.', 'Whisk with 40 ml water at 80 °C until smooth.', 'Heat and froth 150 ml milk, then pour it over the hojicha.'],
      note: 'Roasted and low in caffeine.' },
    { id: 'r_affogato', name: 'Affogato', serve: 'hot',
      ingredients: [{ type: 'icecream', amount: 100, unit: 'g', dairyPossible: true }, { type: 'espresso', amount: 1, unit: 'shot', intensity: 'high' }],
      water: null, ice: false,
      steps: ['Scoop 100 g ice cream into a cup.', 'Pull 1 hot espresso shot and pour it over the ice cream right before serving.'],
      note: 'Serve straight away.' },
  ];

  // ---------- preset starter catalogue (editable, not authoritative) ----------
  function P(id, brand, name, category, size, extra) { return Object.assign({ id: id, brand: brand, name: name, category: category, size: size, unit: CATEGORIES[category].unit }, extra || {}); }
  function CAP(id, name, system, intensity, cupSize, shots) {
    return P(id, 'Nespresso', (system === 'original' ? 'Original ' : 'Vertuo ') + name, 'capsule', 10, { capsule: { system: system, intensity: intensity, cupSize: cupSize, shots: shots }, caffeine: SHOT_CAFFEINE * shots });
  }
  const PRESETS = [
    P('pre_matcha_cer', 'Generic', 'Ceremonial matcha', 'matcha', 30, { shelf: 40 }),
    P('pre_matcha_cul', 'Generic', 'Culinary matcha', 'matcha', 100, { shelf: 60 }),
    P('pre_hojicha', 'Generic', 'Hojicha powder', 'hojicha', 50, { shelf: 60 }),
    P('pre_milk_whole', 'Generic', 'Whole milk', 'milk', 1000, { dairy: true }),
    P('pre_milk_lf', 'Generic', 'Lactose-free milk', 'milk', 1000, { dairy: true }),
    P('pre_milk_oat', 'Generic', 'Oat milk (barista)', 'milk', 1000, { dairy: false }),
    P('pre_milk_soy', 'Generic', 'Soy milk', 'milk', 1000, { dairy: false }),
    P('pre_milk_almond', 'Generic', 'Almond milk', 'milk', 1000, { dairy: false }),
    P('pre_syrup_van', 'Generic', 'Vanilla syrup', 'syrup', 750),
    P('pre_syrup_car', 'Generic', 'Caramel syrup', 'syrup', 750),
    P('pre_syrup_simple', 'Generic', 'Simple syrup', 'syrup', 500, { density: 1.3 }),
    P('pre_tonic', 'Generic', 'Tonic water', 'tonic', 500),
    P('pre_beans', 'Generic', 'Espresso beans', 'coffee', 250),
    P('pre_grounds', 'Generic', 'Coarse ground coffee', 'coffee', 250),
    P('pre_icecream', 'Generic', 'Vanilla ice cream', 'icecream', 450, { dairy: true }),
    CAP('pre_n_ristretto', 'Ristretto', 'original', 9, 25, 1),
    CAP('pre_n_arpeggio', 'Arpeggio', 'original', 9, 40, 1),
    CAP('pre_n_roma', 'Roma', 'original', 8, 40, 1),
    CAP('pre_n_livanto', 'Livanto', 'original', 6, 40, 1),
    CAP('pre_n_volluto', 'Volluto', 'original', 4, 40, 1),
    CAP('pre_n_kazaar', 'Kazaar', 'original', 12, 25, 1),
    CAP('pre_v_forte', 'Espresso Forte', 'vertuo', 9, 40, 1),
    CAP('pre_v_scuro', 'Double Espresso Scuro', 'vertuo', 8, 80, 2),
    CAP('pre_v_chiaro', 'Double Espresso Chiaro', 'vertuo', 5, 80, 2),
  ];

  // ---------- state ----------
  function defaultThresholds() { const t = {}; Object.keys(CATEGORIES).forEach((k) => { t[k] = CATEGORIES[k].thr; }); return t; }
  function builtinRecipes() { return BUILTIN_RECIPES.map((r) => Object.assign(clone(r), { builtin: true, fav: false })); }
  function defaultState() {
    return {
      app: 'stockcup', version: APP_VERSION,
      settings: { theme: 'auto', tempUnit: 'C', imperial: false, onboarded: false, activePerson: 'p_me', recountMark: 0, lastUsed: {}, sampleLoaded: false },
      people: [{ id: 'p_me', name: 'Me' }],
      machines: [], products: [], recipes: builtinRecipes(), logs: [], adjustments: [],
      thresholds: defaultThresholds(), shopping: [],
    };
  }

  // ---------- stock model ----------
  function stockOf(p) {
    if (p.category === 'capsule') return { amount: p.count || 0, unknown: false, sealed: 0, open: null };
    const unknown = !!(p.open && p.open.amount === null);
    const openAmt = p.open && p.open.amount !== null ? p.open.amount : 0;
    return { amount: round(p.sealed * p.size + openAmt), unknown: unknown, sealed: p.sealed, open: p.open };
  }
  function productLabel(p) { return p.brand + ' ' + p.name; }
  function snapshot(p) { return { sealed: p.sealed, count: p.count || 0, open: p.open ? { amount: p.open.amount, openedAt: p.open.openedAt } : null }; }
  function setSnapshot(p, s) { p.sealed = s.sealed; p.count = s.count; p.open = s.open ? { amount: s.open.amount, openedAt: s.open.openedAt } : null; }
  function sameSnapshot(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function addToOpen(p, n, openedAt) {
    if (p.open && p.open.amount === null) return;
    if (!p.open) p.open = { amount: round(n), openedAt: openedAt };
    else p.open.amount = round(p.open.amount + n);
    while (p.open && p.open.amount >= p.size - EPS) {
      p.sealed += 1; p.open.amount = round(p.open.amount - p.size);
      if (p.open.amount <= EPS) p.open = null;
    }
  }
  // Deduct `amount` (product units). Mutates p. Never goes below zero.
  function deduct(p, amount, dateISO) {
    const res = { requested: amount, deducted: 0, shortfall: 0, opened: 0, chunks: [], unknown: false };
    if (p.category === 'capsule') {
      const t = Math.min(p.count || 0, amount); p.count = (p.count || 0) - t;
      res.deducted = t; res.shortfall = round(amount - t); res.chunks.push({ k: 'cap', n: t }); return res;
    }
    if (p.open && p.open.amount === null) { res.unknown = true; return res; } // cannot deduct from an unknown amount
    let rem = amount;
    if (p.open && p.open.amount > 0) {
      const take = Math.min(p.open.amount, rem);
      res.chunks.push({ k: 'old', n: round(take), openedAt: p.open.openedAt });
      p.open.amount = round(p.open.amount - take); rem = round(rem - take);
      if (p.open.amount <= EPS) p.open = null;
    }
    while (rem > EPS && p.sealed > 0) {
      p.sealed -= 1; res.opened += 1;
      const take = Math.min(p.size, rem);
      res.chunks.push({ k: 'new', n: round(take), openedAt: dateISO });
      p.open = { amount: round(p.size - take), openedAt: dateISO }; rem = round(rem - take);
      if (p.open.amount <= EPS) p.open = null;
    }
    res.deducted = round(amount - rem); res.shortfall = rem > EPS ? round(rem) : 0;
    return res;
  }
  function restoreChunks(p, chunks) {
    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i];
      if (c.k === 'cap') p.count = (p.count || 0) + c.n;
      else if (c.k === 'pack') {
        if (p.category === 'capsule') p.count = Math.max(0, (p.count || 0) - c.n * p.size);
        else p.sealed = Math.max(0, p.sealed - c.n);
      } else addToOpen(p, c.n, c.openedAt);
    }
  }
  function addPacks(p, n) {
    if (p.category === 'capsule') p.count = (p.count || 0) + n * p.size; else p.sealed += n;
  }
  function openAPack(p, dateISO) {
    if (p.category === 'capsule' || p.open || p.sealed < 1) return false;
    p.sealed -= 1; p.open = { amount: p.size, openedAt: dateISO }; return true;
  }
  function freshness(p, today) {
    if (p.category === 'capsule') return null;
    if (!p.open) return { state: 'sealed' };
    if (!p.shelfLifeDays) return { state: 'none' };
    const days = daysBetween(p.open.openedAt, today);
    const pct = days / p.shelfLifeDays;
    return { state: pct >= 1 ? 'past' : pct >= 0.75 ? 'warn' : 'fresh', days: days, pct: pct, left: p.shelfLifeDays - days };
  }

  // ---------- product validation / creation ----------
  function validateProductInput(f, opts) {
    opts = opts || {}; const today = opts.today || localDate(); const errors = {}; const v = {};
    v.category = f.category; if (!CATEGORIES[v.category]) errors.category = 'Choose a category';
    const C = CATEGORIES[v.category] || CATEGORIES.other;
    v.brand = String(f.brand || '').trim(); if (!v.brand) errors.brand = 'Brand is required'; else if (v.brand.length > 60) errors.brand = 'Too long';
    v.name = String(f.name || '').trim(); if (!v.name) errors.name = 'Name is required'; else if (v.name.length > 80) errors.name = 'Too long';
    const size = parseNum(f.size, { min: 0, minExclusive: true, max: 100000, int: v.category === 'capsule' });
    if (!size.ok) errors.size = size.error; else v.size = size.value;
    if (v.category === 'capsule') v.unit = 'capsule';
    else if (v.category === 'other') { v.unit = f.unit === 'ml' ? 'ml' : 'g'; }
    else v.unit = C.unit;
    if (!['g', 'ml', 'capsule'].includes(v.unit)) errors.unit = 'Choose a unit';
    const price = parseNum(f.price, { min: 0, max: 1e6, blank: true }); if (!price.ok) errors.price = price.error; else v.price = price.value;
    v.dairy = !!f.dairy;
    const dens = parseNum(f.density === '' || f.density === undefined ? C.density : f.density, { min: 0, minExclusive: true, max: 20 });
    if (!dens.ok) errors.density = dens.error; else v.density = dens.value;
    if (v.category !== 'capsule') {
      const shelf = parseNum(f.shelfLifeDays === undefined ? C.shelf : f.shelfLifeDays, { min: 1, max: 3650, int: true, blank: true });
      if (!shelf.ok) errors.shelfLifeDays = shelf.error; else v.shelfLifeDays = shelf.value;
    } else v.shelfLifeDays = null;
    const caf = parseNum(f.caffeine, { min: 0, max: 5000, blank: true }); if (!caf.ok) errors.caffeine = caf.error; else v.caffeine = caf.value;
    if (v.category === 'capsule') {
      const cap = {};
      cap.system = f.system === 'vertuo' ? 'vertuo' : f.system === 'original' ? 'original' : null; if (!cap.system) errors.system = 'Choose Original or Vertuo';
      const inten = parseNum(f.intensity, { min: 1, max: 13, int: true }); if (!inten.ok) errors.intensity = inten.error; else cap.intensity = inten.value;
      const cup = parseNum(f.cupSize, { min: 0, minExclusive: true, max: 1000, blank: true }); if (!cup.ok) errors.cupSize = cup.error; else cap.cupSize = cup.value;
      const shots = parseNum(f.shots === '' || f.shots === undefined ? 1 : f.shots, { min: 1, max: 4, int: true }); if (!shots.ok) errors.shots = shots.error; else cap.shots = shots.value;
      v.capsule = cap;
    }
    if (v.category === 'coffee') {
      const g = parseNum(f.gramsPerShot === '' || f.gramsPerShot === undefined ? GRAMS_PER_SHOT : f.gramsPerShot, { min: 0, minExclusive: true, max: 100 });
      if (!g.ok) errors.gramsPerShot = g.error; else v.gramsPerShot = g.value;
    }
    if (opts.withStock) {
      if (v.category === 'capsule') {
        const sl = parseNum(f.sleeves === undefined || f.sleeves === '' ? 0 : f.sleeves, { min: 0, max: 10000, int: true });
        const lo = parseNum(f.loose === undefined || f.loose === '' ? 0 : f.loose, { min: 0, max: 100000, int: true });
        if (!sl.ok) errors.sleeves = sl.error; if (!lo.ok) errors.loose = lo.error;
        if (sl.ok && lo.ok && size.ok) v.count = sl.value * size.value + lo.value;
      } else {
        const sealed = parseNum(f.sealed === undefined || f.sealed === '' ? 0 : f.sealed, { min: 0, max: 10000, int: true });
        if (!sealed.ok) errors.sealed = sealed.error; else v.sealed = sealed.value;
        const mode = f.openMode || 'none';
        const od = f.openDate || today;
        if (mode !== 'none') {
          if (!validDate(od)) errors.openDate = 'Enter a valid date'; else if (od.slice(0, 10) > today) errors.openDate = 'Cannot be in the future';
        }
        if (mode === 'none') v.open = null;
        else if (mode === 'unknown') v.open = { amount: null, openedAt: od.slice(0, 10) };
        else if (FILL[mode] !== undefined && size.ok) v.open = { amount: round(size.value * FILL[mode]), openedAt: od.slice(0, 10) };
        else if (!FILL[mode]) errors.openMode = 'Choose a fill level';
      }
    }
    return { errors: errors, ok: Object.keys(errors).length === 0, value: v };
  }
  function buildProduct(v, existing) {
    const p = existing || { id: uid(), sealed: 0, count: 0, open: null, created: localDate() };
    p.category = v.category; p.brand = v.brand; p.name = v.name; p.size = v.size; p.unit = v.unit;
    p.price = v.price === undefined ? null : v.price; p.dairy = !!v.dairy; p.density = v.density;
    p.shelfLifeDays = v.shelfLifeDays === undefined ? null : v.shelfLifeDays; p.caffeine = v.caffeine === undefined ? null : v.caffeine;
    if (v.capsule) p.capsule = v.capsule; else delete p.capsule;
    if (v.gramsPerShot) p.gramsPerShot = v.gramsPerShot; else delete p.gramsPerShot;
    if (v.count !== undefined) { p.count = v.count; p.sealed = 0; p.open = null; }
    if (v.sealed !== undefined) { p.sealed = v.sealed; p.open = v.open || null; p.count = 0; }
    return p;
  }
  function presetToForm(pr) {
    const C = CATEGORIES[pr.category];
    return {
      category: pr.category, brand: pr.brand, name: pr.name, size: pr.size, unit: pr.unit,
      dairy: pr.dairy !== undefined ? pr.dairy : C.dairy, density: pr.density || C.density,
      shelfLifeDays: pr.shelf !== undefined ? pr.shelf : C.shelf, caffeine: pr.caffeine !== undefined ? pr.caffeine : '',
      system: pr.capsule ? pr.capsule.system : '', intensity: pr.capsule ? pr.capsule.intensity : '', cupSize: pr.capsule ? pr.capsule.cupSize : '', shots: pr.capsule ? pr.capsule.shots : 1,
    };
  }
  function addProduct(state, f, today) {
    const r = validateProductInput(f, { withStock: true, today: today });
    if (!r.ok) return r;
    const p = buildProduct(r.value);
    if (!state.products.some((x) => x.category === p.category && x.usual)) p.usual = true;
    state.products.push(p);
    return { ok: true, product: p, errors: {} };
  }

  // ---------- machines ----------
  function machineSystems(state) { return new Set(state.machines.map((m) => m.system)); }
  function capsulesEnabled(state) { return state.machines.length > 0; }
  function isUsable(state, p) { return p.category !== 'capsule' || machineSystems(state).has(p.capsule.system); }
  function descaleStatus(m, today) {
    const monthsDue = addMonths(m.lastDescaled, m.descaleMonths);
    const byCaps = m.caps >= m.descaleCaps, byTime = today >= monthsDue;
    return { due: byCaps || byTime, byCaps: byCaps, byTime: byTime, capsLeft: Math.max(0, m.descaleCaps - m.caps), dueDate: monthsDue };
  }
  function makeMachine(name, system, today) { return { id: uid(), name: name, system: system, descaleCaps: 300, descaleMonths: 3, caps: 0, lastDescaled: today || localDate() }; }

  // ---------- index / supply ----------
  function buildIndex(state) {
    const systems = machineSystems(state); const byCat = {};
    for (let i = 0; i < state.products.length; i++) {
      const p = state.products[i];
      if (p.category === 'capsule' && !systems.has(p.capsule.system)) continue;
      (byCat[p.category] = byCat[p.category] || []).push(p);
    }
    return { systems: systems, byCat: byCat };
  }
  function slotProducts(idx, slot) {
    if (slot.type === 'espresso') return (idx.byCat.capsule || []).concat(idx.byCat.coffee || []);
    const list = idx.byCat[slot.type] || [];
    if (slot.type === 'other' && slot.label) { const l = slot.label.toLowerCase(); return list.filter((p) => productLabel(p).toLowerCase().indexOf(l) >= 0); }
    return list;
  }
  function gramsPerShot(p) { return p.gramsPerShot || GRAMS_PER_SHOT; }
  function productSupply(p, slot) {
    const st = stockOf(p); let amt;
    if (slot.type === 'espresso') amt = p.category === 'capsule' ? st.amount * p.capsule.shots : st.amount / gramsPerShot(p);
    else amt = convert(st.amount, p.unit, slot.unit, p.density);
    return { amount: amt, unknown: st.unknown };
  }
  function slotSupply(idx, slot, dfOnly) {
    let have = 0, unknown = false; const prods = slotProducts(idx, slot);
    for (let i = 0; i < prods.length; i++) {
      const p = prods[i]; if (dfOnly && p.dairy) continue;
      const s = productSupply(p, slot); have += s.amount; if (s.unknown) unknown = true;
    }
    return { have: round(have), unknown: unknown };
  }

  // ---------- caffeine ----------
  function partCaffeine(p, amount) { // amount in product units (capsules, g, ml)
    if (p.category === 'capsule') return round(amount * (p.caffeine !== null && p.caffeine !== undefined ? p.caffeine : SHOT_CAFFEINE * p.capsule.shots), 1);
    const per = p.caffeine !== null && p.caffeine !== undefined ? p.caffeine : CATEGORIES[p.category].caf;
    return round(amount * per, 1);
  }
  function recipeCaffeineEstimate(recipe) { // default-based, for filtering only
    let mg = 0;
    recipe.ingredients.forEach((s) => {
      if (s.optional) return;
      if (s.type === 'espresso') mg += s.amount * SHOT_CAFFEINE;
      else if (CATEGORIES[s.type] && CATEGORIES[s.type].caf) { mg += convert(s.amount, s.unit, CATEGORIES[s.type].unit, CATEGORIES[s.type].density) * CATEGORIES[s.type].caf; }
    });
    return Math.round(mg);
  }
  function caffeineLevel(mg) { return mg < 5 ? 'none' : mg < 50 ? 'low' : mg < 120 ? 'medium' : 'high'; }

  // ---------- recipe analysis, suggestions ----------
  function analyzeRecipe(state, idx, recipe, servings, opts) {
    opts = opts || {}; servings = servings || 1;
    const slots = []; let cap = Infinity, limiting = -1; let shortN = 0, maybeN = 0;
    recipe.ingredients.forEach((s, i) => {
      const need = round(s.amount * servings);
      const sup = slotSupply(idx, s, opts.dfOnly && s.dairyPossible);
      let status;
      if (sup.have >= need - EPS) status = 'ok'; else if (sup.unknown) status = 'maybe'; else status = s.optional ? 'optional-short' : 'short';
      if (!s.optional) {
        if (status === 'short') shortN++; else if (status === 'maybe') maybeN++;
        const c = sup.have / s.amount; if (c < cap) { cap = c; limiting = i; }
      }
      slots.push({ i: i, slot: s, need: need, have: sup.have, unknown: sup.unknown, status: status, short: round(Math.max(0, need - sup.have)) });
    });
    const status = shortN === 0 ? (maybeN ? 'maybe' : 'ready') : shortN === 1 ? 'almost' : 'no';
    const makeable = cap === Infinity ? 0 : Math.floor(cap + 1e-9);
    return { recipe: recipe, slots: slots, status: status, makeable: makeable, limiting: limiting, shortSlots: slots.filter((x) => x.status === 'short') };
  }
  function recipeHasDairySlot(r) { return r.ingredients.some((s) => s.dairyPossible); }
  function matchesFilters(r, f) {
    if (f.serve && r.serve !== f.serve) return false;
    if (f.caf && caffeineLevel(recipeCaffeineEstimate(r)) !== f.caf) return false;
    if (f.fav && !r.fav) return false;
    if (f.q && r.name.toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
    return true;
  }
  function suggest(state, filters, today) {
    filters = filters || {}; const idx = buildIndex(state);
    const out = { ready: [], maybe: [], almost: [], no: [], needsDF: [], hints: [], useItUp: [] };
    state.recipes.forEach((r) => {
      if (!matchesFilters(r, filters)) return;
      const hasDairy = recipeHasDairySlot(r);
      const a = analyzeRecipe(state, idx, r, 1, { dfOnly: !!filters.dairyFree });
      if (filters.dairyFree && hasDairy && (a.status === 'no' || a.status === 'almost')) {
        const all = analyzeRecipe(state, idx, r, 1, {});
        if (all.status === 'ready' || all.status === 'maybe') { out.needsDF.push(a); return; }
      }
      out[a.status].push(a);
    });
    const byName = (x, y) => (y.recipe.fav ? 1 : 0) - (x.recipe.fav ? 1 : 0) || x.recipe.name.localeCompare(y.recipe.name);
    ['ready', 'maybe', 'almost', 'no', 'needsDF'].forEach((k) => out[k].sort(byName));
    // hints: which single ingredient unlocks which recipes
    const hint = {};
    out.almost.forEach((a) => { const t = a.shortSlots[0].slot.type; (hint[t] = hint[t] || []).push(a.recipe.name); });
    out.hints = Object.keys(hint).map((t) => ({ type: t, recipes: hint[t] }));
    // use it up
    const aged = state.products.filter((p) => { const f = freshness(p, today); return f && (f.state === 'warn' || f.state === 'past') && isUsable(state, p); });
    if (aged.length) {
      out.ready.concat(out.maybe).forEach((a) => {
        const used = [];
        a.recipe.ingredients.forEach((s) => {
          aged.forEach((p) => { if (slotProducts({ byCat: { [p.category]: [p] } }, s).length && !(filters.dairyFree && s.dairyPossible && p.dairy)) used.push({ p: p, f: freshness(p, today) }); });
        });
        if (used.length) out.useItUp.push({ analysis: a, aged: used, score: Math.max.apply(null, used.map((u) => u.f.pct)) });
      });
      out.useItUp.sort((x, y) => y.score - x.score);
    }
    return out;
  }

  // ---------- scaling ----------
  function densityFor(state, type) {
    const idx = buildIndex(state); const list = (idx.byCat[type] || []).filter((p) => p.density);
    if (list.length) { list.sort((a, b) => stockOf(b).amount - stockOf(a).amount); return list[0].density; }
    return CATEGORIES[type] ? CATEGORIES[type].density : 1;
  }
  // mode 'have': "I have X of slot i" -> servings; mode 'want': N servings
  function scaleRecipe(state, recipe, mode, input) {
    const idx = buildIndex(state); let servings;
    if (mode === 'want') servings = input.servings;
    else {
      const s = recipe.ingredients[input.slot]; let amt = input.amount;
      if (s.type === 'espresso') {
        const spc = input.shotsPerCapsule || 1;
        if (input.unit === 'capsule') { const per = Math.ceil(s.amount / spc - 1e-9); servings = Math.floor(amt / per + 1e-9); }
        else servings = amt / s.amount;
      } else {
        amt = convert(amt, input.unit, s.unit, densityFor(state, s.type));
        servings = amt / s.amount;
      }
    }
    const rows = recipe.ingredients.map((s, i) => {
      const amount = s.amount * servings; const sup = slotSupply(idx, s, false);
      return { i: i, slot: s, amount: amount, have: sup.have, unknown: sup.unknown, enough: sup.have >= amount - EPS };
    });
    const a = analyzeRecipe(state, idx, recipe, 1, {});
    return { servings: servings, whole: Math.floor(servings + 1e-9), rows: rows, pantryServings: a.makeable, limiting: a.limiting >= 0 ? recipe.ingredients[a.limiting] : null,
      water: recipe.water ? { ml: recipe.water.ml * servings, tempC: recipe.water.tempC } : null };
  }

  // ---------- guest planning ----------
  function planCheck(state, items) {
    const idx = buildIndex(state); const need = {};
    items.forEach((it) => {
      const r = state.recipes.find((x) => x.id === it.recipeId); if (!r || !(it.servings > 0)) return;
      r.ingredients.forEach((s) => {
        if (s.optional) return;
        const key = s.type + (s.type === 'other' ? '|' + (s.label || '') : '');
        const base = BASE_UNIT[s.type] === 'shot' ? 'shot' : (s.type === 'other' ? s.unit : BASE_UNIT[s.type]);
        const amt = s.type === 'espresso' ? s.amount : convert(s.amount, s.unit, base, densityFor(state, s.type));
        if (!need[key]) need[key] = { type: s.type, label: s.label || '', unit: base, need: 0 };
        need[key].need += amt * it.servings;
      });
    });
    return Object.keys(need).map((k) => {
      const n = need[k]; const slot = { type: n.type, label: n.label, unit: n.unit };
      const sup = slotSupply(idx, slot, false); const short = round(Math.max(0, n.need - sup.have));
      return { type: n.type, label: n.label, unit: n.unit, need: round(n.need), have: sup.have, unknown: sup.unknown, short: short, covered: short <= EPS, maybe: short > EPS && sup.unknown };
    });
  }

  // ---------- logging ----------
  function slotCandidates(state, slot, withStockOnly) {
    const idx = buildIndex(state); let list = slotProducts(idx, slot);
    if (withStockOnly) list = list.filter((p) => { const s = stockOf(p); return s.amount > 0 || s.unknown; });
    return list;
  }
  function intensityBand(n) { return n <= 5 ? 'low' : n <= 8 ? 'medium' : 'high'; }
  function defaultProductsForSlot(state, slot, recipeId) {
    let list = slotCandidates(state, slot, true); if (!list.length) return [];
    const lu = state.settings.lastUsed || {}; const luId = lu[(recipeId || '') + ':' + slot.type] || lu[slot.type];
    const rank = (p) => {
      let s = 0;
      if (slot.type === 'espresso') {
        if (p.category === 'capsule') { s -= 100; if (slot.intensity && intensityBand(p.capsule.intensity) === slot.intensity) s -= 50; }
      }
      const open = p.open && (p.open.amount === null || p.open.amount > 0);
      if (open) s -= 20;
      if (p.id === luId) s -= 10;
      s -= Math.min(stockOf(p).sealed, 5) * 0.1;
      return s;
    };
    return list.slice().sort((a, b) => rank(a) - rank(b));
  }
  function emptyDraft(state, recipe, servings, personId, ts) {
    const draft = { recipeId: recipe ? recipe.id : null, name: recipe ? recipe.name : 'One-off drink', servings: servings || 1, personId: personId || null, ts: ts || localDateTime(), rating: null, note: '', allowShort: false, slots: [] };
    if (recipe) {
      recipe.ingredients.forEach((s, i) => {
        const slot = { i: i, type: s.type, label: s.label || '', unit: s.unit, perServing: s.amount, dairyPossible: !!s.dairyPossible, optional: !!s.optional, intensity: s.intensity || null, enabled: !s.optional, parts: [] };
        const defs = defaultProductsForSlot(state, slot, recipe.id);
        if (defs.length) slot.parts.push({ productId: defs[0].id, qty: null, machineId: null });
        draft.slots.push(slot);
      });
      draft.slots.forEach((s) => refillSlot(state, draft, s));
    }
    return draft;
  }
  function slotNeed(draft, slot) { return round(slot.perServing * draft.servings); }
  // qty required to cover the slot with a single part of a given product
  function fullQty(state, draft, slot, p) {
    const need = slotNeed(draft, slot);
    if (slot.type === 'espresso') return p.category === 'capsule' ? Math.ceil(need / p.capsule.shots - 1e-9) : need;
    return need;
  }
  function refillSlot(state, draft, slot) {
    if (!slot.parts.length) return;
    const p = state.products.find((x) => x.id === slot.parts[0].productId);
    if (p && slot.parts.length === 1) slot.parts[0].qty = fullQty(state, draft, slot, p);
    slot.parts.forEach((pt) => { if (!pt.machineId) pt.machineId = defaultMachine(state, state.products.find((x) => x.id === pt.productId)); });
  }
  function defaultMachine(state, p) {
    if (!p || p.category !== 'capsule') return null;
    const m = state.machines.find((x) => x.system === p.capsule.system); return m ? m.id : null;
  }
  function partCalc(state, slot, part, p) {
    const q = part.qty; let amount, shots = 0;
    if (slot.type === 'espresso' && !slot.free) {
      if (p.category === 'capsule') { amount = q; shots = q * p.capsule.shots; }
      else { amount = q * gramsPerShot(p); shots = q; }
    } else if (slot.free) { amount = q; }
    else amount = convert(q, slot.unit, p.unit, p.density);
    return { amount: round(amount), shots: shots };
  }
  // Evaluate a draft against current stock without changing it.
  function evaluateLog(state, draft, opts) {
    opts = opts || {};
    const ev = { ok: true, errors: [], warnings: [], slotInfo: [], parts: [], caffeine: 0, cost: 0, costUnknown: false, dairyFree: true, opens: [], shortages: [] };
    const sim = {}; const getSim = (p) => sim[p.id] || (sim[p.id] = { p: clone(p), orig: p, opened: 0, req: 0, short: 0 });
    const date = String(draft.ts).slice(0, 10);
    if (!validDate(draft.ts)) { ev.ok = false; ev.errors.push('Enter a valid date.'); }
    const sv = parseNum(draft.servings, { min: 0, minExclusive: true, max: 100 }); if (!sv.ok) { ev.ok = false; ev.errors.push('Servings: ' + sv.error); }
    let any = false;
    draft.slots.forEach((slot) => {
      const info = { errors: [], covered: 0, need: null, parts: [] }; ev.slotInfo.push(info);
      if (slot.enabled === false) return;
      const need = slot.free ? null : slotNeed(draft, slot); info.need = need;
      const parts = slot.parts.filter((pt) => pt.productId);
      if (!parts.length) { if (!slot.free) info.errors.push('Choose a product for ' + (SLOT_LABEL[slot.type] || 'this ingredient') + '.'); else if (!slot.optional) info.errors.push('Choose a product.'); return; }
      let covered = 0, maxShots = 1, bad = false;
      parts.forEach((pt) => {
        const p = state.products.find((x) => x.id === pt.productId);
        if (!p) { info.errors.push('A chosen product no longer exists.'); bad = true; return; }
        if (!isUsable(state, p)) { info.errors.push(productLabel(p) + ' does not fit your machines.'); bad = true; return; }
        const q = parseNum(pt.qty, { min: 0, minExclusive: true, max: 100000 });
        if (!q.ok) { info.errors.push('Amount for ' + productLabel(p) + ': ' + q.error); bad = true; return; }
        if (p.category === 'capsule' && Math.floor(q.value) !== q.value) { info.errors.push('Capsules must be whole numbers.'); bad = true; return; }
        pt.qty = q.value;
        const c = partCalc(state, slot, pt, p);
        if (slot.type === 'espresso' && !slot.free) { covered += c.shots; if (p.category === 'capsule') maxShots = Math.max(maxShots, p.capsule.shots); } else covered += q.value;
        const sm = getSim(p); const r = deduct(sm.p, c.amount, date); sm.opened += r.opened; sm.req += c.amount; sm.short += r.shortfall;
        if (r.shortfall > EPS) { ev.shortages.push({ product: p, missing: r.shortfall, slot: slot }); }
        let machineId = pt.machineId;
        if (p.category === 'capsule') {
          const m = state.machines.find((x) => x.id === machineId);
          if (!m || m.system !== p.capsule.system) { machineId = defaultMachine(state, p); }
        }
        const caf = partCaffeine(p, c.amount);
        const unit = p.unit, price = p.price;
        const cost = price === null || price === undefined ? null : round(c.amount * price / p.size, 4);
        info.parts.push({ productId: p.id });
        ev.parts.push({ slotIndex: slot.i, slotType: slot.type, label: slot.label || SLOT_LABEL[slot.type], productId: p.id, productLabel: productLabel(p), qty: q.value, amount: c.amount, unit: unit, shots: c.shots, caffeine: caf, cost: cost, dairy: !!p.dairy, machineId: machineId, unknownStock: stockOf(p).unknown, category: p.category });
        any = true;
      });
      info.covered = round(covered);
      if (!bad && !slot.free && need !== null) {
        if (slot.type === 'espresso') {
          if (covered < need - EPS) info.errors.push('Parts cover ' + fmtNum(covered) + ' of ' + fmtNum(need) + ' shots.');
          else if (covered > need + maxShots - 1 + EPS) info.errors.push('Parts add up to ' + fmtNum(covered) + ' shots but only ' + fmtNum(need) + ' are needed.');
        } else if (Math.abs(covered - need) > Math.max(0.01, need * 0.001)) {
          info.errors.push('Parts add up to ' + fmtNum(covered) + ' ' + slot.unit + ' but the recipe needs ' + fmtNum(need) + ' ' + slot.unit + (covered < need ? ' (' + fmtNum(need - covered) + ' still unassigned).' : '.'));
        }
      }
    });
    if (!any) { ev.errors.push('Nothing to log yet. Choose at least one product.'); }
    ev.slotInfo.forEach((i) => i.errors.forEach((e) => ev.errors.push(e)));
    Object.keys(sim).forEach((k) => { if (sim[k].opened > 0) ev.opens.push({ product: sim[k].orig, n: sim[k].opened }); });
    ev.parts.forEach((pt) => {
      ev.caffeine += pt.caffeine; if (pt.cost === null) ev.costUnknown = true; else ev.cost += pt.cost;
      if (pt.dairy) ev.dairyFree = false;
    });
    ev.caffeine = round(ev.caffeine, 1); ev.cost = round(ev.cost, 2);
    if (ev.shortages.length) {
      if (draft.allowShort) ev.warnings.push('Not enough stock. Stock will stop at 0.');
      else { ev.errors.push('Not enough stock: ' + ev.shortages.map((s) => productLabel(s.product) + ' is short by ' + fmtNum(s.missing) + ' ' + s.product.unit).join('; ') + '.'); }
    }
    ev.parts.filter((p) => p.unknownStock).forEach((p) => { ev.warnings.push(p.productLabel + ' has an unknown amount, so its stock will not change. Recount it to fix that.'); });
    if (ev.parts.length) {
      const after = { products: state.products.map((p) => (sim[p.id] ? sim[p.id].p : p)), machines: state.machines, thresholds: state.thresholds };
      const wasLow = new Set(lowStock(state).map((x) => x.type));
      lowStock(after).forEach((x) => { if (!wasLow.has(x.type)) ev.warnings.push('Low stock after this drink: ' + CATEGORIES[x.type].label.toLowerCase() + ' will be at ' + fmtNum(x.total) + ' ' + x.unit + '.'); });
    }
    ev.ok = ev.ok && ev.errors.length === 0;
    return ev;
  }
  function commitLog(state, draft) {
    const ev = evaluateLog(state, draft); if (!ev.ok) return { ok: false, errors: ev.errors };
    const date = String(draft.ts).slice(0, 10); const parts = [];
    ev.parts.forEach((pt) => {
      const p = state.products.find((x) => x.id === pt.productId);
      const r = deduct(p, pt.amount, date);
      const part = Object.assign({}, pt, { chunks: r.chunks, deducted: r.deducted, short: r.shortfall });
      parts.push(part);
      if (p.category === 'capsule' && part.machineId) {
        const m = state.machines.find((x) => x.id === part.machineId); if (m) m.caps += r.deducted;
      }
      const lu = state.settings.lastUsed = state.settings.lastUsed || {};
      lu[(draft.recipeId || '') + ':' + pt.slotType] = p.id; lu[pt.slotType] = p.id;
    });
    const log = { id: uid(), ts: draft.ts, personId: draft.personId, recipeId: draft.recipeId, name: draft.name, servings: draft.servings, parts: parts,
      caffeine: ev.caffeine, cost: ev.cost, costUnknown: ev.costUnknown, dairyFree: ev.dairyFree, rating: draft.rating || null, note: draft.note || '',
      slotsMeta: draft.slots.map((s) => ({ i: s.i, enabled: s.enabled !== false })), free: !draft.recipeId };
    if (draft.sample) log.sample = true;
    state.logs.push(log);
    return { ok: true, log: log, opened: ev.opens };
  }
  function undoLog(state, logId) {
    const i = state.logs.findIndex((l) => l.id === logId); if (i < 0) return false;
    const log = state.logs[i];
    log.parts.forEach((pt) => {
      const p = state.products.find((x) => x.id === pt.productId); if (!p) return;
      restoreChunks(p, pt.chunks || []);
      if (p.category === 'capsule' && pt.machineId) { const m = state.machines.find((x) => x.id === pt.machineId); if (m) m.caps = Math.max(0, m.caps - (pt.deducted || 0)); }
    });
    state.logs.splice(i, 1); return true;
  }
  // Rebuild a draft that repeats an earlier log ("same as last time").
  function draftFromLog(state, log, personId, ts) {
    const recipe = log.recipeId ? state.recipes.find((r) => r.id === log.recipeId) : null;
    if (recipe) {
      const d = emptyDraft(state, recipe, log.servings, personId, ts);
      d.slots.forEach((s) => {
        const meta = (log.slotsMeta || []).find((m) => m.i === s.i); if (meta) s.enabled = meta.enabled;
        const parts = log.parts.filter((p) => p.slotIndex === s.i);
        if (parts.length) s.parts = parts.map((p) => ({ productId: p.productId, qty: p.qty, machineId: p.machineId }));
      });
      return d;
    }
    const d = emptyDraft(state, null, log.servings, personId, ts); d.name = log.name;
    d.slots = [{ i: 0, type: 'other', free: true, label: '', unit: 'g', perServing: 0, enabled: true, parts: log.parts.map((p) => ({ productId: p.productId, qty: p.qty, machineId: p.machineId })) }];
    return d;
  }
  function lastLogFor(state, personId) {
    let best = null; state.logs.forEach((l) => { if (l.personId === personId && (!best || l.ts >= best.ts)) best = l; }); return best;
  }

  // ---------- recount & restock ----------
  function recountPreview(p, input) {
    const oldS = stockOf(p); let nv;
    if (p.category === 'capsule') nv = input.count;
    else nv = input.sealed * p.size + (input.open && input.open.amount !== null ? input.open.amount : 0);
    const newUnknown = p.category !== 'capsule' && input.open && input.open.amount === null;
    return { oldTotal: oldS.amount, oldUnknown: oldS.unknown, newTotal: round(nv), newUnknown: !!newUnknown, diff: oldS.unknown || newUnknown ? null : round(nv - oldS.amount) };
  }
  function validateRecount(p, f, today) {
    const errors = {}; const v = {};
    if (p.category === 'capsule') {
      const c = parseNum(f.count, { min: 0, max: 100000, int: true }); if (!c.ok) errors.count = c.error; else v.count = c.value;
    } else {
      const s = parseNum(f.sealed === '' || f.sealed === undefined ? 0 : f.sealed, { min: 0, max: 10000, int: true }); if (!s.ok) errors.sealed = s.error; else v.sealed = s.value;
      const mode = f.openMode || 'none';
      if (mode === 'none') v.open = null;
      else if (mode === 'unknown') v.open = { amount: null, openedAt: (p.open && p.open.openedAt) || today };
      else if (mode === 'amount') {
        const a = parseNum(f.openAmount, { min: 0, max: p.size }); if (!a.ok) errors.openAmount = a.error === 'Required' ? 'Required' : a.error.replace(/Must be (.*) or less/, 'Cannot be more than the pack size ($1)');
        else v.open = a.value > EPS ? { amount: a.value, openedAt: (p.open && p.open.openedAt) || today } : null;
      } else if (FILL[mode] !== undefined) v.open = { amount: round(p.size * FILL[mode]), openedAt: (p.open && p.open.openedAt) || today };
      else errors.openMode = 'Choose an option';
    }
    return { ok: Object.keys(errors).length === 0, errors: errors, value: v };
  }
  function applyRecount(state, productId, v, ts) {
    const p = state.products.find((x) => x.id === productId); if (!p) return null;
    const before = snapshot(p); const prev = recountPreview(p, v);
    if (p.category === 'capsule') p.count = v.count; else { p.sealed = v.sealed; p.open = v.open; }
    const adj = { id: uid(), ts: ts || localDateTime(), kind: 'recount', productId: p.id, productLabel: productLabel(p), unit: p.unit, before: before, after: snapshot(p), diff: prev.diff, oldTotal: prev.oldTotal, newTotal: prev.newTotal, newUnknown: prev.newUnknown };
    state.adjustments.push(adj); state.settings.recountMark = state.logs.length; return adj;
  }
  function restock(state, productId, packs, ts) {
    const p = state.products.find((x) => x.id === productId); if (!p) return null;
    packs = packs || 1; const before = snapshot(p); addPacks(p, packs);
    const adj = { id: uid(), ts: ts || localDateTime(), kind: 'restock', productId: p.id, productLabel: productLabel(p), unit: p.unit, packs: packs, before: before, after: snapshot(p), diff: p.category === 'capsule' ? packs * p.size : packs * p.size, chunks: [{ k: 'pack', n: packs }] };
    state.adjustments.push(adj); return adj;
  }
  function undoAdjustment(state, adjId) {
    const i = state.adjustments.findIndex((a) => a.id === adjId); if (i < 0) return false;
    const a = state.adjustments[i]; const p = state.products.find((x) => x.id === a.productId);
    if (p) {
      if (sameSnapshot(snapshot(p), a.after)) setSnapshot(p, a.before);
      else if (a.kind === 'restock') restoreChunks(p, a.chunks);
      else if (a.diff !== null && a.diff !== undefined) {
        if (a.diff < 0) { if (p.category === 'capsule') p.count += -a.diff; else addToOpen(p, -a.diff, localDate()); }
        else deduct(p, a.diff, localDate());
      } else setSnapshot(p, a.before);
    }
    state.adjustments.splice(i, 1); return true;
  }

  // ---------- shopping ----------
  function usualProduct(state, cat) {
    const list = state.products.filter((p) => p.category === cat && isUsable(state, p)); if (!list.length) return null;
    return list.find((p) => p.usual) || list[list.length - 1];
  }
  function categoryTotal(idx, cat) {
    let total = 0, unknown = false; const C = CATEGORIES[cat];
    (idx.byCat[cat] || []).forEach((p) => { const s = stockOf(p); total += convert(s.amount, p.unit, C.unit, p.density); if (s.unknown) unknown = true; });
    return { total: round(total), unknown: unknown, count: (idx.byCat[cat] || []).length };
  }
  function lowStock(state) {
    const idx = buildIndex(state); const out = [];
    Object.keys(CATEGORIES).forEach((cat) => {
      const thr = state.thresholds[cat]; if (thr === null || thr === undefined) return;
      const t = categoryTotal(idx, cat); if (!t.count) return;
      if (t.total <= thr + EPS && !t.unknown) out.push({ type: cat, total: t.total, threshold: thr, unit: CATEGORIES[cat].unit, usual: usualProduct(state, cat) });
    });
    return out;
  }

  // ---------- people & stats ----------
  function logsFor(state, who) { // who: 'all' | 'none' | personId
    return state.logs.filter((l) => who === 'all' ? true : who === 'none' ? !l.personId : l.personId === who);
  }
  function dayCaffeine(state, who, dateISO) { return round(logsFor(state, who).filter((l) => l.ts.slice(0, 10) === dateISO).reduce((a, l) => a + l.caffeine, 0), 1); }
  function monthSummary(state, who, ym) {
    const logs = logsFor(state, who).filter((l) => l.ts.slice(0, 7) === ym);
    const counts = {}; let spend = 0, unknown = 0, caf = 0;
    logs.forEach((l) => { spend += l.cost; if (l.costUnknown) unknown++; caf += l.caffeine; counts[l.name] = (counts[l.name] || 0) + 1; });
    let fav = null; Object.keys(counts).forEach((k) => { if (!fav || counts[k] > fav.count) fav = { name: k, count: counts[k] }; });
    return { cups: logs.length, spend: round(spend, 2), unknownCost: unknown, caffeine: round(caf, 1), favorite: fav };
  }
  function deletePerson(state, id) {
    if (state.people.length <= 1) return false;
    state.people = state.people.filter((p) => p.id !== id);
    state.logs.forEach((l) => { if (l.personId === id) l.personId = null; });
    if (state.settings.activePerson === id) state.settings.activePerson = state.people[0].id;
    return true;
  }

  // ---------- sample pantry ----------
  function loadSample(state, today) {
    today = today || localDate(); if (state.settings.sampleLoaded) return false;
    const mk = (f) => { const r = addProduct(state, f, today); if (!r.ok) throw new Error(JSON.stringify(r.errors)); r.product.sample = true; return r.product; };
    const pre = (id, extra) => Object.assign(presetToForm(PRESETS.find((x) => x.id === id)), extra || {});
    const person = { id: 'p_sample', name: 'Dad (sample)', sample: true }; state.people.push(person);
    const machine = makeMachine('Sample Original machine', 'original', addDays(today, -60)); machine.sample = true; machine.caps = 295; state.machines.push(machine);
    const matcha = mk(pre('pre_matcha_cer', { sealed: 1, openMode: 'quarter', openDate: addDays(today, -33) }));
    mk(pre('pre_hojicha', { sealed: 0, openMode: 'unknown', openDate: addDays(today, -10) }));
    const oat = mk(pre('pre_milk_oat', { sealed: 1, openMode: 'half', openDate: addDays(today, -3) }));
    const whole = mk(pre('pre_milk_whole', { sealed: 0, openMode: 'half', openDate: addDays(today, -6), price: 85 }));
    mk(pre('pre_syrup_van', { sealed: 1 }));
    mk(pre('pre_tonic', { sealed: 2 }));
    const rist = mk(pre('pre_n_ristretto', { sleeves: 2, loose: 3, price: 220 }));
    mk(pre('pre_n_volluto', { sleeves: 1, loose: 0 }));
    mk(pre('pre_v_forte', { sleeves: 1, loose: 0 }));
    matcha.price = 650; oat.price = 160;
    const mkLog = (recipeId, dayOff, hh, who) => {
      const r = state.recipes.find((x) => x.id === recipeId);
      const d = emptyDraft(state, r, 1, who, addDays(today, dayOff) + 'T' + pad(hh) + ':15'); d.sample = true;
      const res = commitLog(state, d); if (res.ok) res.log.sample = true; return res;
    };
    mkLog('r_flat_white', -3, 8, 'p_sample'); mkLog('r_flat_white', -2, 8, 'p_sample'); mkLog('r_flat_white', -1, 9, 'p_sample'); mkLog('r_flat_white', 0, 8, 'p_sample');
    mkLog('r_matcha_latte', -2, 15, state.settings.activePerson); mkLog('r_matcha_latte', -1, 14, state.settings.activePerson);
    void whole; void rist;
    state.settings.sampleLoaded = true; return true;
  }
  function clearSample(state) {
    const sampleProducts = new Set(state.products.filter((p) => p.sample).map((p) => p.id));
    state.logs = state.logs.filter((l) => !l.sample && !l.parts.every((pt) => sampleProducts.has(pt.productId)));
    state.adjustments = state.adjustments.filter((a) => !sampleProducts.has(a.productId));
    state.products = state.products.filter((p) => !p.sample);
    state.machines = state.machines.filter((m) => !m.sample);
    const sp = state.people.filter((p) => p.sample).map((p) => p.id);
    state.logs.forEach((l) => { if (sp.indexOf(l.personId) >= 0) l.personId = null; });
    state.people = state.people.filter((p) => !p.sample);
    if (!state.people.length) state.people.push({ id: 'p_me', name: 'Me' });
    if (!state.people.some((p) => p.id === state.settings.activePerson)) state.settings.activePerson = state.people[0].id;
    state.settings.sampleLoaded = false;
    Object.keys(state.settings.lastUsed || {}).forEach((k) => { if (sampleProducts.has(state.settings.lastUsed[k])) delete state.settings.lastUsed[k]; });
  }

  // ---------- export / import ----------
  function hash(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
  function exportData(state) {
    const data = JSON.stringify(state);
    return JSON.stringify({ app: 'stockcup', version: APP_VERSION, exportedAt: new Date().toISOString(), checksum: hash(data), data: JSON.parse(data) });
  }
  function fail(msg) { throw new Error(msg); }
  function chkStr(v, what, max) { if (typeof v !== 'string' || !v.trim() || v.length > (max || 200)) fail('Invalid ' + what); }
  function chkNum(v, what, o) { const r = parseNum(v, o); if (!r.ok || v === null || typeof v !== 'number') fail('Invalid ' + what); }
  function sanitizeState(s) {
    if (!s || typeof s !== 'object' || s.app !== 'stockcup') fail('This is not a StockCup file.');
    if (typeof s.version !== 'number' || s.version > APP_VERSION) fail('Unsupported file version.');
    const need = ['settings', 'people', 'machines', 'products', 'recipes', 'logs', 'adjustments', 'thresholds', 'shopping'];
    need.forEach((k) => { if (s[k] === undefined || s[k] === null) fail('Missing "' + k + '".'); });
    ['people', 'machines', 'products', 'recipes', 'logs', 'adjustments', 'shopping'].forEach((k) => { if (!Array.isArray(s[k])) fail('"' + k + '" must be a list.'); });
    if (typeof s.settings !== 'object' || typeof s.thresholds !== 'object') fail('Invalid settings.');
    if (!s.people.length) fail('At least one person is required.');
    const ids = new Set();
    const uniq = (id, what) => { chkStr(id, what + ' id', 80); if (ids.has(id)) fail('Duplicate id in ' + what + '.'); ids.add(id); };
    s.people.forEach((p) => { uniq(p.id, 'person'); chkStr(p.name, 'person name', 60); });
    s.machines.forEach((m) => {
      uniq(m.id, 'machine'); chkStr(m.name, 'machine name', 60); if (m.system !== 'original' && m.system !== 'vertuo') fail('Invalid machine system.');
      chkNum(m.caps, 'machine count', { min: 0 }); chkNum(m.descaleCaps, 'descale limit', { min: 1 }); chkNum(m.descaleMonths, 'descale months', { min: 1 }); if (!validDate(m.lastDescaled)) fail('Invalid descale date.');
    });
    s.products.forEach((p) => {
      uniq(p.id, 'product'); chkStr(p.brand, 'brand', 80); chkStr(p.name, 'product name', 100);
      if (!CATEGORIES[p.category]) fail('Invalid category.'); if (['g', 'ml', 'capsule'].indexOf(p.unit) < 0) fail('Invalid unit.');
      chkNum(p.size, 'size', { min: 0, minExclusive: true }); chkNum(p.sealed, 'sealed count', { min: 0 }); chkNum(p.density, 'density', { min: 0, minExclusive: true });
      if (p.count !== undefined) chkNum(p.count, 'count', { min: 0 });
      if (p.price !== null && p.price !== undefined) chkNum(p.price, 'price', { min: 0 });
      if (p.open !== null && p.open !== undefined) { if (typeof p.open !== 'object') fail('Invalid open pack.'); if (p.open.amount !== null) chkNum(p.open.amount, 'open amount', { min: 0 }); if (!validDate(p.open.openedAt)) fail('Invalid open date.'); } else p.open = null;
      if (p.category === 'capsule') { if (!p.capsule || (p.capsule.system !== 'original' && p.capsule.system !== 'vertuo')) fail('Invalid capsule data.'); chkNum(p.capsule.shots, 'shots', { min: 1 }); chkNum(p.capsule.intensity, 'intensity', { min: 1 }); }
    });
    s.recipes.forEach((r) => {
      uniq(r.id, 'recipe'); chkStr(r.name, 'recipe name', 100); if (r.serve !== 'hot' && r.serve !== 'iced') fail('Invalid recipe type.');
      if (!Array.isArray(r.ingredients) || !r.ingredients.length) fail('A recipe has no ingredients.'); if (!Array.isArray(r.steps)) fail('Invalid recipe steps.');
      r.ingredients.forEach((i) => { if (SLOT_TYPES.indexOf(i.type) < 0) fail('Invalid ingredient type.'); chkNum(i.amount, 'ingredient amount', { min: 0, minExclusive: true }); if (RECIPE_UNITS.indexOf(i.unit) < 0) fail('Invalid ingredient unit.'); });
    });
    s.logs.forEach((l) => {
      uniq(l.id, 'log'); if (!validDate(l.ts)) fail('Invalid log date.'); chkNum(l.caffeine, 'caffeine', { min: 0 }); chkNum(l.cost, 'cost', { min: 0 });
      if (!Array.isArray(l.parts)) fail('Invalid log.'); l.parts.forEach((pt) => { chkNum(pt.amount, 'log amount', { min: 0 }); });
      if (l.personId !== null && l.personId !== undefined && !s.people.some((p) => p.id === l.personId)) l.personId = null;
    });
    s.adjustments.forEach((a) => { uniq(a.id, 'adjustment'); if (!validDate(a.ts)) fail('Invalid adjustment date.'); });
    Object.keys(s.thresholds).forEach((k) => { if (s.thresholds[k] !== null) chkNum(s.thresholds[k], 'threshold', { min: 0 }); });
    if (!s.people.some((p) => p.id === s.settings.activePerson)) s.settings.activePerson = s.people[0].id;
    s.settings.lastUsed = s.settings.lastUsed || {}; s.settings.recountMark = s.settings.recountMark || 0;
    return s;
  }
  function importData(text) {
    let o; try { o = JSON.parse(text); } catch (e) { fail('The file is damaged or not a StockCup export.'); }
    if (!o || o.app !== 'stockcup' || !o.data) fail('This is not a StockCup export.');
    if (o.checksum !== hash(JSON.stringify(o.data))) fail('The file is damaged (checksum does not match).');
    return sanitizeState(o.data);
  }

  return {
    APP_VERSION, EPS, SHOT_CAFFEINE, GRAMS_PER_SHOT, FILL, FILL_LABEL, VOL_ML, CATEGORIES, SLOT_TYPES, SLOT_LABEL, BASE_UNIT, RECIPE_UNITS, BUILTIN_RECIPES, PRESETS,
    uid, round, isNum, clone, pad, localDate, localDateTime, daysBetween, addDays, addMonths, validDate, fmtNum, parseNum, convert,
    defaultState, builtinRecipes, defaultThresholds, stockOf, productLabel, snapshot, deduct, restoreChunks, addPacks, openAPack, freshness,
    validateProductInput, buildProduct, presetToForm, addProduct, machineSystems, capsulesEnabled, isUsable, descaleStatus, makeMachine,
    buildIndex, slotProducts, productSupply, slotSupply, partCaffeine, recipeCaffeineEstimate, caffeineLevel, analyzeRecipe, recipeHasDairySlot, suggest,
    densityFor, scaleRecipe, planCheck, slotCandidates, intensityBand, defaultProductsForSlot, emptyDraft, slotNeed, fullQty, refillSlot, defaultMachine,
    evaluateLog, commitLog, undoLog, draftFromLog, lastLogFor, recountPreview, validateRecount, applyRecount, restock, undoAdjustment,
    usualProduct, categoryTotal, lowStock, logsFor, dayCaffeine, monthSummary, deletePerson, loadSample, clearSample, hash, exportData, importData, sanitizeState, gramsPerShot,
  };
})();
if (typeof module !== 'undefined') module.exports = SC;

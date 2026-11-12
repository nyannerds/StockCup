/* StockCup sheets (forms and dialogs). */
'use strict';

const footBtns = (cancel, ok, okLabel, okAct, extra) => '<button data-act="' + cancel + '">' + (cancel === 'closeSheet' ? 'Cancel' : 'Back') + '</button>' + (extra || '') + '<button class="primary" data-act="' + okAct + '">' + esc(okLabel) + '</button>';
const errList = (arr) => arr && arr.length ? '<div class="errbox" role="alert">' + arr.map((e) => '<div>' + esc(e) + '</div>').join('') + '</div>' : '';

// ---------- add menu & presets ----------
ACT.addMenu = () => openSheet('addMenu');
SHEETS.addMenu = () => ({ title: 'Add products', body: '<div class="stack" style="margin-top:10px"><button class="big" data-act="addPreset">📋 Pick from the starter list</button><button class="big" data-act="openQuickAdd">⌨️ Type a line (quick add)</button><button class="big" data-act="openReceipt">🧾 Scan a receipt photo</button><button class="big" data-act="newProduct">✏️ Enter all the details</button></div><p class="small muted">The starter list is a small, editable set of common products. It is not an authoritative catalogue.</p>' });
ACT.newProduct = () => openProductForm({});
ACT.addPreset = () => openSheet('presets', { q: '' });
function presetListHtml(q) {
  const caps = SC.capsulesEnabled(S); q = (q || '').toLowerCase(); let last = '';
  const list = SC.PRESETS.filter((p) => (p.category !== 'capsule' || caps) && (p.brand + ' ' + p.name + ' ' + catLabel(p.category)).toLowerCase().indexOf(q) >= 0);
  if (!list.length) return '<div class="empty">No presets match.</div>';
  return list.map((p) => {
    const head = p.category !== last ? '<h2>' + esc(catLabel(p.category)) + '</h2>' : ''; last = p.category;
    return head + '<div class="card tap" data-act="pickPreset" data-id="' + p.id + '"><div class="row"><div class="grow"><b>' + esc(p.brand) + ' · ' + esc(p.name) + '</b><div class="small muted">' + (p.category === 'capsule' ? 'sleeve of ' + p.size + ' · ' + (p.capsule.system === 'original' ? 'Original' : 'Vertuo') + ' · intensity ' + p.capsule.intensity : fmt(p.size) + ' ' + p.unit + (p.dairy ? ' · contains dairy' : '')) + '</div></div><span aria-hidden="true">＋</span></div></div>';
  }).join('');
}
SHEETS.presets = (d) => ({ title: 'Starter list', body: '<p class="small muted">A small starter list of common products. Pick one, then check the details. Everything can be edited.</p><input type="search" data-input="presetQ" placeholder="Search" aria-label="Search the starter list" value="' + esc(d.q) + '"><div id="presetList">' + presetListHtml(d.q) + '</div>' });
INP.presetQ = (el) => { SHEET.data.q = el.value; $('#presetList').innerHTML = presetListHtml(el.value); };
ACT.pickPreset = (el) => { const pr = SC.PRESETS.find((p) => p.id === el.dataset.id); openProductForm({ f: Object.assign(SC.presetToForm(pr), { sealed: 1, sleeves: 1 }) }); };

// ---------- product form ----------
function productDefaults(cat) {
  const C = SC.CATEGORIES[cat]; const m = S.machines[0];
  return { category: cat, brand: '', name: '', size: C.size, unit: C.unit, price: '', dairy: C.dairy, density: C.density, shelfLifeDays: C.shelf === null ? '' : C.shelf, caffeine: '', system: m ? m.system : 'original', intensity: '', cupSize: '', shots: 1, gramsPerShot: SC.GRAMS_PER_SHOT, sealed: 1, openMode: 'none', openDate: today(), sleeves: 1, loose: 0, usual: false };
}
function openProductForm(o) {
  let f, id = null;
  if (o.id) {
    id = o.id; const p = S.products.find((x) => x.id === id);
    f = { category: p.category, brand: p.brand, name: p.name, size: p.size, unit: p.unit, price: p.price === null ? '' : p.price, dairy: p.dairy, density: p.density, shelfLifeDays: p.shelfLifeDays === null ? '' : p.shelfLifeDays, caffeine: p.caffeine === null ? '' : p.caffeine,
      system: p.capsule ? p.capsule.system : 'original', intensity: p.capsule ? p.capsule.intensity : '', cupSize: p.capsule && p.capsule.cupSize ? p.capsule.cupSize : '', shots: p.capsule ? p.capsule.shots : 1, gramsPerShot: p.gramsPerShot || SC.GRAMS_PER_SHOT, usual: !!p.usual };
  } else f = Object.assign(productDefaults(o.category || (o.f && o.f.category) || 'matcha'), o.f || {});
  openSheet('product', { id: id, f: f, errors: {} });
}
SHEETS.product = (d) => {
  const f = d.f, e = d.errors, isNew = !d.id, cat = f.category, C = SC.CATEGORIES[cat] || SC.CATEGORIES.other, isCap = cat === 'capsule';
  const cats = Object.keys(SC.CATEGORIES).filter((c) => c !== 'capsule' || SC.capsulesEnabled(S) || cat === 'capsule');
  let b = '<form data-submit="product" id="pform" novalidate>' + selectField('category', 'Category', cats.map((c) => [c, catLabel(c)]), cat, { change: 'pfCat', err: e.category });
  if (!isNew) b = b.replace('<select ', '<select disabled ');
  b += field('brand', 'Brand', f.brand, { err: e.brand, auto: 'off', ph: 'e.g. Brand A' }) + field('name', 'Product name', f.name, { err: e.name, ph: isCap ? 'e.g. Original Livanto' : 'e.g. Ceremonial matcha' });
  if (isCap) {
    b += field('size', 'Capsules per sleeve', f.size, { type: 'number', int: true, err: e.size });
    b += selectField('system', 'Machine system', [['original', 'Original'], ['vertuo', 'Vertuo']], f.system, { err: e.system });
    b += '<div class="grid2"><div>' + field('intensity', 'Intensity (1–13)', f.intensity, { type: 'number', int: true, err: e.intensity }) + '</div><div>' + field('shots', 'Shots per capsule', f.shots, { type: 'number', int: true, err: e.shots }) + '</div></div>';
    b += '<div class="grid2"><div>' + field('cupSize', 'Cup size (ml)', f.cupSize, { type: 'number', err: e.cupSize }) + '</div><div>' + field('caffeine', 'Caffeine per capsule (mg)', f.caffeine, { type: 'number', err: e.caffeine, ph: 'default ' + SC.SHOT_CAFFEINE * (Number(f.shots) || 1) }) + '</div></div>';
  } else {
    b += '<div class="grid2"><div>' + field('size', 'Pack size', f.size, { type: 'number', err: e.size }) + '</div><div>' + (cat === 'other' ? selectField('unit', 'Unit', [['g', 'g'], ['ml', 'ml']], f.unit) : '<label class="f">Unit</label><input value="' + esc(C.unit) + '" disabled aria-label="Unit"><input type="hidden" name="unit" value="' + esc(C.unit) + '">') + '</div></div>';
  }
  b += field('price', isCap ? 'Price per sleeve (optional)' : 'Price per pack (optional)', f.price, { type: 'number', err: e.price, hint: 'Leave blank if unknown. Unpriced drinks are flagged “cost unknown”.' });
  b += checkField('dairy', 'Contains dairy', f.dairy);
  b += '<details><summary>More settings</summary>' + (isCap ? '' : field('shelfLifeDays', 'Shelf life after opening (days)', f.shelfLifeDays, { type: 'number', int: true, err: e.shelfLifeDays, hint: 'An estimate. Warns at 75% and shows “past best” at 100%. Leave blank for none.' }) + field('caffeine', 'Caffeine per ' + C.unit + ' (mg)', f.caffeine, { type: 'number', err: e.caffeine, ph: 'default ' + (C.caf || 0), hint: 'Estimate. Leave blank to use the average.' })) +
    (isCap ? '' : field('density', 'Density (g per ml)', f.density, { type: 'number', err: e.density, hint: 'Used to convert between weight and volume.' })) + (cat === 'coffee' ? field('gramsPerShot', 'Grams per espresso shot', f.gramsPerShot, { type: 'number', err: e.gramsPerShot }) : '') + checkField('usual', 'My usual pick when restocking', f.usual) + '</details>';
  if (isNew) {
    b += '<h2>How much do you have?</h2>';
    if (isCap) b += '<div class="grid2"><div>' + field('sleeves', 'Sleeves', f.sleeves, { type: 'number', int: true, err: e.sleeves }) + '</div><div>' + field('loose', 'Loose capsules', f.loose, { type: 'number', int: true, err: e.loose }) + '</div></div><div class="small muted">3 sleeves of 10 and 4 loose = 34 capsules.</div>';
    else {
      b += field('sealed', 'Sealed packs (bought N packs)', f.sealed, { type: 'number', int: true, err: e.sealed }) +
        selectField('openMode', 'Plus one opened pack', [['none', 'No opened pack'], ['full', 'Opened, full'], ['half', 'Opened, half'], ['quarter', 'Opened, a quarter'], ['almost', 'Opened, almost empty'], ['unknown', 'Opened, amount unknown']], f.openMode, { change: 'pfMode', err: e.openMode });
      if (f.openMode !== 'none') b += field('openDate', 'Date opened', f.openDate, { type: 'date', err: e.openDate, max: today() });
    }
  }
  b += '</form>';
  return { title: isNew ? 'Add a product' : 'Edit product', body: b, footer: footBtns('closeSheet', 1, isNew ? 'Save product' : 'Save changes', 'saveProduct') };
};
function syncProductForm() { const form = $('#pform'); if (form && SHEET && SHEET.name === 'product') Object.assign(SHEET.data.f, formData(form)); }
CHG.pfCat = (el) => {
  syncProductForm(); const f = SHEET.data.f; const nf = productDefaults(el.value);
  ['size', 'unit', 'dairy', 'density', 'shelfLifeDays', 'shots', 'gramsPerShot'].forEach((k) => { f[k] = nf[k]; }); f.category = el.value; f.system = f.system || nf.system; SHEET.data.errors = {}; renderSheet();
};
CHG.pfMode = () => { syncProductForm(); renderSheet(); };
ACT.saveProduct = () => { const form = $('#pform'); if (form) SUB.product(form); };
SUB.product = (form) => {
  syncProductForm(); const d = SHEET.data; const f = Object.assign({}, d.f); const isNew = !d.id;
  if (!isNew) { const p0 = S.products.find((x) => x.id === d.id); f.category = p0.category; }
  const r = SC.validateProductInput(f, { withStock: isNew, today: today() });
  if (!r.ok) { d.errors = r.errors; renderSheet(); const first = $('#overlay .invalid'); if (first) first.focus(); return; }
  let p;
  if (isNew) { p = SC.buildProduct(r.value); if (!S.products.some((x) => x.category === p.category && x.usual) || f.usual) { S.products.forEach((x) => { if (x.category === p.category) delete x.usual; }); p.usual = true; } S.products.push(p); }
  else { p = S.products.find((x) => x.id === d.id); SC.buildProduct(r.value, p); if (f.usual) { S.products.forEach((x) => { if (x.category === p.category) delete x.usual; }); p.usual = true; } else delete p.usual; }
  save(); closeSheet(); render(); toast((isNew ? 'Added ' : 'Saved ') + SC.productLabel(p) + '.');
};

// ---------- product detail ----------
ACT.viewProduct = (el) => openSheet('productView', { id: el.dataset.id });
SHEETS.productView = (d) => {
  const p = S.products.find((x) => x.id === d.id); if (!p) return null; const isCap = p.category === 'capsule';
  const rows = [['Category', catLabel(p.category)], ['Pack size', fmt(p.size) + ' ' + p.unit + (isCap ? ' per sleeve' : '')], ['In stock', stockText(p)], ['Total', totalText(p)], ['Price', p.price === null || p.price === undefined ? 'unknown' : money(p.price) + (isCap ? ' per sleeve' : ' per pack')], ['Contains dairy', p.dairy ? 'Yes' : 'No']];
  if (isCap) rows.push(['Machine', p.capsule.system === 'original' ? 'Original' : 'Vertuo'], ['Intensity', p.capsule.intensity], ['Shots per capsule', p.capsule.shots], ['Caffeine (est.)', fmt(p.caffeine !== null && p.caffeine !== undefined ? p.caffeine : SC.SHOT_CAFFEINE * p.capsule.shots, 0) + ' mg per capsule']);
  else { rows.push(['Caffeine (est.)', fmt(p.caffeine !== null && p.caffeine !== undefined ? p.caffeine : SC.CATEGORIES[p.category].caf) + ' mg per ' + p.unit]); if (p.open) rows.push(['Opened', p.open.openedAt]); if (p.shelfLifeDays) rows.push(['Shelf life (est.)', p.shelfLifeDays + ' days after opening']); }
  const fr = SC.freshness(p, today());
  const canOpen = !isCap && !p.open && p.sealed > 0;
  const b = (!SC.isUsable(S, p) ? '<div class="warnbox">This capsule does not fit any of your machines, so it is not counted as stock.</div>' : '') + (fr ? '<div style="margin:8px 0">' + freshBadge(p) + '</div>' : '') +
    '<table class="t"><tbody>' + rows.map((r) => '<tr><th scope="row">' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>').join('') + '</tbody></table>' +
    '<div class="grid2" style="margin-top:12px"><button data-act="pvRecount" data-id="' + p.id + '">🔢 Recount</button><button data-act="pvAddPack" data-id="' + p.id + '">＋ Bought ' + (isCap ? 'a sleeve' : 'a pack') + '</button>' + (canOpen ? '<button data-act="pvOpen" data-id="' + p.id + '">📦 Open a pack today</button>' : '') + '<button data-act="pvEdit" data-id="' + p.id + '">✏️ Edit</button></div>';
  return { title: SC.productLabel(p), body: b, footer: '<button class="danger" data-act="pvDelete" data-id="' + p.id + '">Delete</button><button class="primary" data-act="closeSheet">Done</button>' };
};
ACT.pvEdit = (el) => openProductForm({ id: el.dataset.id });
ACT.pvRecount = (el) => openRecount(el.dataset.id);
ACT.pvAddPack = (el) => { const adj = SC.restock(S, el.dataset.id, 1); save(); render(); toast('Added one ' + (S.products.find((p) => p.id === el.dataset.id).category === 'capsule' ? 'sleeve' : 'pack') + '.', 'Undo', () => { SC.undoAdjustment(S, adj.id); save(); render(); }); };
ACT.pvOpen = (el) => mutate((s) => { SC.openAPack(s.products.find((p) => p.id === el.dataset.id), today()); });
ACT.pvDelete = (el) => { const p = S.products.find((x) => x.id === el.dataset.id); confirmDialog('Delete ' + SC.productLabel(p) + '? Past drinks keep their record.', 'Delete', () => { mutate((s) => { s.products = s.products.filter((x) => x.id !== p.id); }); closeSheet(); toast('Deleted.'); }, true); };

// ---------- recount ----------
function openRecount(id) {
  const p = S.products.find((x) => x.id === id);
  openSheet('recount', { id: id, f: p.category === 'capsule' ? { count: p.count } : { sealed: p.sealed, openMode: p.open ? (p.open.amount === null ? 'unknown' : 'amount') : 'none', openAmount: p.open && p.open.amount !== null ? p.open.amount : '' } });
}
SHEETS.recount = (d) => {
  const p = S.products.find((x) => x.id === d.id); if (!p) return null; const f = d.f; const v = SC.validateRecount(p, f, today());
  let b = '<p class="muted">Count what is really on the shelf. The difference is saved as an adjustment, not a drink.</p><p>Currently: <b>' + esc(stockText(p)) + '</b></p><form id="rform" data-submit="recount" novalidate>';
  if (p.category === 'capsule') b += field('count', 'Capsules in total', f.count, { type: 'number', int: true, err: v.errors.count, change: 'rcField' });
  else {
    b += field('sealed', 'Sealed packs (' + fmt(p.size) + ' ' + p.unit + ' each)', f.sealed, { type: 'number', int: true, err: v.errors.sealed, change: 'rcField' }) +
      selectField('openMode', 'Opened pack', [['none', 'No opened pack'], ['amount', 'I know the exact amount'], ['full', 'Full'], ['half', 'About half'], ['quarter', 'About a quarter'], ['almost', 'Almost empty'], ['unknown', 'Not sure']], f.openMode, { change: 'rcField' });
    if (f.openMode === 'amount') b += field('openAmount', 'Amount left in the opened pack (' + p.unit + ')', f.openAmount, { type: 'number', err: v.errors.openAmount, change: 'rcField' });
  }
  b += '</form>';
  if (v.ok) {
    const pv = SC.recountPreview(p, v.value);
    b += '<div class="card"><div class="row"><div class="grow"><span class="small muted">Before → after</span><div><b>' + (pv.oldUnknown ? 'unknown' : fmt(pv.oldTotal) + ' ' + p.unit) + '</b> → <b>' + (pv.newUnknown ? 'unknown' : fmt(pv.newTotal) + ' ' + p.unit) + '</b></div></div><div class="stat"><span class="small muted">Difference</span><b>' + (pv.diff === null ? 'n/a' : (pv.diff > 0 ? '+' : '') + fmt(pv.diff) + ' ' + p.unit) + '</b></div></div></div>';
  }
  return { title: 'Recount ' + SC.productLabel(p), body: b, footer: '<button data-act="closeSheet">Cancel</button><button class="primary" data-act="saveRecount"' + (v.ok ? '' : ' disabled') + '>Save recount</button>' };
};
CHG.rcField = () => { Object.assign(SHEET.data.f, formData($('#rform'))); renderSheet(); };
ACT.saveRecount = () => {
  const p = S.products.find((x) => x.id === SHEET.data.id); Object.assign(SHEET.data.f, formData($('#rform'))); const v = SC.validateRecount(p, SHEET.data.f, today()); if (!v.ok) { renderSheet(); return; }
  const adj = SC.applyRecount(S, p.id, v.value); save(); closeSheet(); render();
  toast('Recount saved' + (adj.diff === null ? '.' : ' (' + (adj.diff > 0 ? '+' : '') + fmt(adj.diff) + ' ' + p.unit + ').'), 'Undo', () => { SC.undoAdjustment(S, adj.id); save(); render(); });
};

// ---------- quick add & receipt ----------
ACT.openQuickAdd = () => openSheet('quickAdd', { text: '', err: '' });
SHEETS.quickAdd = (d) => ({ title: 'Quick add', body: '<p class="muted">One product per line, like <code>Brand A matcha 30g x2</code>, <code>Oatly barista oat milk 1L</code> or <code>Nespresso Livanto 10 caps x3</code>. You will review everything before it is saved.</p>' + (d.err ? '<div class="errbox">' + esc(d.err) + '</div>' : '') + '<label class="f" for="qa">Lines</label><textarea id="qa" rows="6" placeholder="Brand A matcha 30g x2&#10;Whole milk 1L x2 @ 85">' + esc(d.text) + '</textarea>', footer: footBtns('closeSheet', 1, 'Review', 'qaParse') });
ACT.qaParse = () => {
  const text = $('#qa').value; const rows = SCP.parseQuickAdd(text, S);
  if (!rows.length) { SHEET.data.text = text; SHEET.data.err = 'Type at least one line.'; renderSheet(); return; }
  openSheet('confirmRows', { rows: rows, other: [], from: 'quickAdd', text: text, errors: [] });
};
ACT.openReceipt = () => openSheet('receipt', { text: '', status: '', busy: false });
SHEETS.receipt = (d) => ({ title: 'Scan a receipt', body: '<p class="muted">Take or choose a photo of a grocery receipt. The text is read on this device and the photo is thrown away. You will review everything before it is saved.</p>' +
  '<label class="f" for="rcFile">Receipt photo</label><input type="file" id="rcFile" accept="image/*" style="min-height:44px">' + '<button class="primary big" style="margin-top:8px" data-act="readReceipt"' + (d.busy ? ' disabled' : '') + '>Read photo</button><div id="ocrStatus" class="small muted" role="status" style="margin:6px 0">' + esc(d.status) + '</div>' +
  '<label class="f" for="rcText">Receipt text (edit if the reading is off, or paste it here)</label><textarea id="rcText" rows="8">' + esc(d.text) + '</textarea>', footer: footBtns('closeSheet', 1, 'Find items', 'rcParse') });
ACT.readReceipt = async () => {
  const file = $('#rcFile') && $('#rcFile').files[0]; if (!file) { $('#ocrStatus').textContent = 'Choose a photo first.'; return; }
  SHEET.data.text = $('#rcText').value; SHEET.data.busy = true; const st = (m) => { const n = $('#ocrStatus'); if (n) n.textContent = m; }; st('Starting…');
  try { const text = await OCR.read(file, st); SHEET.data.text = text; SHEET.data.status = 'Done. Check the text below, then press “Find items”.'; } catch (e) { SHEET.data.status = e.message; }
  SHEET.data.busy = false; if (SHEET && SHEET.name === 'receipt') renderSheet();
};
ACT.rcParse = () => {
  const text = $('#rcText').value; const out = SCP.parseReceipt(text, S);
  if (!out.rows.length) { SHEET.data.text = text; SHEET.data.status = 'No drink-related items found. Edit the text and try again, or use Quick add.'; renderSheet(); return; }
  openSheet('confirmRows', { rows: out.rows, other: out.other, from: 'receipt', text: text, errors: [] });
};
function rowHtml(r, i) {
  const same = S.products.filter((p) => p.category === r.category); const cap = r.category === 'capsule';
  return '<div class="card"><label class="check"><input type="checkbox" name="r' + i + '_include"' + (r.include ? ' checked' : '') + ' data-change="rowField"> <span><b>' + esc(r.raw.length > 50 ? r.raw.slice(0, 50) + '…' : r.raw) + '</b></span></label>' + (r.include ? '<div>' +
    selectField('r' + i + '_match', 'Add to', [['', 'A new product']].concat(same.map((p) => [p.id, 'Existing: ' + SC.productLabel(p)])), r.matchedProductId || '', { change: 'rowField' }) +
    (r.matchedProductId ? '' : '<div class="grid2"><div>' + field('r' + i + '_brand', 'Brand', r.brand, { err: r.errors && r.errors.brand }) + '</div><div>' + field('r' + i + '_name', 'Name', r.name, { err: r.errors && r.errors.name }) + '</div></div>' +
      selectField('r' + i + '_category', 'Category', Object.keys(SC.CATEGORIES).filter((c) => c !== 'capsule' || SC.capsulesEnabled(S) || r.category === 'capsule').map((c) => [c, catLabel(c)]), r.category || 'other', { change: 'rowField' }) +
      '<div class="grid2"><div>' + field('r' + i + '_size', cap ? 'Capsules per sleeve' : 'Pack size (' + (r.unit || '') + ')', r.size, { type: 'number', err: r.errors && r.errors.size }) + '</div><div>' + field('r' + i + '_price', 'Price per pack', r.price === null ? '' : r.price, { type: 'number', err: r.errors && r.errors.price }) + '</div></div>') +
    (cap ? '<div class="grid2"><div>' + field('r' + i + '_sleeves', 'Sleeves', r.sleeves === null ? 0 : r.sleeves, { type: 'number', int: true }) + '</div><div>' + field('r' + i + '_loose', 'Loose capsules', r.loose || 0, { type: 'number', int: true }) + '</div></div>' : field('r' + i + '_packs', 'Packs bought', r.packs, { type: 'number', int: true, err: r.errors && r.errors.sealed })) + '</div>' : '') + '</div>';
}
SHEETS.confirmRows = (d) => {
  const n = d.rows.filter((r) => r.include).length;
  return { title: 'Check before saving', body: '<p class="muted">Nothing is saved until you press Save. Fix anything that was misread.</p>' + errList(d.errors) + '<form id="cform" novalidate>' + d.rows.map(rowHtml).join('') + '</form>' +
    (d.other && d.other.length ? '<details><summary>' + d.other.length + ' other line' + (d.other.length > 1 ? 's' : '') + ' ignored</summary>' + d.other.map((l) => '<div class="small muted">' + esc(l) + '</div>').join('') + '</details>' : ''),
    footer: '<button data-act="confirmRowsBack">Back</button><button class="primary" data-act="confirmRowsSave"' + (n ? '' : ' disabled') + '>Save ' + n + ' item' + (n === 1 ? '' : 's') + '</button>' };
};
function syncRows() {
  const f = formData($('#cform')); const rows = SHEET.data.rows;
  rows.forEach((r, i) => {
    r.include = !!f['r' + i + '_include']; r.matchedProductId = f['r' + i + '_match'] || null;
    if (r.matchedProductId) { const p = S.products.find((x) => x.id === r.matchedProductId); if (p) { r.category = p.category; r.brand = p.brand; r.name = p.name; r.size = p.size; r.unit = p.unit; } return; }
    if (f['r' + i + '_brand'] !== undefined) { r.brand = f['r' + i + '_brand']; r.name = f['r' + i + '_name']; r.size = f['r' + i + '_size']; r.price = f['r' + i + '_price']; }
    const cat = f['r' + i + '_category']; if (cat && cat !== r.category) { r.category = cat; const C = SC.CATEGORIES[cat]; r.unit = C.unit; if (r.sizeGuessed || true) r.size = C.size; r.presetId = null; }
    if (f['r' + i + '_packs'] !== undefined) r.packs = f['r' + i + '_packs'];
    if (f['r' + i + '_sleeves'] !== undefined) { r.sleeves = f['r' + i + '_sleeves']; r.loose = f['r' + i + '_loose']; }
  });
}
CHG.rowField = () => { syncRows(); renderSheet(); };
ACT.confirmRowsBack = () => { const d = SHEET.data; openSheet(d.from, { text: d.text, err: '', status: '' }); };
ACT.confirmRowsSave = () => {
  syncRows(); const d = SHEET.data; const errors = []; const jobs = [];
  d.rows.forEach((r, i) => {
    r.errors = {}; if (!r.include) return;
    if (r.matchedProductId) {
      const p = S.products.find((x) => x.id === r.matchedProductId); if (!p) { errors.push('Row ' + (i + 1) + ': product no longer exists.'); return; }
      if (p.category === 'capsule') { const sl = SC.parseNum(r.sleeves === null ? 0 : r.sleeves, { min: 0, max: 1000, int: true }), lo = SC.parseNum(r.loose || 0, { min: 0, max: 100000, int: true }); if (!sl.ok || !lo.ok || sl.value * p.size + lo.value <= 0) { errors.push('Row ' + (i + 1) + ': enter sleeves or loose capsules.'); return; } jobs.push({ kind: 'cap', p: p, n: sl.value * p.size + lo.value }); }
      else { const n = SC.parseNum(r.packs, { min: 1, max: 1000, int: true }); if (!n.ok) { errors.push('Row ' + (i + 1) + ': packs ' + n.error.toLowerCase() + '.'); return; } jobs.push({ kind: 'packs', p: p, n: n.value }); }
      return;
    }
    const f = SCP.rowToForm(Object.assign({}, r, { category: r.category || 'other', price: r.price === null ? null : r.price }));
    f.brand = r.brand; f.name = r.name; f.size = r.size; f.price = r.price === null || r.price === undefined ? '' : r.price; f.category = r.category || 'other';
    const v = SC.validateProductInput(f, { withStock: true, today: today() });
    if (!v.ok) { r.errors = v.errors; errors.push('Row ' + (i + 1) + ' (' + (r.raw.slice(0, 30)) + '): ' + Object.keys(v.errors).map((k) => k + ' – ' + v.errors[k]).join('; ')); return; }
    jobs.push({ kind: 'new', v: v.value });
  });
  if (errors.length) { d.errors = errors; renderSheet(); return; }
  if (!jobs.length) { toast('Nothing selected.'); return; }
  jobs.forEach((j) => {
    if (j.kind === 'new') { const p = SC.buildProduct(j.v); if (!S.products.some((x) => x.category === p.category && x.usual)) p.usual = true; S.products.push(p); }
    else if (j.kind === 'cap') j.p.count += j.n; else SC.addPacks(j.p, j.n);
  });
  save(); closeSheet(); render(); toast('Saved ' + jobs.length + ' item' + (jobs.length > 1 ? 's' : '') + '.');
};

// ---------- logging ----------
ACT.logPick = () => openSheet('logPick');
SHEETS.logPick = () => {
  const sug = SC.suggest(S, {}, today()); const seen = {}; const order = [];
  ['ready', 'maybe', 'almost', 'no'].forEach((k) => sug[k].forEach((a) => { seen[a.recipe.id] = k; order.push(a.recipe); }));
  const tag = { ready: '<span class="badge ok">Ready</span>', maybe: '<span class="badge warn">Maybe</span>', almost: '<span class="badge warn">One item short</span>', no: '<span class="badge">Missing items</span>' };
  return { title: 'What did you make?', body: '<div style="margin-top:8px">' + order.map((r) => '<button class="big" style="justify-content:space-between;margin:4px 0" data-act="logRecipe" data-id="' + r.id + '"><span>' + (r.fav ? '★ ' : '') + esc(r.name) + '</span>' + tag[seen[r.id]] + '</button>').join('') + '<button class="big" style="margin-top:10px" data-act="logOneOff">✏️ A one-off drink (not a recipe)</button></div>' };
};
function openLog(draft, title) { SHEET = { name: 'log', data: { draft: draft, title: title, note: false } }; renderSheet(); const b = $('#overlay .body'); if (b) b.scrollTop = 0; }
ACT.logRecipe = (el, e) => { if (e) e.stopPropagation(); const r = S.recipes.find((x) => x.id === el.dataset.id); if (!r) return; openLog(SC.emptyDraft(S, r, 1, S.settings.activePerson, SC.localDateTime()), r.name); };
ACT.logSame = () => { const l = SC.lastLogFor(S, S.settings.activePerson); if (!l) return; openLog(SC.draftFromLog(S, l, S.settings.activePerson, SC.localDateTime()), 'Same as last time: ' + l.name); };
ACT.logOneOff = () => { const d = SC.emptyDraft(S, null, 1, S.settings.activePerson, SC.localDateTime()); d.name = ''; d.slots = [{ i: 0, type: 'other', free: true, label: '', unit: 'g', perServing: 0, enabled: true, parts: [] }]; openLog(d, 'One-off drink'); };
const availQty = (p, slot) => {
  const st = SC.stockOf(p); if (st.unknown) return Infinity;
  if (slot.free) return st.amount; if (slot.type === 'espresso') return p.category === 'capsule' ? st.amount : st.amount / SC.gramsPerShot(p);
  return SC.convert(st.amount, p.unit, slot.unit, p.density);
};
function partUnit(slot, p) { if (!p) return ''; if (slot.free) return p.unit === 'capsule' ? 'capsules' : p.unit; if (slot.type === 'espresso') return p.category === 'capsule' ? 'capsules' : 'shots'; return slot.unit; }
function candidatesFor(slot) { return slot.free ? S.products.filter((p) => SC.isUsable(S, p) && (SC.stockOf(p).amount > 0 || SC.stockOf(p).unknown)) : SC.slotCandidates(S, slot, true); }
function productOpt(p, slot) { return SC.productLabel(p) + (p.category === 'capsule' ? ' (int. ' + p.capsule.intensity + ')' : '') + ' · ' + totalText(p) + (SC.stockOf(p).amount === 0 && !SC.stockOf(p).unknown ? ' (none)' : ''); }
function logSlotHtml(draft, slot, s, ev) {
  const info = ev.slotInfo[s] || { errors: [] }; const need = slot.free ? null : SC.slotNeed(draft, slot);
  const cands = candidatesFor(slot); const name = slot.free ? 'Items used' : slot.type === 'espresso' ? 'Espresso' : slotName(slot);
  let h = '<div class="card"><div class="row"><div class="grow"><b>' + esc(name.charAt(0).toUpperCase() + name.slice(1)) + '</b>' + (need !== null ? ' <span class="muted">· need ' + esc(amt(need, slot.unit)) + '</span>' : '') + (slot.intensity ? ' <span class="badge">' + slot.intensity + ' intensity</span>' : '') + (slot.dairyPossible ? ' <span class="badge">dairy slot</span>' : '') + '</div>';
  if (slot.optional) h += '<label class="check"><input type="checkbox" data-change="logOpt" data-s="' + s + '"' + (slot.enabled ? ' checked' : '') + '> <span>Include</span></label>';
  h += '</div>';
  if (!slot.enabled) return h + '</div>';
  if (!cands.length && !slot.free) {
    h += '<div class="warnbox">No ' + esc(slotName(slot)) + ' in stock' + (slot.type === 'espresso' ? ' for your machines or beans' : '') + '.</div><button class="small" data-act="addMissing" data-cat="' + (slot.type === 'espresso' ? (SC.capsulesEnabled(S) ? 'capsule' : 'coffee') : slot.type) + '">+ Add one now</button>';
  }
  slot.parts.forEach((pt, k) => {
    const p = S.products.find((x) => x.id === pt.productId); const opts = cands.slice(); if (p && opts.indexOf(p) < 0) opts.unshift(p);
    h += '<div class="partrow"><select name="p-' + s + '-' + k + '" data-change="logPart" data-s="' + s + '" data-k="' + k + '" aria-label="Product for ' + esc(name) + '">' + (p ? '' : '<option value="">Choose…</option>') + opts.map((o) => '<option value="' + o.id + '"' + (o.id === pt.productId ? ' selected' : '') + '>' + esc(productOpt(o, slot)) + '</option>').join('') + '</select>' +
      '<div class="row qrow"><input name="q-' + s + '-' + k + '" inputmode="decimal" value="' + esc(pt.qty === null || pt.qty === undefined ? '' : pt.qty) + '" data-change="logPart" data-s="' + s + '" data-k="' + k + '" aria-label="Amount in ' + esc(partUnit(slot, p)) + '"><span class="u grow">' + esc(partUnit(slot, p)) + (p && p.category === 'capsule' ? ' · ' + p.capsule.shots + (p.capsule.shots > 1 ? ' shots each' : ' shot each') : '') + (p ? ' · ' + esc(totalText(p)) + ' in stock' : '') + '</span>' +
      (slot.parts.length > 1 || slot.free ? '<button class="small" data-act="logRemovePart" data-s="' + s + '" data-k="' + k + '" aria-label="Remove this product">✕</button>' : '') + '</div></div>';
    if (p && p.category === 'capsule') { const ms = S.machines.filter((m) => m.system === p.capsule.system); if (ms.length > 1) h += '<div class="small">Machine: <select name="m-' + s + '-' + k + '" data-change="logMachine" data-s="' + s + '" data-k="' + k + '" aria-label="Machine" style="width:auto;display:inline-block">' + ms.map((m) => '<option value="' + m.id + '"' + (m.id === pt.machineId ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select></div>'; }
  });
  if (info.errors.length) h += info.errors.map((x) => '<div class="err">' + esc(x) + '</div>').join('');
  const short = ev.shortages.filter((x) => x.slot === slot || (x.slot && x.slot.i === slot.i && x.slot.type === slot.type));
  if (short.length && !slot.free) {
    const used = slot.parts.map((x) => x.productId); const alt = cands.find((c) => used.indexOf(c.id) < 0);
    h += alt ? '<div class="warnbox">' + esc(SC.productLabel(short[0].product)) + ' is short. <button class="small" data-act="logUseAlt" data-s="' + s + '">Use the rest from ' + esc(SC.productLabel(alt)) + '</button></div>' : '<div class="warnbox">Not enough in stock across your products.</div>';
  }
  const canSplit = slot.free ? true : cands.length > 1 && slot.parts.length < 4;
  if (canSplit && (slot.parts.length || slot.free)) h += '<button class="small" data-act="logSplit" data-s="' + s + '">' + (slot.free ? '＋ Add another item' : '⇄ Split with another product') + '</button>';
  return h + '</div>';
}
SHEETS.log = (d) => {
  const draft = d.draft; const ev = SC.evaluateLog(S, draft); d.ev = ev; const recipe = draft.recipeId ? S.recipes.find((r) => r.id === draft.recipeId) : null;
  let b = '<div class="row wrap" style="margin-top:8px">' + (recipe ? '<div class="row"><button class="small" data-act="logServ" data-d="-1" aria-label="Fewer servings">−</button><div style="min-width:84px;text-align:center"><b>' + fmt(draft.servings) + '</b> serving' + (draft.servings === 1 ? '' : 's') + '</div><button class="small" data-act="logServ" data-d="1" aria-label="More servings">＋</button></div>' : '<div class="grow"><label class="f" for="f-lname">Drink name</label><input id="f-lname" data-change="logMeta" name="name" maxlength="60" value="' + esc(draft.name) + '" placeholder="e.g. Coffee with milk"></div>') + '</div>';
  b += '<div class="grid2"><div>' + selectField('personId', 'Who had it', S.people.map((p) => [p.id, p.name]).concat([['', 'Unassigned']]), draft.personId || '', { change: 'logMeta' }) + '</div><div><label class="f" for="f-ts">When</label><input id="f-ts" type="datetime-local" name="ts" data-change="logMeta" value="' + esc(draft.ts) + '" max="' + SC.localDateTime(new Date(Date.now() + 864e5)) + '"></div></div>';
  draft.slots.forEach((slot, s) => { b += logSlotHtml(draft, slot, s, ev); });
  if (recipe && (recipe.water || recipe.ice)) b += '<div class="small muted" style="margin:6px 0">💧 ' + (recipe.water ? 'Water ' + esc(amt(recipe.water.ml * draft.servings, 'ml')) + ' at ' + esc(temp(recipe.water.tempC)) : '') + (recipe.water && recipe.ice ? ' and ' : '') + (recipe.ice ? 'ice' : '') + ' are assumed to be on hand and are not tracked.</div>';
  const cafParts = ev.parts.length ? '<div class="grid3" style="margin:10px 0"><div class="stat"><span class="small muted">Caffeine (estimate)</span><b>~' + fmt(ev.caffeine, 0) + ' mg</b></div><div class="stat"><span class="small muted">Cost</span><b>' + (ev.parts.length && ev.costUnknown ? (ev.cost ? '≥ ' + money(ev.cost) : '?') : money(ev.cost)) + '</b>' + (ev.costUnknown ? '<span class="small" style="color:var(--warn)">cost unknown</span>' : '') + '</div><div class="stat"><span class="small muted">Dairy-free*</span><b>' + (ev.dairyFree ? 'Yes' : 'No') + '</b></div></div><div class="small muted">*Based on the “contains dairy” setting of the products you chose.</div>' : '';
  b += cafParts;
  const warns = ev.warnings.filter((w) => w); if (warns.length) b += warns.map((w) => '<div class="warnbox">' + esc(w) + '</div>').join('');
  if (ev.opens.length) b += '<div class="warnbox">📦 This opens a new sealed pack: ' + ev.opens.map((o) => esc(SC.productLabel(o.product)) + (o.n > 1 ? ' ×' + o.n : '')).join(', ') + '.</div>';
  if (ev.shortages.length) b += checkField('allowShort', 'Log anyway (stock will stop at 0)', draft.allowShort, { change: 'logMeta' });
  const topErrs = ev.errors.filter((e) => !ev.slotInfo.some((i) => i.errors.indexOf(e) >= 0)); b += errList(topErrs);
  b += '<details' + (d.note ? ' open' : '') + '><summary>Rating and note (optional)</summary><div class="chips" role="group" aria-label="Rating">' + [1, 2, 3, 4, 5].map((n) => '<button class="chip" aria-pressed="' + (draft.rating === n) + '" data-act="logRate" data-n="' + n + '" aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '">' + '★'.repeat(n) + '</button>').join('') + '</div><label class="f" for="f-lnote">Note</label><input id="f-lnote" name="note" data-change="logMeta" maxlength="200" value="' + esc(draft.note) + '" placeholder="e.g. a bit sweet"></details>';
  const label = ev.opens.length ? 'Open pack & log' : 'Log drink';
  return { title: d.title || 'Log a drink', body: b, footer: '<button data-act="closeSheet">Cancel</button><button class="primary" data-act="logSubmit"' + (ev.ok ? '' : ' disabled') + '>' + label + '</button>' };
};
const draftOf = () => SHEET.data.draft;
function resetSingle(slot) { const draft = draftOf(); if (slot.free) return; slot.parts = slot.parts.slice(0, 1); SC.refillSlot(S, draft, slot); }
ACT.logServ = (el) => { const d = draftOf(); const n = Math.max(1, Math.min(50, Math.round(Number(d.servings) || 1) + Number(el.dataset.d))); d.servings = n; d.slots.forEach((s) => { if (s.enabled) resetSingle(s); }); d.allowShort = false; renderSheet(); };
CHG.logMeta = (el) => { const d = draftOf(); const n = el.name; d[n] = el.type === 'checkbox' ? el.checked : el.value; if (n === 'personId' && !el.value) d.personId = null; renderSheet(); };
ACT.logRate = (el) => { const d = draftOf(); const n = Number(el.dataset.n); d.rating = d.rating === n ? null : n; SHEET.data.note = true; renderSheet(); };
CHG.logOpt = (el) => { const d = draftOf(); const s = d.slots[el.dataset.s]; s.enabled = el.checked; if (s.enabled && !s.parts.length) { const defs = SC.defaultProductsForSlot(S, s, d.recipeId); if (defs.length) { s.parts.push({ productId: defs[0].id, qty: null, machineId: null }); SC.refillSlot(S, d, s); } } renderSheet(); };
CHG.logPart = (el) => {
  const d = draftOf(); const s = d.slots[el.dataset.s]; const k = Number(el.dataset.k); const pt = s.parts[k];
  if (el.tagName === 'SELECT') {
    pt.productId = el.value; const p = S.products.find((x) => x.id === pt.productId); pt.machineId = SC.defaultMachine(S, p);
    if (s.parts.length === 1 && !s.free) SC.refillSlot(S, d, s); else if (s.free) pt.qty = p ? (p.category === 'capsule' ? 1 : Math.min(p.size / 10, SC.stockOf(p).amount) || 1) : null;
  } else pt.qty = el.value;
  d.allowShort = false; renderSheet();
};
CHG.logMachine = (el) => { draftOf().slots[el.dataset.s].parts[el.dataset.k].machineId = el.value; renderSheet(); };
ACT.logRemovePart = (el) => { const d = draftOf(); const s = d.slots[el.dataset.s]; s.parts.splice(Number(el.dataset.k), 1); if (!s.free && s.parts.length === 1) SC.refillSlot(S, d, s); renderSheet(); };
ACT.logSplit = (el) => {
  const d = draftOf(); const s = d.slots[el.dataset.s];
  if (s.free) { const c = candidatesFor(s).find((p) => !s.parts.some((x) => x.productId === p.id)) || candidatesFor(s)[0]; if (c) s.parts.push({ productId: c.id, qty: c.category === 'capsule' ? 1 : Math.min(Math.round(c.size / 10), SC.stockOf(c).amount) || 1, machineId: SC.defaultMachine(S, c) }); renderSheet(); return; }
  const first = S.products.find((p) => p.id === s.parts[0].productId); const alt = candidatesFor(s).find((c) => s.parts.every((x) => x.productId !== c.id)); if (!first || !alt) return;
  const need = SC.slotNeed(d, s); const isEsp = s.type === 'espresso';
  const needQty = isEsp ? (first.category === 'capsule' ? Math.ceil(need / first.capsule.shots - 1e-9) : need) : need;
  let a = Math.min(availQty(first, s), needQty); if (a >= needQty) a = isEsp && first.category === 'capsule' ? Math.floor(needQty / 2) || 1 : Math.round((needQty / 2) * 100) / 100;
  if (first.category === 'capsule') a = Math.floor(a);
  s.parts[0].qty = a;
  const remainingShots = isEsp ? need - (first.category === 'capsule' ? a * first.capsule.shots : a) : 0;
  const q2 = isEsp ? (alt.category === 'capsule' ? Math.max(1, Math.ceil(remainingShots / alt.capsule.shots - 1e-9)) : Math.max(remainingShots, 0)) : Math.round((need - a) * 1000) / 1000;
  s.parts.push({ productId: alt.id, qty: q2, machineId: SC.defaultMachine(S, alt) }); renderSheet();
};
ACT.logUseAlt = (el) => {
  const d = draftOf(); const s = d.slots[el.dataset.s]; const used = s.parts.map((x) => x.productId); const alt = candidatesFor(s).find((c) => used.indexOf(c.id) < 0); if (!alt) return;
  const need = SC.slotNeed(d, s); const isEsp = s.type === 'espresso'; let covered = 0;
  s.parts.forEach((pt) => { const p = S.products.find((x) => x.id === pt.productId); const av = availQty(p, s); const take = Math.min(av, pt.qty === null ? Infinity : Number(pt.qty) || 0); pt.qty = p.category === 'capsule' ? Math.floor(take) : Math.round(take * 1000) / 1000; covered += isEsp ? (p.category === 'capsule' ? pt.qty * p.capsule.shots : pt.qty) : pt.qty; });
  const rem = Math.max(0, need - covered); const q = isEsp ? (alt.category === 'capsule' ? Math.ceil(rem / alt.capsule.shots - 1e-9) : rem) : Math.round(rem * 1000) / 1000;
  s.parts = s.parts.filter((pt) => Number(pt.qty) > 0); s.parts.push({ productId: alt.id, qty: q, machineId: SC.defaultMachine(S, alt) }); renderSheet();
};
ACT.logSubmit = () => {
  const d = draftOf(); if (!d.name || !String(d.name).trim()) { d.name = 'One-off drink'; }
  const res = SC.commitLog(S, d); if (!res.ok) { renderSheet(); return; }
  save(); const log = res.log; closeSheet(); render();
  toast('Logged ' + log.name + ' · ~' + fmt(log.caffeine, 0) + ' mg caffeine (est.)', 'Undo', () => { SC.undoLog(S, log.id); save(); render(); toast('Undone. Stock restored.'); });
};
ACT.editLog = (el) => { const l = S.logs.find((x) => x.id === el.dataset.id); openSheet('editLog', { id: l.id, rating: l.rating, note: l.note, personId: l.personId || '' }); };
SHEETS.editLog = (d) => { const l = S.logs.find((x) => x.id === d.id); if (!l) return null; return { title: 'Edit ' + l.name, body: '<p class="small muted">Stock is not changed by edits. To change what was used, undo the drink and log it again.</p>' + selectField('personId', 'Who had it', S.people.map((p) => [p.id, p.name]).concat([['', 'Unassigned']]), d.personId, { change: 'elField' }) + '<div class="chips" role="group" aria-label="Rating" style="margin-top:8px">' + [1, 2, 3, 4, 5].map((n) => '<button class="chip" aria-pressed="' + (d.rating === n) + '" data-act="elRate" data-n="' + n + '">' + '★'.repeat(n) + '</button>').join('') + '</div><label class="f" for="f-note">Note</label><input id="f-note" name="note" maxlength="200" data-change="elField" value="' + esc(d.note) + '">', footer: footBtns('closeSheet', 1, 'Save', 'elSave') }; };
CHG.elField = (el) => { SHEET.data[el.name] = el.value; };
ACT.elRate = (el) => { const n = Number(el.dataset.n); SHEET.data.rating = SHEET.data.rating === n ? null : n; renderSheet(); };
ACT.elSave = () => { const d = SHEET.data; const l = S.logs.find((x) => x.id === d.id); const note = ($('#f-note') ? $('#f-note').value : d.note).slice(0, 200); mutate((s) => { const x = s.logs.find((q) => q.id === d.id); x.rating = d.rating || null; x.note = note; x.personId = d.personId || null; }); closeSheet(); void l; };

// ---------- people & machines ----------
SHEETS.renamePerson = (d) => ({ title: 'Rename', body: '<form id="rpform" data-submit="renamePerson">' + field('name', 'Name', d.name, { err: d.err }) + '</form>', footer: footBtns('closeSheet', 1, 'Save', 'rpSave') });
ACT.rpSave = () => SUB.renamePerson($('#rpform'));
SUB.renamePerson = (f) => { const n = formData(f).name.trim(); const d = SHEET.data; if (!n || n.length > 40) { d.err = 'Enter a name (up to 40 characters).'; renderSheet(); return; } if (S.people.some((p) => p.id !== d.id && p.name.toLowerCase() === n.toLowerCase())) { d.err = 'That name is already used.'; renderSheet(); return; } mutate((s) => { s.people.find((p) => p.id === d.id).name = n; }); closeSheet(); };
ACT.editMachine = (el) => {
  const m = el.dataset.id ? S.machines.find((x) => x.id === el.dataset.id) : null;
  openSheet('machine', { id: m ? m.id : null, f: m ? { name: m.name, system: m.system, descaleCaps: m.descaleCaps, descaleMonths: m.descaleMonths, caps: m.caps, lastDescaled: m.lastDescaled } : { name: '', system: 'original', descaleCaps: 300, descaleMonths: 3, caps: 0, lastDescaled: today() }, errors: {} });
};
SHEETS.machine = (d) => { const f = d.f, e = d.errors; return { title: d.id ? 'Edit machine' : 'Add a machine', body: '<form id="mform" novalidate>' + field('name', 'Name', f.name, { err: e.name, ph: 'e.g. Kitchen Original' }) + selectField('system', 'System', [['original', 'Original'], ['vertuo', 'Vertuo']], f.system) + '<div class="grid2"><div>' + field('descaleCaps', 'Descale after (capsules)', f.descaleCaps, { type: 'number', int: true, err: e.descaleCaps }) + '</div><div>' + field('descaleMonths', 'Or after (months)', f.descaleMonths, { type: 'number', int: true, err: e.descaleMonths }) + '</div></div>' + (d.id ? '<div class="grid2"><div>' + field('caps', 'Capsules since descale', f.caps, { type: 'number', int: true, err: e.caps }) + '</div><div>' + field('lastDescaled', 'Last descaled', f.lastDescaled, { type: 'date', err: e.lastDescaled, max: today() }) + '</div></div>' : '') + '</form>', footer: (d.id ? '<button class="danger" data-act="machineDel">Remove</button>' : '<button data-act="closeSheet">Cancel</button>') + '<button class="primary" data-act="machineSave">Save</button>' }; };
ACT.machineSave = () => {
  const d = SHEET.data; const f = formData($('#mform')); const e = {}; const name = f.name.trim(); if (!name || name.length > 60) e.name = 'Enter a name';
  const dc = SC.parseNum(f.descaleCaps, { min: 1, max: 100000, int: true }); if (!dc.ok) e.descaleCaps = dc.error; const dm = SC.parseNum(f.descaleMonths, { min: 1, max: 120, int: true }); if (!dm.ok) e.descaleMonths = dm.error;
  let caps = 0, last = today(); if (d.id) { const c = SC.parseNum(f.caps, { min: 0, max: 1e6, int: true }); if (!c.ok) e.caps = c.error; else caps = c.value; if (!SC.validDate(f.lastDescaled) || f.lastDescaled > today()) e.lastDescaled = 'Enter a valid past date'; else last = f.lastDescaled; }
  if (Object.keys(e).length) { d.f = Object.assign(d.f, f); d.errors = e; renderSheet(); return; }
  mutate((s) => { if (d.id) { const m = s.machines.find((x) => x.id === d.id); Object.assign(m, { name: name, system: f.system, descaleCaps: dc.value, descaleMonths: dm.value, caps: caps, lastDescaled: last }); } else { const m = SC.makeMachine(name, f.system, today()); m.descaleCaps = dc.value; m.descaleMonths = dm.value; s.machines.push(m); } }); closeSheet();
};
ACT.machineDel = () => { const d = SHEET.data; confirmDialog('Remove this machine? Capsules that no longer fit any machine stop counting as stock (they are kept, just hidden).', 'Remove', () => { mutate((s) => { s.machines = s.machines.filter((m) => m.id !== d.id); }); closeSheet(); }, true); };

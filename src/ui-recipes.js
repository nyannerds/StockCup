/* StockCup recipe sheets, import, guide. */
'use strict';

function stepSeconds(text) {
  const m = String(text).match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|min|seconds?|secs?|s)\b/i); if (!m) return 0;
  const n = Number(m[1]), u = m[2].toLowerCase(); const sec = /^h/.test(u) ? n * 3600 : /^m/.test(u) ? n * 60 : n; return sec > 0 && sec <= 86400 ? Math.round(sec) : 0;
}

// ---------- recipe detail ----------
ACT.viewRecipe = (el) => openSheet('recipe', { id: el.dataset.id, servings: 1 });
SHEETS.recipe = (d) => {
  const r = S.recipes.find((x) => x.id === d.id); if (!r) return null; const idx = SC.buildIndex(S); const a = SC.analyzeRecipe(S, idx, r, d.servings, {});
  let b = '<div style="margin:8px 0">' + recipeBadges(r) + '</div>' + (r.note ? '<p class="muted">' + esc(r.note) + '</p>' : '');
  b += '<div class="row" style="margin:8px 0"><span class="muted">Servings</span><button class="small" data-act="rvServ" data-d="-1" aria-label="Fewer servings">−</button><b>' + d.servings + '</b><button class="small" data-act="rvServ" data-d="1" aria-label="More servings">＋</button>' +
    '<span class="badge ' + (a.status === 'ready' ? 'ok' : a.status === 'almost' || a.status === 'maybe' ? 'warn' : '') + ' right">' + ({ ready: 'Ready now', maybe: 'Maybe', almost: 'One item short', no: 'Missing items' }[a.status]) + '</span></div>';
  b += '<h2 style="margin-top:8px">Ingredients</h2><div class="card">' + a.slots.map((sl) => {
    const st = sl.status === 'ok' ? '<span class="badge ok">have ' + esc(amt(sl.have, sl.slot.unit)) + '</span>' : sl.status === 'maybe' ? '<span class="badge warn">amount unknown</span>' : sl.status === 'optional-short' ? '<span class="badge">optional, none</span>' : '<span class="badge bad">short ' + esc(amt(sl.short, sl.slot.unit)) + '</span>';
    return '<div class="row" style="margin:4px 0"><div class="grow"><b>' + esc(amt(sl.need, sl.slot.unit)) + '</b> ' + esc(slotName(sl.slot)) + (sl.slot.optional ? ' <span class="muted small">(optional)</span>' : '') + (sl.slot.dairyPossible ? ' <span class="muted small">· dairy slot</span>' : '') + (sl.slot.intensity ? ' <span class="muted small">· ' + sl.slot.intensity + ' intensity</span>' : '') + '</div>' + st + (sl.status === 'short' ? addMissingBtn(sl) : '') + '</div>';
  }).join('') + (r.water ? '<div class="small muted" style="margin-top:6px">💧 Water ' + esc(amt(r.water.ml * d.servings, 'ml')) + ' · ' + esc(temp(r.water.tempC)) + '</div>' : '') + (r.ice ? '<div class="small muted">🧊 Ice</div>' : '') + '<div class="small muted" style="margin-top:4px">Water and ice are assumed to be on hand and are never tracked.</div></div>';
  if (a.status === 'ready' && a.makeable > 1) b += '<div class="okbox">The pantry covers about ' + a.makeable + ' servings of this.</div>';
  b += '<h2>Steps</h2><div class="card">' + (r.steps.length ? r.steps.map((s, i) => { const sec = stepSeconds(s); return '<div class="step"><span class="n">' + (i + 1) + '</span><div class="grow">' + esc(s) + (sec ? '<div><button class="small" data-act="stepTimer" data-sec="' + sec + '" data-label="' + esc(r.name) + ' · step ' + (i + 1) + '">⏱ Start ' + clock(sec) + ' timer</button></div>' : '') + '</div></div>'; }).join('') : '<span class="muted">No steps.</span>') + '</div>';
  if (r.sourceLink) b += '<p class="small muted">Source (saved as a note): ' + esc(r.sourceLink) + '</p>';
  b += '<div class="grid2" style="margin-top:10px"><button data-act="rvFav" data-id="' + r.id + '">' + (r.fav ? '★ Unfavorite' : '☆ Favorite') + '</button><button data-act="rvDup" data-id="' + r.id + '">⧉ Duplicate</button>' + (r.builtin ? '' : '<button data-act="rvEdit" data-id="' + r.id + '">✏️ Edit</button><button class="danger" data-act="rvDel" data-id="' + r.id + '">Delete</button>') + '</div>';
  return { title: r.name, body: b, footer: '<button data-act="openScale" data-id="' + r.id + '">⚖ Scale</button><button class="primary" data-act="logRecipe" data-id="' + r.id + '">Log this drink</button>' };
};
ACT.rvServ = (el) => { const d = SHEET.data; d.servings = Math.max(1, Math.min(50, d.servings + Number(el.dataset.d))); renderSheet(); };
ACT.stepTimer = (el) => { startTimer(Number(el.dataset.sec), el.dataset.label); };
ACT.rvFav = (el) => mutate((s) => { const r = s.recipes.find((x) => x.id === el.dataset.id); r.fav = !r.fav; });
ACT.rvDup = (el) => { const r = S.recipes.find((x) => x.id === el.dataset.id); const c = SC.clone(r); c.id = SC.uid(); c.name = r.name + ' (copy)'; c.builtin = false; c.fav = false; mutate((s) => { s.recipes.push(c); }); openRecipeForm(c.id); toast('Duplicated. Edit your copy.'); };
ACT.rvEdit = (el) => openRecipeForm(el.dataset.id);
ACT.rvDel = (el) => { const r = S.recipes.find((x) => x.id === el.dataset.id); confirmDialog('Delete “' + r.name + '”? Drinks already logged keep their record.', 'Delete', () => { mutate((s) => { s.recipes = s.recipes.filter((x) => x.id !== r.id); }); closeSheet(); toast('Recipe deleted.'); }, true); };

// ---------- scaling ----------
ACT.openScale = (el) => { const r = S.recipes.find((x) => x.id === el.dataset.id); openSheet('scale', { id: r.id, mode: 'have', slot: 0, amount: '', unit: r.ingredients[0].unit, servings: 2, spc: 1 }); };
SHEETS.scale = (d) => {
  const r = S.recipes.find((x) => x.id === d.id); if (!r) return null; const sl = r.ingredients[d.slot] || r.ingredients[0]; const isEsp = sl.type === 'espresso';
  const units = isEsp ? [['shot', 'shots'], ['capsule', 'capsules']] : [['g', 'g'], ['ml', 'ml'], ['tsp', 'tsp'], ['tbsp', 'tbsp'], ['cup', 'cups']];
  let b = '<form id="sform" novalidate>' + selectField('mode', 'What do you know?', [['have', 'I have a certain amount of one ingredient'], ['want', 'I want a number of servings']], d.mode, { change: 'scField' });
  let out = null, err = '';
  if (d.mode === 'have') {
    b += selectField('slot', 'Ingredient', r.ingredients.map((x, i) => [i, slotName(x)]), d.slot, { change: 'scField' }) + '<div class="grid2"><div>' + field('amount', 'I have', d.amount, { type: 'number', change: 'scField' }) + '</div><div>' + selectField('unit', 'Unit', units, units.some((u) => u[0] === d.unit) ? d.unit : units[0][0], { change: 'scField' }) + '</div></div>';
    if (isEsp && d.unit === 'capsule') b += field('spc', 'Shots per capsule', d.spc, { type: 'number', int: true, change: 'scField' });
    const n = SC.parseNum(d.amount, { min: 0, minExclusive: true, max: 1e6 });
    if (d.amount !== '' && !n.ok) err = 'Amount: ' + n.error; else if (n.ok) { const spc = SC.parseNum(d.spc, { min: 1, max: 4, int: true }); if (!spc.ok) err = 'Shots per capsule: ' + spc.error; else out = SC.scaleRecipe(S, r, 'have', { slot: d.slot, amount: n.value, unit: d.unit, shotsPerCapsule: spc.value }); }
  } else {
    b += field('servings', 'Servings I want', d.servings, { type: 'number', change: 'scField' });
    const n = SC.parseNum(d.servings, { min: 0, minExclusive: true, max: 1000 }); if (!n.ok) err = 'Servings: ' + n.error; else out = SC.scaleRecipe(S, r, 'want', { servings: n.value });
  }
  b += '</form>' + (err ? '<div class="errbox">' + esc(err) + '</div>' : '');
  if (out) {
    b += '<div class="card"><div class="stat"><span class="small muted">Makes</span><b>' + fmt(out.servings, 2) + ' serving' + (out.servings === 1 ? '' : 's') + '</b>' + (out.whole !== out.servings ? '<span class="small muted">' + out.whole + ' whole</span>' : '') + '</div><table class="t" style="margin-top:8px"><thead><tr><th>Ingredient</th><th>Amount</th><th>Pantry</th></tr></thead><tbody>' + out.rows.map((x) => '<tr><td>' + esc(slotName(x.slot)) + (x.slot.optional ? ' <span class="muted">(opt.)</span>' : '') + '</td><td>' + esc(amt(x.amount, x.slot.unit)) + '</td><td>' + (x.enough ? '<span class="badge ok">enough</span>' : x.unknown ? '<span class="badge warn">unknown</span>' : '<span class="badge bad">short</span>') + '</td></tr>').join('') + (out.water ? '<tr><td>Water</td><td>' + esc(amt(out.water.ml, 'ml')) + ' · ' + esc(temp(out.water.tempC)) + '</td><td class="muted">assumed</td></tr>' : '') + '</tbody></table></div>';
    b += '<div class="' + (out.pantryServings > 0 ? 'okbox' : 'warnbox') + '">With what is in your pantry now you can make <b>' + out.pantryServings + '</b> serving' + (out.pantryServings === 1 ? '' : 's') + (out.limiting ? '; <b>' + esc(slotName(out.limiting)) + '</b> runs out first' : '') + '.</div>';
  }
  return { title: 'Scale ' + r.name, body: b, footer: '<button data-act="viewRecipeBack" data-id="' + r.id + '">Back</button><button class="primary" data-act="logRecipe" data-id="' + r.id + '">Log this drink</button>' };
};
CHG.scField = (el) => { const d = SHEET.data; const k = el.name; d[k] = k === 'slot' ? Number(el.value) : el.value; if (k === 'slot') { const sl = S.recipes.find((x) => x.id === d.id).ingredients[d.slot]; d.unit = sl.unit; } if (k === 'mode' || k === 'slot') { d.amount = k === 'mode' ? d.amount : d.amount; } renderSheet(); };
ACT.viewRecipeBack = (el) => openSheet('recipe', { id: el.dataset.id, servings: 1 });

// ---------- recipe form ----------
function blankRow() { return { type: 'matcha', label: '', amount: '', unit: 'g', dairyPossible: false, optional: false, intensity: '', notes: [] }; }
function openRecipeForm(id, draft) {
  if (draft) { openSheet('recipeForm', { id: null, d: draft, errors: [] }); return; }
  if (id) {
    const r = S.recipes.find((x) => x.id === id);
    openSheet('recipeForm', { id: id, errors: [], d: { name: r.name, serve: r.serve, servings: 1, fav: r.fav, ingredients: r.ingredients.map((i) => ({ type: i.type, label: i.label || '', amount: i.amount, unit: i.unit, dairyPossible: !!i.dairyPossible, optional: !!i.optional, intensity: i.intensity || '', notes: [] })), waterMl: r.water ? r.water.ml : '', waterTemp: r.water && r.water.tempC !== null ? r.water.tempC : '', ice: r.ice, steps: r.steps.join('\n'), note: r.note || '', sourceLink: r.sourceLink || '' } });
  } else openSheet('recipeForm', { id: null, errors: [], d: { name: '', serve: 'hot', servings: 1, fav: false, ingredients: [blankRow(), Object.assign(blankRow(), { type: 'milk', unit: 'ml', dairyPossible: true })], waterMl: '', waterTemp: '', ice: false, steps: '', note: '', sourceLink: '' } });
}
ACT.newRecipe = () => openRecipeForm(null);
SHEETS.recipeForm = (d) => {
  const f = d.d; const errs = d.errors; const rowErr = (i) => errs.filter((e) => e.row === i).map((e) => '<div class="err">' + esc(e.msg) + '</div>').join('');
  let b = (d.imported ? '<div class="warnbox">Imported drafts can be wrong. Check every ingredient. Amounts below are totals for the number of servings you enter; they are divided to per-serving amounts when you save.</div>' : '') + errList(errs.filter((e) => e.row === -1).map((e) => e.msg));
  b += '<form id="rform" novalidate>' + field('name', 'Recipe name', f.name) + '<div class="grid2"><div>' + selectField('serve', 'Served', [['hot', 'Hot'], ['iced', 'Iced']], f.serve) + '</div><div>' + field('servings', 'These amounts make (servings)', f.servings, { type: 'number' }) + '</div></div>';
  b += '<h2>Ingredients</h2>';
  f.ingredients.forEach((r, i) => {
    const isEsp = r.type === 'espresso';
    b += '<div class="card" style="margin:6px 0"><div class="row"><div class="grow">' + selectField('i' + i + '_type', '', SC.SLOT_TYPES.map((t) => [t, t === 'espresso' ? 'Espresso (capsule or beans)' : SC.SLOT_LABEL[t][0].toUpperCase() + SC.SLOT_LABEL[t].slice(1)]), r.type, { change: 'rfRow' }) + '</div><button class="small danger" data-act="rfDelRow" data-i="' + i + '" aria-label="Remove ingredient">✕</button></div>' +
      (r.type === 'other' ? field('i' + i + '_label', 'What is it?', r.label, { ph: 'e.g. cinnamon' }) : '') +
      '<div class="grid2"><div>' + field('i' + i + '_amount', 'Amount', r.amount === null ? '' : r.amount, { type: 'number', ph: 'needs a number' }) + '</div><div>' + selectField('i' + i + '_unit', 'Unit', (isEsp ? ['shot'] : SC.RECIPE_UNITS.filter((u) => u !== 'shot')).map((u) => [u, u === 'shot' ? 'shots' : u]), isEsp ? 'shot' : r.unit) + '</div></div>' +
      '<div class="row wrap">' + checkField('i' + i + '_dairyPossible', 'Dairy option', r.dairyPossible) + checkField('i' + i + '_optional', 'Optional', r.optional) + (isEsp ? '<div style="min-width:150px">' + selectField('i' + i + '_intensity', '', [['', 'Any intensity'], ['low', 'Low intensity'], ['medium', 'Medium'], ['high', 'High intensity']], r.intensity) + '</div>' : '') + '</div>' +
      (r.notes && r.notes.length ? r.notes.map((n) => '<div class="small" style="color:var(--warn)">' + esc(n) + '</div>').join('') : '') + rowErr(i) + '</div>';
  });
  b += '<button type="button" data-act="rfAddRow">＋ Add ingredient</button><h2>Water & ice</h2><div class="grid2"><div>' + field('waterMl', 'Water (ml, optional)', f.waterMl, { type: 'number' }) + '</div><div>' + field('waterTemp', 'Water temperature (°C)', f.waterTemp, { type: 'number', ph: 'cold' }) + '</div></div>' + checkField('ice', 'Served over ice', f.ice) + '<div class="small muted">Water and ice are never tracked as stock.</div>' +
    '<label class="f" for="f-steps">Steps (one per line)</label><textarea id="f-steps" name="steps" rows="5">' + esc(f.steps) + '</textarea>' + field('note', 'Note (optional)', f.note) + field('sourceLink', 'Source link (kept only as a note)', f.sourceLink, { ph: 'https://…' }) + checkField('fav', 'Favorite', f.fav) + '</form>';
  return { title: d.id ? 'Edit recipe' : d.imported ? 'Check the imported recipe' : 'New recipe', body: b, footer: '<button data-act="closeSheet">Cancel</button><button class="primary" data-act="rfSave">Save recipe</button>' };
};
function syncRecipeForm() {
  const form = $('#rform'); if (!form) return; const v = formData(form); const f = SHEET.data.d;
  ['name', 'serve', 'servings', 'waterMl', 'waterTemp', 'steps', 'note', 'sourceLink'].forEach((k) => { if (v[k] !== undefined) f[k] = v[k]; }); f.ice = !!v.ice; f.fav = !!v.fav;
  f.ingredients.forEach((r, i) => { const t = v['i' + i + '_type']; if (t === undefined) return; r.type = t; r.label = v['i' + i + '_label'] !== undefined ? v['i' + i + '_label'] : r.label; r.amount = v['i' + i + '_amount']; r.unit = v['i' + i + '_unit']; r.dairyPossible = !!v['i' + i + '_dairyPossible']; r.optional = !!v['i' + i + '_optional']; r.intensity = v['i' + i + '_intensity'] || ''; });
}
CHG.rfRow = (el) => {
  syncRecipeForm(); const i = Number(el.name.match(/^i(\d+)_/)[1]); const r = SHEET.data.d.ingredients[i];
  r.unit = r.type === 'espresso' ? 'shot' : (r.unit === 'shot' ? SC.BASE_UNIT[r.type] : r.unit); if (r.type === 'milk' || r.type === 'icecream') r.dairyPossible = true; renderSheet();
};
ACT.rfAddRow = () => { syncRecipeForm(); SHEET.data.d.ingredients.push(blankRow()); renderSheet(); };
ACT.rfDelRow = (el) => { syncRecipeForm(); SHEET.data.d.ingredients.splice(Number(el.dataset.i), 1); renderSheet(); };
ACT.rfSave = () => {
  syncRecipeForm(); const d = SHEET.data; const f = d.d;
  const res = SCP.draftToRecipe({ id: d.id, name: f.name, serve: f.serve, servings: f.servings, fav: f.fav, ingredients: f.ingredients, waterMl: f.waterMl, waterTemp: f.waterTemp, ice: f.ice, steps: String(f.steps).split('\n'), note: f.note, sourceLink: f.sourceLink });
  if (!res.ok) { d.errors = res.errors; renderSheet(); const body = $('#overlay .body'); if (body) body.scrollTop = 0; return; }
  mutate((s) => { const i = s.recipes.findIndex((r) => r.id === res.recipe.id); if (i >= 0) { res.recipe.builtin = false; s.recipes[i] = res.recipe; } else s.recipes.push(res.recipe); });
  closeSheet(); toast('Saved ' + res.recipe.name + '.');
};

// ---------- recipe import ----------
ACT.importRecipe = () => openSheet('importRecipe', { tab: 'text', text: '', status: '', busy: false, err: '' });
SHEETS.importRecipe = (d) => {
  let b = '<p class="muted">Paste recipe text, or read screenshots on this device. You will check the draft before anything is saved. Screenshots are never stored.</p><div class="chips" role="group" aria-label="Source"><button class="chip" aria-pressed="' + (d.tab === 'text') + '" data-act="irTab" data-v="text">Paste text</button><button class="chip" aria-pressed="' + (d.tab === 'shots') + '" data-act="irTab" data-v="shots">Screenshots</button></div>';
  if (d.tab === 'shots') b += '<label class="f" for="irFiles">One or more screenshots</label><input type="file" id="irFiles" accept="image/*" multiple style="min-height:44px"><button class="primary big" style="margin-top:8px" data-act="irRead"' + (d.busy ? ' disabled' : '') + '>Read screenshots</button><div id="ocrStatus" class="small muted" role="status" style="margin:6px 0">' + esc(d.status) + '</div>';
  b += (d.err ? '<div class="errbox">' + esc(d.err) + '</div>' : '') + '<label class="f" for="irText">' + (d.tab === 'shots' ? 'Text read from the screenshots (edit if needed)' : 'Recipe text') + '</label><textarea id="irText" rows="9" placeholder="Iced dirty matcha&#10;2 tsp matcha&#10;1 double espresso&#10;150 ml oat milk&#10;ice">' + esc(d.text) + '</textarea>';
  return { title: 'Import a recipe', body: b, footer: '<button data-act="closeSheet">Cancel</button><button class="primary" data-act="irParse">Make a draft</button>' };
};
ACT.irTab = (el) => { SHEET.data.text = $('#irText').value; SHEET.data.tab = el.dataset.v; renderSheet(); };
ACT.irRead = async () => {
  const files = Array.prototype.slice.call(($('#irFiles') || {}).files || []); const d = SHEET.data; if (!files.length) { $('#ocrStatus').textContent = 'Choose at least one screenshot.'; return; }
  d.text = $('#irText').value; d.busy = true; const st = (m) => { const n = $('#ocrStatus'); if (n) n.textContent = m; };
  try {
    for (let i = 0; i < files.length; i++) { const t0 = Date.now(); const text = await OCR.read(files[i], (m) => st('Screenshot ' + (i + 1) + ' of ' + files.length + ': ' + m)); d.text += (d.text && !/\n$/.test(d.text) ? '\n' : '') + text.trim() + '\n'; d.status = 'Read ' + (i + 1) + ' of ' + files.length + ' (' + Math.round((Date.now() - t0) / 100) / 10 + ' s for the last one).'; }
    d.status += ' Check the text, then press “Make a draft”.';
  } catch (e) { d.status = e.message; }
  d.busy = false; if (SHEET && SHEET.name === 'importRecipe') renderSheet();
};
ACT.irParse = () => {
  const d = SHEET.data; const text = $('#irText').value; d.text = text; if (!text.trim()) { d.err = 'Paste or read some text first.'; renderSheet(); return; }
  const out = SCP.parseRecipeText(text);
  if (!out.ingredients.length) { d.err = out.warnings[0] || 'No ingredients found.'; renderSheet(); return; }
  d.err = '';
  const iced = out.ice || /\biced\b|cold/i.test(out.title);
  const draft = { name: out.title || 'Imported recipe', serve: iced ? 'iced' : 'hot', servings: out.servings || 1, fav: false,
    ingredients: out.ingredients.map((i) => ({ type: i.type || 'other', label: i.type ? '' : i.label, amount: i.amount === null ? '' : i.amount, unit: i.type === 'espresso' ? 'shot' : (SC.RECIPE_UNITS.indexOf(i.unit) >= 0 ? i.unit : 'g'), dairyPossible: i.dairyPossible, optional: i.optional, intensity: '', notes: i.notes })),
    waterMl: out.water && out.water.ml ? out.water.ml : '', waterTemp: out.water && out.water.tempC !== null && out.water.tempC !== undefined ? out.water.tempC : '', ice: out.ice, steps: out.steps.join('\n'), note: 'Imported from text.', sourceLink: out.link };
  SHEET = { name: 'recipeForm', data: { id: null, d: draft, errors: [], imported: true } }; renderSheet();
};

// ---------- first-run guide ----------
const INTERESTS = [['matcha', '🍵 Matcha lattes'], ['hojicha', '🌰 Hojicha'], ['capsules', '☕ Nespresso capsules'], ['beans', '🫘 Coffee beans or grounds'], ['coldbrew', '🧊 Cold brew']];
ACT.openGuide = () => openSheet('guide', { step: 0, interests: { matcha: true }, orig: false, vert: false, picks: null, tempUnit: S.settings.tempUnit, imperial: S.settings.imperial, added: [] });
function guideSuggestions(d) {
  const ids = []; const add = (x) => { if (ids.indexOf(x) < 0) ids.push(x); };
  if (d.interests.matcha) { add('pre_matcha_cer'); add('pre_milk_whole'); add('pre_milk_oat'); }
  if (d.interests.hojicha) { add('pre_hojicha'); add('pre_milk_whole'); }
  if (d.interests.capsules) { if (d.orig || !d.vert) { add('pre_n_livanto'); add('pre_n_arpeggio'); } if (d.vert) { add('pre_v_forte'); add('pre_v_chiaro'); } add('pre_milk_whole'); }
  if (d.interests.beans) { add('pre_beans'); add('pre_milk_whole'); }
  if (d.interests.coldbrew) add('pre_grounds');
  return ids.map((id) => SC.PRESETS.find((p) => p.id === id)).filter((p) => p && (p.category !== 'capsule' || d.orig || d.vert));
}
SHEETS.guide = (d) => {
  const dots = '<div class="row" style="justify-content:center;margin:8px 0" aria-label="Step ' + (d.step + 1) + ' of 4">' + [0, 1, 2, 3].map((i) => '<span style="width:10px;height:10px;border-radius:50%;background:' + (i <= d.step ? 'var(--accent)' : 'var(--line)') + '"></span>').join('') + '</div>';
  let b = dots, foot;
  if (d.step === 0) {
    b += '<h2 style="margin-top:4px">What do you drink?</h2><p class="muted">This only picks a few suggestions. You can change everything later.</p>' + INTERESTS.map((i) => '<label class="check card" style="padding:4px 12px"><input type="checkbox" name="i_' + i[0] + '" data-change="gField"' + (d.interests[i[0]] ? ' checked' : '') + '> <span>' + i[1] + '</span></label>').join('');
    foot = '<button data-act="gSkip">Skip</button><button class="primary" data-act="gNext">Next</button>';
  } else if (d.step === 1) {
    b += '<h2 style="margin-top:4px">Your machine and units</h2><p class="muted">Only capsules that fit your machine are offered or counted. No machine is fine.</p>' +
      '<label class="check card" style="padding:4px 12px"><input type="checkbox" name="orig" data-change="gField"' + (d.orig ? ' checked' : '') + '> <span>Nespresso Original machine</span></label><label class="check card" style="padding:4px 12px"><input type="checkbox" name="vert" data-change="gField"' + (d.vert ? ' checked' : '') + '> <span>Nespresso Vertuo machine</span></label>' +
      selectField('tempUnit', 'Temperature', [['C', '°C'], ['F', '°F']], d.tempUnit, { change: 'gField' }) + checkField('imperial', 'Also show ounces / fl oz', d.imperial, { change: 'gField' });
    foot = '<button data-act="gBack">Back</button><button data-act="gSkip">Skip</button><button class="primary" data-act="gNext">Next</button>';
  } else if (d.step === 2) {
    const sug = guideSuggestions(d); if (d.picks === null) d.picks = sug.slice(0, 3).map((p) => p.id); d.picks = d.picks.filter((id) => sug.some((p) => p.id === id));
    b += '<h2 style="margin-top:4px">Add up to 3 products</h2><p class="muted">From the starter list. Each is added as one sealed pack. That is enough to get your first answer.</p>' + (sug.length ? sug.map((p) => '<label class="check card" style="padding:4px 12px"><input type="checkbox" name="pick" value="' + p.id + '" data-change="gPick"' + (d.picks.indexOf(p.id) >= 0 ? ' checked' : '') + '> <span><b>' + esc(p.brand) + ' ' + esc(p.name) + '</b><br><span class="small muted">' + (p.category === 'capsule' ? 'sleeve of ' + p.size : fmt(p.size) + ' ' + p.unit) + '</span></span></label>').join('') : '<div class="empty">Pick something to drink first (Back).</div>');
    foot = '<button data-act="gBack">Back</button><button data-act="gSkip">Skip</button><button class="primary" data-act="gNext"' + (d.picks.length ? '' : ' disabled') + '>Add and show me</button>';
  } else {
    const sug = SC.suggest(S, {}, today());
    b += '<h2 style="margin-top:4px">You can make this now</h2>' + (sug.ready.length ? sug.ready.map((a) => recipeRow(a)).join('') : '<div class="card muted">Nothing is fully covered yet. Add the missing item from Home.</div>') + (sug.almost.length ? '<h2>One item away</h2>' + sug.almost.slice(0, 3).map(almostRow).join('') : '');
    foot = '<button class="primary" data-act="gDone">Finish</button>';
  }
  return { title: 'Welcome to StockCup', full: true, noClose: true, body: b, footer: foot };
};
CHG.gField = (el) => {
  const d = SHEET.data; if (el.name.indexOf('i_') === 0) d.interests[el.name.slice(2)] = el.checked; else if (el.type === 'checkbox') d[el.name] = el.checked; else d[el.name] = el.value;
  if (el.name === 'orig' || el.name === 'vert' || el.name.indexOf('i_') === 0) d.picks = null; renderSheet();
};
CHG.gPick = () => { const d = SHEET.data; const boxes = Array.prototype.slice.call(document.querySelectorAll('#overlay input[name="pick"]')); let picks = boxes.filter((b) => b.checked).map((b) => b.value); if (picks.length > 3) { toast('Up to 3 products for now. You can add more later.'); picks = picks.slice(0, 3); } d.picks = picks; renderSheet(); };
ACT.gBack = () => { SHEET.data.step--; renderSheet(); };
ACT.gSkip = () => { mutate((s) => { s.settings.onboarded = true; }); closeSheet(); };
ACT.gNext = () => {
  const d = SHEET.data;
  if (d.step === 1) { mutate((s) => { s.settings.tempUnit = d.tempUnit; s.settings.imperial = d.imperial; if (!s.machines.length) { if (d.orig) s.machines.push(SC.makeMachine('Original machine', 'original', today())); if (d.vert) s.machines.push(SC.makeMachine('Vertuo machine', 'vertuo', today())); } }); }
  if (d.step === 2) {
    const picks = d.picks.map((id) => SC.PRESETS.find((p) => p.id === id)).filter(Boolean);
    mutate((s) => { picks.forEach((p) => { const r = SC.addProduct(s, Object.assign(SC.presetToForm(p), { sealed: 1, sleeves: 1 }), today()); void r; }); });
  }
  d.step++; renderSheet();
};
ACT.gDone = () => { mutate((s) => { s.settings.onboarded = true; }); closeSheet(); toast('All set. Log a drink from Home whenever you make one.'); };

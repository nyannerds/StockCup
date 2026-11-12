/* StockCup screens. */
'use strict';

function alertBox(kind, html, btnLabel, act, data) {
  return '<div class="alert ' + kind + '" role="status"><span class="grow">' + html + '</span>' + (btnLabel ? '<button class="small" data-act="' + act + '"' + (data ? ' data-id="' + esc(data) + '"' : '') + '>' + esc(btnLabel) + '</button>' : '') + '</div>';
}
function ingSummary(r) { return r.ingredients.map((i) => slotName(i) + ' ' + (i.unit === 'shot' ? i.amount + (i.amount === 1 ? ' shot' : ' shots') : fmt(i.amount) + ' ' + i.unit) + (i.optional ? ' (optional)' : '')).join(' · '); }
function recipeBadges(r) {
  const mg = SC.recipeCaffeineEstimate(r);
  return '<span class="badge acc">' + (r.serve === 'iced' ? '🧊 Iced' : '☕ Hot') + '</span> <span class="badge">' + levelLabel[SC.caffeineLevel(mg)] + (mg ? ' · ~' + mg + ' mg est.' : '') + '</span>' + (r.fav ? ' <span class="badge warn">★ Favorite</span>' : '');
}
function needText(sl) { return slotName(sl.slot) + ': need ' + amt(sl.need, sl.slot.unit) + ', have ' + (sl.unknown && sl.have === 0 ? 'unknown amount' : amt(sl.have, sl.slot.unit)); }
function recipeRow(a, note) {
  const r = a.recipe; const many = a.makeable > 1 ? '<span class="badge ok">Enough for ' + a.makeable + '</span>' : '';
  return '<div class="card tap" data-act="viewRecipe" data-id="' + r.id + '"><div class="row top"><div class="grow"><h3>' + esc(r.name) + '</h3><div>' + recipeBadges(r) + ' ' + many + '</div><div class="small muted" style="margin-top:4px">' + esc(ingSummary(r)) + '</div>' + (note || '') + '</div>' +
    '<button class="primary small" data-act="logRecipe" data-id="' + r.id + '" aria-label="Log ' + esc(r.name) + '">Log</button></div></div>';
}
function addMissingBtn(slot) {
  const t = slot.slot.type; const cat = t === 'espresso' ? (SC.capsulesEnabled(S) ? 'capsule' : 'coffee') : t;
  return '<button class="small" data-act="addMissing" data-cat="' + cat + '">+ Add ' + esc(t === 'espresso' ? (cat === 'capsule' ? 'capsules' : 'coffee beans') : slotName(slot.slot)) + '</button>';
}
function almostRow(a) {
  const r = a.recipe; const sl = a.shortSlots[0];
  return '<div class="card tap" data-act="viewRecipe" data-id="' + r.id + '"><div class="row top"><div class="grow"><h3>' + esc(r.name) + '</h3><div>' + recipeBadges(r) + '</div><div class="small" style="margin-top:4px;color:var(--warn)">One short: ' + esc(needText(sl)) + '</div><div style="margin-top:6px">' + addMissingBtn(sl) + '</div></div></div></div>';
}

// ---------- HOME ----------
VIEWS.home = () => {
  const t = today(), who = S.settings.activePerson; const sug = SC.suggest(S, {}, t); const last = SC.lastLogFor(S, who);
  let h = topbar('StockCup');
  const alerts = [];
  S.machines.forEach((m) => {
    const d = SC.descaleStatus(m, t);
    if (d.due) alerts.push(alertBox('warn', '🧼 <b>Descale ' + esc(m.name) + '.</b> ' + (d.byCaps ? m.caps + ' capsules since the last descale (limit ' + m.descaleCaps + ').' : 'Last descaled more than ' + m.descaleMonths + ' months ago.') + ' <span class="muted small">(estimate)</span>', 'Done', 'descaled', m.id));
  });
  const aging = S.products.filter((p) => { const f = SC.freshness(p, t); return f && (f.state === 'warn' || f.state === 'past') && SC.isUsable(S, p); });
  const past = aging.filter((p) => SC.freshness(p, t).state === 'past');
  if (past.length) alerts.push(alertBox('bad', '⏳ <b>Past best:</b> ' + past.map((p) => esc(SC.productLabel(p))).join(', ') + '. Freshness is an estimate.', 'See', 'seeAging'));
  const warn = aging.filter((p) => SC.freshness(p, t).state === 'warn');
  if (warn.length) alerts.push(alertBox('warn', '⏳ <b>Use soon:</b> ' + warn.map((p) => esc(SC.productLabel(p))).join(', ') + '.', 'See', 'seeAging'));
  const low = SC.lowStock(S);
  if (low.length) alerts.push(alertBox('warn', '🛒 <b>Running low:</b> ' + low.map((x) => esc(catLabel(x.type).toLowerCase()) + ' (' + fmt(x.total) + ' ' + x.unit + ')').join(', ') + '.', 'Shopping list', 'toShopping'));
  if (S.logs.length - S.settings.recountMark >= 20) alerts.push(alertBox('', '🔢 <b>' + (S.logs.length - S.settings.recountMark) + ' drinks logged since your last recount.</b> A quick look at the shelf keeps stock honest.', 'Not now', 'dismissRecount'));
  h += alerts.join('');
  if (!S.products.filter((p) => p.category !== 'capsule' || SC.capsulesEnabled(S)).length) {
    h += '<div class="card"><div class="empty"><div class="big-ic">🍵</div><h2>Your pantry is empty</h2><p>Add a few products and StockCup will tell you what you can make, deduct stock when you log a drink and warn you before things go stale.</p></div><div class="stack">' +
      '<button class="primary big" data-act="openGuide">Take the 1-minute setup guide</button><button class="big" data-act="addPreset">Add from the starter list</button><button class="big" data-act="loadSample">Try the sample pantry</button></div></div>';
    return h;
  }
  h += '<div class="grid2" style="margin-top:8px"><button class="primary big" data-act="logPick">☕ Log a drink</button><button class="big" data-act="logSame"' + (last ? '' : ' disabled') + '>↻ Same as last time</button></div>';
  if (last) h += '<div class="small muted" style="margin:4px 2px">Last: ' + esc(last.name) + ' · ' + esc(fmtDT(last.ts)) + '</div>';
  const recents = []; S.logs.slice().sort((a, b) => (a.ts < b.ts ? 1 : -1)).forEach((l) => { if (l.personId === who && l.recipeId && recents.indexOf(l.recipeId) < 0 && S.recipes.some((r) => r.id === l.recipeId)) recents.push(l.recipeId); });
  if (recents.length) h += '<div class="chips" aria-label="Recent drinks">' + recents.slice(0, 5).map((id) => '<button class="chip" data-act="logRecipe" data-id="' + id + '">' + esc(S.recipes.find((r) => r.id === id).name) + '</button>').join('') + '</div>';
  const cafToday = SC.dayCaffeine(S, who, t);
  h += '<div class="grid3" style="margin:10px 0"><div class="stat"><span class="small muted">Caffeine today (est.)</span><b>' + fmt(cafToday, 0) + ' mg</b></div><div class="stat"><span class="small muted">Drinks today</span><b>' + SC.logsFor(S, who).filter((l) => l.ts.slice(0, 10) === t).length + '</b></div><div class="stat"><span class="small muted">Can make now</span><b>' + sug.ready.length + '</b></div></div>';
  h += '<h2>You can make now</h2>';
  if (sug.ready.length) h += sug.ready.slice(0, 4).map((a) => recipeRow(a)).join('') + (sug.ready.length > 4 ? '<button class="big" data-act="seeMake">See all ' + sug.ready.length + '</button>' : '');
  else h += '<div class="card muted">Nothing is fully covered right now. ' + (sug.almost.length ? 'See “almost there” below.' : 'Add more products to unlock recipes.') + '</div>';
  if (sug.maybe.length) h += '<h2>Maybe (an amount is unknown)</h2>' + sug.maybe.slice(0, 3).map((a) => recipeRow(a, '<div class="small" style="color:var(--warn)">Recount to be sure.</div>')).join('');
  if (sug.useItUp.length) h += '<h2>Use it up</h2>' + sug.useItUp.slice(0, 3).map((u) => recipeRow(u.analysis, '<div class="small" style="color:var(--warn)">Uses ' + u.aged.map((x) => esc(SC.productLabel(x.p)) + (x.f.state === 'past' ? ' (past best)' : ' (open ' + x.f.days + ' d)')).join(', ') + '</div>')).join('');
  if (sug.almost.length) h += '<h2>Almost there</h2>' + sug.almost.slice(0, 3).map(almostRow).join('');
  return h;
};
ACT.seeAging = () => { UI.pantryCat = 'aging'; go('pantry'); };
ACT.toShopping = () => go('shopping');
ACT.seeMake = () => { UI.rview = 'make'; go('recipes'); };
ACT.dismissRecount = () => mutate((s) => { s.settings.recountMark = s.logs.length; });
ACT.descaled = (el) => mutate((s) => { const m = s.machines.find((x) => x.id === el.dataset.id); if (m) { m.caps = 0; m.lastDescaled = today(); } });
ACT.addMissing = (el, e) => { e.stopPropagation(); openProductForm({ category: el.dataset.cat }); };
ACT.loadSample = () => { mutate((s) => { SC.loadSample(s, today()); }); toast('Sample pantry loaded. Clear it any time in More.'); };

// ---------- PANTRY ----------
function pantryItems() {
  const caps = SC.capsulesEnabled(S); const q = UI.pantryQ.trim().toLowerCase(); const t = today();
  return S.products.filter((p) => {
    if (p.category === 'capsule' && !caps) return false;
    if (UI.pantryCat === 'aging') { const f = SC.freshness(p, t); if (!(f && (f.state === 'warn' || f.state === 'past'))) return false; } else if (UI.pantryCat !== 'all' && p.category !== UI.pantryCat) return false;
    if (q && (p.brand + ' ' + p.name + ' ' + catLabel(p.category)).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort((a, b) => Object.keys(SC.CATEGORIES).indexOf(a.category) - Object.keys(SC.CATEGORIES).indexOf(b.category) || SC.productLabel(a).localeCompare(SC.productLabel(b)));
}
function productCard(p) {
  const usable = SC.isUsable(S, p); const st = SC.stockOf(p);
  const cap = p.category === 'capsule' ? '<div class="small muted">' + (p.capsule.system === 'original' ? 'Original' : 'Vertuo') + ' · intensity ' + p.capsule.intensity + ' · ' + p.capsule.shots + (p.capsule.shots === 1 ? ' shot' : ' shots') + (p.capsule.cupSize ? ' · ' + p.capsule.cupSize + ' ml' : '') + '</div>' : '';
  const empty = !st.unknown && st.amount === 0;
  return '<div class="card tap" data-act="viewProduct" data-id="' + p.id + '"><div class="row top"><div class="grow"><h3>' + esc(p.brand) + ' · ' + esc(p.name) + '</h3><div class="small muted">' + esc(catLabel(p.category)) + (p.category === 'capsule' ? '' : ' · ' + fmt(p.size) + ' ' + p.unit + ' pack') + (p.dairy ? ' · contains dairy' : '') + '</div>' + cap +
    '<div class="small" style="margin-top:2px">' + esc(stockText(p)) + '</div><div style="margin-top:4px">' + (usable ? '' : '<span class="badge bad">Not for your machines</span> ') + (empty ? '<span class="badge bad">Empty</span> ' : '') + (p.price === null || p.price === undefined ? '<span class="badge">cost unknown</span> ' : '') + freshBadge(p) + '</div></div>' +
    '<div style="text-align:right"><b>' + esc(totalText(p)) + '</b></div></div></div>';
}
function pantryListHtml() {
  const items = pantryItems();
  if (!items.length) return '<div class="empty"><div class="big-ic">🫙</div><p>' + (S.products.length ? 'Nothing matches.' : 'No products yet.') + '</p></div>';
  return items.map(productCard).join('');
}
VIEWS.pantry = () => {
  let h = topbar('Pantry', '<button class="primary small" data-act="addMenu">＋ Add</button>');
  h += '<input type="search" id="pantrySearch" data-input="pantryQ" placeholder="Search brand or name" aria-label="Search pantry" value="' + esc(UI.pantryQ) + '">';
  const cats = Object.keys(SC.CATEGORIES).filter((c) => c !== 'capsule' || SC.capsulesEnabled(S));
  h += '<div class="chips" role="group" aria-label="Filter">' + [['all', 'All'], ['aging', '⏳ Aging']].concat(cats.map((c) => [c, catLabel(c)])).map((c) => '<button class="chip" aria-pressed="' + (UI.pantryCat === c[0]) + '" data-act="pantryCat" data-cat="' + c[0] + '">' + esc(c[1]) + '</button>').join('') + '</div>';
  h += '<div id="plist">' + pantryListHtml() + '</div>';
  if (!SC.capsulesEnabled(S) && S.products.some((p) => p.category === 'capsule')) h += '<p class="small muted">Capsule products are hidden because no machine is set. Add one in More → Machines.</p>';
  return h;
};
INP.pantryQ = (el) => { UI.pantryQ = el.value; $('#plist').innerHTML = pantryListHtml(); };
ACT.pantryCat = (el) => { UI.pantryCat = el.dataset.cat; render(); };

// ---------- RECIPES ----------
function filterRow() {
  const f = UI.rf;
  return '<input type="search" data-input="rq" placeholder="Search recipes" aria-label="Search recipes" value="' + esc(f.q) + '">' +
    '<div class="chips" role="group" aria-label="Filters">' +
    [['serve', 'hot', '☕ Hot'], ['serve', 'iced', '🧊 Iced'], ['caf', 'none', 'No caffeine'], ['caf', 'low', 'Low'], ['caf', 'medium', 'Medium'], ['caf', 'high', 'High']].map((c) => '<button class="chip" aria-pressed="' + (f[c[0]] === c[1]) + '" data-act="rfilter" data-k="' + c[0] + '" data-v="' + c[1] + '">' + c[2] + '</button>').join('') +
    '<button class="chip" aria-pressed="' + f.dairyFree + '" data-act="rfilter" data-k="dairyFree" data-v="1">🌱 Dairy-free</button><button class="chip" aria-pressed="' + f.fav + '" data-act="rfilter" data-k="fav" data-v="1">★ Favorites</button></div>';
}
VIEWS.recipes = () => {
  let h = topbar('Recipes', '<button class="small" data-act="importRecipe">Import</button><button class="primary small" data-act="newRecipe">＋ New</button>');
  h += '<div class="chips" role="group" aria-label="View"><button class="chip" aria-pressed="' + (UI.rview === 'make') + '" data-act="rview" data-v="make">What can I make?</button><button class="chip" aria-pressed="' + (UI.rview === 'all') + '" data-act="rview" data-v="all">All recipes</button></div>';
  h += filterRow();
  const f = UI.rf; const filt = { serve: f.serve, caf: f.caf, dairyFree: f.dairyFree, fav: f.fav, q: f.q };
  if (f.dairyFree) h += '<div class="small muted" style="margin:4px 0">Dairy-free is worked out from the products you chose and the “contains dairy” setting on each product. It is not allergy advice.</div>';
  if (UI.rview === 'all') {
    const sug = SC.suggest(S, filt, today()); const seen = {};
    ['ready', 'maybe', 'almost', 'no', 'needsDF'].forEach((k) => sug[k].forEach((a) => { seen[a.recipe.id] = k; }));
    const shown = S.recipes.filter((r) => seen[r.id] !== undefined).sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || a.name.localeCompare(b.name));
    if (!shown.length) h += '<div class="empty">No recipes match these filters.</div>';
    shown.forEach((r) => {
      const k = seen[r.id]; const badge = { ready: '<span class="badge ok">Ready now</span>', maybe: '<span class="badge warn">Maybe</span>', almost: '<span class="badge warn">Almost</span>', no: '<span class="badge">Missing items</span>', needsDF: '<span class="badge warn">Needs a dairy-free product</span>' }[k];
      h += '<div class="card tap" data-act="viewRecipe" data-id="' + r.id + '"><div class="row top"><div class="grow"><h3>' + esc(r.name) + (r.builtin ? '' : ' <span class="badge">Mine</span>') + '</h3><div>' + recipeBadges(r) + ' ' + badge + '</div><div class="small muted" style="margin-top:4px">' + esc(ingSummary(r)) + '</div></div><button class="primary small" data-act="logRecipe" data-id="' + r.id + '">Log</button></div></div>';
    });
    return h;
  }
  const sug = SC.suggest(S, filt, today());
  const sec = (title, arr, fn, empty) => '<h2>' + title + ' <span class="badge">' + arr.length + '</span></h2>' + (arr.length ? arr.map(fn).join('') : empty ? '<div class="card muted small">' + empty + '</div>' : '');
  h += sec('Ready now', sug.ready, (a) => recipeRow(a), 'Nothing is fully covered with these filters.');
  if (f.dairyFree) h += sec('Needs a dairy-free product', sug.needsDF, (a) => '<div class="card tap" data-act="viewRecipe" data-id="' + a.recipe.id + '"><h3>' + esc(a.recipe.name) + '</h3><div class="small" style="color:var(--warn)">You have a dairy option, but no product flagged dairy-free for this.</div><div style="margin-top:6px"><button class="small" data-act="addMissing" data-cat="milk">+ Add a dairy-free milk</button></div></div>');
  if (sug.maybe.length) h += sec('Maybe (amount unknown)', sug.maybe, (a) => recipeRow(a, '<div class="small" style="color:var(--warn)">An amount is unknown. Recount to be sure.</div>'));
  h += sec('Almost there (one item short)', sug.almost, almostRow);
  if (!sug.ready.length && !sug.maybe.length && !sug.almost.length) h += '<div class="card"><p class="muted">Nothing is close yet with these filters. Browse all recipes to see what each one needs.</p><button class="big" data-act="rview" data-v="all">Show all recipes</button></div>';
  if (sug.hints.length) h += '<h2>What to buy</h2>' + sug.hints.map((x) => '<div class="card"><b>' + esc(SC.SLOT_LABEL[x.type]) + '</b> would unlock ' + x.recipes.map(esc).join(', ') + '.</div>').join('');
  if (sug.useItUp.length) h += '<h2>Use it up</h2>' + sug.useItUp.map((u) => recipeRow(u.analysis, '<div class="small" style="color:var(--warn)">Uses ' + u.aged.map((x) => esc(SC.productLabel(x.p)) + (x.f.state === 'past' ? ' (past best)' : ' (open ' + x.f.days + ' d)')).join(', ') + '</div>')).join('');
  return h;
};
ACT.rview = (el) => { UI.rview = el.dataset.v; render(); };
ACT.rfilter = (el) => { const k = el.dataset.k, v = el.dataset.v; if (k === 'dairyFree' || k === 'fav') UI.rf[k] = !UI.rf[k]; else UI.rf[k] = UI.rf[k] === v ? '' : v; render(); };
INP.rq = (el) => { UI.rf.q = el.value; const pos = el.selectionStart; render(); const n = $('[data-input="rq"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } } };

// ---------- LOG / INSIGHTS ----------
VIEWS.history = () => {
  let h = topbar('Log & insights');
  const who = UI.hwho; const t = today();
  const opts = [['all', 'Household']].concat(S.people.map((p) => [p.id, p.name])); if (S.logs.some((l) => !l.personId)) opts.push(['none', 'Unassigned']);
  h += '<div class="chips" role="group" aria-label="Whose drinks">' + opts.map((o) => '<button class="chip" aria-pressed="' + (who === o[0]) + '" data-act="hwho" data-v="' + o[0] + '">' + esc(o[1]) + '</button>').join('') + '</div>';
  const days = []; for (let i = 6; i >= 0; i--) { const d = SC.addDays(t, -i); days.push({ d: d, mg: SC.dayCaffeine(S, who, d) }); }
  const max = Math.max(100, Math.max.apply(null, days.map((x) => x.mg)));
  h += '<div class="card"><div class="row"><h3 class="grow">Caffeine, last 7 days <span class="badge">estimate</span></h3><b>' + fmt(days[6].mg, 0) + ' mg today</b></div><div class="bars" role="img" aria-label="Estimated caffeine per day">' +
    days.map((x) => '<div class="bar"><span>' + (x.mg ? fmt(x.mg, 0) : '') + '</span><i style="height:' + Math.round((x.mg / max) * 80) + 'px"></i><span>' + new Date(x.d + 'T12:00').toLocaleDateString(undefined, { weekday: 'narrow' }) + '</span></div>').join('') + '</div>' +
    '<div class="small muted">Values come from each product’s caffeine setting, or a commonly cited average (about 63 mg per espresso shot, 30 mg per gram of matcha). Real values vary.</div></div>';
  const ym = UI.hmonth; const ms = SC.monthSummary(S, who, ym); const mname = new Date(ym + '-15T12:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  h += '<div class="card"><div class="row"><button class="small" data-act="hmonth" data-d="-1" aria-label="Previous month">‹</button><h3 class="grow" style="text-align:center">' + esc(mname) + '</h3><button class="small" data-act="hmonth" data-d="1" aria-label="Next month">›</button></div>' +
    '<div class="grid3" style="margin-top:8px"><div class="stat"><span class="small muted">Cups</span><b>' + ms.cups + '</b></div><div class="stat"><span class="small muted">Spend</span><b>' + money(ms.spend) + '</b></div><div class="stat"><span class="small muted">Caffeine (est.)</span><b>' + fmt(ms.caffeine, 0) + ' mg</b></div></div>' +
    (ms.unknownCost ? '<div class="small" style="color:var(--warn);margin-top:6px">' + ms.unknownCost + ' drink' + (ms.unknownCost > 1 ? 's' : '') + ' include unpriced products (cost unknown), so spend may be higher.</div>' : '') +
    (ms.favorite ? '<div class="small muted" style="margin-top:6px">Favorite: <b>' + esc(ms.favorite.name) + '</b> (' + ms.favorite.count + '×)</div>' : '') + '</div>';
  const logs = SC.logsFor(S, who).slice().sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 60);
  h += '<h2>Drinks</h2>';
  if (!logs.length) h += '<div class="empty"><div class="big-ic">📝</div><p>No drinks logged yet.</p></div>';
  logs.forEach((l) => {
    h += '<div class="card"><div class="row top"><div class="grow"><h3>' + esc(l.name) + (l.servings !== 1 ? ' × ' + fmt(l.servings) : '') + '</h3><div class="small muted">' + esc(fmtDT(l.ts)) + ' · ' + esc(personName(l.personId)) + '</div>' +
      '<div class="small">' + l.parts.map((p) => esc(p.productLabel) + ' (' + fmt(p.qty) + ' ' + (p.slotType === 'espresso' && p.category === 'capsule' ? 'caps' : p.slotType === 'espresso' ? 'shots' : (p.unit === 'capsule' ? 'caps' : p.unit)) + ')').join(' · ') + '</div>' +
      '<div style="margin-top:4px"><span class="badge">~' + fmt(l.caffeine, 0) + ' mg caffeine (estimate)</span> <span class="badge' + (l.costUnknown ? ' warn' : '') + '">' + (l.costUnknown ? 'cost unknown' + (l.cost ? ' (≥ ' + money(l.cost) + ')' : '') : money(l.cost)) + '</span>' + (l.dairyFree ? ' <span class="badge ok">dairy-free*</span>' : '') + (l.rating ? ' <span class="badge warn">' + '★'.repeat(l.rating) + '</span>' : '') + '</div>' + (l.note ? '<div class="small muted">“' + esc(l.note) + '”</div>' : '') + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px"><button class="small" data-act="editLog" data-id="' + l.id + '">Edit</button><button class="small danger" data-act="undoLogAsk" data-id="' + l.id + '">Undo</button></div></div></div>';
  });
  if (logs.length) h += '<p class="small muted">*Dairy-free relies on the “contains dairy” setting of each product you used.</p>';
  const adjs = S.adjustments.slice().sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 20);
  if (adjs.length) {
    h += '<h2>Stock adjustments</h2><p class="small muted">Recounts and restocks are not drinks, so they never change caffeine or cost.</p>';
    adjs.forEach((a) => {
      h += '<div class="card"><div class="row"><div class="grow"><b>' + (a.kind === 'recount' ? 'Recount' : 'Restock') + '</b> · ' + esc(a.productLabel) + '<div class="small muted">' + esc(fmtDT(a.ts)) + ' · ' + (a.kind === 'restock' ? '+' + (a.packs || 1) + ' pack' + ((a.packs || 1) > 1 ? 's' : '') : a.diff === null ? 'was unknown' : (a.diff > 0 ? '+' : '') + fmt(a.diff) + ' ' + esc(a.unit)) + (a.kind === 'recount' ? ' (now ' + (a.newUnknown ? 'unknown' : fmt(a.newTotal) + ' ' + esc(a.unit)) + ')' : '') + '</div></div><button class="small danger" data-act="undoAdj" data-id="' + a.id + '">Undo</button></div></div>';
    });
  }
  return h;
};
ACT.hwho = (el) => { UI.hwho = el.dataset.v; render(); };
ACT.hmonth = (el) => { const [y, m] = UI.hmonth.split('-').map(Number); const d = new Date(y, m - 1 + Number(el.dataset.d), 1); UI.hmonth = d.getFullYear() + '-' + SC.pad(d.getMonth() + 1); render(); };
ACT.undoLogAsk = (el) => confirmDialog('Undo this drink? The stock it used will be put back.', 'Undo drink', () => { const ok = SC.undoLog(S, el.dataset.id); save(); render(); toast(ok ? 'Drink removed and stock restored.' : 'Could not find that drink.'); }, true);
ACT.undoAdj = (el) => { SC.undoAdjustment(S, el.dataset.id); save(); render(); toast('Adjustment undone.'); };

// ---------- SHOPPING ----------
VIEWS.shopping = () => {
  let h = topbar('Shopping list', '<button class="small" data-act="go" data-page="more">‹ More</button>');
  const low = SC.lowStock(S);
  h += '<p class="muted small">Items appear when the total across all brands is at or below the low-stock limit you set in More.</p>';
  if (!low.length && !S.shopping.length) h += '<div class="empty"><div class="big-ic">🛒</div><p>Nothing to buy right now.</p></div>';
  low.forEach((x) => {
    const u = x.usual;
    h += '<div class="card"><div class="row top"><div class="grow"><h3>' + esc(catLabel(x.type)) + '</h3><div class="small muted">' + fmt(x.total) + ' ' + x.unit + ' left · limit ' + fmt(x.threshold) + ' ' + x.unit + '</div>' + (u ? '<div class="small">Usual: ' + esc(SC.productLabel(u)) + (u.category === 'capsule' ? ' (sleeve of ' + u.size + ')' : ' (' + fmt(u.size) + ' ' + u.unit + ')') + '</div>' : '') + '</div>' +
      (u ? '<button class="primary small" data-act="bought" data-id="' + u.id + '">Bought it</button>' : '<button class="small" data-act="addMissing" data-cat="' + x.type + '">Add product</button>') + '</div></div>';
  });
  S.shopping.forEach((it) => {
    const u = it.type ? SC.usualProduct(S, it.type === 'espresso' ? (SC.capsulesEnabled(S) ? 'capsule' : 'coffee') : it.type) : null;
    h += '<div class="card"><div class="row"><div class="grow"><b>' + esc(it.label) + '</b><div class="small muted">' + esc(it.note || '') + '</div></div>' + (u ? '<button class="small" data-act="boughtExtra" data-id="' + it.id + '" data-pid="' + u.id + '">Bought it</button>' : '') + '<button class="small" data-act="dropExtra" data-id="' + it.id + '" aria-label="Remove ' + esc(it.label) + '">✕</button></div></div>';
  });
  h += '<form data-submit="addShop" class="card"><label class="f" for="f-shoplabel">Add something to buy</label><div class="row"><input id="f-shoplabel" name="label" maxlength="60" placeholder="e.g. paper filters" autocomplete="off"><button class="primary">Add</button></div></form>';
  return h;
};
ACT.bought = (el) => { const adj = SC.restock(S, el.dataset.id, 1); save(); render(); toast('Restocked the usual pack.', 'Undo', () => { SC.undoAdjustment(S, adj.id); save(); render(); }); };
ACT.boughtExtra = (el) => { const adj = SC.restock(S, el.dataset.pid, 1); S.shopping = S.shopping.filter((x) => x.id !== el.dataset.id); save(); render(); toast('Restocked and removed from the list.', 'Undo', () => { SC.undoAdjustment(S, adj.id); save(); render(); }); };
ACT.dropExtra = (el) => mutate((s) => { s.shopping = s.shopping.filter((x) => x.id !== el.dataset.id); });
SUB.addShop = (f) => { const v = formData(f).label.trim(); if (!v) { toast('Type what to buy first.'); return; } if (v.length > 60) { toast('That is too long.'); return; } mutate((s) => { s.shopping.push({ id: SC.uid(), label: v, note: '' }); }); };

// ---------- GUEST PLAN ----------
UI.plan = [];
VIEWS.plan = () => {
  let h = topbar('Guest plan', '<button class="small" data-act="go" data-page="more">‹ More</button>');
  h += '<p class="muted small">Check whether the pantry covers a round of drinks. Planning never changes your stock.</p>';
  UI.plan = UI.plan.filter((p) => S.recipes.some((r) => r.id === p.recipeId));
  UI.plan.forEach((p, i) => {
    h += '<div class="card"><div class="row">' + '<div class="grow"><b>' + esc(S.recipes.find((r) => r.id === p.recipeId).name) + '</b></div><label class="sr" for="ps' + i + '">Servings</label><input id="ps' + i + '" style="width:80px" inputmode="numeric" data-change="planServ" data-i="' + i + '" value="' + esc(p.servings) + '"><button class="small" data-act="planDel" data-i="' + i + '" aria-label="Remove">✕</button></div></div>';
  });
  h += '<form data-submit="planAdd" class="card"><div class="row"><div class="grow">' + selectField('recipe', 'Add a recipe', S.recipes.map((r) => [r.id, r.name]), '') + '</div><div style="width:84px"><label class="f" for="f-n">Servings</label><input id="f-n" name="n" inputmode="numeric" value="4"></div></div><button class="primary" style="margin-top:8px">Add to plan</button></form>';
  if (UI.plan.length) {
    const res = SC.planCheck(S, UI.plan.map((p) => ({ recipeId: p.recipeId, servings: Number(p.servings) })));
    const short = res.filter((r) => !r.covered);
    h += '<h2>Result</h2>' + (short.length ? '<div class="warnbox">Short on ' + short.length + ' item' + (short.length > 1 ? 's' : '') + '.</div>' : '<div class="okbox">The pantry covers this plan.</div>');
    h += '<div class="card"><table class="t"><thead><tr><th>Ingredient</th><th>Need</th><th>Have</th><th>Status</th></tr></thead><tbody>' + res.map((r) => {
      const nm = r.type === 'espresso' ? 'Espresso' : esc(r.label || SC.SLOT_LABEL[r.type]);
      return '<tr><td>' + nm + '</td><td>' + esc(amt(r.need, r.unit)) + '</td><td>' + (r.unknown && r.have === 0 ? 'unknown' : esc(amt(r.have, r.unit))) + '</td><td>' + (r.covered ? '<span class="badge ok">Covered</span>' : r.maybe ? '<span class="badge warn">Short ' + esc(amt(r.short, r.unit)) + ' or unknown</span>' : '<span class="badge bad">Short ' + esc(amt(r.short, r.unit)) + '</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    if (short.length) h += '<button class="primary big" data-act="planToShop">Add shortfalls to the shopping list</button>';
  }
  return h;
};
SUB.planAdd = (f) => { const d = formData(f); const n = SC.parseNum(d.n, { min: 0, minExclusive: true, max: 200 }); if (!n.ok || !d.recipe) { toast('Servings: ' + (n.error || 'choose a recipe')); return; } UI.plan.push({ recipeId: d.recipe, servings: n.value }); render(); };
CHG.planServ = (el) => { const n = SC.parseNum(el.value, { min: 0, minExclusive: true, max: 200 }); if (!n.ok) { toast('Servings: ' + n.error); el.value = UI.plan[el.dataset.i].servings; return; } UI.plan[el.dataset.i].servings = n.value; render(); };
ACT.planDel = (el) => { UI.plan.splice(Number(el.dataset.i), 1); render(); };
ACT.planToShop = () => {
  const res = SC.planCheck(S, UI.plan.map((p) => ({ recipeId: p.recipeId, servings: Number(p.servings) }))).filter((r) => !r.covered); let n = 0;
  mutate((s) => { res.forEach((r) => { const label = (r.type === 'espresso' ? 'Espresso' : r.label || SC.SLOT_LABEL[r.type]) + ': ' + amt(r.short, r.unit) + ' more'; if (!s.shopping.some((x) => x.label === label)) { s.shopping.push({ id: SC.uid(), label: label, type: r.type, note: 'From guest plan' }); n++; } }); });
  toast(n ? 'Added ' + n + ' item' + (n > 1 ? 's' : '') + ' to the shopping list.' : 'Already on the list.');
};

// ---------- MORE ----------
VIEWS.more = () => {
  const lowN = SC.lowStock(S).length + S.shopping.length;
  let h = topbar('More');
  h += '<div class="grid2"><button class="big" data-act="go" data-page="shopping">🛒 Shopping list' + (lowN ? ' (' + lowN + ')' : '') + '</button><button class="big" data-act="go" data-page="plan">🎉 Guest plan</button></div>';
  h += '<h2>People</h2><div class="card"><p class="small muted">Names only, no logins. Stock is shared; each drink is tagged with who had it.</p>' + S.people.map((p) =>
    '<div class="row"><div class="grow">' + (p.id === S.settings.activePerson ? '<b>' + esc(p.name) + '</b> <span class="badge acc">active</span>' : esc(p.name)) + '</div>' + (p.id === S.settings.activePerson ? '' : '<button class="small" data-act="setPerson" data-id="' + p.id + '">Use</button>') + '<button class="small" data-act="renamePerson" data-id="' + p.id + '">Rename</button><button class="small danger" data-act="delPerson" data-id="' + p.id + '" aria-label="Delete ' + esc(p.name) + '">✕</button></div>').join('') +
    '<form data-submit="addPerson" class="row" style="margin-top:8px"><input name="name" maxlength="40" placeholder="Add a person" aria-label="New person name" autocomplete="off"><button class="primary">Add</button></form></div>';
  h += '<h2>Machines</h2><div class="card"><p class="small muted">Only capsules that fit your machines are offered, suggested or counted as stock. With no machine, capsule features are hidden.</p>' +
    (S.machines.length ? S.machines.map((m) => { const d = SC.descaleStatus(m, today()); return '<div class="row top" style="margin:6px 0"><div class="grow"><b>' + esc(m.name) + '</b> <span class="badge">' + (m.system === 'original' ? 'Original' : 'Vertuo') + '</span>' + (d.due ? ' <span class="badge bad">Descale due</span>' : '') + '<div class="small muted">' + m.caps + ' / ' + m.descaleCaps + ' capsules · or every ' + m.descaleMonths + ' months (last: ' + esc(m.lastDescaled) + ')</div></div><button class="small" data-act="editMachine" data-id="' + m.id + '">Edit</button></div>'; }).join('') : '<p class="muted">No machines.</p>') +
    '<button class="big" data-act="editMachine">＋ Add a machine</button></div>';
  h += '<h2>Low-stock limits</h2><div class="card"><p class="small muted">Counted across brands. Leave blank for no limit.</p>' + Object.keys(SC.CATEGORIES).filter((c) => c !== 'capsule' || SC.capsulesEnabled(S)).map((c) => {
    const C = SC.CATEGORIES[c]; const v = S.thresholds[c];
    return '<div class="row" style="margin:4px 0"><label class="grow" for="th-' + c + '">' + esc(C.label) + '</label><input id="th-' + c + '" style="width:92px" inputmode="decimal" data-change="threshold" data-cat="' + c + '" value="' + (v === null || v === undefined ? '' : v) + '" placeholder="none"><span class="small muted" style="width:52px">' + C.unit + '</span></div>';
  }).join('') + '</div>';
  h += '<h2>Appearance & units</h2><div class="card">' + selectField('theme', 'Theme', [['auto', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']], S.settings.theme, { change: 'setting' }) +
    selectField('tempUnit', 'Temperature', [['C', '°C'], ['F', '°F']], S.settings.tempUnit, { change: 'setting' }) +
    '<label class="check"><input type="checkbox" name="imperial" data-change="setting"' + (S.settings.imperial ? ' checked' : '') + '> <span>Also show ounces / fl oz</span></label>' +
    '<label class="f" for="f-currency">Currency symbol</label><input id="f-currency" name="currency" maxlength="3" data-change="setting" value="' + esc(S.settings.currency || '$') + '"></div>';
  h += '<h2>Your data</h2><div class="card stack"><p class="small muted">Everything stays on this device. Use export and import to back up or move to another device. Photos and screenshots are never stored.</p><div class="grid2"><button data-act="exportData">⬇ Export</button><button data-act="importPick">⬆ Import</button></div><input type="file" id="importFile" accept="application/json,.json" class="sr" tabindex="-1" aria-label="Choose a StockCup export file" data-change="importFile">' +
    '<button data-act="addPreset">Starter product list</button><button data-act="restoreBuiltins">Restore built-in recipes</button>' +
    (S.settings.sampleLoaded ? '<button class="danger" data-act="clearSample">Clear the sample pantry</button>' : '<button data-act="loadSample">Load the sample pantry</button>') +
    '<button data-act="openGuide">Show the setup guide</button><button data-act="speedCheck">Run a speed check</button><div id="speedOut" class="small muted" role="status"></div><button class="danger" data-act="wipeAll">Erase everything</button></div>';
  h += '<p class="small muted" style="text-align:center;margin-top:20px">StockCup · works offline · caffeine, freshness and descale values are estimates</p>';
  return h;
};
ACT.setPerson = (el) => mutate((s) => { s.settings.activePerson = el.dataset.id; });
ACT.renamePerson = (el) => { const p = S.people.find((x) => x.id === el.dataset.id); openSheet('renamePerson', { id: p.id, name: p.name }); };
ACT.delPerson = (el) => {
  const p = S.people.find((x) => x.id === el.dataset.id); if (S.people.length < 2) { toast('Keep at least one person.'); return; }
  confirmDialog('Delete ' + p.name + '? Their drinks stay in the log as “Unassigned”.', 'Delete', () => { mutate((s) => { SC.deletePerson(s, p.id); }); }, true);
};
SUB.addPerson = (f) => { const n = formData(f).name.trim(); if (!n || n.length > 40) { toast('Enter a name (up to 40 characters).'); return; } if (S.people.some((p) => p.name.toLowerCase() === n.toLowerCase())) { toast('That name is already used.'); return; } mutate((s) => { s.people.push({ id: SC.uid(), name: n }); }); };
CHG.threshold = (el) => {
  const v = SC.parseNum(el.value, { min: 0, max: 1e6, blank: true });
  if (!v.ok) { toast(v.error); el.value = S.thresholds[el.dataset.cat] === null ? '' : S.thresholds[el.dataset.cat]; return; }
  mutate((s) => { s.thresholds[el.dataset.cat] = v.value; });
};
CHG.setting = (el) => {
  const n = el.name; let v = el.type === 'checkbox' ? el.checked : el.value;
  if (n === 'currency') v = String(v).trim().slice(0, 3) || '$';
  mutate((s) => { s.settings[n] = v; }); if (n === 'theme') applyTheme();
};
ACT.exportData = () => {
  const blob = new Blob([SC.exportData(S)], { type: 'application/json' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'stockcup-' + today() + '.json'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast('Exported. Keep the file somewhere safe.');
};
ACT.importPick = () => { $('#importFile').click(); };
CHG.importFile = (el) => {
  const file = el.files && el.files[0]; if (!file) return;
  if (file.size > 20 * 1024 * 1024) { toast('That file is too large to be a StockCup export.'); el.value = ''; return; }
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = SC.importData(String(r.result));
      confirmDialog('Replace everything on this device with the file’s data? (' + data.products.length + ' products, ' + data.logs.length + ' logged drinks.) This cannot be undone.', 'Replace', () => { S = data; save(); applyTheme(); render(); toast('Import complete.'); }, true);
    } catch (e) { toast('Import failed: ' + e.message, null, null, 6000); }
  };
  r.onerror = () => toast('Could not read that file.'); r.readAsText(file); el.value = '';
};
ACT.restoreBuiltins = () => mutate((s) => { SC.builtinRecipes().forEach((b) => { if (!s.recipes.some((r) => r.id === b.id)) s.recipes.push(b); }); toast('Built-in recipes restored.'); });
ACT.clearSample = () => confirmDialog('Remove the sample products, sample drinks and sample people? Your own data stays.', 'Clear sample', () => { mutate((s) => { SC.clearSample(s); }); toast('Sample cleared.'); }, true);
ACT.wipeAll = () => confirmDialog('Erase ALL products, recipes you made, drinks and settings on this device? Export first if you might want them back.', 'Erase everything', () => { S = SC.defaultState(); save(); applyTheme(); UI.pantryCat = 'all'; render(); toast('Everything erased.'); }, true);
ACT.speedCheck = () => {
  const out = $('#speedOut'); out.textContent = 'Running…';
  setTimeout(() => {
    const T = SC.localDate(); const s = SC.defaultState(); const cats = ['matcha', 'milk', 'syrup', 'coffee', 'tonic', 'hojicha', 'icecream'];
    for (let i = 0; i < 500; i++) { const c = cats[i % cats.length]; SC.addProduct(s, { category: c, brand: 'B' + i, name: c + i, size: SC.CATEGORIES[c].size, sealed: 1 + (i % 4), openMode: i % 3 ? 'half' : 'none', openDate: T, price: 100 + i, dairy: i % 2 === 0 }, T); }
    s.machines.push(SC.makeMachine('M', 'original', T)); for (let i = 0; i < 20; i++) SC.addProduct(s, { category: 'capsule', brand: 'N' + i, name: 'c' + i, size: 10, sleeves: 5, system: 'original', intensity: 1 + (i % 12) }, T);
    const base = s.recipes.slice(); for (let i = 0; i < 92; i++) { const r = SC.clone(base[i % 8]); r.id = 'x' + i; r.name = 'Copy ' + i; s.recipes.push(r); }
    for (let i = 0; i < 1000; i++) { const d = SC.emptyDraft(s, base[i % 8], 1, 'p_me', SC.addDays(T, -(i % 60)) + 'T08:00'); d.allowShort = true; SC.commitLog(s, d); }
    const t0 = performance.now(); SC.suggest(s, {}, T); SC.suggest(s, { dairyFree: true }, T); SC.lowStock(s); SC.monthSummary(s, 'all', T.slice(0, 7)); SC.planCheck(s, s.recipes.slice(0, 20).map((r) => ({ recipeId: r.id, servings: 3 }))); SC.evaluateLog(s, SC.emptyDraft(s, base[4], 1, 'p_me'));
    const ms = Math.round(performance.now() - t0);
    out.textContent = 'With 500 products, 100 recipes and 1,000 logs, all calculations took ' + ms + ' ms (goal: under 1000 ms). This used temporary data; yours was not touched.';
  }, 30);
};

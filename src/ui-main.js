/* StockCup entry point. */
'use strict';
(function init() {
  S = loadState();
  applyTheme();
  routeFromHash();
  render();
  if (!S.settings.onboarded && !S.products.length && !S.logs.length) openSheet('guide', { step: 0, interests: { matcha: true }, orig: false, vert: false, picks: null, tempUnit: S.settings.tempUnit, imperial: S.settings.imperial, added: [] });
  window.addEventListener('error', (e) => { try { toast('Something went wrong: ' + (e.message || 'unknown error')); } catch (x) { /* ignore */ } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && TIMER) render(); });
  window.__stockcup = { get state() { return S; }, SC: SC, SCP: SCP };
})();

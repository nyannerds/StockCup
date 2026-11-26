/* StockCup entry point. */
'use strict';
// ---------- installable offline app (service worker, install prompt, durable storage) ----------
const PWA = { installEvt: null, offlineReady: false, standalone: false, ios: /iphone|ipad|ipod/i.test(navigator.userAgent), persisted: false };
function setupPwa() {
  PWA.standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); PWA.installEvt = e; if (UI.page === 'more') render(); });
  window.addEventListener('appinstalled', () => { PWA.installEvt = null; PWA.standalone = true; toast('StockCup installed.'); render(); });
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return; // file:// cannot register workers
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const watch = (w) => { if (!w) return; w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('A new version of StockCup is ready.', 'Reload', () => w.postMessage('SKIP_WAITING'), 60000); }); };
    if (reg.waiting && navigator.serviceWorker.controller) toast('A new version of StockCup is ready.', 'Reload', () => reg.waiting.postMessage('SKIP_WAITING'), 60000);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    navigator.serviceWorker.ready.then(() => { PWA.offlineReady = true; if (UI.page === 'more') render(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => { /* app still works without the worker */ });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; location.reload(); });
}
// Ask the browser not to clear our data when space is low (called after the first logged drink).
function askPersist() {
  if (PWA.persisted || !navigator.storage || !navigator.storage.persist) return;
  PWA.persisted = true; navigator.storage.persist().catch(() => {});
}
ACT.installApp = () => { const e = PWA.installEvt; if (!e) return; e.prompt(); e.userChoice.finally(() => { PWA.installEvt = null; render(); }); };
function appCardHtml() {
  if (!/^https?:$/.test(location.protocol)) return '';
  let b;
  if (PWA.standalone) b = '<div class="okbox">Installed. StockCup opens like an app' + (PWA.offlineReady ? ' and works offline.' : '.') + '</div>';
  else if (PWA.installEvt) b = '<button class="primary big" data-act="installApp">Install StockCup on this device</button>';
  else if (PWA.ios) b = '<p class="small muted">To install on iPhone or iPad: tap the Share button, then <b>Add to Home Screen</b>.</p>';
  else b = '<p class="small muted">To install, use your browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>';
  return '<h2>App</h2><div class="card stack">' + b + '<div class="small muted">' + (PWA.offlineReady ? '✓ Ready to use offline.' : 'Offline use is being prepared…') + ' Your pantry data is stored on this device in this browser.</div></div>';
}

(function init() {
  S = loadState();
  applyTheme();
  routeFromHash();
  render();
  if (!S.settings.onboarded && !S.products.length && !S.logs.length) openSheet('guide', { step: 0, interests: { matcha: true }, orig: false, vert: false, picks: null, tempUnit: S.settings.tempUnit, imperial: S.settings.imperial, added: [] });
  window.addEventListener('error', (e) => { try { toast('Something went wrong: ' + (e.message || 'unknown error')); } catch (x) { /* ignore */ } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && TIMER) render(); });
  setupPwa();
  syncInit();
  window.__stockcup = { get state() { return S; }, SC: SC, SCP: SCP, SYNC: SYNC };
})();


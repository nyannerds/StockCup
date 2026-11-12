/* On-device text reading for receipt photos and recipe screenshots.
   1) the browser's own TextDetector when present, 2) bundled Tesseract (vendor/ocr/), which runs fully offline.
   Images are drawn to a temporary canvas and discarded; nothing is stored. */
const OCR = (function () {
  'use strict';
  const BASE = 'vendor/ocr/';
  let worker = null, loading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('missing ' + src)); document.head.appendChild(s);
    });
  }
  async function toCanvas(file) {
    const bmp = await createImageBitmap(file); const max = 1800; const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, c.width, c.height); if (bmp.close) bmp.close(); return c;
  }
  const unavailable = () => new Error('On-device text reading is not available in this copy of the app. Browsers block the reader when the file is opened straight from your files; serve the folder (for example with a local web server) or paste the text below instead.');
  async function getWorker(status) {
    if (worker) return worker;
    if (loading) return loading;
    loading = (async () => {
      status('Loading the on-device reader…');
      if (!window.Tesseract) { try { await loadScript(BASE + 'tesseract.min.js'); } catch (e) { throw unavailable(); } }
      try {
        const w = await window.Tesseract.createWorker('eng', 1, { workerPath: BASE + 'worker.min.js', corePath: BASE, langPath: BASE, gzip: true, workerBlobURL: false, cacheMethod: 'none',
          logger: (m) => { if (m.status) status(m.status.replace(/^./, (c) => c.toUpperCase()) + (m.progress ? ' ' + Math.round(m.progress * 100) + '%' : '')); } });
        worker = w; return w;
      } catch (e) { throw unavailable(); }
    })();
    try { return await loading; } finally { loading = null; }
  }
  async function read(file, status) {
    status = status || function () {};
    if (!file || !/^image\//.test(file.type)) throw new Error('That file is not an image.');
    if (file.size > 30 * 1024 * 1024) throw new Error('That image is too large (30 MB max).');
    const canvas = await toCanvas(file);
    try {
      if (typeof window.TextDetector === 'function') {
        try {
          const det = new window.TextDetector(); const res = await det.detect(canvas);
          if (res && res.length) { const rows = res.slice().sort((a, b) => a.boundingBox.y - b.boundingBox.y || a.boundingBox.x - b.boundingBox.x); return rows.map((r) => r.rawValue).join('\n'); }
        } catch (e) { /* fall through to Tesseract */ }
      }
      const w = await getWorker(status); status('Reading…');
      const out = await w.recognize(canvas); return out.data.text || '';
    } finally { canvas.width = 0; canvas.height = 0; }
  }
  return { read };
})();

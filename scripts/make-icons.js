#!/usr/bin/env node
/* One-off: renders the PWA icons from the StockCup logo. Run: node scripts/make-icons.js */
const { chromium } = require('playwright');
const path = require('path');
const LOGO = '<svg viewBox="0 0 44 38" xmlns="http://www.w3.org/2000/svg"><path d="M8 14h24v8a11 11 0 0 1-11 11h-2A11 11 0 0 1 8 22z" fill="#fffaea" stroke="#fffaea"/><path d="M32 16h2.5a4.5 4.5 0 0 1 0 9H31" fill="none" stroke="#fffaea" stroke-width="2.5"/><path d="M15 6c-2 2 2 4 0 6M22 6c-2 2 2 4 0 6" fill="none" stroke="#ffb347" stroke-width="2.2" stroke-linecap="round"/><circle cx="16" cy="23" r="1.3" fill="#4f7339"/><circle cx="25" cy="23" r="1.3" fill="#4f7339"/><path d="M18.5 26q2 2 4 0" fill="none" stroke="#4f7339" stroke-width="1.4" stroke-linecap="round"/></svg>';
const page = (size, scale, radius) => `<body style="margin:0"><div style="width:${size}px;height:${size}px;background:#4f7339;border-radius:${radius}px;display:flex;align-items:center;justify-content:center"><div style="width:${size * scale}px">${LOGO}</div></div></body>`;
const jobs = [['icon-192.png', 192, 0.62, 0.22], ['icon-512.png', 512, 0.62, 0.22], ['icon-maskable-512.png', 512, 0.5, 0], ['apple-touch-icon.png', 180, 0.62, 0]];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  for (const [f, size, scale, r] of jobs) {
    await p.setViewportSize({ width: size, height: size }); await p.setContent(page(size, scale, Math.round(size * r)));
    await p.screenshot({ path: path.join(__dirname, '..', 'icons', f), omitBackground: true }); console.log('icons/' + f);
  }
  await b.close();
})();

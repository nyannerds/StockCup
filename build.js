#!/usr/bin/env node
/* Builds the single-file app: node build.js  ->  index.html */
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const js = ['core.js', 'parse.js', 'sync.js', 'ocr.js', 'ui-base.js', 'ui-views.js', 'ui-sheets.js', 'ui-recipes.js', 'ui-sync.js', 'ui-main.js'].map(src).join('\n');
let html = src('index.template.html');
html = html.replace('/*{{CSS}}*/', () => src('style.css')).replace('/*{{JS}}*/', () => js.replace(/<\/script/gi, '<\\/script'));
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('index.html: ' + Math.round(html.length / 1024) + ' KB');

// service worker: versioned by a hash of everything the shell caches, so any change ships an update
const crypto = require('crypto');
const shell = ['index.html', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
const h = crypto.createHash('sha1');
shell.forEach((f) => h.update(fs.readFileSync(path.join(__dirname, f))));
const sw = src('sw.template.js').replace('__VERSION__', h.digest('hex').slice(0, 10)).replace('__SHELL__', () => JSON.stringify(['./'].concat(shell)));
fs.writeFileSync(path.join(__dirname, 'sw.js'), sw);
console.log('sw.js written');

#!/usr/bin/env node
/* Builds the single-file app: node build.js  ->  index.html */
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const js = ['core.js', 'parse.js', 'ocr.js', 'ui-base.js', 'ui-views.js', 'ui-sheets.js', 'ui-recipes.js', 'ui-main.js'].map(src).join('\n');
let html = src('index.template.html');
html = html.replace('/*{{CSS}}*/', () => src('style.css')).replace('/*{{JS}}*/', () => js.replace(/<\/script/gi, '<\\/script'));
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('index.html: ' + Math.round(html.length / 1024) + ' KB');

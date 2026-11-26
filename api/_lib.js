/* Helpers for the "recipe from a video link" function (kept apart so they can be tested without a server).
   Files starting with "_" in api/ are not deployed as endpoints. */
'use strict';

const ALLOWED = {
  'youtube.com': 'youtube', 'www.youtube.com': 'youtube', 'm.youtube.com': 'youtube', 'youtu.be': 'youtube',
  'tiktok.com': 'tiktok', 'www.tiktok.com': 'tiktok', 'vm.tiktok.com': 'tiktok', 'vt.tiktok.com': 'tiktok', 'm.tiktok.com': 'tiktok',
  'instagram.com': 'instagram', 'www.instagram.com': 'instagram',
};
const MAX_URL = 500, MAX_BYTES = 1500000, TIMEOUT_MS = 8000, MAX_HOPS = 4, UA = 'StockCupBot/1.0 (reads the public caption of a link a person pasted into their own app)';

// Accepts only plain https links to the allowed sites: no credentials, no odd ports, no IP addresses.
function parseTarget(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_URL) return { ok: false, error: 'bad_url', message: 'Paste a full link that starts with https://' };
  let u; try { u = new URL(input.trim()); } catch (e) { return { ok: false, error: 'bad_url', message: 'That does not look like a link.' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'bad_url', message: 'Only https:// links work.' };
  if (u.username || u.password) return { ok: false, error: 'bad_url', message: 'That link is not allowed.' };
  if (u.port && u.port !== '443') return { ok: false, error: 'bad_url', message: 'That link is not allowed.' };
  const host = u.hostname.toLowerCase();
  const site = Object.prototype.hasOwnProperty.call(ALLOWED, host) ? ALLOWED[host] : null;
  if (!site) return { ok: false, error: 'unsupported', message: 'Only YouTube, TikTok and Instagram links are supported. Paste the caption instead.' };
  u.hash = ''; return { ok: true, url: u.toString(), host: host, site: site };
}

function decodeEntities(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ''; } })
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(Number(d)); } catch (e) { return ''; } });
}
function meta(html, key) {
  const a = new RegExp('<meta[^>]+(?:property|name)=["\']' + key + '["\'][^>]*content=["\']([^"\']*)["\']', 'i').exec(html);
  const b = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + key + '["\']', 'i').exec(html);
  const m = a || b; return m ? decodeEntities(m[1]).trim() : '';
}
function jsonString(html, key) { // value of "key":"..." in embedded page data, with JSON escapes resolved
  const m = new RegExp('"' + key + '":"((?:[^"\\\\]|\\\\.)*)"').exec(html); if (!m) return '';
  try { return JSON.parse('"' + m[1] + '"'); } catch (e) { return ''; }
}
const clean = (s) => String(s || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);

// Pull the title and caption/description out of a page's HTML.
function extract(site, html) {
  const h = String(html || ''); let title = meta(h, 'og:title') || (/<title[^>]*>([^<]*)<\/title>/i.exec(h) || [])[1] || ''; title = decodeEntities(title).replace(/\s*[-|]\s*(YouTube|TikTok|Instagram)\s*$/i, '').trim();
  let text = '';
  if (site === 'youtube') text = jsonString(h, 'shortDescription') || meta(h, 'og:description') || meta(h, 'description');
  else if (site === 'tiktok') { text = jsonString(h, 'desc') || meta(h, 'og:description') || meta(h, 'description'); }
  else if (site === 'instagram') {
    const d = meta(h, 'og:description') || meta(h, 'description'); const q = /[:\-]\s*[“"](.+)[”"]\.?\s*$/s.exec(d); text = q ? q[1] : d;
  }
  title = clean(title); text = clean(text);
  if (site === 'tiktok' && title && text && title.length > 100) title = '';
  return { title: title, text: text };
}

// Read a response body but stop at a size limit.
async function readLimited(res, limit) {
  if (!res.body || !res.body.getReader) { const t = await res.text(); return t.slice(0, limit); }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let out = '', n = 0;
  for (;;) { const r = await reader.read(); if (r.done) break; n += r.value.length; out += dec.decode(r.value, { stream: true }); if (n >= limit) { try { await reader.cancel(); } catch (e) { /* ignore */ } break; } }
  return out.slice(0, limit);
}
// Fetch with manual redirects: every hop must again be an allowed https site.
async function fetchPage(startUrl, fetchImpl) {
  let url = startUrl; const f = fetchImpl || fetch;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS); let res;
    try { res = await f(url, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en' } }); }
    catch (e) { clearTimeout(timer); return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : 'network', message: e && e.name === 'AbortError' ? 'That site took too long to answer.' : 'Could not reach that site.' }; }
    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer); const loc = res.headers.get('location'); if (!loc) return { ok: false, error: 'redirect', message: 'The link redirected somewhere unexpected.' };
      let next; try { next = new URL(loc, url).toString(); } catch (e) { return { ok: false, error: 'redirect', message: 'The link redirected somewhere unexpected.' }; }
      const t = parseTarget(next); if (!t.ok) return { ok: false, error: 'redirect', message: 'The link redirected somewhere that is not supported.' };
      url = t.url; continue;
    }
    try {
      if (res.status === 404 || res.status === 410) return { ok: false, error: 'not_found', message: 'That video or post was not found.' };
      if (res.status === 401 || res.status === 403 || res.status === 429) return { ok: false, error: 'blocked', message: 'That site would not share the page (many sites block this). Paste the caption instead.' };
      if (res.status < 200 || res.status >= 300) return { ok: false, error: 'http_' + res.status, message: 'That site answered with an error (' + res.status + ').' };
      const html = await readLimited(res, MAX_BYTES); return { ok: true, html: html, finalUrl: url };
    } catch (e) { return { ok: false, error: 'network', message: 'Could not read that page.' }; } finally { clearTimeout(timer); }
  }
  return { ok: false, error: 'redirect', message: 'The link redirected too many times.' };
}

// Tiny per-instance rate limit (serverless instances are short lived, so this only blunts bursts).
const hits = new Map();
function rateLimited(key, now) {
  const t = now || Date.now(); const arr = (hits.get(key) || []).filter((x) => t - x < 60000); arr.push(t); hits.set(key, arr);
  if (hits.size > 500) { for (const k of hits.keys()) { if (!hits.get(k).some((x) => t - x < 60000)) hits.delete(k); } }
  return arr.length > 12;
}

async function lookup(input, fetchImpl) {
  const t = parseTarget(input); if (!t.ok) return t;
  const page = await fetchPage(t.url, fetchImpl); if (!page.ok) return page;
  const final = parseTarget(page.finalUrl); const site = final.ok ? final.site : t.site;
  const { title, text } = extract(site, page.html);
  if (!title && !text) return { ok: false, error: 'empty', message: 'No caption was found on that page. Paste the caption instead.' };
  const thin = (text + title).replace(/\s/g, '').length < 40 || !/\d/.test(text);
  return { ok: true, site: site, title: title, text: text, thin: thin, message: thin ? 'Only a little text was found; the recipe may be spoken or shown in the video itself. Check it, add what is missing, or paste the caption.' : '' };
}
module.exports = { parseTarget, extract, fetchPage, lookup, rateLimited, decodeEntities, ALLOWED, MAX_BYTES, MAX_HOPS, UA };

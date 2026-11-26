/* Vercel serverless function: read the public caption of a YouTube / TikTok / Instagram link so the app can turn it into a recipe draft.
   Only answers POST requests from the app itself (JSON + custom header, no CORS), allows only those three sites, never stores anything. */
'use strict';
const { lookup, rateLimited } = require('./_lib');

const send = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { ok: false, error: 'method', message: 'Use POST.' }); }
  const ct = String((req.headers && req.headers['content-type']) || ''); if (ct.indexOf('application/json') < 0 || (req.headers && req.headers['x-stockcup']) !== '1') return send(res, 400, { ok: false, error: 'bad_request', message: 'Not a StockCup request.' });
  const ip = String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) return send(res, 429, { ok: false, error: 'rate_limited', message: 'Too many requests. Wait a minute and try again.' });
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body.url !== 'string') return send(res, 400, { ok: false, error: 'bad_request', message: 'Send {"url": "https://…"}.' });
  try { const r = await lookup(body.url); return send(res, r.ok ? 200 : (r.error === 'bad_url' || r.error === 'unsupported' ? 400 : 502), r); }
  catch (e) { return send(res, 500, { ok: false, error: 'server', message: 'Something went wrong reading that link.' }); }
};

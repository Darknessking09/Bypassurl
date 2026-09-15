// Vercel bypass relay - D3S Edition
// Endpoint: POST /api/bypass
// Body: { url: "https://links.lootlabs.gg/s?..." }
// Returns: { ok, status, direct, raw }

export const config = { maxDuration: 30 };

const UPSTREAM_BASE = 'https://bypass-links.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function call(url, opts = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(opts.headers || {}),
      },
      body: opts.body,
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const text = await r.text();
    return { status: r.status, text };
  } catch (e) {
    clearTimeout(to);
    return { status: 0, text: String(e) };
  }
}

async function fetchToken() {
  const t = await call(`${UPSTREAM_BASE}/api/token`);
  try {
    const j = JSON.parse(t.text);
    return j.token || null;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      relay: 'vercel-bypass',
      upstream: UPSTREAM_BASE,
      ts: Date.now(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, msg: 'POST only' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { body = Object.fromEntries(new URLSearchParams(body)); }
  }
  if (!body || typeof body !== 'object') body = {};

  const url = String(body.url || '').trim();
  if (!url) return res.status(400).json({ ok: false, msg: 'url required' });

  // Validate URL
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return res.status(400).json({ ok: false, msg: 'invalid protocol' });
    }
  } catch (e) {
    return res.status(400).json({ ok: false, msg: 'invalid url' });
  }

  // Get bypass token
  let token = await fetchToken();
  if (!token) {
    return res.status(502).json({ ok: false, msg: 'upstream token unavailable' });
  }

  // Call bypass endpoint
  const r = await call(`${UPSTREAM_BASE}/api/bypass`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, bypass_token: token }),
  });

  if (r.status !== 200) {
    return res.status(200).json({
      ok: false,
      status: r.status,
      msg: 'upstream failed',
      raw: r.text.slice(0, 300),
    });
  }

  let parsed;
  try { parsed = JSON.parse(r.text); }
  catch (e) {
    return res.status(200).json({
      ok: false,
      status: r.status,
      msg: 'upstream returned non-JSON',
      raw: r.text.slice(0, 300),
    });
  }

  const direct = parsed.direct || parsed.result || parsed.destination || null;

  return res.status(200).json({
    ok: !!direct,
    status: 200,
    direct,
    raw: parsed,
    relay: 'vercel',
  });
}

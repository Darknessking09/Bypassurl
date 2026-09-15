// Vercel /api/bypass — D3S Edition
// Forwards URL to the Cloudflare bypass-proxy worker.
// The worker fetches the upstream token automatically.

export const config = { maxDuration: 30 };

// ── Cloudflare Worker URL ──
const PROXY_BASE = 'https://bypass-proxy.marcelochristann.workers.dev';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── Health check ──
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      relay: 'vercel-bypass',
      proxy: PROXY_BASE,
      ts: Date.now(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, msg: 'POST only' });
  }

  // ── Parse body ──
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { body = Object.fromEntries(new URLSearchParams(body)); }
  }
  if (!body || typeof body !== 'object') body = {};

  const url = String(body.url || '').trim();
  if (!url) return res.status(400).json({ ok: false, msg: 'url required' });

  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return res.status(400).json({ ok: false, msg: 'invalid protocol' });
    }
  } catch (e) {
    return res.status(400).json({ ok: false, msg: 'invalid url' });
  }

  // ── Forward to Cloudflare Worker ──
  const r = await call(`${PROXY_BASE}/api/bypass`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (r.status !== 200) {
    return res.status(200).json({
      ok: false,
      status: r.status,
      msg: 'proxy failed',
      raw: r.text.slice(0, 400),
      proxy: PROXY_BASE,
    });
  }

  let parsed;
  try { parsed = JSON.parse(r.text); }
  catch (e) {
    return res.status(200).json({
      ok: false,
      status: r.status,
      msg: 'proxy returned non-JSON',
      raw: r.text.slice(0, 400),
      proxy: PROXY_BASE,
    });
  }

  const direct = parsed.direct || parsed.result || parsed.destination || null;

  return res.status(200).json({
    ok: !!direct,
    success: !!direct,
    status: 200,
    direct,
    raw: parsed,
    relay: 'vercel',
    proxy: PROXY_BASE,
  });
}

/* api/upstream.js
   Vercel relay for bypass-links.com.
   Breaks the Cloudflare same-zone loop (error 1042).
   Cloudflare Worker -> Vercel -> bypass-links.com -> Vercel -> Worker */

export const config = { maxDuration: 30 };

const UPSTREAM = 'https://bypass-links.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Path after /api/upstream
  const path = req.url.replace(/^\/api\/upstream/, '') || '/';
  const target = UPSTREAM + path;

  let body = undefined;
  if (req.method === 'POST') {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  }

  try {
    const r = await fetch(target, {
      method: req.method,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': UPSTREAM,
        'Referer': UPSTREAM + '/',
        'Content-Type': 'application/json',
      },
      body,
    });
    const text = await r.text();
    return res.status(r.status).json({ ok: r.ok, status: r.status, text });
  } catch (e) {
    return res.status(200).json({ ok: false, status: 0, error: String(e) });
  }
}

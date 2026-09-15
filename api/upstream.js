export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // req.url may be "/api/upstream/api/token" or "/api/upstream?..." depending on rewrite
  let path = req.url || '/';
  // Strip the /api/upstream prefix
  path = path.replace(/^\/api\/upstream/, '') || '/';
  if (!path.startsWith('/')) path = '/' + path;

  const UPSTREAM = 'https://bypass-links.com';
  const target = UPSTREAM + path;

  let body = undefined;
  if (req.method === 'POST') {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  }

  try {
    const r = await fetch(target, {
      method: req.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
      },
      body,
    });
    const text = await r.text();
    return res.status(200).json({ ok: r.ok, status: r.status, text });
  } catch (e) {
    return res.status(200).json({ ok: false, status: 0, error: String(e) });
  }
}

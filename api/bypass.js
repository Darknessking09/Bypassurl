// Bypass relay — D3S Edition
// Endpoint: GET /api/bypass?url=<encoded_link>
// Returns: { ok, resolved, target, status, ms }

export const config = { maxDuration: 30 };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/* ── supported domains ── */
const SUPPORTED = [
  'linkvertise.com', 'linkvertise.net', 'link-to.net',
  'work.ink', 'lootlabs.gg', 'loot-link.com',
  'lootdest.org', 'lootdest.com', 'lootdest.info',
  'lootlinks.co', 'lockr.so', 'rekonise.com',
  'boost.ink', 'sub2unlock.com', 'sub2unlock.net',
  'mboost.me',
];

function isSupported(host) {
  return SUPPORTED.some(d => host === d || host.endsWith('.' + d));
}

async function fetchOnce(url, opts = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(opts.headers || {}),
      },
      redirect: 'manual',
      body: opts.body,
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const text = await r.text().catch(() => '');
    return { status: r.status, headers: r.headers, text };
  } catch (e) {
    clearTimeout(to);
    return { status: 0, headers: new Headers(), text: '', error: String(e) };
  }
}

/* ── specific resolvers ── */

async function resolveLinkvertise(url) {
  // linkvertise returns a redirect chain; follow and grab the final Location.
  const r = await fetchOnce(url);
  const loc = r.headers.get('location');
  if (loc) return loc;

  // Try the /api/link/... JSON route
  const m = url.match(/linkvertise\.(com|net)\/(\d+)\/(.+)/);
  if (m) {
    const apiTry = await fetchOnce('https://publisher.linkvertise.com/api/v1/redirect/link/static/' + m[2] + '/' + m[3]);
    try {
      const j = JSON.parse(apiTry.text);
      if (j?.data?.target) return j.data.target;
    } catch {}
  }
  return null;
}

async function resolveWorkInk(url) {
  const r = await fetchOnce(url);
  const loc = r.headers.get('location');
  if (loc) return loc;
  // scrape meta refresh
  const m = r.text.match(/content=["']0;\s*url=([^"']+)/i);
  if (m) return m[1];
  return null;
}

async function resolveLootLabs(url) {
  const r = await fetchOnce(url);
  const loc = r.headers.get('location');
  if (loc) return loc;
  const m = r.text.match(/https:\/\/[^"'\s]*loot-link[^"'\s]*/i);
  return null;
}

async function resolveGeneric(url) {
  const r = await fetchOnce(url);
  const loc = r.headers.get('location');
  if (loc) return loc;
  // meta refresh
  const m = r.text.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)/i);
  if (m) return m[1];
  // js redirect
  const j = r.text.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)/i);
  if (j) return j[1];
  // anchor fallback
  const a = r.text.match(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>[^<]*continue/i);
  if (a) return a[1];
  return null;
}

async function follow(url, max = 6) {
  let current = url;
  for (let i = 0; i < max; i++) {
    const r = await fetchOnce(current);
    const loc = r.headers.get('location');
    if (loc) {
      try { current = new URL(loc, current).toString(); } catch { current = loc; }
      continue;
    }
    break;
  }
  return current;
}

/* ── handler ── */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const target = req.query?.url || new URL(req.url, 'http://x').searchParams.get('url');
  if (!target) return res.status(400).json({ ok: false, msg: 'url required' });

  let parsed;
  try { parsed = new URL(target); }
  catch { return res.status(400).json({ ok: false, msg: 'bad url' }); }

  if (!isSupported(parsed.hostname)) {
    return res.status(200).json({
      ok: false,
      msg: 'unsupported host',
      host: parsed.hostname,
      supported: SUPPORTED,
    });
  }

  const t0 = Date.now();
  let resolved = null;

  try {
    if (parsed.hostname.includes('linkvertise') || parsed.hostname.includes('link-to')) {
      resolved = await resolveLinkvertise(target);
    } else if (parsed.hostname.includes('work.ink')) {
      resolved = await resolveWorkInk(target);
    } else if (parsed.hostname.match(/loot|lockr|rekonise|boost|sub2unlock|mboost/)) {
      resolved = await resolveLootLabs(target);
    } else {
      resolved = await resolveGeneric(target);
    }

    if (!resolved) resolved = await follow(target);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e), ms: Date.now() - t0 });
  }

  return res.status(200).json({
    ok: !!resolved,
    source: target,
    host: parsed.hostname,
    resolved,
    ms: Date.now() - t0,
  });
}

// Bypass relay — D3S Edition v1.1
// Endpoint: GET /api/bypass?url=<encoded_link>
// Returns: { ok, resolved, target, host, status, ms }
// Supports: linkvertise, work.ink, lootlabs, loot-link, lockr, rekonise, boost.ink, sub2unlock, mboost

export const config = { maxDuration: 30 };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const SUPPORTED = [
  'linkvertise.com', 'linkvertise.net', 'link-to.net',
  'work.ink', 'lootlabs.gg', 'loot-link.com',
  'lootdest.org', 'lootdest.com', 'lootdest.info',
  'lootlinks.co', 'lockr.so', 'rekonise.com',
  'boost.ink', 'sub2unlock.com', 'sub2unlock.net',
  'mboost.me',
];

const isSupported = (host) =>
  SUPPORTED.some(d => host === d || host.endsWith('.' + d));

/* ── fetch helper ── */
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
    return { status: r.status, headers: r.headers, text, url: r.url };
  } catch (e) {
    clearTimeout(to);
    return { status: 0, headers: new Headers(), text: '', error: String(e) };
  }
}

/* ── domain-specific resolvers ── */

async function resolveLinkvertise(url) {
  const r = await fetchOnce(url);
  const loc = r.headers.get('location');
  if (loc) return loc;

  const m = url.match(/linkvertise\.(com|net)\/(\d+)\/(.+)/);
  if (m) {
    const apiTry = await fetchOnce(
      'https://publisher.linkvertise.com/api/v1/redirect/link/static/' + m[2] + '/' + m[3]
    );
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
  const m = r.text.match(/content=["']0;\s*url=([^"']+)/i);
  if (m) return m[1];
  return null;
}

/* ── LootLabs — handles /s?<slug>&data=<blob> ── */
async function resolveLootLabs(rawUrl) {
  const u = new URL(rawUrl);
  const host = u.hostname;
  const slug = u.searchParams.keys().next().value || null;

  if (!slug) return null;

  /* attempt 1 — public API endpoints */
  const apiTries = [
    `https://api.lootlabs.gg/api/public/v1/links/${encodeURIComponent(slug)}`,
    `https://${host}/api/links/${encodeURIComponent(slug)}`,
    `https://${host}/api/public/v1/links/${encodeURIComponent(slug)}`,
    `https://api.loot-link.com/api/v1/links/${encodeURIComponent(slug)}`,
  ];

  for (const api of apiTries) {
    const r = await fetchOnce(api, {
      headers: {
        'Referer': rawUrl,
        'Origin': `https://${host}`,
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    if (r.status === 200) {
      try {
        const j = JSON.parse(r.text);
        const target =
          j?.target ||
          j?.url ||
          j?.destination ||
          j?.data?.target ||
          j?.data?.url ||
          j?.data?.destination ||
          j?.link ||
          null;
        if (target && !target.includes('loot')) return target;
      } catch {}
    }
  }

  /* attempt 2 — scrape the page */
  const page = await fetchOnce(rawUrl, {
    headers: {
      'Referer': `https://${host}/`,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  const patterns = [
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)/i,
    /window\.location(?:\.href)?\s*=\s*["']([^"']+)/i,
    /"destination"\s*:\s*"([^"]+)"/i,
    /"target"\s*:\s*"([^"]+)"/i,
    /"redirectUrl"\s*:\s*"([^"]+)"/i,
    /"redirect_url"\s*:\s*"([^"]+)"/i,
    /"finalUrl"\s*:\s*"([^"]+)"/i,
    /"url"\s*:\s*"([^"]+)"/i,
    /(?:href|src)=["'](https?:\/\/(?!loot|lockr|rekonise|boost)[^"']+)["']/i,
  ];

  for (const p of patterns) {
    const m = page.text.match(p);
    if (m && m[1]) {
      const candidate = m[1]
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/')
        .replace(/\\n/g, '');
      if (!candidate.includes('loot') && !candidate.includes('google') && !candidate.includes('gstatic')) {
        return candidate;
      }
    }
  }

  /* attempt 3 — follow redirects from the page itself */
  const followR = await fetchOnce(rawUrl);
  if (followR.headers.get('location')) return followR.headers.get('location');

  return null;
}

/* ── generic resolver ── */
async function resolveGeneric(url) {
  const r = await fetchOnce(url);
  const loc = r.headers.get('location');
  if (loc) return loc;

  const patterns = [
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)/i,
    /window\.location(?:\.href)?\s*=\s*["']([^"']+)/i,
    /"destination"\s*:\s*"([^"]+)"/i,
    /"target"\s*:\s*"([^"]+)"/i,
    /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>[^<]*continue/i,
  ];

  for (const p of patterns) {
    const m = r.text.match(p);
    if (m && m[1]) return m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  }
  return null;
}

/* ── follow redirect chain ── */
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

/* ── main handler ── */
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
  let method = 'unknown';

  try {
    if (parsed.hostname.includes('linkvertise') || parsed.hostname.includes('link-to')) {
      method = 'linkvertise';
      resolved = await resolveLinkvertise(target);
    } else if (parsed.hostname.includes('work.ink')) {
      method = 'workink';
      resolved = await resolveWorkInk(target);
    } else if (parsed.hostname.match(/loot|lockr|rekonise|boost|sub2unlock|mboost/)) {
      method = 'lootlabs';
      resolved = await resolveLootLabs(target);
    } else {
      method = 'generic';
      resolved = await resolveGeneric(target);
    }

    if (!resolved) {
      method += '+follow';
      resolved = await follow(target);
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e), ms: Date.now() - t0 });
  }

  return res.status(200).json({
    ok: !!resolved && resolved !== target,
    source: target,
    host: parsed.hostname,
    resolved,
    method,
    ms: Date.now() - t0,
  });
}

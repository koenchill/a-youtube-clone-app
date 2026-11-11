import http from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const allowed = new Set(['search', 'videos', 'channels']);
const queryKeys = new Set(['part', 'q', 'id', 'channelId', 'order', 'relatedToVideoId', 'type', 'maxResults', 'pageToken']);
function fixture(route) {
  const snippet = { title: 'Deployment training sample', channelId: 'training',
    channelTitle: 'Training channel', description: 'Synthetic metadata for deployment checks.',
    thumbnails: { high: { url: '/sample-thumbnail.svg' } } };
  const item = { id: route === 'search' ? { videoId: 'aqz-KE-bpKQ' } : (route === 'channels' ? 'training' : 'aqz-KE-bpKQ'),
    snippet, statistics: { viewCount: '1000', likeCount: '25', subscriberCount: '100' } };
  return { items: [item], mode: 'demo' };
}
export function createServer({ mode = process.env.API_MODE || 'demo',
  keyFile = process.env.RAPIDAPI_KEY_FILE || '/run/secrets/rapidapi_key',
  origin = 'https://youtube-v31.p.rapidapi.com', timeout = 8000, limit = 60 } = {}) {
  if (!['demo', 'live'].includes(mode)) throw new Error('API_MODE must be demo or live');
  // origin is injectable for local tests. Runtime does not accept a client target URL.
  const rates = new Map();
  return http.createServer(async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(payload));
    };
    try {
      if (req.method !== 'GET') return send(405, { error: 'GET required' });
      if ((req.url || '').length > 2048) return send(414, { error: 'URL too long' });
      const u = new URL(req.url, 'http://local');
      if (u.pathname === '/api/health') {
        let keyReady = mode === 'demo';
        if (!keyReady) { try { keyReady = !!readFileSync(keyFile, 'utf8').trim(); } catch {} }
        return send(keyReady ? 200 : 503, { status: keyReady ? 'ready' : 'key_missing', mode });
      }
      const route = u.pathname.replace(/^\/api\/youtube\//, '');
      if (!u.pathname.startsWith('/api/youtube/') || !allowed.has(route)) return send(404, { error: 'Unknown route' });
      for (const k of u.searchParams.keys()) if (!queryKeys.has(k)) return send(400, { error: 'Unsupported query' });
      if ([...u.searchParams.values()].some(v => v.length > 300)) return send(400, { error: 'Query value too long' });
      const now = Date.now();
      // Sweep expired buckets to bound memory. Trust the socket peer, not a spoofable forwarded header.
      for (const [peer, bucket] of rates) if (bucket.until < now) rates.delete(peer);
      const peer = req.socket.remoteAddress || 'local';
      const bucket = rates.get(peer) || { n: 0, until: now + 60000 };
      bucket.n++; rates.set(peer, bucket);
      if (bucket.n > limit) return send(429, { error: 'Training proxy rate limit' });
      if (mode === 'demo') return send(200, fixture(route));
      let key;
      try { key = readFileSync(keyFile, 'utf8').trim(); } catch { return send(503, { error: 'Provider key unavailable' }); }
      if (!key) return send(503, { error: 'Provider key unavailable' });
      const target = new URL(`/${route}`, origin);
      for (const [k, v] of u.searchParams) target.searchParams.set(k, v);
      const max = Number(target.searchParams.get('maxResults') || 25);
      if (!Number.isInteger(max) || max < 1 || max > 25) return send(400, { error: 'maxResults must be 1 to 25' });
      target.searchParams.set('maxResults', String(max));
      const response = await fetch(target, { headers: { 'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': 'youtube-v31.p.rapidapi.com' }, redirect: 'error', signal: AbortSignal.timeout(timeout) });
      if (!response.ok) {
        const status = response.status === 429 ? 429 : 502;
        return send(status, { error: 'Provider request failed', upstreamStatus: response.status });
      }
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.items)) return send(502, { error: 'Invalid provider response' });
      return send(200, payload);
    } catch (error) {
      console.error(JSON.stringify({ error: error.name || 'Error', message: 'Proxy request failed' }));
      return send(error.name === 'TimeoutError' ? 504 : 502, { error: 'Provider unavailable' });
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  server.listen(3001, '0.0.0.0', () => console.log('Proxy listening on 3001'));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

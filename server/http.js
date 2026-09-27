import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const securityHeaders = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

function json(res, status, value) {
  res.writeHead(status, { ...securityHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

export function createHttpServer({ service, cache, defaultTtl, providerMode, getCacheStatus }) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, { status: 'ok', ...getCacheStatus(), defaultTtlSeconds: defaultTtl, providerMode });
      }
      if (req.method === 'GET' && url.pathname === '/api/stats') return json(res, 200, await service.stats());
      if (req.method === 'DELETE' && url.pathname === '/api/history') { service.history = []; return json(res, 200, { cleared: true }); }
      if (req.method === 'GET' && url.pathname === '/api/data/posts') {
        const ids = url.searchParams.getAll('id'); const ttls = url.searchParams.getAll('ttl');
        if (ids.length !== 1 || !/^\d+$/.test(ids[0])) return json(res, 400, { error: 'Provide one post ID as an integer from 1 to 100.' });
        const id = Number(ids[0]);
        if (!Number.isSafeInteger(id) || id < 1 || id > 100) return json(res, 400, { error: 'Post ID must be an integer from 1 to 100.' });
        if (ttls.length > 1 || (ttls.length === 1 && !/^\d+$/.test(ttls[0]))) return json(res, 400, { error: 'TTL must be an integer from 1 to 86400 seconds.' });
        const ttl = ttls.length ? Number(ttls[0]) : defaultTtl;
        if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 86400) return json(res, 400, { error: 'TTL must be an integer from 1 to 86400 seconds.' });
        return json(res, 200, await service.request(id, ttl));
      }
      if (req.method === 'DELETE' && url.pathname === '/api/cache') return json(res, 200, { cleared: true, entriesRemoved: await service.clearCache() });
      if (url.pathname.startsWith('/api/')) {
        const knownRoute = ['/api/health', '/api/stats', '/api/data/posts', '/api/cache', '/api/history'].includes(url.pathname);
        return json(res, knownRoute ? 405 : 404, { error: knownRoute ? 'Method not allowed.' : 'API route not found.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
      const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      if (requested.includes('..')) return json(res, 400, { error: 'Invalid path.' });
      const file = await readFile(join(publicRoot, requested));
      res.writeHead(200, { ...securityHeaders, 'content-type': types[extname(requested)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : file);
    } catch (error) {
      const status = error instanceof URIError ? 400 : error.status || (error.code === 'ENOENT' ? 404 : 500);
      const message = status === 400 ? 'Malformed or invalid request.' : status === 404 ? 'Not found.' : error.status ? error.message : 'Request could not be completed.';
      json(res, status, { error: message });
    }
  });
}

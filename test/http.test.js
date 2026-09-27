import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCache } from '../server/cache/memory.js';
import { CacheFlowService } from '../server/service.js';
import { createHttpServer } from '../server/http.js';

async function withApp(t, provider) {
  const cache = new MemoryCache();
  const service = new CacheFlowService({ cache, backend: 'memory', provider });
  const server = createHttpServer({ service, cache, defaultTtl: 60, providerMode: 'demo', getCacheStatus: () => ({ backend: 'memory', redisStatus: 'not_configured' }) });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('HTTP API serves MISS then HIT, clears cache, and exposes consistent statistics', async t => {
  let calls = 0; const base = await withApp(t, async id => { calls++; return { data: { id }, durationMs: 1, providerMode: 'test' }; });
  const first = await fetch(`${base}/api/data/posts?id=7&ttl=20`).then(response => response.json());
  const second = await fetch(`${base}/api/data/posts?id=7&ttl=20`).then(response => response.json());
  assert.equal(first.status, 'MISS'); assert.equal(second.status, 'HIT'); assert.equal(calls, 1);
  const clearResponse = await fetch(`${base}/api/cache`, { method: 'DELETE' });
  assert.equal(clearResponse.status, 200); assert.equal((await clearResponse.json()).entriesRemoved, 1);
  const third = await fetch(`${base}/api/data/posts?id=7&ttl=20`).then(response => response.json());
  assert.equal(third.status, 'MISS'); assert.equal(calls, 2);
  const stats = await fetch(`${base}/api/stats`).then(response => response.json());
  assert.deepEqual({ requests: stats.requests, hits: stats.hits, misses: stats.misses, providerCalls: stats.providerCalls, hitRatio: stats.hitRatio, entries: stats.entryCount },
    { requests: 3, hits: 1, misses: 2, providerCalls: 2, hitRatio: 1 / 3, entries: 1 });
  assert.equal((await fetch(`${base}/api/history`, { method: 'DELETE' })).status, 200);
  const afterHistoryClear = await fetch(`${base}/api/stats`).then(response => response.json());
  assert.equal(afterHistoryClear.requests, 3); assert.equal(afterHistoryClear.history.length, 0);
});

test('HTTP API rejects missing, malformed, duplicate, and out-of-range input', async t => {
  const base = await withApp(t, async id => ({ data: { id }, durationMs: 1 }));
  for (const query of ['', '?id=1e1', '?id=1&id=2', '?id=0', '?id=1&ttl=0', '?id=1&ttl=1.5', '?id=1&ttl=86401']) {
    const response = await fetch(`${base}/api/data/posts${query}`);
    assert.equal(response.status, 400, query || 'missing query');
    assert.equal(typeof (await response.json()).error, 'string');
  }
  const malformedPath = await fetch(`${base}/%E0%A4%A`);
  assert.equal(malformedPath.status, 400);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test('provider failure and timeout return safe errors without caching a result', async t => {
  for (const failure of [
    Object.assign(new Error('Data provider is unavailable'), { status: 502 }),
    Object.assign(new Error('Data provider timed out after 5 seconds'), { status: 504 })
  ]) {
    const base = await withApp(t, async () => { throw failure; });
    const response = await fetch(`${base}/api/data/posts?id=9`);
    assert.equal(response.status, failure.status);
    assert.deepEqual(await response.json(), { error: failure.message });
    const stats = await fetch(`${base}/api/stats`).then(result => result.json());
    assert.equal(stats.requests, 0); assert.equal(stats.entryCount, 0);
  }
});

test('static frontend loads with security headers', async t => {
  const base = await withApp(t, async id => ({ data: { id }, durationMs: 1 }));
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await response.text(), /CacheFlow/);
});

test('known API paths reject unsupported methods with 405', async t => {
  const base = await withApp(t, async id => ({ data: { id }, durationMs: 1 }));
  const response = await fetch(`${base}/api/data/posts?id=1`, { method: 'POST' });
  assert.equal(response.status, 405); assert.deepEqual(await response.json(), { error: 'Method not allowed.' });
});

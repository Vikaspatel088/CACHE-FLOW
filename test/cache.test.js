import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCache } from '../server/cache/memory.js';
import { CacheFlowService } from '../server/service.js';

test('memory cache stores isolated keys and tracks hits and misses', async () => {
  const cache = new MemoryCache();
  assert.equal(await cache.get('missing'), null);
  await cache.set('posts:1', { id: 1 }, 60);
  await cache.set('posts:2', { id: 2 }, 60);
  assert.deepEqual((await cache.get('posts:1')).value, { id: 1 });
  assert.deepEqual((await cache.get('posts:2')).value, { id: 2 });
  assert.equal(await cache.exists('posts:1'), true);
  assert.equal(await cache.exists('unknown'), false);
  assert.deepEqual(await cache.stats(), { entryCount: 2, hits: 2, misses: 1 });
});

test('memory cache expires entries and excludes them from statistics', async () => {
  const cache = new MemoryCache();
  await cache.set('short-lived', 'value', 1);
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.equal(await cache.get('short-lived'), null);
  assert.equal(await cache.exists('short-lived'), false);
  assert.deepEqual(await cache.stats(), { entryCount: 0, hits: 0, misses: 1 });
});

test('delete and clear remove entries and report removed count', async () => {
  const cache = new MemoryCache();
  await cache.set('a', 1, 10); await cache.set('b', 2, 10);
  assert.equal(await cache.delete('a'), true); assert.equal(await cache.delete('missing'), false);
  assert.equal(await cache.clear(), 1); assert.equal(await cache.clear(), 0);
  assert.equal((await cache.stats()).entryCount, 0);
});

test('service reports MISS then HIT and keeps request statistics after cache clear', async () => {
  const cache = new MemoryCache(); let calls = 0;
  const service = new CacheFlowService({ cache, backend: 'memory', provider: async id => { calls++; return { data: { id }, durationMs: 2 }; } });
  assert.notEqual(service.keyFor(3), service.keyFor(4));
  const first = await service.request(3, 60); const second = await service.request(3, 60);
  assert.equal(first.status, 'MISS'); assert.equal(second.status, 'HIT'); assert.equal(calls, 1);
  assert.equal(await cache.clear(), 1);
  const afterClear = await service.stats();
  assert.equal(afterClear.requests, 2); assert.equal(afterClear.hits, 1); assert.equal(afterClear.misses, 1); assert.equal(afterClear.hitRatio, 0.5);
  assert.equal((await service.request(3, 60)).status, 'MISS'); assert.equal(calls, 2);
  const finalStats = await service.stats();
  assert.equal(finalStats.requests, 3); assert.equal(finalStats.providerCalls, 2); assert.equal(finalStats.hitRatio, 1 / 3);
});

test('provider failure does not cache a value and the next request retries', async () => {
  const cache = new MemoryCache(); let calls = 0;
  const service = new CacheFlowService({ cache, backend: 'memory', provider: async id => {
    calls++; if (calls === 1) throw Object.assign(new Error('provider unavailable'), { status: 502 });
    return { data: { id }, durationMs: 4 };
  } });
  await assert.rejects(service.request(8), /provider unavailable/);
  assert.equal(await cache.exists(service.keyFor(8)), false);
  assert.equal((await service.request(8)).status, 'MISS');
  assert.equal((await service.request(8)).status, 'HIT');
  assert.equal(calls, 2);
});

test('provider timeout errors propagate without recording a successful request', async () => {
  const service = new CacheFlowService({ cache: new MemoryCache(), backend: 'memory', provider: async () => {
    throw Object.assign(new Error('Data provider timed out after 5 seconds'), { status: 504 });
  } });
  await assert.rejects(service.request(1), error => error.status === 504);
  const stats = await service.stats(); assert.equal(stats.requests, 0); assert.equal(stats.entryCount, 0);
});

test('cache clear during a provider request does not allow the old request to repopulate cache', async () => {
  const cache = new MemoryCache(); let releaseProvider; let providerStarted;
  const started = new Promise(resolve => { providerStarted = resolve; });
  const provider = () => new Promise(resolve => { releaseProvider = resolve; providerStarted(); });
  const service = new CacheFlowService({ cache, backend: 'memory', provider });
  const pending = service.request(11, 60); await started; await service.clearCache();
  releaseProvider({ data: { id: 11 }, durationMs: 5 }); const response = await pending;
  assert.equal(response.cacheStored, false);
  assert.equal(await cache.exists(service.keyFor(11)), false);
});

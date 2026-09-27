import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export class CacheFlowService {
  constructor({ cache, backend, defaultTtl = 60, provider }) {
    this.cache = cache; this.backend = backend; this.defaultTtl = defaultTtl; this.provider = provider;
    this.history = []; this.totals = { requests: 0, hits: 0, misses: 0, providerCalls: 0, latencyTotalMs: 0, hitLatencyTotalMs: 0, hitLatencyCount: 0, missLatencyTotalMs: 0, missLatencyCount: 0 };
    this.cacheGeneration = 0;
  }
  keyFor(id) { const canonical = `GET:/posts?id=${new URLSearchParams({ id: String(id) })}`; return `cacheflow:v1:${createHash('sha256').update(canonical).digest('hex')}`; }
  async request(id, ttl = this.defaultTtl) {
    const requestId = randomUUID(); const timestamp = new Date().toISOString(); const start = performance.now();
    const generation = this.cacheGeneration;
    const key = this.keyFor(id); const lookupStart = performance.now();
    let cached;
    try { cached = await this.cache.get(key); } catch { throw Object.assign(new Error('Cache provider is unavailable'), { status: 503 }); }
    const cacheLookupMs = performance.now() - lookupStart; let result; let providerRequestMs = null; let providerMode = null; let expiresAt;
    let cacheStored = Boolean(cached);
    if (cached) { result = cached.value; expiresAt = cached.expiresAt; }
    else {
      const external = await this.provider(id); result = external.data; providerRequestMs = external.durationMs; providerMode = external.providerMode || 'custom';
      this.totals.providerCalls++;
      if (generation === this.cacheGeneration) {
        try { await this.cache.set(key, result, ttl); cacheStored = true; } catch { /* Return fetched data even if it cannot be cached. */ }
      }
      expiresAt = Date.now() + ttl * 1000;
    }
    const totalMs = performance.now() - start; const status = cached ? 'HIT' : 'MISS';
    this.totals.requests++; this.totals.latencyTotalMs += totalMs;
    if (cached) { this.totals.hits++; this.totals.hitLatencyTotalMs += totalMs; this.totals.hitLatencyCount++; }
    else { this.totals.misses++; this.totals.missLatencyTotalMs += totalMs; this.totals.missLatencyCount++; }
    const row = { requestId, timestamp, endpoint: `/posts/${id}`, status, totalMs, cacheLookupMs, providerRequestMs, backend: typeof this.backend === 'function' ? this.backend() : this.backend };
    this.history.unshift(row); this.history.length = Math.min(this.history.length, 100);
    return { ...row, data: result, providerRequestMs, providerMode, cacheStored, ttlRemainingSeconds: cacheStored ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) : 0, ttlSeconds: ttl, cacheKey: key };
  }
  async clearCache() { this.cacheGeneration++; return this.cache.clear(); }
  async stats() {
    const cache = await this.cache.stats(); const requests = this.totals.requests;
    return { ...cache, hits: this.totals.hits, misses: this.totals.misses, requests, providerCalls: this.totals.providerCalls, hitRatio: requests ? this.totals.hits / requests : 0,
      averageLatencyMs: requests ? this.totals.latencyTotalMs / requests : 0,
      averageHitLatencyMs: this.totals.hitLatencyCount ? this.totals.hitLatencyTotalMs / this.totals.hitLatencyCount : null,
      averageMissLatencyMs: this.totals.missLatencyCount ? this.totals.missLatencyTotalMs / this.totals.missLatencyCount : null,
      history: [...this.history] };
  }
}

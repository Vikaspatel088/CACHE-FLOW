import { MemoryCache } from './cache/memory.js';
import { RedisCache } from './cache/redis.js';
import { CacheFlowService } from './service.js';
import { createHttpServer } from './http.js';
import { fetchDemoResource, fetchRemoteResource } from './provider.js';

function integerSetting(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

async function start() {
  const port = integerSetting('PORT', 3000, 1, 65535);
  const defaultTtl = integerSetting('DEFAULT_TTL_SECONDS', 60, 1, 86400);
  const providerMode = process.env.DATA_PROVIDER || 'demo';
  if (!['demo', 'remote'].includes(providerMode)) throw new Error('DATA_PROVIDER must be either demo or remote');
  const memory = new MemoryCache(); let activeCache = memory; let backend = 'memory'; let redisStatus = 'not_configured';
  if (process.env.REDIS_URL) {
    try {
      const candidate = new RedisCache(process.env.REDIS_URL);
      if (await candidate.ping() === 'PONG') { activeCache = candidate; backend = 'redis'; redisStatus = 'connected'; }
      else redisStatus = 'unavailable';
    } catch { redisStatus = 'unavailable'; }
  }
  const redisCache = activeCache;
  const cache = new Proxy({}, { get(_target, operation) { return async (...args) => {
    try { return await activeCache[operation](...args); }
    catch (error) {
      if (activeCache !== redisCache || redisCache === memory) throw error;
      activeCache = memory; backend = 'memory'; redisStatus = 'unavailable';
      return memory[operation](...args);
    }
  }; } });
  const service = new CacheFlowService({ cache, backend: () => backend, defaultTtl, provider: providerMode === 'remote' ? fetchRemoteResource : fetchDemoResource });
  const server = createHttpServer({ service, cache, defaultTtl, providerMode, getCacheStatus: () => ({ backend, redisStatus }) });
  server.on('error', () => { console.error(`CacheFlow could not listen on port ${port}`); process.exitCode = 1; });
  server.listen(port, () => console.log(`CacheFlow listening on http://localhost:${port}`));
}

start().catch(error => { console.error(`CacheFlow configuration error: ${error.message}`); process.exitCode = 1; });

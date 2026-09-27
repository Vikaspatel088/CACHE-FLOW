# CacheFlow

CacheFlow is a small API performance lab that makes cache hit/miss behavior visible. Request sample post data from an offline demo provider or a fixed public endpoint, compare measured response times, tune entry TTLs, inspect request history, and clear the cache.

## Run locally

Requires Node.js 20 or newer. No npm install step or third-party runtime dependency is required.

```sh
node --version
npm start
```

Open [http://localhost:3000](http://localhost:3000). The first request for a post is a miss and calls the deterministic local demo provider; repeat it before its TTL expires to get a hit. Change the post ID to observe another miss. The local provider makes the demo work offline. Set `DATA_PROVIDER=remote` to call JSONPlaceholder on misses instead.

To run in watch mode use `npm run dev`. To run automated checks use `npm test`.

## Architecture

```text
Browser UI → Node HTTP API → CacheFlowService → MemoryCache or RedisCache
                                               ↓ on miss
                                    local demo / JSONPlaceholder
```

The service owns request orchestration and measurement. Cache providers share `get`, `set`, `delete`, `clear`, `exists`, and `stats` operations; cache selection happens at startup. The Redis adapter uses Redis' RESP protocol and built-in Node networking, so the app can run without adding a Redis client package.

## Cache flow and metrics

For each `GET /api/data/posts?id=N&ttl=S`, CacheFlow canonicalizes the resource as `GET:/posts?id=N`, hashes it with SHA-256, and prefixes the digest with a versioned namespace. A miss calls the configured provider, measures provider and total elapsed time, then stores the response with an expiration. A hit returns the stored value and does not call the provider. Entries that have expired are misses. TTL is an integer from 1 to 86,400 seconds; the default is 60.

Durations use Node's monotonic performance clock. Provider time measures the provider fetch (including response body parsing); total time covers cache lookup and, for misses, provider fetch and cache write. Statistics and request history are process-local and reset when the server restarts. The visible history keeps up to 100 latest requests. Hit and miss counters count successful data requests handled by the service, independent of cache backend. These are measurements from this running process, not benchmark claims.

## Configuration

Copy `.env.example` values into your environment or set them directly in the shell. Node does not load `.env` files automatically.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port |
| `DEFAULT_TTL_SECONDS` | `60` | TTL used by the UI on startup |
| `DATA_PROVIDER` | `demo` | `demo` uses local deterministic sample data; `remote` calls JSONPlaceholder |
| `REDIS_URL` | unset | Optional Redis URL, such as `redis://localhost:6379/0`; `rediss://` TLS URLs are unsupported |

When Redis is configured, CacheFlow checks it at startup. If it cannot connect, the application starts with in-memory cache and reports Redis unavailable in the header. At runtime, Redis errors switch the process to in-memory cache. Redis TLS (`rediss://`) is not supported. Redis entry TTL is enforced by Redis; entry counts and cache clearing scan only CacheFlow's `cacheflow:v1:*` namespace, leaving unrelated keys in the selected database untouched. A dedicated Redis database is still recommended.

## API

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | Active backend, Redis state, and default TTL |
| `GET /api/data/posts?id=1&ttl=60` | Fetch cached post data and per-request timing metadata |
| `GET /api/stats` | Counters, averages, cache entry count, and recent request history |
| `DELETE /api/cache` | Invalidate all entries in the active cache |
| `DELETE /api/history` | Clear visible request history; aggregate counters remain |

IDs are restricted to 1–100 and TTL to 1–86,400 seconds. Errors return a concise JSON `error` field; the optional remote provider endpoint is fixed in code, so callers cannot make arbitrary outbound requests. The demo provider is explicitly identified in the UI and API response metadata; its provider timing and cache timings are measured, not supplied as benchmark data.

## Engineering notes and trade-offs

- **Why cache:** Reusing a valid response can lower request latency and reduce load on a data provider.
- **Hit / miss:** A hit uses a non-expired entry. A miss contacts the provider and attempts to save the response.
- **TTL / invalidation:** TTL bounds how long an entry can be reused; the cache control clears all entries. Per-key invalidation is supported by the adapter interface.
- **Hit ratio:** Hits divided by requests seen by this process. It starts at 0 when no requests have run.
- **In-memory vs Redis:** Memory is simple and requires no services, but is per-process and is lost on restart. Redis shares entries across app processes and enforces expiry centrally, with network and operational costs.
- **Production considerations:** Real deployments need deliberate stale-data policy, memory limits and eviction strategy, cache stampede protection, distributed coordination, consistency expectations, Redis authentication/TLS, and persistent or aggregated analytics. This compact lab does not claim to provide those controls.
- Request history and aggregate latency statistics live in process memory. The offline demo provider returns deterministic sample records; the optional remote mode calls the fixed public JSONPlaceholder endpoint.

## Tests

`npm test` runs deterministic Node tests for memory cache operations, TTL expiration, key isolation, clear races, API routes and validation, provider failures/timeouts, metrics, and Redis behavior against a local fake RESP server. Automated tests do not require a live Redis server or make external network calls.

export class MemoryCache {
  #entries = new Map();
  #hits = 0;
  #misses = 0;

  constructor() {
    this.cleanupTimer = setInterval(() => this.#pruneExpired(), 5000);
    this.cleanupTimer.unref?.();
  }

  #pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of this.#entries) if (entry.expiresAt <= now) this.#entries.delete(key);
  }

  async get(key) {
    const entry = this.#entries.get(key);
    if (!entry) { this.#misses++; return null; }
    if (entry.expiresAt <= Date.now()) { this.#entries.delete(key); this.#misses++; return null; }
    this.#hits++;
    return { value: entry.value, expiresAt: entry.expiresAt, createdAt: entry.createdAt };
  }
  async set(key, value, ttlSeconds) {
    this.#pruneExpired();
    const createdAt = Date.now();
    this.#entries.set(key, { value, createdAt, expiresAt: createdAt + ttlSeconds * 1000 });
  }
  async delete(key) { return this.#entries.delete(key); }
  async clear() { this.#pruneExpired(); const removed = this.#entries.size; this.#entries.clear(); return removed; }
  async exists(key) {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) { this.#entries.delete(key); return false; }
    return true;
  }
  async stats() { this.#pruneExpired(); return { entryCount: this.#entries.size, hits: this.#hits, misses: this.#misses }; }
}

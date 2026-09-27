import net from 'node:net';

// Small RESP2 client for the cache commands CacheFlow needs; no runtime dependency.
function encode(parts) { return `*${parts.length}\r\n${parts.map(p => `$${Buffer.byteLength(String(p))}\r\n${p}\r\n`).join('')}`; }
function parse(buffer, offset = 0) {
  const end = buffer.indexOf('\r\n', offset); if (end < 0) return null;
  const head = buffer.toString('utf8', offset, end); const bodyStart = end + 2;
  if (head[0] === '-') throw new Error(head.slice(1));
  if (head[0] === '+') return { value: head.slice(1), next: bodyStart };
  if (head[0] === ':') return { value: Number(head.slice(1)), next: bodyStart };
  if (head[0] === '$') { const len = Number(head.slice(1)); if (len < 0) return { value: null, next: bodyStart }; const next = bodyStart + len + 2; if (buffer.length < next) return null; return { value: buffer.toString('utf8', bodyStart, bodyStart + len), next }; }
  if (head[0] === '*') {
    const count = Number(head.slice(1)); if (count < 0) return { value: null, next: bodyStart };
    let next = bodyStart; const values = [];
    for (let i = 0; i < count; i++) { const item = parse(buffer, next); if (!item) return null; values.push(item.value); next = item.next; }
    return { value: values, next };
  }
  throw new Error('Unsupported Redis response');
}
export class RedisCache {
  constructor(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'redis:' || !parsed.hostname || parsed.search || parsed.hash || !/^\/(?:\d+)?$/.test(parsed.pathname)) {
      throw new Error('REDIS_URL must be a redis:// URL with an optional database number; TLS URLs are unsupported');
    }
    this.host = parsed.hostname; this.port = Number(parsed.port || 6379);
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) throw new Error('REDIS_URL port must be from 1 to 65535');
    this.password = parsed.password ? decodeURIComponent(parsed.password) : null;
    this.username = parsed.username ? decodeURIComponent(parsed.username) : null;
    this.database = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;
    if (!Number.isSafeInteger(this.database)) throw new Error('REDIS_URL database must be a non-negative integer');
    this.hits = 0; this.misses = 0;
  }
  command(parts) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port }); let data = Buffer.alloc(0); let settled = false;
      const fail = error => { if (!settled) { settled = true; socket.destroy(); reject(error); } };
      socket.setTimeout(1200, () => fail(new Error('Redis connection timed out')));
      socket.on('error', fail);
      socket.on('connect', () => {
        const commands = [];
        if (this.password) commands.push(encode(this.username ? ['AUTH', this.username, this.password] : ['AUTH', this.password]));
        if (this.database) commands.push(encode(['SELECT', this.database]));
        commands.push(encode(parts)); socket.write(commands.join(''));
      });
      socket.on('data', chunk => {
        data = Buffer.concat([data, chunk]);
        // Commands are sent sequentially; final response is the last RESP frame.
        const expected = 1 + Number(Boolean(this.password)) + Number(Boolean(this.database));
        try {
          let offset = 0; let response;
          for (let i = 0; i < expected; i++) {
            const parsed = parse(data, offset); if (!parsed) return; response = parsed.value; offset = parsed.next;
          }
          settled = true; socket.end(); resolve(response);
        } catch (error) { fail(error); }
      });
    });
  }
  async get(key) {
    const raw = await this.command(['GET', key]);
    if (raw === null) { this.misses++; return null; }
    const entry = JSON.parse(raw); this.hits++;
    return { value: entry.value, createdAt: entry.createdAt, expiresAt: entry.expiresAt };
  }
  async set(key, value, ttlSeconds) {
    const createdAt = Date.now(); const expiresAt = createdAt + ttlSeconds * 1000;
    await this.command(['SET', key, JSON.stringify({ value, createdAt, expiresAt }), 'PX', Math.max(1, expiresAt - Date.now())]);
  }
  async delete(key) { return (await this.command(['DEL', key])) > 0; }
  async #scanKeys() {
    let cursor = '0'; const keys = [];
    do {
      const [next, batch] = await this.command(['SCAN', cursor, 'MATCH', 'cacheflow:v1:*', 'COUNT', 500]);
      cursor = next; keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }
  async clear() {
    let removed = 0;
    while (true) {
      const keys = await this.#scanKeys();
      if (!keys.length) break;
      removed += await this.command(['DEL', ...keys]);
    }
    return removed;
  }
  async exists(key) { return (await this.command(['EXISTS', key])) > 0; }
  async stats() { return { entryCount: (await this.#scanKeys()).length, hits: this.hits, misses: this.misses }; }
  async ping() { return this.command(['PING']); }
}

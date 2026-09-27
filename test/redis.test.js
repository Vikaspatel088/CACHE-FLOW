import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { RedisCache } from '../server/cache/redis.js';

function readCommand(buffer, offset) {
  const lineEnd = buffer.indexOf('\r\n', offset); if (lineEnd < 0) return null;
  const count = Number(buffer.toString('ascii', offset + 1, lineEnd)); let cursor = lineEnd + 2; const args = [];
  for (let i = 0; i < count; i++) {
    const end = buffer.indexOf('\r\n', cursor); if (end < 0) return null;
    const size = Number(buffer.toString('ascii', cursor + 1, end)); const start = end + 2; const next = start + size + 2;
    if (buffer.length < next) return null;
    args.push(buffer.toString('utf8', start, start + size)); cursor = next;
  }
  return { args, next: cursor };
}
const simple = value => `+${value}\r\n`;
const integer = value => `:${value}\r\n`;
const bulk = value => value == null ? '$-1\r\n' : `$${Buffer.byteLength(value)}\r\n${value}\r\n`;

async function startFakeRedis() {
  const records = new Map(); const received = [];
  const server = net.createServer(socket => {
    let pending = Buffer.alloc(0); let output = Promise.resolve();
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]); let command;
      while ((command = readCommand(pending, 0))) {
        pending = pending.subarray(command.next); const [name, ...args] = command.args; received.push(name);
        let response;
        switch (name.toUpperCase()) {
          case 'SELECT': case 'AUTH': response = simple('OK'); break;
          case 'PING': response = simple('PONG'); break;
          case 'SET': records.set(args[0], args[1]); response = simple('OK'); break;
          case 'GET': response = bulk(records.get(args[0]) ?? null); break;
          case 'EXISTS': response = integer(records.has(args[0]) ? 1 : 0); break;
          case 'DEL': { let removed = 0; for (const key of args) if (records.delete(key)) removed++; response = integer(removed); break; }
          case 'SCAN': {
            const keys = [...records.keys()].filter(key => key.startsWith('cacheflow:v1:'));
            response = `*2\r\n${bulk('0')}*${keys.length}\r\n${keys.map(bulk).join('')}`; break;
          }
          default: response = `-ERR unsupported command\r\n`;
        }
        output = output.then(() => new Promise(resolve => {
          const bytes = Buffer.from(response); const split = Math.min(3, bytes.length);
          socket.write(bytes.subarray(0, split)); setTimeout(() => { if (split < bytes.length) socket.write(bytes.subarray(split)); resolve(); }, 1);
        }));
      }
    });
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  return { server, records, received, port: server.address().port };
}

test('Redis adapter handles fragmented RESP replies and only clears its own namespace', async t => {
  const fake = await startFakeRedis(); t.after(() => new Promise(resolve => fake.server.close(resolve)));
  const cache = new RedisCache(`redis://127.0.0.1:${fake.port}/2`);
  assert.equal(await cache.ping(), 'PONG');
  await cache.set('cacheflow:v1:item', { id: 1 }, 30);
  await cache.command(['SET', 'unrelated:key', 'keep']);
  assert.deepEqual((await cache.get('cacheflow:v1:item')).value, { id: 1 });
  assert.equal(await cache.get('cacheflow:v1:missing'), null);
  assert.equal((await cache.stats()).entryCount, 1);
  assert.equal(await cache.clear(), 1);
  assert.equal(await cache.exists('unrelated:key'), true);
  assert.equal((await cache.stats()).entryCount, 0);
  assert.equal(fake.received.includes('FLUSHDB'), false);
  assert.deepEqual({ hits: cache.hits, misses: cache.misses }, { hits: 1, misses: 1 });
});

test('Redis URL rejects unsupported or malformed configurations', () => {
  assert.throws(() => new RedisCache('rediss://localhost:6379'), /redis:\/\//);
  assert.throws(() => new RedisCache('redis://localhost:6379/not-a-database'), /database number/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDemoResource, fetchRemoteResource } from '../server/provider.js';

test('demo provider returns deterministic data and measured duration', async () => {
  const first = await fetchDemoResource(2); const second = await fetchDemoResource(2);
  assert.deepEqual(first.data, second.data); assert.equal(first.providerMode, 'demo');
  assert.equal(typeof first.durationMs, 'number'); assert.ok(first.durationMs >= 0);
});

test('remote provider returns response data and measures the complete fetch', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://jsonplaceholder.typicode.com/posts/17');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ id: 17, title: 'sample' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await fetchRemoteResource(17);
  assert.deepEqual(result.data, { id: 17, title: 'sample' }); assert.equal(result.providerMode, 'remote');
  assert.ok(result.durationMs >= 0);
});

test('remote provider normalizes provider errors and abort timeouts', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error('network details are private'); };
  await assert.rejects(fetchRemoteResource(1), error => error.status === 502 && error.message === 'Data provider is unavailable');
  globalThis.fetch = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  await assert.rejects(fetchRemoteResource(1), error => error.status === 504 && error.message.includes('timed out'));
});

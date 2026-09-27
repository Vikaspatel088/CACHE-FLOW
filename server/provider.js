const API_ROOT = 'https://jsonplaceholder.typicode.com';
const demoPosts = [
  { userId: 1, id: 1, title: 'delectus aut autem', body: 'At the beginning of each day, a cache can reuse fresh data instead of calling its provider again.' },
  { userId: 1, id: 2, title: 'quis ut nam facilis et officia qui', body: 'This deterministic demo response makes the cache flow work without network access.' },
  { userId: 1, id: 3, title: 'fugiat veniam minus', body: 'A time to live bounds how long an entry can be served from the cache.' },
  { userId: 1, id: 4, title: 'et porro tempora', body: 'Once an entry expires, the next request fetches fresh provider data.' },
  { userId: 1, id: 5, title: 'laboriosam mollitia et enim quasi adipisci quia provident illum', body: 'The demo provider is local and deterministic; the cache and timings are real.' }
];
export async function fetchDemoResource(id) {
  const started = performance.now();
  const data = demoPosts.find(post => post.id === Number(id)) || { userId: 1, id: Number(id), title: `Demo post ${id}`, body: 'Generated deterministic sample content from the local demo provider.' };
  return { data, durationMs: performance.now() - started, providerMode: 'demo' };
}
export async function fetchRemoteResource(id) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000); const started = performance.now();
  try {
    const response = await fetch(`${API_ROOT}/posts/${encodeURIComponent(id)}`, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw Object.assign(new Error(`Data provider returned HTTP ${response.status}`), { status: 502 });
    const data = await response.json(); return { data, durationMs: performance.now() - started, providerMode: 'remote' };
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('Data provider timed out after 5 seconds'), { status: 504 });
    if (error.status) throw error;
    throw Object.assign(new Error('Data provider is unavailable'), { status: 502 });
  } finally { clearTimeout(timer); }
}

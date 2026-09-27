const $ = id => document.getElementById(id);
const state = { filter: 'ALL', history: [], busy: false, toastTimer: null };
const fmtMs = value => value == null ? '—' : `${Number(value) < 10 ? Number(value).toFixed(1) : Math.round(Number(value))} ms`;
const shortTime = value => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
function toast(message, error = false) { const node = $('toast'); node.textContent = message; node.classList.toggle('error', error); node.classList.add('show'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => node.classList.remove('show'), 2500); }
async function api(path, options) { const response = await fetch(path, options); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Request could not be completed.'); return body; }
function updateUrl() { $('request-url').textContent = `/api/data/posts?id=${$('resource').value}&ttl=${$('ttl').value || '60'}`; }
function renderStats(stats) {
  const hits = stats.hits || 0, misses = stats.misses || 0;
  const entryCount = stats.entryCount ?? 0;
  $('cache-entry-count').textContent = `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`;
  $('hit-rate').innerHTML = `${(stats.hitRatio * 100 || 0).toFixed(0)}<small>%</small>`;
  $('hit-rate-note').textContent = stats.requests ? `${hits} of ${stats.requests} requests were hits` : 'Waiting for requests';
  $('hit-meter').style.width = `${Math.min(100, (stats.hitRatio || 0) * 100)}%`;
  $('total-requests').textContent = stats.requests || 0; $('cache-hits').textContent = hits; $('cache-misses').textContent = misses;
  $('provider-calls').textContent = stats.providerCalls || 0; $('avg-latency').innerHTML = `${stats.averageLatencyMs == null ? '—' : stats.averageLatencyMs.toFixed(1)}<small>ms</small>`;
  const max = Math.max(stats.averageHitLatencyMs || 0, stats.averageMissLatencyMs || 0);
  const hitWidth = stats.averageHitLatencyMs == null ? 0 : Math.max(2, (stats.averageHitLatencyMs / (max || 1)) * 100);
  const missWidth = stats.averageMissLatencyMs == null ? 0 : Math.max(2, (stats.averageMissLatencyMs / (max || 1)) * 100);
  $('hit-bar').style.width = `${hitWidth}%`; $('miss-bar').style.width = `${missWidth}%`;
  $('hit-bar-label').textContent = fmtMs(stats.averageHitLatencyMs); $('miss-bar-label').textContent = fmtMs(stats.averageMissLatencyMs);
  $('distribution-hit').style.width = `${stats.hitRatio * 100 || 0}%`;
  $('distribution-miss').style.width = `${(1 - (stats.hitRatio || 0)) * 100}%`;
  $('distribution-hits').textContent = hits; $('distribution-misses').textContent = misses;
  $('distribution-rate').textContent = `${(stats.hitRatio * 100 || 0).toFixed(0)}% hit rate`;
  $('distribution-total').textContent = stats.requests ? `${stats.requests} total` : 'No requests yet';
  $('distribution-chart').setAttribute('aria-label', `${hits} cache hits, ${misses} cache misses, ${(stats.hitRatio * 100 || 0).toFixed(0)} percent hit rate`);
  renderTrend(stats.history || []);
  state.history = stats.history || []; renderHistory();
}
function renderTrend(history) {
  const recent = history.slice(0, 12).reverse(); const container = $('latency-trend');
  $('trend-summary').textContent = `${recent.length} ${recent.length === 1 ? 'request' : 'requests'}`;
  if (!recent.length) { container.innerHTML = '<p>No requests yet. Your latency trend will appear here.</p>'; return; }
  const width = 320, height = 72, max = Math.max(...recent.map(row => Number(row.totalMs)), 1);
  const points = recent.map((row, index) => {
    const x = recent.length === 1 ? width / 2 : 8 + index * (width - 16) / (recent.length - 1);
    const y = height - 10 - (Number(row.totalMs) / max) * (height - 22);
    return { x, y, row };
  });
  const line = points.map(point => `${point.x},${point.y}`).join(' ');
  const circles = points.map(({ x, y, row }) => `<circle cx="${x}" cy="${y}" r="3.5" class="trend-point ${row.status.toLowerCase()}"><title>${row.status}: ${Number(row.totalMs).toFixed(2)} ms at ${shortTime(row.timestamp)}</title></circle>`).join('');
  const last = recent.at(-1);
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Recent request latency trend from ${recent.length} requests. Latest ${Number(last.totalMs).toFixed(2)} milliseconds."><line x1="8" y1="${height - 10}" x2="${width - 8}" y2="${height - 10}" class="trend-axis"/><polyline points="${line}" class="trend-line"/>${circles}</svg><div class="trend-captions"><span>${recent.length > 1 ? shortTime(recent[0].timestamp) : 'Latest request'}</span><strong>${fmtMs(last.totalMs)} latest</strong><span>${recent.length > 1 ? shortTime(last.timestamp) : last.status}</span></div>`;
}
function renderHistory() {
  const list = $('activity-list'); const filtered = state.history.filter(row => state.filter === 'ALL' || row.status === state.filter);
  $('request-count').textContent = state.history.length; $('all-count').textContent = state.history.length;
  $('hits-count').textContent = state.history.filter(row => row.status === 'HIT').length; $('miss-count').textContent = state.history.filter(row => row.status === 'MISS').length;
  if (!filtered.length) { list.innerHTML = `<div class="activity-empty"><span class="empty-symbol">◷</span><span>${state.history.length ? 'No requests match this filter.' : 'Requests will appear here as they run.'}</span></div>`; return; }
  list.innerHTML = filtered.slice(0, 12).map(row => `<div class="activity-row" title="${row.backend} cache · ${row.requestId}"><span class="activity-time">${shortTime(row.timestamp)}</span><span class="activity-endpoint">${row.endpoint}</span><span class="activity-status ${row.status.toLowerCase()}">${row.status}</span><span class="activity-latency">${fmtMs(row.totalMs)}</span></div>`).join('');
}
function renderResult(result) {
  const hit = result.status === 'HIT';
  $('result-panel').setAttribute('aria-live', 'polite');
  $('result-panel').innerHTML = `<div class="result-content"><div class="result-top"><span class="status-pill ${hit ? 'hit' : 'miss'}"><i class="status-dot"></i>CACHE ${result.status}</span><span class="request-id">${result.requestId.slice(0, 8)}</span></div><div class="result-main"><strong class="big-latency">${Number(result.totalMs).toFixed(2)}<small>ms</small></strong><span class="result-description">${hit ? 'Served from cache · provider not contacted' : result.cacheStored ? `Cache miss · ${result.providerMode === 'demo' ? 'demo provider' : 'JSONPlaceholder'} contacted and response cached` : 'Provider response returned · cache was cleared before it could be stored'}</span></div><div class="result-details"><div class="detail"><span>CACHE LOOKUP</span><b>${fmtMs(result.cacheLookupMs)}</b></div><div class="detail"><span>${hit ? 'PROVIDER CALL' : 'PROVIDER TIME'}</span><b>${hit ? 'Skipped' : fmtMs(result.providerRequestMs)}</b></div><div class="detail"><span>${hit ? 'TTL LEFT' : result.cacheStored ? 'CACHED FOR' : 'CACHE WRITE'}</span><b>${hit ? `${result.ttlRemainingSeconds}s` : result.cacheStored ? `${result.ttlSeconds}s` : 'Skipped'}</b></div></div><details class="response-body"><summary>View response data</summary><pre>${escapeHtml(JSON.stringify(result.data, null, 2))}</pre></details></div>`;
}
function renderRequestError(message) {
  $('result-panel').setAttribute('aria-live', 'assertive');
  $('result-panel').innerHTML = `<div class="request-error"><span class="error-mark" aria-hidden="true">!</span><div><strong>Request failed</strong><p>${escapeHtml(message)}</p></div></div>`;
}
function renderRequestLoading() {
  $('result-panel').setAttribute('aria-live', 'polite');
  $('result-panel').innerHTML = '<div class="result-empty request-loading" role="status"><span class="empty-orbit"><span>↻</span></span><h3>Checking the cache</h3><p>Looking up this resource and measuring the response.</p></div>';
}
function escapeHtml(text) { return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
async function refreshStats() { try { renderStats(await api('/api/stats')); } catch { /* Retain the last known snapshot during transient errors. */ } }
async function refreshHealth() { try { const health = await api('/api/health'); $('system-status').innerHTML = '<span></span> API CONNECTED'; $('system-status').classList.remove('offline'); $('backend-label').textContent = health.backend === 'redis' ? 'Redis connected' : health.redisStatus === 'unavailable' ? 'Memory active · Redis unavailable' : 'In-memory cache'; $('backend-dot').classList.toggle('warning', health.redisStatus === 'unavailable'); $('provider-label').textContent = health.providerMode === 'remote' ? 'Data provider: JSONPlaceholder' : 'Data provider: local deterministic demo'; $('ttl').value = health.defaultTtlSeconds; updateUrl(); } catch { $('system-status').textContent = 'API UNAVAILABLE'; $('system-status').classList.add('offline'); $('backend-label').textContent = 'Cache status unavailable'; } }
$('resource').addEventListener('change', updateUrl); $('ttl').addEventListener('input', updateUrl);
$('request-form').addEventListener('submit', async event => {
  event.preventDefault(); if (state.busy) return;
  const ttl = Number($('ttl').value); if (!Number.isInteger(ttl) || ttl < 1 || ttl > 86400) { toast('Enter a TTL from 1 to 86400 seconds.', true); return; }
  state.busy = true; $('send-button').disabled = true; $('send-button').setAttribute('aria-busy', 'true'); $('send-button').querySelector('.send-label').textContent = 'Looking up cache…'; renderRequestLoading();
  try { const result = await api(`/api/data/posts?id=${encodeURIComponent($('resource').value)}&ttl=${ttl}`); renderResult(result); await refreshStats(); }
  catch (error) { renderRequestError(error.message); toast(error.message, true); }
  finally { state.busy = false; $('send-button').disabled = false; $('send-button').removeAttribute('aria-busy'); $('send-button').querySelector('.send-label').textContent = 'Send request'; }
});
$('copy-url').addEventListener('click', async () => { try { await navigator.clipboard.writeText(`${location.origin}${$('request-url').textContent}`); toast('Request URL copied'); } catch { toast('Could not access clipboard', true); } });
$('clear-cache').addEventListener('click', async () => { try { await api('/api/cache', { method: 'DELETE' }); $('result-panel').setAttribute('aria-live', 'polite'); $('result-panel').innerHTML = '<div class="result-empty cache-cleared"><span class="empty-orbit"><span>✓</span></span><h3>Cache cleared</h3><p>The next request will fetch fresh provider data.</p></div>'; await refreshStats(); toast('Cache cleared · next request will miss'); } catch (error) { toast(error.message, true); } });
$('clear-history').addEventListener('click', async () => { try { await api('/api/history', { method: 'DELETE' }); await refreshStats(); toast('Request history cleared'); } catch (error) { toast(error.message, true); } });
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item === button)); renderHistory(); }));
refreshHealth(); refreshStats();

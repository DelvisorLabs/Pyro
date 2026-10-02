import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportServer } from './server.mjs';
test('allow, block, review, reviewer authorization, replay and provider failure', async () => {
  const reviewToken = 'test-review-token-24-characters';
  const server = createSupportServer({ reviewToken, classify: async input => { if (input === 'error') throw new Error('offline'); return { id: 'decision', action: input, verdict: input === 'allow' ? 'safe' : 'suspicious' }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, authorized = false) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: `Bearer ${reviewToken}` } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/ask', { input: 'allow' })).status, 200);
    assert.equal((await post('/ask', { input: 'block' })).status, 422);
    const pending = await post('/ask', { input: 'review' }); assert.equal(pending.status, 202);
    const path = `/reviews/${(await pending.json()).reviewId}/resolve`;
    assert.equal((await post(path, { action: 'approve' })).status, 403);
    assert.equal((await post(path, { action: 'approve' }, true)).status, 200);
    assert.equal((await post(path, { action: 'approve' }, true)).status, 404);
    assert.equal((await post('/ask', { input: 'error' })).status, 503);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

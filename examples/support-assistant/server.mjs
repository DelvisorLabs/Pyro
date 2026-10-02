import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
export function createSupportServer({ gateway, key, reviewToken, policy = 'support-workflow', classify: suppliedClassifier } = {}) {
  const held = new Map();
  const classify = suppliedClassifier ?? (async input => {
    const response = await fetch(`${gateway.replace(/\/$/, '')}/v1/classify`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ input, profile: policy }), signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Policy service returned ${response.status}`);
    return response.json();
  });
  const answer = () => ({ status: 'answered', answer: 'Northstar demo: open Settings → Billing to change your plan. This sample does not access customer data or execute tools.' });
  return createServer(async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
    for (const [id, row] of held) if (row.expiresAt <= Date.now()) held.delete(id);
    try {
      if (request.method !== 'POST') return send(405, { error: 'POST /ask or /reviews/ID/resolve' });
      let raw = ''; for await (const chunk of request) { raw += chunk; if (Buffer.byteLength(raw) > 16000) return send(413, { error: 'Input too large' }); }
      let body; try { body = JSON.parse(raw); } catch { return send(400, { error: 'JSON required' }); }
      if (request.url === '/ask') {
        if (typeof body.input !== 'string' || !body.input.trim() || body.input.length > 4000) return send(400, { error: 'Provide an input of 1–4000 characters' });
        const decision = await classify(body.input);
        if (decision.action === 'block') return send(422, { status: 'blocked', decisionId: decision.id });
        if (decision.action === 'review' || decision.verdict === 'indeterminate') {
          if (held.size >= 100) return send(503, { status: 'unavailable', error: 'Review capacity reached' });
          const reviewId = randomUUID(); held.set(reviewId, { decisionId: decision.id, expiresAt: Date.now() + 600000 });
          return send(202, { status: 'held', reviewId, decisionId: decision.id, message: 'A reviewer must resolve this request. No protected operation has run.' });
        }
        if (decision.action !== 'allow') return send(503, { status: 'unavailable' });
        return send(200, { ...answer(), decisionId: decision.id });
      }
      const match = /^\/reviews\/([a-f0-9-]+)\/resolve$/.exec(request.url ?? '');
      if (match) {
        const received = Buffer.from(request.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${reviewToken}`);
        if (!reviewToken || received.length !== expected.length || !timingSafeEqual(received, expected)) return send(403, { error: 'Reviewer authorization required' });
        if (!['approve', 'reject'].includes(body.action)) return send(400, { error: 'Choose approve or reject' });
        const row = held.get(match[1]); if (!row) return send(404, { error: 'Review expired or already resolved' });
        held.delete(match[1]);
        // A real app must recheck the original user's resource permissions here.
        // This demo can only return public documentation; it never executes a held tool.
        return send(200, { ...(body.action === 'approve' ? answer() : { status: 'rejected' }), decisionId: row.decisionId });
      }
      send(404, { error: 'Endpoint not found' });
    } catch { send(503, { status: 'unavailable', message: 'Policy check could not complete. Please retry later. No protected operation has run.' }); }
  });
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const key = process.env.PYRO_API_KEY, reviewToken = process.env.DEMO_REVIEW_TOKEN;
  if (!key || !reviewToken || reviewToken.length < 24) throw new Error('Set PYRO_API_KEY and a DEMO_REVIEW_TOKEN of at least 24 characters.');
  const server = createSupportServer({ gateway: process.env.PYRO_GATEWAY_URL ?? 'http://127.0.0.1:8080', key, reviewToken, policy: process.env.PYRO_POLICY_ID ?? 'support-workflow' });
  server.listen(Number(process.env.DEMO_PORT ?? 3090), '127.0.0.1', () => console.log('Support example listening at http://127.0.0.1:3090'));
}

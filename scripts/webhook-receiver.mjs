import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function createWebhookReceiver({ getSecret = () => process.env.PYRO_WEBHOOK_SECRET, failFirst = 0, log = console.log } = {}) {
  let attempts = 0;
  const seen = new Map();
  return http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') { response.end('ok'); return; }
    if (request.method !== 'POST' || request.url !== '/events') { response.writeHead(404).end(); return; }
    try {
      const chunks = []; let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 64 * 1024) { response.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      const timestamp = request.headers['x-pyro-timestamp'];
      const signature = request.headers['x-pyro-signature'];
      const deliveryId = request.headers['x-pyro-delivery-id'];
      const secret = getSecret();
      if (secret) {
        const expected = `v1=${createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}`;
        if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
            typeof signature !== 'string' || signature.length !== expected.length ||
            !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
          log('Rejected: invalid signature or expired timestamp.'); response.writeHead(401).end(); return;
        }
      }
      const event = JSON.parse(raw.toString('utf8'));
      if (typeof deliveryId !== 'string' || !deliveryId || !event?.id || !event?.type) { response.writeHead(400).end(); return; }
      attempts++;
      if (attempts <= failFirst) { log('Simulated HTTP 503; waiting for Pyro to retry.'); response.writeHead(503, { 'Retry-After': '1' }).end(); return; }
      const now = Date.now();
      for (const [id, expires] of seen) if (expires < now) seen.delete(id);
      if (!seen.has(deliveryId)) {
        seen.set(deliveryId, now + 3600_000);
        log(JSON.stringify({ deliveryId, signature: secret ? 'verified' : 'not checked (set PYRO_WEBHOOK_SECRET)', event }, null, 2));
      } else log(`Duplicate acknowledged: ${deliveryId}`);
      response.writeHead(204).end();
    } catch { response.writeHead(400).end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.WEBHOOK_TEST_PORT ?? 9091);
  const host = process.env.WEBHOOK_TEST_HOST ?? '127.0.0.1';
  const server = createWebhookReceiver({ failFirst: Number(process.env.WEBHOOK_TEST_FAIL_FIRST ?? 0) });
  server.listen(port, host, () => {
    console.log(`Local webhook receiver: http://${host}:${port}/events`);
    console.log(process.env.PYRO_WEBHOOK_SECRET ? 'Signature verification enabled.' : 'Set PYRO_WEBHOOK_SECRET to verify signatures.');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}

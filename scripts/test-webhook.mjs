import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createWebhookReceiver } from './webhook-receiver.mjs';

let fileEnv = {};
try { fileEnv = parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')); } catch {}
const env = { ...fileEnv, ...process.env };
const control = env.PYRO_CONTROL_URL ?? 'http://127.0.0.1:8081';
const gateway = env.PYRO_GATEWAY_URL ?? 'http://127.0.0.1:8080';
// This smoke test intentionally sends only to local services.
for (const value of [control, gateway]) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) throw new Error('Use localhost gateway and control-plane URLs for this test.');
}
if (!env.ADMIN_PASSWORD || !env.GATEWAY_API_KEY) throw new Error('Set ADMIN_PASSWORD and GATEWAY_API_KEY in .env, and start the local Pyro stack.');
let cookie, signingSecret, integrationId, profileCreated = false;
const profileId = `webhook-test-${Date.now()}`;
const received = [];
const receiver = createWebhookReceiver({ getSecret: () => signingSecret, failFirst: 1, log: (message) => {
  if (message.startsWith('{')) { const payload = JSON.parse(message); received.push(payload); console.log(`Received ${payload.event.type}: signature ${payload.signature}`); }
  else console.log(message);
} });
const port = Number(env.WEBHOOK_TEST_PORT ?? 9091);
const destination = env.WEBHOOK_RECEIVER_URL ?? `http://host.docker.internal:${port}/events`;
if (!['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(new URL(destination).hostname)) throw new Error('The test receiver must be local.');
async function api(path, method = 'GET', body) {
  const response = await fetch(`${control}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}. Check the running backend and local test configuration.`);
  if (path === '/api/auth/login') cookie = response.headers.get('set-cookie')?.split(';')[0];
  return response.status === 204 ? undefined : response.json();
}
async function waitForDelivery(eventId) {
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    const { deliveries } = await api(`/api/integration-deliveries?integrationId=${integrationId}`);
    const record = deliveries.find((d) => d.eventId === eventId);
    if (record?.status === 'delivered') return record;
    if (record?.status === 'failed') throw new Error(record.error ?? 'Webhook delivery failed.');
    await delay(300);
  }
  throw new Error('Delivery timed out. The gateway must be running and able to reach WEBHOOK_RECEIVER_URL.');
}
try {
  await new Promise((resolve, reject) => { receiver.once('error', reject); receiver.listen(port, env.WEBHOOK_TEST_HOST ?? '127.0.0.1', resolve); });
  await api('/api/auth/login', 'POST', { password: env.ADMIN_PASSWORD });
  const created = await api('/api/integrations', 'POST', { name: 'Local webhook smoke test', url: destination, allowPrivateNetwork: true, profileIds: [profileId], actions: ['block'] });
  integrationId = created.integration.id; signingSecret = created.signingSecret;
  assert.equal(typeof signingSecret, 'string');
  const { delivery } = await api(`/api/integrations/${integrationId}/test`, 'POST');
  const test = await waitForDelivery(delivery.eventId);
  assert.equal(test.lastStatus, 204); assert.equal(test.attempts, 2);
  const now = new Date().toISOString();
  await api('/api/profiles', 'POST', {
    id: profileId, name: profileId, description: 'Temporary local outgoing webhook test', model: 'local-rules',
    reviewThreshold: .5, blockThreshold: .8, failMode: 'closed', maxInputChars: 1000, timeoutMs: 1000,
    persistInputs: false, notifyOn: [], shadowProfileIds: [], detectors: [], createdAt: now, updatedAt: now,
    localRules: [{ id: 'webhook-test', name: 'Local test trigger', enabled: true, scope: 'all_text', match: 'contains', pattern: profileId, action: 'block', risk: 1 }],
  });
  profileCreated = true;
  // Gateway document caches refresh within one second.
  await delay(1100);
  const response = await fetch(`${gateway}/v1/classify`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GATEWAY_API_KEY}` }, body: JSON.stringify({ input: profileId, profile: profileId }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Local classification failed: HTTP ${response.status}. Use a gateway key allowed to select the test profile.`);
  const decision = await response.json(); assert.equal(decision.action, 'block'); assert.equal(decision.provider, 'local-rules');
  const delivered = await waitForDelivery(decision.id); assert.equal(delivered.lastStatus, 204);
  assert.deepEqual(received.map((r) => r.event.type), ['integration.test', 'decision.created']);
  assert.ok(received.every((r) => r.signature === 'verified'));
  console.log('PASS: signed test, automatic retry after HTTP 503, and a real local-rule decision delivered with HTTP 204.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (integrationId) await api(`/api/integrations/${integrationId}`, 'DELETE').catch(() => { console.error('Could not remove the temporary webhook. Remove “Local webhook smoke test” in the dashboard.'); process.exitCode = 1; });
  if (profileCreated) await api(`/api/profiles/${profileId}`, 'DELETE').catch(() => { console.error(`Could not remove temporary profile ${profileId}.`); process.exitCode = 1; });
  receiver.closeAllConnections();
  await new Promise((resolve) => receiver.close(resolve));
}

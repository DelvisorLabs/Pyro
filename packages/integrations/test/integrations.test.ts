import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";
import type { ClassificationEvent, StoredIntegration } from "@pyro/contracts";
import { encryptText, openDatabase } from "@pyro/storage";
import { decisionDeliveries, DeliveryWorker, isPublicAddress, sendHttp, signWebhook, validateDestination } from "../src/index.js";
const secret = "test-encryption-secret-for-pyro";
function integration(): StoredIntegration {
  return { id: randomUUID(), name: "Test", type: "webhook", enabled: true, actions: ["block"], profileIds: [], appIds: [], minimumRisk: .8,
    allowPrivateNetwork: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    destination: encryptText("https://receiver.example/events", secret), destinationHost: "receiver.example", signingSecret: encryptText("signing-key", secret) };
}
function event(): ClassificationEvent {
  return { id: randomUUID(), createdAt: new Date().toISOString(), profileId: "default", action: "block", verdict: "unsafe", risk: .9, confidence: .8,
    reason: "secret reason", detectors: [], model: "local-rules", provider: "local-rules", latencyMs: 2, queueMs: 0, inputHash: "hash", inputPreview: "private prompt", metadata: { secret: "metadata" }, labels: { token: "sensitive" }, appId: "support" };
}
test("filters events and excludes sensitive fields", () => {
  const i = integration(); const e = event(); const deliveries = decisionDeliveries(e, [i]);
  assert.equal(deliveries.length, 1);
  const payload = JSON.stringify(deliveries[0]!.payload);
  for (const text of ["private prompt", "metadata", "sensitive", "secret reason", "inputHash"]) assert.ok(!payload.includes(text));
  assert.equal(decisionDeliveries(e, [{ ...i, enabled: false }]).length, 0);
  assert.equal(decisionDeliveries(e, [{ ...i, appIds: ["other"] }]).length, 0);
  assert.equal(decisionDeliveries(e, [{ ...i, profileIds: ["other"] }]).length, 0);
  assert.equal(decisionDeliveries(e, [{ ...i, minimumRisk: .95 }]).length, 0);
});
test("signs deliveries, retries a receiver failure, survives worker recreation, and deduplicates events", async () => {
  const db = await openDatabase(`memory://${randomUUID()}`); const i = integration(); const e = event();
  await db.document("integrations", () => [i]).write([i]);
  const ds = decisionDeliveries(e, [i]);
  await db.events.append(e, ds); await db.events.append(e, ds);
  assert.equal((await db.deliveries.list()).length, 1);
  let observed = false;
  const worker = new DeliveryWorker(db, secret, async (_url, body, headers) => {
    assert.equal(headers["x-pyro-signature"], signWebhook("signing-key", headers["x-pyro-timestamp"]!, body));
    assert.equal(headers["x-pyro-delivery-id"], ds[0]!.id); observed = true;
    return { status: 503 };
  });
  await worker.tick(); assert.ok(observed);
  const pending = (await db.deliveries.list())[0]!;
  assert.equal(pending.status, "pending"); assert.equal(pending.attempts, 1);
  const claimed = await db.deliveries.claim(1, new Date(Date.now() + 120_000));
  await db.deliveries.finish({ ...claimed[0]!, status: "pending", nextAttemptAt: new Date(0).toISOString() });
  await new DeliveryWorker(db, secret, async () => ({ status: 204 })).tick();
  assert.equal((await db.deliveries.list())[0]!.status, "delivered");
});
test("terminal errors, disabled destinations, leases, and manual retries", async () => {
  const db = await openDatabase(`memory://${randomUUID()}`); const i = integration();
  await db.document("integrations", () => [i]).write([i]);
  await db.events.append(event(), decisionDeliveries(event(), [i]));
  const [first, second] = await Promise.all([db.deliveries.claim(), db.deliveries.claim()]);
  assert.equal(first.length + second.length, 1);
  const old = first[0] ?? second[0]!;
  const recovered = (await db.deliveries.claim(1, new Date(Date.now() + 31_000)))[0]!;
  await db.deliveries.finish({ ...old, status: "delivered" });
  assert.equal((await db.deliveries.list())[0]!.status, "delivering");
  await db.deliveries.finish({ ...recovered, status: "pending", nextAttemptAt: new Date(0).toISOString() });
  await new DeliveryWorker(db, secret, async () => ({ status: 400 })).tick();
  assert.equal((await db.deliveries.list())[0]!.status, "failed");
  assert.equal(await db.deliveries.retry(old.id), true);
  assert.equal(await db.deliveries.retry(old.id), false);
  await db.document("integrations", () => [i]).write([{ ...i, enabled: false }]);
  await new DeliveryWorker(db, secret, async () => { throw new Error("must not call"); }).tick();
  assert.match((await db.deliveries.list())[0]!.error!, /disabled/);
});
test("validates destinations and blocks private addresses including mapped IPv6", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fc00::1", "0.0.0.0"]) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.throws(() => validateDestination("http://example.com", false));
  assert.throws(() => validateDestination("https://user:pass@example.com", false));
  await assert.rejects(sendHttp(new URL("https://127.0.0.1/events"), "{}", {}, false), /public address/);
});
test("local HTTP transport delivers exact bytes and does not follow redirects", async (t) => {
  let body = "";
  const server = http.createServer((req, res) => { req.on("data", (chunk) => { body += chunk; }); req.on("end", () => { res.writeHead(302, { Location: "http://127.0.0.1:1/never", "Retry-After": "3" }); res.end(); }); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as { port: number };
  const result = await sendHttp(new URL(`http://localhost:${address.port}`), '{"hello":"world"}', {}, true);
  assert.equal(body, '{"hello":"world"}'); assert.equal(result.status, 302); assert.equal(result.retryAfterMs, 3_000);
});

test("unsupported persisted destinations never enqueue or send, including old pending deliveries", async () => {
  const db = await openDatabase(`memory://${randomUUID()}`);
  const original = integration();
  const removed = { ...original, type: "removed-adapter" } as unknown as StoredIntegration;
  assert.equal(decisionDeliveries(event(), [removed]).length, 0);
  const e = event();
  await db.events.append(e, decisionDeliveries(e, [original]));
  await db.document("integrations", () => [removed]).write([removed]);
  let sent = false;
  await new DeliveryWorker(db, secret, async () => { sent = true; return { status: 204 }; }).tick();
  assert.equal(sent, false);
  assert.equal((await db.deliveries.list())[0]?.status, "failed");
});

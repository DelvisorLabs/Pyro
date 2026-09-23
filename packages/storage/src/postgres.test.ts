import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ClassificationEvent } from "@pyro/contracts";
import { openDatabase } from "./index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL event queries, aggregates, and cursors", { skip: !databaseUrl }, async () => {
  const database = await openDatabase(databaseUrl!);
  const suffix = randomUUID();
  const appId = `test-${suffix}`;
  const firstAt = new Date(Date.now() - 2_000).toISOString();
  const secondAt = new Date(Date.now() - 1_000).toISOString();
  const event = (id: string, createdAt: string, action: "allow" | "block", labels: Record<string, string>): ClassificationEvent => ({
    id, requestId: `request-${id}`, createdAt, traceId: randomUUID().replaceAll("-", ""), profileId: "default",
    verdict: action === "block" ? "unsafe" : "safe", action, risk: action === "block" ? .95 : .05,
    confidence: .9, reason: "Storage integration test", detectors: [{ id: "test", name: "Test", probability: .9, weightedProbability: .9 }],
    model: "test", provider: "mock", latencyMs: 12, queueMs: 1, timings: { providerMs: 10, policyMs: 2, totalMs: 12 },
    usage: { inputTokens: 4, outputTokens: 1, cost: { amount: .001, currency: "USD" } }, labels,
    inputHash: randomUUID().replaceAll("-", ""), inputBytes: 12, appId, appName: "Storage test", apiKeyName: "test-key",
  });
  const first = event(`${suffix}-1`, firstAt, "allow", { tenant: "alpha" });
  const second = event(`${suffix}-2`, secondAt, "block", { tenant: "beta", session_url: "https://example.test/2" });
  await database.events.append(first);
  await database.events.append(second);

  const filtered = await database.events.query({ appId, labelKey: "tenant", labelValue: "bet", limit: 10 });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.events[0]?.id, second.id);
  assert.ok(filtered.labelKeys.includes("session_url"));
  const byRequestId = await database.events.query({ appId, search: second.requestId });
  assert.equal(byRequestId.events[0]?.id, second.id);

  const after = await database.events.readAfter({ createdAt: first.createdAt, id: first.id }, 10);
  assert.ok(after.some((candidate) => candidate.id === second.id));

  const usage = await database.events.usage({ from: new Date(Date.now() - 60_000).toISOString(), to: new Date().toISOString(), bucketMs: 10_000, buckets: 6, appId });
  assert.equal(usage.totals.requests, 2);
  assert.equal(usage.totals.blocked, 1);
  assert.equal(usage.totals.inputTokens, 8);
  assert.equal(usage.totals.costs[0]?.currency, "USD");

  const overview = await database.events.overview();
  assert.ok(overview.totals.requests >= 2);
  assert.equal(overview.timeline.length, 12);
  await database.close();
});

test("PostgreSQL atomically persists deliveries and leases them across workers", { skip: !databaseUrl }, async () => {
  const db = await openDatabase(databaseUrl!);
  const { randomUUID } = await import("node:crypto");
  const now = new Date().toISOString(); const eventId = randomUUID(); const integrationId = randomUUID();
  const event: ClassificationEvent = { id: eventId, createdAt: now, profileId: "default", action: "block", verdict: "unsafe", risk: .9, confidence: .9, reason: "test", detectors: [], model: "test", provider: "test", latencyMs: 1, queueMs: 0, inputHash: "hash" };
  const delivery: import("@pyro/contracts").Delivery = { id: randomUUID(), integrationId, eventId, createdAt: now, status: "pending", attempts: 0, nextAttemptAt: now, payload: { id: eventId, type: "decision.created", createdAt: now, data: { id: eventId, profileId: "default", action: "block", verdict: "unsafe", risk: .9, provider: "test", latencyMs: 1, failed: false } } };
  await db.events.append(event, [delivery]); await db.events.append(event, [delivery]);
  assert.equal((await db.deliveries.list(integrationId)).length, 1);
  const [left, right] = await Promise.all([db.deliveries.claim(100), db.deliveries.claim(100)]);
  assert.equal([...left, ...right].filter((d) => d.id === delivery.id).length, 1);
  const old = [...left, ...right].find((d) => d.id === delivery.id)!;
  const recovered = (await db.deliveries.claim(100, new Date(Date.now() + 31_000))).find((d) => d.id === delivery.id)!;
  await db.deliveries.finish({ ...old, status: "delivered" });
  assert.equal((await db.deliveries.list(integrationId))[0]!.status, "delivering");
  await db.deliveries.finish({ ...recovered, status: "failed" });
  assert.equal(await db.deliveries.retry(delivery.id), true);
  const retry = (await db.deliveries.list(integrationId))[0]!;
  assert.equal(retry.status, "pending"); assert.equal(retry.attempts, 0);
  const claimed = (await db.deliveries.claim(100)).find((d) => d.id === delivery.id)!;
  await db.deliveries.finish({ ...claimed, status: "delivered" });
  // An invalid outbox row must roll back the event as well.
  const invalidId = randomUUID();
  await assert.rejects(db.events.append({ ...event, id: invalidId }, [{ ...delivery, id: randomUUID(), eventId: invalidId, createdAt: "invalid date" }]));
  assert.equal(await db.events.findById(invalidId), undefined);
  await db.close();
});

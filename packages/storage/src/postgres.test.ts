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

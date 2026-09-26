import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ClassificationEvent, Delivery } from "@pyro/contracts";
import { openDatabase } from "./index.js";
for (const url of [`memory://replay-${randomUUID()}`, ...(process.env.TEST_DATABASE_URL ? [process.env.TEST_DATABASE_URL] : [])]) {
  test(`first event and its webhook outbox are authoritative: ${url.startsWith("memory") ? "memory" : "PostgreSQL"}`, async (t) => {
    const db = await openDatabase(url); t.after(() => db.close());
    const id = randomUUID(), integrationId = randomUUID(), at = new Date().toISOString();
    const event: ClassificationEvent = { id, appId: id, profileId: "default", createdAt: at, action: "allow", verdict: "safe", risk: 0, confidence: 1, reason: "first", detectors: [], model: "local", provider: "local-rules", latencyMs: 0, queueMs: 0, inputHash: "hash" };
    const delivery: Delivery = { id: randomUUID(), integrationId, eventId: id, createdAt: at, status: "pending", attempts: 0, nextAttemptAt: at, payload: { id, type: "decision.created", createdAt: at, data: { id, action: "allow" } } };
    await db.events.append(event, [delivery]);
    await db.events.append({ ...event, action: "block", reason: "late worker" }, [{ ...delivery, id: randomUUID() }]);
    assert.deepEqual(await db.events.findById(id), event);
    assert.equal((await db.deliveries.list(integrationId)).length, 1);
  });
}

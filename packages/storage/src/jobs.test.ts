import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { openDatabase, DurableJobs, consumeQuota } from "./index.js";
for (const kind of ["memory", "postgres"] as const) test(`${kind}: durable recovery, fencing, idempotency, fairness, encryption and shared quotas`, { skip: kind === "postgres" && !process.env.TEST_DATABASE_URL }, async () => {
  const db = await openDatabase(kind === "memory" ? `memory://${randomUUID()}` : process.env.TEST_DATABASE_URL!);
  try {
    const name = `test_jobs_${randomUUID().replaceAll("-", "")}`;
    const first = new DurableJobs(db, "a-secret-longer-than-sixteen", name, 10, 50);
    const second = new DurableJobs(db, "a-secret-longer-than-sixteen", name, 10, 50);
    const id = randomUUID(); const appId = randomUUID();
    const data = { id, appId, input: { prompt: "sensitive-example" }, fingerprint: "one", idempotencyKey: "one" };
    assert.equal((await first.enqueue(data)).id, (await second.enqueue({ ...data, id: randomUUID() })).id);
    await assert.rejects(second.enqueue({ ...data, fingerprint: "different" }));
    assert.ok(!JSON.stringify(await db.document(name, () => ({})).read()).includes("sensitive-example"));
    const stale = (await first.claim())!;
    await new Promise((r) => setTimeout(r, 70));
    const recovered = (await second.claim())!;
    assert.equal(recovered.id, id); assert.equal(recovered.attempts, 2);
    assert.deepEqual(second.input(recovered), data.input);
    assert.equal(await first.finish(stale, { stale: true }), false);
    assert.equal(await second.finish(recovered, { ok: true }), true);
    assert.equal((await first.get(id, appId))!.input, undefined);
    assert.equal(await first.get(id, "other-app"), undefined);
    await first.enqueue({ id: "a1", appId: "a", input: 1, fingerprint: "a1" });
    await first.enqueue({ id: "a2", appId: "a", input: 2, fingerprint: "a2" });
    await first.enqueue({ id: "b1", appId: "b", input: 3, fingerprint: "b1" });
    const a = (await first.claim())!, b = (await second.claim())!;
    assert.notEqual(a.appId, b.appId, "fair scheduling gives each application a turn");
    const limits = [{ id: `app:${appId}`, limit: 3 }];
    const quota = await Promise.all(Array.from({ length: 10 }, () => consumeQuota(db, limits)));
    assert.equal(quota.filter((q) => q.allowed).length, 3);
  } finally { await db.close(); }
});

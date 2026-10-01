import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { openDatabase } from "./index.js";
import type { ClassificationEvent } from "@pyro/contracts";
const url = process.env.TEST_DATABASE_URL;
for (const postgres of [false, true]) test(`organization storage isolation (${postgres ? "PostgreSQL RLS" : "memory"})`, { skip: postgres && !url }, async () => {
  const connection = postgres ? url! : `memory://${randomUUID()}`;
  const left = await openDatabase(connection, `a-${randomUUID()}`), right = await openDatabase(connection, `b-${randomUUID()}`);
  try {
    await Promise.all([left.document("profiles", () => []).write(["left"]), right.document("profiles", () => []).write(["right"])]);
    assert.deepEqual(await left.document("profiles", () => []).read(), ["left"]); assert.deepEqual(await right.document("profiles", () => []).read(), ["right"]);
    const event: ClassificationEvent = { id: "same-event", createdAt: new Date().toISOString(), profileId: "same-policy", appId: "same-app", action: "allow", verdict: "safe", risk: 0, confidence: 1, reason: "left", detectors: [], model: "test", provider: "test", latencyMs: 1, queueMs: 0, inputHash: "left" };
    await Promise.all([left.events.append(event), right.events.append({ ...event, reason: "right" })]);
    assert.equal((await left.events.findById(event.id))?.reason, "left"); assert.equal((await right.events.findById(event.id))?.reason, "right");
    assert.equal((await left.events.query({ search: "right" })).total, 0);
    await Promise.all(Array.from({ length: 30 }, async (_, index) => { const db = index % 2 ? left : right; const expected = index % 2 ? "left" : "right"; assert.equal((await db.events.readRecent())[0]?.reason, expected); }));
    await left.prune(new Date(Date.now() + 10000).toISOString()); assert.equal((await right.events.readRecent()).length, 1);
    if (postgres) { const pool = new Pool({ connectionString: connection }); const client = await pool.connect();
      try { await client.query("BEGIN"); await client.query("SET LOCAL ROLE pyro_tenant"); assert.equal((await client.query("SELECT * FROM pyro_events")).rowCount, 0); await client.query("ROLLBACK");
        await client.query("BEGIN"); await client.query("SET LOCAL ROLE pyro_tenant"); await client.query("SELECT set_config('pyro.organization_id', 'tenant-a', true)");
        await assert.rejects(client.query("INSERT INTO pyro_documents (org_id, key, value) VALUES ('tenant-b', 'forged', '{}')"), /row-level security/);
        await client.query("ROLLBACK"); }
      finally { client.release(); await pool.end(); }
    }
  } finally { await left.close(); await right.close(); }
});

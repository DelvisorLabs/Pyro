import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultProfile } from "@pyro/contracts";
import { openDatabase, PolicyStore, revisionOf, type PolicyRecord } from "./index.js";

test("policy saves are atomic, immutable, hash stable and reject concurrent stale edits", async () => {
  const db = await openDatabase(`memory://policies-${crypto.randomUUID()}`);
  const store = new PolicyStore(db.document<PolicyRecord[]>("profiles", () => [createDefaultProfile()]));
  await store.initialize();
  const original = (await store.read())[0]!;
  const results = await Promise.allSettled(["First", "Second"].map((name) => store.update((current) => [{ ...original, name }], name)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  let record = (await store.records.read())[0]!;
  assert.equal(record.revisions!.length, 2);
  assert.deepEqual(revisionOf(record, 1), original);
  const active = (await store.read())[0]!;
  const draft = await store.draft(active.id, { ...active, description: "Draft only" }, active.revision!, "alice");
  record = (await store.records.read())[0]!;
  assert.equal(revisionOf(record, draft.revision), undefined, "drafts cannot be executed");
  assert.equal((await store.read())[0]!.contentHash, active.contentHash);
  await store.update(() => [{ ...original, revision: active.revision }], "rollback");
  record = (await store.records.read())[0]!;
  assert.equal(record.contentHash, original.contentHash);
  assert.equal(record.revision, 4);
  assert.equal(record.revisions![1]!.actorId, "First");
  await db.close();
});

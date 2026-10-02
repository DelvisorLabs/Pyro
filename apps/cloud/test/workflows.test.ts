import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "@pyro/storage";
import { CloudStore } from "../src/store.js";
import { buildCloud } from "../src/app.js";
import { config, account } from "./fixtures.js";

test("drafts persist without publication, reject conflicts and remain scoped to their author", async () => {
  const cfg = config(), app = await buildCloud(cfg);
  try {
    const a = await account(app, cfg, "draft-a@example.test"), b = await account(app, cfg, "draft-b@example.test");
    const profile = (await app.inject({ url: "/api/profiles", headers: a.headers })).json().profiles[0];
    const id = randomUUID(), payload = { profile: { ...profile, id: "unpublished", name: "Unpublished" }, isNew: true, appId: "default" };
    const save = await app.inject({ method: "PUT", url: `/api/policy-drafts/${id}`, headers: a.headers, payload }); assert.equal(save.statusCode, 200, save.body);
    assert.equal((await app.inject({ url: "/api/profiles", headers: a.headers })).json().profiles.length, 1);
    assert.equal((await app.inject({ url: "/api/policy-drafts", headers: a.headers })).json().drafts[0].profile.name, "Unpublished");
    assert.equal((await app.inject({ url: "/api/policy-drafts", headers: b.headers })).json().drafts.length, 0);
    assert.equal((await app.inject({ method: "PUT", url: `/api/policy-drafts/${id}`, headers: a.headers, payload })).statusCode, 409);
    assert.equal((await app.inject({ method: "PUT", url: `/api/policy-drafts/${id}`, headers: a.headers, payload: { ...payload, expectedUpdatedAt: save.json().draft.updatedAt } })).statusCode, 200);
  } finally { await app.close(); }
});
test("credit estimates are free, caps prevent calls, and previews report actual source usage", async () => {
  const cfg = config(), app = await buildCloud(cfg);
  try {
    const a = await account(app, cfg, "estimate@example.test"), profile = (await app.inject({ url: "/api/profiles", headers: a.headers })).json().profiles[0];
    const payload = { profile, input: "Hello", appId: "default", allowPaid: true };
    const estimate = await app.inject({ method: "POST", url: "/api/playground/estimate", headers: a.headers, payload }); assert.equal(estimate.statusCode, 200, estimate.body);
    assert.ok(estimate.json().maximumCredits > 0);
    assert.equal((await app.inject({ url: "/api/billing", headers: a.headers })).json().consumed, 0);
    const denied = await app.inject({ method: "POST", url: "/api/playground", headers: a.headers, payload: { ...payload, maxCredits: 0 } }); assert.equal(denied.statusCode, 400, denied.body);
    assert.equal((await app.inject({ url: "/api/billing", headers: a.headers })).json().consumed, 0);
    const result = await app.inject({ method: "POST", url: "/api/playground", headers: a.headers, payload: { ...payload, maxCredits: estimate.json().maximumCredits } }); assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().creditsConsumed, estimate.json().maximumCredits);
    const usage = (await app.inject({ url: "/api/billing/usage", headers: a.headers })).json();
    assert.equal(usage.sources.playground.credits, result.json().creditsConsumed);
    const apps = (await app.inject({ url: "/api/apps", headers: a.headers })).json().apps;
    assert.equal(apps[0].activeKeyCount, 1, "Only the user-created key is counted, not the internal playground key");
  } finally { await app.close(); }
});
test("retained case access respects application scope, raw-input permission and deletion", async () => {
  const cfg = config(), app = await buildCloud(cfg);
  try {
    const a = await account(app, cfg, "cases-a@example.test"), b = await account(app, cfg, "cases-b@example.test");
    const dataset = await app.inject({ method: "POST", url: "/api/datasets", headers: a.headers, payload: { appId: "default", name: "Cases", jsonl: JSON.stringify({ id: "one", input: "private test", expected: "allow" }), retentionDays: 1, retainInputs: true } }); assert.equal(dataset.statusCode, 201, dataset.body);
    const url = `/api/datasets/${dataset.json().dataset.id}/cases`;
    assert.equal((await app.inject({ url, headers: a.headers })).json().cases[0].input, "private test");
    assert.equal((await app.inject({ url, headers: b.headers })).statusCode, 404);
    const db = await openDatabase(cfg.databaseUrl, "platform"), store = new CloudStore(db, cfg);
    await store.identity.update(s => { s.memberships.push({ orgId: a.orgId, userId: b.userId, role: "viewer", appIds: ["default"], rawPreviews: false }); return s; });
    assert.equal((await app.inject({ url, headers: { ...b.headers, "x-pyro-organization": a.orgId } })).statusCode, 403);
    await app.inject({ method: "DELETE", url: `/api/datasets/${dataset.json().dataset.id}`, headers: a.headers });
    assert.equal((await app.inject({ url, headers: a.headers })).statusCode, 404); await db.close();
  } finally { await app.close(); }
});

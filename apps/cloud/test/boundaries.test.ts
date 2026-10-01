import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { openDatabase } from "@pyro/storage";
import { createDefaultApp, createDefaultProfile, createDefaultProviderSettings } from "@pyro/contracts";
import { evaluatePolicy, PolicyExecutionDenied } from "@pyro/classifiers";
import { buildCloud } from "../src/app.js";
import { CloudStore } from "../src/store.js";
import { Billing } from "../src/billing.js";
import { account, config } from "./fixtures.js";

function stream(url: string, headers?: Record<string, string>, key?: string) {
  const socket = new WebSocket(url, { headers }), messages: any[] = [];
  const ready = new Promise<void>((resolve, reject) => {
    socket.on("error", reject);
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()); messages.push(message);
      if (message.type === "auth.required") socket.send(JSON.stringify({ type: "auth", apiKey: key }));
      if (["connected", "auth.ok"].includes(message.type)) resolve();
    });
    socket.once("close", () => reject(new Error("Closed before authentication")));
  });
  return { socket, messages, ready };
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("live SDK/dashboard streams isolate organizations and close after revocation", { timeout: 15000 }, async () => {
  const cfg = config(), app = await buildCloud(cfg); const sockets: WebSocket[] = [];
  try {
    const a = await account(app, cfg, "stream-a@example.test"), b = await account(app, cfg, "stream-b@example.test");
    const url = (await app.listen({ host: "127.0.0.1", port: 0 })).replace("http:", "ws:");
    const sa = stream(`${url}/v1/events`, undefined, a.key), sb = stream(`${url}/v1/events`, undefined, b.key);
    const dashboard = stream(`${url}/ws?organization=${a.orgId}`, a.headers);
    sockets.push(sa.socket, sb.socket, dashboard.socket); await Promise.all([sa.ready, sb.ready, dashboard.ready]);
    const decision = await app.inject({ method: "POST", url: "/v1/classify", headers: { authorization: `Bearer ${a.key}` }, payload: { input: "Hello" } });
    for (let i = 0; i < 20 && !sa.messages.some((m) => m.type === "decision"); i++) await delay(100);
    assert.equal(sa.messages.find((m) => m.type === "decision")?.data.id, decision.json().id);
    for (let i = 0; i < 20 && !dashboard.messages.some((m) => m.type === "decision"); i++) await delay(100);
    assert.equal(dashboard.messages.find((m) => m.type === "decision")?.data.id, decision.json().id);
    assert.equal(sb.messages.filter((m) => m.type === "decision").length, 0);
    const keyClosed = once(sa.socket, "close"); await app.inject({ method: "DELETE", url: `/api/keys/${a.keyId}`, headers: a.headers });
    assert.equal((await keyClosed)[0], 1008);
    const userClosed = once(dashboard.socket, "close"); await app.inject({ method: "POST", url: "/api/auth/logout", headers: a.headers });
    assert.equal((await userClosed)[0], 1008);
  } finally { for (const socket of sockets) socket.terminate(); await app.close(); }
});

test("every retry reserves upstream spend; failures in metering cannot fail open", async () => {
  const cfg = config(), app = await buildCloud(cfg);
  let calls = 0;
  const upstream = createServer((_req, res) => { calls++; res.setHeader("content-type", "application/json"); res.writeHead(503); res.end('{"error":"retry"}'); });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  try {
    const a = await account(app, cfg, "retry@example.test"), db = await openDatabase(cfg.databaseUrl, "platform");
    cfg.providerEndpoint = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
    const billing = new Billing(new CloudStore(db, cfg));
    const input = { id: "retry-decision", traceId: "test", envelope: { input: "hello" }, profile: { ...createDefaultProfile(), failureMode: "open" as const }, provider: { ...createDefaultProviderSettings(), mode: "jev" as const, endpoint: cfg.providerEndpoint, maxRetries: 1, retryBackoffMs: 1 }, firewallApp: createDefaultApp(), apiKey: async () => "fake-provider-key", providerHooks: billing.hooks(a.orgId) };
    await evaluatePolicy(input); assert.equal(calls, 2);
    const state = await billing.meter.read(); assert.equal(state.attempts, 2); assert.ok(state.reservedMicros > 0);
    assert.equal(state.entries.filter((e) => e.kind === "usage").length, 1);
    cfg.monthlyProviderBudgetMicros = state.reservedMicros;
    await assert.rejects(evaluatePolicy({ ...input, id: "budget-denial" }), PolicyExecutionDenied); assert.equal(calls, 2);
    await assert.rejects(evaluatePolicy({ ...input, providerHooks: { before: async () => { throw new Error("database unavailable"); } } }), PolicyExecutionDenied); assert.equal(calls, 2);
    // Recording errors occur after classification and must not invoke the provider again.
    let writes = 0;
    await assert.rejects(evaluatePolicy({ ...input, provider: { ...input.provider, mode: "mock" }, providerHooks: { before: async () => {}, after: async () => { writes++; throw new Error("ledger unavailable"); } } }), PolicyExecutionDenied);
    assert.equal(writes, 1); await db.close();
  } finally { upstream.closeAllConnections(); await new Promise<void>((resolve) => upstream.close(() => resolve())); await app.close(); }
});

test("cloud rejects model overrides and scopes datasets, evaluations, exports and resource caps", async () => {
  const cfg = config(), app = await buildCloud(cfg);
  try {
    const a = await account(app, cfg, "data-a@example.test"), b = await account(app, cfg, "data-b@example.test");
    assert.equal((await app.inject({ method: "DELETE", url: "/api/keys/cloud%2dplayground", headers: a.headers })).statusCode, 403);
    assert.equal((await app.inject({ url: "/api/overview", headers: a.headers })).json().gateway.status, "ok");
    assert.equal((await app.inject({ method: "POST", url: "/v1/classify", headers: { authorization: `Bearer ${a.key}` }, payload: { input: "Hello", metadata: { tooLarge: "x".repeat(5000) } } })).statusCode, 413);
    const platform = await openDatabase(cfg.databaseUrl, "platform"), cloudStore = new CloudStore(platform, cfg);
    await cloudStore.eventBudget(a.orgId, 100);
    await platform.document("cloud_event_budget", () => ({})).write({ month: new Date().toISOString().slice(0, 7), total: 500_000_000, organizations: { [a.orgId]: 500_000_000 } });
    const storageDenied = await app.inject({ method: "POST", url: "/v1/classify", headers: { authorization: `Bearer ${a.key}` }, payload: { input: "Hello" } }); assert.equal(storageDenied.statusCode, 429, storageDenied.body);
    await platform.document("cloud_event_budget", () => ({})).write({ month: new Date().toISOString().slice(0, 7), total: 0, organizations: {} }); await platform.close();
    const profile = (await app.inject({ url: "/api/profiles", headers: a.headers })).json().profiles[0];
    const changed = await app.inject({ method: "PUT", url: `/api/profiles/${profile.id}`, headers: a.headers, payload: { ...profile, model: "customer-model" } }); assert.equal(changed.statusCode, 400, changed.body);
    const draft = await app.inject({ method: "POST", url: `/api/profiles/${profile.id}/revisions`, headers: a.headers, payload: { profile: { ...profile, model: "customer-model" }, expectedRevision: profile.revision } }); assert.ok(draft.statusCode >= 400);
    const dataset = await app.inject({ method: "POST", url: "/api/datasets", headers: a.headers, payload: { appId: "default", name: "Private samples", jsonl: JSON.stringify({ id: "case", input: "private-org-a", expected: "allow" }), retentionDays: 1, retainInputs: true } }); assert.equal(dataset.statusCode, 201, dataset.body);
    const run = await app.inject({ method: "POST", url: "/api/evaluations", headers: a.headers, payload: { datasetId: dataset.json().dataset.id, policies: [{ id: profile.id, revision: profile.revision }], allowPaid: true } }); assert.equal(run.statusCode, 202, run.body);
    assert.equal((await app.inject({ url: `/api/evaluations/${run.json().run.id}`, headers: b.headers })).statusCode, 404);
    assert.deepEqual((await app.inject({ url: "/api/datasets", headers: b.headers })).json().datasets, []);
    const directExport = await app.inject({ url: `/api/profiles/default/export?organization=${a.orgId}`, headers: { cookie: a.headers.cookie } }); assert.equal(directExport.statusCode, 200);
    assert.equal((await app.inject({ url: `/api/profiles/default/export?organization=${b.orgId}`, headers: { cookie: a.headers.cookie } })).statusCode, 403);
    const exportA = await app.inject({ url: "/api/organizations/export", headers: a.headers }); assert.ok(exportA.body.includes("private-org-a")); assert.ok(!exportA.body.includes("passwordHash")); assert.ok(!exportA.body.includes(a.key));
    assert.ok(!(await app.inject({ url: "/api/organizations/export", headers: b.headers })).body.includes("private-org-a"));
    const db = await openDatabase(cfg.databaseUrl, a.orgId);
    await db.document("apps", () => []).write(Array.from({ length: 20 }, (_, i) => ({ ...createDefaultApp(), id: i ? `app-${i}` : "default", name: `App ${i}` })));
    const cap = await app.inject({ method: "POST", url: "/api/apps", headers: a.headers, payload: { ...createDefaultApp(), name: "Over capacity" } }); assert.equal(cap.statusCode, 409, cap.body);
    await db.close();
  } finally { await app.close(); }
});

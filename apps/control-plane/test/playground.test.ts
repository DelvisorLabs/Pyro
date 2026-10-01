import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openDatabase, policyHash } from "@pyro/storage";
import { createDefaultProviderSettings, type Profile, type UserRecord } from "@pyro/contracts";
import { buildControlPlane } from "../src/app.js";
import { parseProfileYaml } from "../src/profile-files.js";

test("draft preview, export, publication and regression datasets preserve policy boundaries", async (t) => {
  const cfg = { host: "127.0.0.1", port: 0, databaseUrl: `memory://playground-${randomUUID()}`, adminPassword: "correct-horse-battery-staple", controlPlaneSecret: "control-plane-test-secret", gatewayInternalUrl: "http://127.0.0.1:1", gatewayApiKey: "test-key", typesafeEndpoint: "https://api.typesafe.ai/v1/systemone", typesafeModel: "jev-latest" };
  const app = await buildControlPlane(cfg); t.after(() => app.close());
  const db = await openDatabase(cfg.databaseUrl); t.after(() => db.close());
  const profile = parseProfileYaml(await readFile(new URL("../../../profiles/support-workflow.yaml", import.meta.url), "utf8"));
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: cfg.adminPassword } });
  const headers = { cookie: login.headers["set-cookie"]!.split(";")[0]! };
  const post = (url: string, payload: object) => app.inject({ method: "POST", url, headers, payload });
  const body = { profile, appId: "default", input: "How do I change my Northstar billing plan?" };
  assert.equal((await app.inject({ method: "POST", url: "/api/playground", payload: body })).statusCode, 401);
  assert.equal((await post("/api/playground", body)).statusCode, 400, "provider consent required before executing semantic policy");
  await db.document("provider_settings", createDefaultProviderSettings).update((p) => ({ ...p, mode: "mock" }));
  const preview = await post("/api/playground", body); assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().action, "allow"); assert.equal(preview.json().preview, true); assert.equal(preview.json().policyHash, policyHash(profile));
  assert.equal((await db.events.readRecent(10)).length, 0, "preview is not a retained event");
  assert.equal((await app.inject({ url: "/api/profiles", headers })).json().profiles.length, 1, "preview cannot publish");
  assert.equal((await post("/api/playground", { ...body, profile: { ...profile, maxInputChars: 128 }, input: "x".repeat(129) })).statusCode, 413);
  assert.equal((await post("/api/playground", { ...body, appId: "missing" })).statusCode, 400);
  const exported = await post("/api/playground/export", { profile }); assert.equal(exported.statusCode, 200);
  assert.equal(policyHash(parseProfileYaml(exported.json().yaml)), policyHash(profile));
  const published = (await post("/api/profiles", profile)).json().profile as Profile;
  const saved = await post(`/api/profiles/${published.id}/revisions`, { profile: { ...published, pipeline: { ...published.pipeline, onUncertain: "block" } }, expectedRevision: published.revision });
  assert.equal(saved.statusCode, 201); const active = (await app.inject({ url: "/api/profiles", headers })).json().profiles.find((p: Profile) => p.id === published.id);
  assert.equal(active.pipeline.onUncertain, "review", "saving a draft keeps the published policy");
  const dataset = await post("/api/datasets", { appId: "default", name: "Playground regression", jsonl: JSON.stringify({ id: "case-1", input: body.input, expected: "allow" }), retentionDays: 7, retainInputs: true });
  assert.equal(dataset.statusCode, 201);
  assert.ok(!JSON.stringify(await db.document("evaluation_datasets", () => []).read()).includes(body.input));
  const run = await post("/api/evaluations", { datasetId: dataset.json().dataset.id, policies: [{ id: published.id, revision: published.revision }] });
  assert.equal(run.statusCode, 202, run.body);
  let status;
  for (let i = 0; i < 100; i++) { status = (await app.inject({ url: `/api/evaluations/${run.json().run.id}`, headers })).json().run; if (["complete", "failed"].includes(status.status)) break; await new Promise((resolve) => setTimeout(resolve, 25)); }
  assert.equal(status.status, "complete"); assert.equal(status.rows[0].decision.action, "allow");
  await db.document<UserRecord[]>("users", () => []).update((users) => users.map((u) => ({ ...u, role: "viewer", appIds: ["default"] })));
  assert.equal((await post("/api/playground", body)).statusCode, 403, "viewers cannot run draft policies");
  assert.equal((await post("/api/playground/export", { profile })).statusCode, 403);
});

test("concurrent draft tests have an atomic two-request admission cap", async (t) => {
  let calls = 0, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; }); t.after(() => release());
  const cfg = { host: "127.0.0.1", port: 0, databaseUrl: `memory://playground-load-${randomUUID()}`, adminPassword: "correct-horse-battery-staple", controlPlaneSecret: "control-plane-test-secret", gatewayInternalUrl: "http://127.0.0.1:1", gatewayApiKey: "test-key", typesafeEndpoint: "https://api.typesafe.ai/v1/systemone", typesafeModel: "jev-latest", providerHooks: { before: async () => { calls++; await gate; } } };
  const app = await buildControlPlane(cfg); t.after(() => app.close()); const db = await openDatabase(cfg.databaseUrl); t.after(() => db.close());
  await db.document("provider_settings", createDefaultProviderSettings).update((p) => ({ ...p, mode: "mock" }));
  const profile = parseProfileYaml(await readFile(new URL("../../../profiles/support-workflow.yaml", import.meta.url), "utf8"));
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: cfg.adminPassword } });
  const request = () => app.inject({ method: "POST", url: "/api/playground", headers: { cookie: login.headers["set-cookie"]!.split(";")[0]! }, payload: { profile, appId: "default", input: "company request" } });
  const pending = [request(), request()];
  for (let i = 0; i < 100 && calls < 2; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  try { assert.equal(calls, 2); assert.equal((await request()).statusCode, 429); }
  finally { release(); await Promise.all(pending); }
});

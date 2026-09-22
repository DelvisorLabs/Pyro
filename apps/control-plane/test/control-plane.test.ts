import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createDefaultProfile, type ClassificationEvent, type Profile } from "@pyro/contracts";
import { openDatabase } from "@pyro/storage";
import { buildControlPlane } from "../src/app.js";

test("updates the active policy directly", async () => {
  const databaseUrl = `memory://control-${randomUUID()}`;
  const app = await buildControlPlane({
    host: "127.0.0.1",
    port: 0,
    databaseUrl,
    adminPassword: "correct-horse-battery-staple",
    controlPlaneSecret: "control-plane-test-secret",
    gatewayInternalUrl: "http://127.0.0.1:1",
    gatewayApiKey: "test-key",
    typesafeEndpoint: "https://api.typesafe.ai/v1/systemone",
    typesafeModel: "jev-latest",
  });
  const rejected = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "wrong-password" } });
  assert.equal(rejected.statusCode, 401);
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "correct-horse-battery-staple" } });
  assert.equal(login.statusCode, 200);
  const cookie = login.headers["set-cookie"]?.split(";")[0];
  assert.ok(cookie);
  const initial = await app.inject({ method: "GET", url: "/api/profiles", headers: { cookie } });
  const profile = initial.json<{ profiles: Profile[] }>().profiles[0]!;
  const updateResponse = await app.inject({
    method: "PUT",
    url: `/api/profiles/${profile.id}`,
    headers: { cookie },
    payload: { ...profile, blockThreshold: 0.9 },
  });
  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.json<{ profile: Profile }>().profile.blockThreshold, 0.9);
  const active = await app.inject({ method: "GET", url: "/api/profiles", headers: { cookie } });
  assert.equal(active.json<{ profiles: Profile[] }>().profiles[0]!.blockThreshold, 0.9);
  await app.close();
});

test("assigns policy ids and rejects duplicate policy names", async () => {
  const databaseUrl = `memory://control-${randomUUID()}`;
  const app = await buildControlPlane({
    host: "127.0.0.1", port: 0, databaseUrl,
    adminPassword: "correct-horse-battery-staple", controlPlaneSecret: "control-plane-test-secret",
    gatewayInternalUrl: "http://127.0.0.1:1", gatewayApiKey: "test-key",
    typesafeEndpoint: "https://api.typesafe.ai/v1/systemone", typesafeModel: "jev-latest",
  });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "correct-horse-battery-staple" } });
  const cookie = login.headers["set-cookie"]?.split(";")[0];
  assert.ok(cookie);
  const template = createDefaultProfile();
  const created = await app.inject({
    method: "POST", url: "/api/profiles", headers: { cookie },
    payload: { ...template, id: "client-controlled-id", name: "Support Guard" },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json<{ profile: Profile }>().profile.id, "support-guard");
  const duplicate = await app.inject({
    method: "POST", url: "/api/profiles", headers: { cookie },
    payload: { ...template, id: "another-id", name: " support guard " },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json<{ error: string }>().error, "A policy with this name already exists.");
  const renamedDuplicate = await app.inject({
    method: "PUT", url: "/api/profiles/support-guard", headers: { cookie },
    payload: { ...created.json<{ profile: Profile }>().profile, name: "Default protection" },
  });
  assert.equal(renamedDuplicate.statusCode, 409);
  await app.close();
});

test("creates applications and binds new API keys to them", async () => {
  const databaseUrl = `memory://control-${randomUUID()}`;
  const app = await buildControlPlane({
    host: "127.0.0.1",
    port: 0,
    databaseUrl,
    adminPassword: "correct-horse-battery-staple",
    controlPlaneSecret: "control-plane-test-secret",
    gatewayInternalUrl: "http://127.0.0.1:1",
    gatewayApiKey: "test-key",
    typesafeEndpoint: "https://api.typesafe.ai/v1/systemone",
    typesafeModel: "jev-latest",
  });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "correct-horse-battery-staple" } });
  const cookie = login.headers["set-cookie"]?.split(";")[0];
  assert.ok(cookie);
  const created = await app.inject({
    method: "POST",
    url: "/api/apps",
    headers: { cookie },
    payload: { name: "Support agent", description: "Customer-facing traffic", rateLimitPerMinute: 240 },
  });
  assert.equal(created.statusCode, 201);
  const application = created.json<{ app: { id: string; localRules: unknown[] } }>().app;
  assert.equal(application.id, "support-agent");
  assert.ok(application.localRules.length > 0);
  const key = await app.inject({
    method: "POST",
    url: "/api/keys",
    headers: { cookie },
    payload: { name: "Support production", appId: application.id, defaultProfileId: "default" },
  });
  assert.equal(key.statusCode, 201);
  assert.equal(key.json<{ record: { appId: string } }>().record.appId, application.id);
  const usage = await app.inject({ method: "GET", url: `/api/usage?range=24h&appId=${application.id}`, headers: { cookie } });
  assert.equal(usage.statusCode, 200);
  assert.equal(usage.json<{ totals: { requests: number } }>().totals.requests, 0);
  await app.close();
});

test("does not delete policies that are still referenced", async () => {
  const databaseUrl = `memory://control-${randomUUID()}`;
  const app = await buildControlPlane({
    host: "127.0.0.1", port: 0, databaseUrl,
    adminPassword: "correct-horse-battery-staple", controlPlaneSecret: "control-plane-test-secret",
    gatewayInternalUrl: "http://127.0.0.1:1", gatewayApiKey: "test-key",
    typesafeEndpoint: "https://api.typesafe.ai/v1/systemone", typesafeModel: "jev-latest",
  });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "correct-horse-battery-staple" } });
  const cookie = login.headers["set-cookie"]?.split(";")[0];
  assert.ok(cookie);
  const profile = { ...createDefaultProfile(), id: "strict", name: "Strict" };
  const created = await app.inject({ method: "POST", url: "/api/profiles", headers: { cookie }, payload: profile });
  assert.equal(created.statusCode, 201);
  const apps = await app.inject({ method: "GET", url: "/api/apps", headers: { cookie } });
  const defaultApp = apps.json<{ apps: Array<Record<string, unknown>> }>().apps[0]!;
  const updated = await app.inject({
    method: "PUT", url: "/api/apps/default", headers: { cookie },
    payload: { ...defaultApp, defaultProfileId: "strict", allowedProfileIds: ["strict"] },
  });
  assert.equal(updated.statusCode, 200);
  const deletion = await app.inject({ method: "DELETE", url: "/api/profiles/strict", headers: { cookie } });
  assert.equal(deletion.statusCode, 409);
  await app.close();
});

test("neutralizes spreadsheet formulas in CSV exports", async () => {
  const databaseUrl = `memory://control-${randomUUID()}`;
  const database = await openDatabase(databaseUrl);
  const event: ClassificationEvent = {
    id: randomUUID(), requestId: "csv-test", createdAt: new Date().toISOString(), traceId: randomUUID().replaceAll("-", ""),
    profileId: "default", verdict: "unsafe", action: "block", risk: .99, confidence: .99,
    reason: "CSV export test", detectors: [], model: "test", provider: "mock", latencyMs: 1, queueMs: 0,
    inputHash: "hash", inputBytes: 1, appId: "default", appName: "=HYPERLINK(\"https://example.test\")",
  };
  await database.events.append(event);
  const app = await buildControlPlane({
    host: "127.0.0.1", port: 0, databaseUrl,
    adminPassword: "correct-horse-battery-staple", controlPlaneSecret: "control-plane-test-secret",
    gatewayInternalUrl: "http://127.0.0.1:1", gatewayApiKey: "test-key",
    typesafeEndpoint: "https://api.typesafe.ai/v1/systemone", typesafeModel: "jev-latest",
  });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "correct-horse-battery-staple" } });
  const cookie = login.headers["set-cookie"]?.split(";")[0];
  assert.ok(cookie);
  const exported = await app.inject({ method: "GET", url: "/api/activity?format=csv", headers: { cookie } });
  assert.equal(exported.statusCode, 200);
  assert.match(exported.body, /"'=HYPERLINK/);
  await app.close();
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { LocalRuleSchema, createDefaultProfile, type Profile, type StoredIntegration } from "@pyro/contracts";
import { decryptText, openDatabase } from "@pyro/storage";
import { buildControlPlane } from "../src/app.js";
import { exportProfileYaml, loadPresetProfiles, parseProfileYaml } from "../src/profile-files.js";
const secret = "control-test-secret-at-least-16";
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const databaseUrl = `memory://${randomUUID()}`;
  const app = await buildControlPlane({ host: "127.0.0.1", port: 0, databaseUrl, adminPassword: "test-password", controlPlaneSecret: secret,
    gatewayInternalUrl: "http://127.0.0.1:1", gatewayApiKey: "test", typesafeEndpoint: "https://api.typesafe.ai/v1/systemone", typesafeModel: "jev-latest" });
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "test-password" } });
  return { app, database: await openDatabase(databaseUrl), headers: { cookie: login.headers["set-cookie"]!.toString().split(";")[0]! } };
}
test("catalog profiles round-trip with local rules and reject malformed or hostile YAML", async () => {
  const presets = await loadPresetProfiles(); assert.equal(presets.length, 4);
  for (const preset of presets) assert.deepEqual(parseProfileYaml(exportProfileYaml(preset.profile)).localRules, preset.profile.localRules);
  assert.throws(() => parseProfileYaml("apiVersion: pyro/v2\nkind: Profile\nprofile: {}"));
  assert.throws(() => parseProfileYaml("apiVersion: pyro/v1\napiVersion: pyro/v1"));
  assert.throws(() => parseProfileYaml("x: &a [1,2]\ny: *a"));
  const p = createDefaultProfile();
  assert.throws(() => parseProfileYaml(exportProfileYaml({ ...p, reviewThreshold: .9, blockThreshold: .1 })));
  assert.equal(LocalRuleSchema.safeParse({ id: "bad", name: "Bad", enabled: true, scope: "all_text", match: "regex", pattern: "(x)\\1", action: "block", risk: 1 }).success, false);
  assert.equal(LocalRuleSchema.safeParse({ id: "bad", name: "Bad", enabled: true, scope: "all_text", match: "regex", pattern: "(?=x)", action: "block", risk: 1 }).success, false);
});
test("profile preview, import, conflict, export and auth", async (t) => {
  const { app, headers } = await setup(t);
  assert.equal((await app.inject({ url: "/api/profile-presets" })).statusCode, 401);
  const catalog = (await app.inject({ url: "/api/profile-presets", headers })).json();
  const yaml = catalog.presets.find((p: { profile: Profile }) => p.profile.id === "local-secrets").yaml;
  const preview = await app.inject({ method: "POST", url: "/api/profiles/preview", headers, payload: { yaml } });
  assert.equal(preview.statusCode, 200);
  assert.equal((await app.inject({ url: "/api/profiles", headers })).json().profiles.length, 1);
  const imported = await app.inject({ method: "POST", url: "/api/profiles/import", headers, payload: { yaml } });
  assert.equal(imported.statusCode, 201); assert.equal(imported.json().profile.localRules.length, 2);
  assert.equal((await app.inject({ method: "POST", url: "/api/profiles/import", headers, payload: { yaml } })).statusCode, 409);
  const exported = await app.inject({ url: "/api/profiles/local-secrets/export", headers });
  assert.equal(exported.statusCode, 200); assert.equal(parseProfileYaml(exported.body).id, "local-secrets");
  assert.ok(!exported.body.includes("createdAt"));
  assert.equal((await app.inject({ method: "POST", url: "/api/profiles/import", headers, payload: { yaml: "not a profile" } })).statusCode, 400);
});
test("integration credentials are encrypted, never listed, and tests are queued", async (t) => {
  const { app, database, headers } = await setup(t);
  assert.equal((await app.inject({ url: "/api/integrations" })).statusCode, 401);
  const created = await app.inject({ method: "POST", url: "/api/integrations", headers, payload: { name: "Receiver", type: "webhook", url: "https://receiver.example/secret-path" } });
  assert.equal(created.statusCode, 201);
  const body = created.json(); assert.equal(body.signingSecret.length, 64); assert.ok(!created.body.includes("secret-path"));
  const records = await database.document<StoredIntegration[]>("integrations", () => []).read();
  assert.equal(decryptText(records[0]!.destination, secret), "https://receiver.example/secret-path");
  const listed = await app.inject({ url: "/api/integrations", headers });
  assert.ok(!listed.body.includes(body.signingSecret)); assert.ok(!listed.body.includes("ciphertext"));
  const id = body.integration.id;
  assert.equal((await app.inject({ method: "POST", url: `/api/integrations/${id}/test`, headers })).statusCode, 202);
  assert.equal((await database.deliveries.list()).length, 1);
  const rotate = await app.inject({ method: "POST", url: `/api/integrations/${id}/rotate-secret`, headers });
  assert.notEqual(rotate.json().signingSecret, body.signingSecret);
  await app.inject({ method: "PUT", url: `/api/integrations/${id}`, headers, payload: { enabled: false } });
  assert.equal((await app.inject({ method: "POST", url: `/api/integrations/${id}/test`, headers })).statusCode, 409);
  assert.equal((await app.inject({ method: "POST", url: "/api/integrations", headers, payload: { name: "Bad", type: "slack", url: "https://example.com" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/integrations/${id}`, headers })).statusCode, 204);
});

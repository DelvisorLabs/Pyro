import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import test from "node:test";
import { openDatabase, decryptText } from "@pyro/storage";
import { buildCloud } from "../src/app.js";
import type { CloudConfig } from "../src/config.js";
import { CloudStore } from "../src/store.js";
import { Billing } from "../src/billing.js";
import { config, account } from "./fixtures.js";
test("cloud accounts, organizations, API isolation, revoked membership and prepaid limits", async () => {
  const cfg = config(), app = await buildCloud(cfg);
  try {
    const a = await account(app, cfg, "alpha@example.test"), b = await account(app, cfg, "beta@example.test");
    const classify = await app.inject({ method: "POST", url: "/v1/classify", headers: { authorization: `Bearer ${a.key}` }, payload: { input: "Hello customer" } }); assert.equal(classify.statusCode, 200, classify.body);
    const eventId = classify.json().id;
    const own = await app.inject({ url: `/api/activity/${eventId}`, headers: a.headers }); assert.equal(own.statusCode, 200, own.body);
    const other = await app.inject({ url: `/api/activity/${eventId}`, headers: b.headers }); assert.equal(other.statusCode, 404, other.body);
    const forged = await app.inject({ url: "/api/apps", headers: { ...a.headers, "x-pyro-organization": b.orgId } }); assert.equal(forged.statusCode, 403);
    const settings = await app.inject({ method: "PUT", url: "/api/settings/provider", headers: a.headers, payload: { mode: "mock" } }); assert.equal(settings.statusCode, 403);
    const webhook = await app.inject({ method: "POST", url: "/api/integrations", headers: a.headers, payload: { allowPrivateNetwork: true } }); assert.equal(webhook.statusCode, 400);
    const jobHeaders = (key: string) => ({ authorization: `Bearer ${key}`, "idempotency-key": "same-key" });
    const [ja, jb] = await Promise.all([a, b].map((user) => app.inject({ method: "POST", url: "/v1/jobs", headers: jobHeaders(user.key), payload: { input: "Hello" } })));
    assert.equal(ja.statusCode, 202, ja.body); assert.equal(jb.statusCode, 202, jb.body); assert.notEqual(ja.json().id, jb.json().id);
    assert.equal((await app.inject({ url: `/v1/jobs/${ja.json().id}`, headers: jobHeaders(b.key) })).statusCode, 404);
    const platform = await openDatabase(cfg.databaseUrl, "platform"); const bill = new Billing(new CloudStore(platform, cfg));
    await bill.meter.update((s) => { s.accounts[a.orgId]!.balance = 0; return s; });
    const denied = await app.inject({ method: "POST", url: "/v1/classify", headers: { authorization: `Bearer ${a.key}` }, payload: { input: "Hello" } }); assert.equal(denied.statusCode, 402, denied.body);
    const revoke = await app.inject({ method: "DELETE", url: `/api/keys/${b.keyId}`, headers: b.headers }); assert.equal(revoke.statusCode, 200, revoke.body);
    assert.equal((await app.inject({ method: "POST", url: "/v1/classify", headers: jobHeaders(b.key), payload: { input: "Hi" } })).statusCode, 401);
    await platform.close();
  } finally { await app.close(); }
});
test("signed payments grant once, reject tampering and cannot choose arbitrary credits", async () => {
  const cfg = config(), app = await buildCloud(cfg);
  try {
    const a = await account(app, cfg, "payment@example.test"), platform = await openDatabase(cfg.databaseUrl, "platform"), billing = new Billing(new CloudStore(platform, cfg));
    await billing.orders.write([{ id: "order_test", orgId: a.orgId, amount: 199900, currency: "INR", credits: 25000 }]);
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_test", order_id: "order_test", amount: 199900, currency: "INR", status: "captured" } } } });
    const signature = createHmac("sha256", cfg.razorpayWebhookSecret!).update(body).digest("hex");
    for (let i = 0; i < 2; i++) assert.equal((await app.inject({ method: "POST", url: "/api/billing/webhook", headers: { "content-type": "application/json", "x-razorpay-signature": signature }, payload: body })).statusCode, 200);
    assert.equal((await billing.summary(a.orgId)).balance, 25100);
    assert.equal((await app.inject({ method: "POST", url: "/api/billing/webhook", headers: { "x-razorpay-signature": signature }, payload: {} })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/platform/credits", headers: a.headers, payload: { orgId: a.orgId, credits: 9999, reference: "unauthorized" } })).statusCode, 401);
    await platform.close();
  } finally { await app.close(); }
});
test("memberships are independent, invitations bind email, reset revokes sessions, and deletion is scoped", async () => {
  const cfg = config(), app = await buildCloud(cfg);
  try {
    const a = await account(app, cfg, "owner@example.test"), b = await account(app, cfg, "member@example.test");
    const invite = await app.inject({ method: "POST", url: "/api/invitations", headers: a.headers, payload: { email: "member@example.test", role: "viewer", appIds: ["default"] } }); assert.equal(invite.statusCode, 201, invite.body);
    const platform = await openDatabase(cfg.databaseUrl, "platform");
    const mail = (await platform.document<any[]>("email_outbox", () => []).read()).at(-1); const message = JSON.parse(decryptText(mail.message, cfg.secret)); const inviteToken = new URL(message.text).searchParams.get("invite");
    assert.equal((await app.inject({ method: "POST", url: "/api/invitations/accept", headers: a.headers, payload: { token: inviteToken } })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/api/invitations/accept", headers: b.headers, payload: { token: inviteToken } })).statusCode, 200);
    const shared = { ...b.headers, "x-pyro-organization": a.orgId };
    assert.equal((await app.inject({ url: "/api/overview", headers: shared })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/keys", headers: shared, payload: { name: "Unauthorized" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "PUT", url: `/api/team/${b.userId}`, headers: a.headers, payload: { role: "viewer", appIds: ["default"], disabled: true } })).statusCode, 200);
    assert.equal((await app.inject({ url: "/api/overview", headers: shared })).statusCode, 403);
    assert.equal((await app.inject({ url: "/api/overview", headers: b.headers })).statusCode, 200);
    const remove = await app.inject({ method: "DELETE", url: "/api/organizations/current", headers: a.headers, payload: { confirmation: "Test organization" } }); assert.equal(remove.statusCode, 200, remove.body);
    assert.equal((await app.inject({ url: "/api/apps", headers: a.headers })).statusCode, 403);
    assert.equal((await app.inject({ url: "/api/apps", headers: b.headers })).statusCode, 200);
    await app.inject({ method: "POST", url: "/api/auth/recover", payload: { email: "member@example.test" } });
    const resetMail = (await platform.document<any[]>("email_outbox", () => []).read()).at(-1); const resetMessage = JSON.parse(decryptText(resetMail.message, cfg.secret)); const resetToken = new URL(resetMessage.text).searchParams.get("reset");
    const payload = { token: resetToken, password: "a-new-secure-password" };
    assert.equal((await app.inject({ method: "POST", url: "/api/auth/reset", payload })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/auth/reset", payload })).statusCode, 400);
    assert.equal((await app.inject({ url: "/api/auth/me", headers: b.headers })).statusCode, 401);
    await platform.close();
  } finally { await app.close(); }
});

test("concurrent semantic calls cannot overspend an organization balance", async () => {
  const cfg = config(), app = await buildCloud(cfg);
  try {
    const a = await account(app, cfg, "budget@example.test"), platform = await openDatabase(cfg.databaseUrl, "platform"), billing = new Billing(new CloudStore(platform, cfg));
    const first = await app.inject({ method: "POST", url: "/v1/classify", headers: { authorization: `Bearer ${a.key}` }, payload: { input: "Hello" } }); assert.equal(first.statusCode, 200);
    const consumed = (await billing.summary(a.orgId)).consumed;
    await billing.meter.update((s) => { s.accounts[a.orgId]!.balance = consumed; return s; });
    const responses = await Promise.all(Array.from({ length: 6 }, () => app.inject({ method: "POST", url: "/v1/classify", headers: { authorization: `Bearer ${a.key}` }, payload: { input: "Hello" } })));
    assert.equal(responses.filter((r) => r.statusCode === 200).length, 1); assert.equal(responses.filter((r) => r.statusCode === 402).length, 5);
    assert.equal((await billing.summary(a.orgId)).balance, 0); await platform.close();
  } finally { await app.close(); }
});

test("PostgreSQL cloud migration preserves existing keys and resumes organizations after restart", { skip: !process.env.CLOUD_TEST_DATABASE_URL }, async () => {
  const cfg = config(process.env.CLOUD_TEST_DATABASE_URL), legacy = await openDatabase(cfg.databaseUrl);
  const { createDefaultApp, createDefaultProfile, createDefaultProviderSettings } = await import("@pyro/contracts");
  const { hash, passwordHash } = await import("../src/store.js");
  await legacy.document("users", () => []).write([{ id: "legacy-owner", username: "admin", role: "admin", createdAt: new Date().toISOString(), passwordHash: await passwordHash("legacy-admin-password") }]);
  await legacy.document("profiles", () => []).write([createDefaultProfile()]); await legacy.document("apps", () => []).write([createDefaultApp()]);
  await legacy.document("api_keys", () => []).write([{ id: "old-key", name: "Old key", hash: hash("pf_legacy_key"), prefix: "pf_legacy", appId: "default", createdAt: new Date().toISOString() }]);
  await legacy.close(); let app = await buildCloud(cfg);
  try {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "legacy-admin-password" } }); assert.equal(login.statusCode, 200, login.body);
    const platform = await openDatabase(cfg.databaseUrl, "platform"), billing = new Billing(new CloudStore(platform, cfg)); await billing.grant("default", 100, `test:${randomUUID()}`); await platform.close();
    const decision = await app.inject({ method: "POST", url: "/v1/classify", headers: { authorization: "Bearer pf_legacy_key" }, payload: { input: "Hello" } }); assert.equal(decision.statusCode, 200, decision.body);
    const user = await account(app, cfg, `postgres-${randomUUID()}@example.test`);
    const job = await app.inject({ method: "POST", url: "/v1/jobs", headers: { authorization: `Bearer ${user.key}`, "idempotency-key": "restart" }, payload: { input: "Hello" } }); assert.equal(job.statusCode, 202, job.body);
    await app.close(); app = await buildCloud(cfg);
    let result; for (let attempt = 0; attempt < 40; attempt++) { result = await app.inject({ url: `/v1/jobs/${job.json().id}`, headers: { authorization: `Bearer ${user.key}` } }); if (result.json().status === "complete") break; await new Promise((r) => setTimeout(r, 50)); }
    assert.equal(result!.json().status, "complete", result!.body);
    assert.equal((await app.inject({ method: "POST", url: "/v1/jobs", headers: { authorization: `Bearer ${user.key}`, "idempotency-key": "restart" }, payload: { input: "Hello" } })).json().id, job.json().id);
  } finally { await app.close(); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "@pyro/storage";
import { createDefaultProfile, createDefaultProviderSettings } from "@pyro/contracts";
import { buildCloud } from "../src/app.js";
import { CloudStore } from "../src/store.js";
import { Billing } from "../src/billing.js";
import { Plans } from "../src/plans.js";
import { config, account } from "./fixtures.js";

test("plans require platform authority, validate limits and apply live to one organization", async () => {
  const cfg = config(), app = await buildCloud(cfg);
  try {
    const a = await account(app, cfg, "plan-a@example.test"), b = await account(app, cfg, "plan-b@example.test");
    const headers = { authorization: `Bearer ${cfg.platformToken}` };
    const plan = { id: "starter", name: "Starter", concurrency: 3, queueDepth: 7, monthlyCredits: 50, monthlyCreditLimit: 100 };
    assert.equal((await app.inject({ method: "PUT", url: "/platform/plans", headers: a.headers, payload: plan })).statusCode, 401);
    assert.equal((await app.inject({ method: "PUT", url: "/platform/plans", headers, payload: { ...plan, concurrency: 0 } })).statusCode, 400);
    assert.equal((await app.inject({ method: "PUT", url: "/platform/plans", headers, payload: { ...plan, monthlyCreditLimit: 1 } })).statusCode, 400);
    assert.equal((await app.inject({ method: "PUT", url: "/platform/plans", headers, payload: plan })).statusCode, 200);
    assert.equal((await app.inject({ method: "PUT", url: `/platform/organizations/${a.orgId}/plan`, headers, payload: { planId: plan.id } })).statusCode, 200);
    const usage = (await app.inject({ url: "/api/billing/usage", headers: a.headers })).json();
    assert.equal(usage.plan.concurrency, 3); assert.equal(usage.availableCredits, 100);
    assert.equal((await app.inject({ url: "/api/billing/usage", headers: b.headers })).json().plan.concurrency, 2);
    const overview = (await app.inject({ url: "/api/overview", headers: a.headers })).json();
    assert.ok(JSON.stringify(overview).includes('"concurrency":3'));
  } finally { await app.close(); }
});
test("monthly allowance is atomic, renews in UTC, and plan switching never resets consumption", async () => {
  const cfg = config(), db = await openDatabase(cfg.databaseUrl, "platform"), store = new CloudStore(db, cfg), plans = new Plans(store), billing = new Billing(store);
  await store.identity.update(s => { s.organizations.push({ id: "org", name: "Test", status: "active", createdAt: new Date().toISOString() }); return s; });
  await plans.save({ id: "limited", name: "Limited", monthlyCredits: 2, monthlyCreditLimit: 2, concurrency: 8 }); await plans.assign("org", "limited");
  const input = (id: string) => ({ id, traceId: id, input: "Hello", profile: { ...createDefaultProfile(), detectors: [createDefaultProfile().detectors[0]!] }, provider: createDefaultProviderSettings(), queueMs: 0, signal: new AbortController().signal });
  const hooks = billing.hooks("org", "playground");
  const result = await Promise.allSettled(["a", "b", "c"].map(async id => { await hooks.before(input(id)); await hooks.settled!(input(id)); }));
  assert.equal(result.filter(r => r.status === "fulfilled").length, 2);
  assert.equal((await billing.summary("org")).monthlyConsumed, 2);
  await plans.save({ id: "other", name: "Other", monthlyCredits: 2, monthlyCreditLimit: 2 }); await plans.assign("org", "other");
  await assert.rejects(hooks.before(input("d")), /Monthly credit/);
  await billing.meter.update(s => { s.accounts.org!.month = "2000-01"; return s; });
  await hooks.before(input("e")); await hooks.settled!(input("e"));
  assert.equal((await billing.summary("org")).monthlyConsumed, 1);
  assert.equal((await billing.summary("org")).balance, 0);
  await db.close();
});
test("provider concurrency is shared across surfaces and retries debit only once", async () => {
  const cfg = config(), db = await openDatabase(cfg.databaseUrl, "platform"), store = new CloudStore(db, cfg), plans = new Plans(store), billing = new Billing(store);
  await store.identity.update(s => { s.organizations.push({ id: "org", name: "Test", status: "active", createdAt: new Date().toISOString() }); return s; });
  await plans.save({ id: "single", name: "Single", concurrency: 1 }); await plans.assign("org", "single"); await billing.grant("org", 100, "test-grant");
  const input = { id: "a", traceId: "a", input: "Hello", profile: createDefaultProfile(), provider: createDefaultProviderSettings(), queueMs: 0, signal: new AbortController().signal };
  const a = billing.hooks("org"), b = billing.hooks("org", "evaluation");
  await a.before(input); const used = (await billing.summary("org")).consumed;
  await assert.rejects(b.before({ ...input, id: "b" }), /concurrency/);
  assert.equal((await billing.summary("org")).consumed, used);
  await a.settled!(input); await a.before(input); await a.settled!(input);
  assert.equal((await billing.summary("org")).consumed, used);
  await b.before({ ...input, id: "b" }); await b.settled!({ ...input, id: "b" });
  assert.equal((await billing.summary("org")).sources.evaluation?.calls, 1);
  await db.close();
});

test("monthly request admission is atomic, isolated, and renews without changing plans", async () => {
  const cfg = config(), db = await openDatabase(cfg.databaseUrl, "platform"), store = new CloudStore(db, cfg), plans = new Plans(store);
  try {
    await plans.save({ id: "beta", name: "Beta", monthlyRequests: 2 });
    const admissions = await Promise.allSettled([1, 2, 3].map(() => plans.admitRequest("a")));
    assert.equal(admissions.filter(r => r.status === "fulfilled").length, 2);
    await plans.admitRequest("b");
    await assert.rejects(plans.admitRequest("a"), /Monthly request allowance/);
    await store.platform.document("cloud_request_usage", () => ({ month: "", organizations: {} as Record<string, number> })).update(s => ({ ...s, month: "2000-01" }));
    await plans.admitRequest("a");
  } finally { await db.close(); }
});

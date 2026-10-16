import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultProfile, type Profile } from "@pyro/contracts";
import { buildCloud } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { config, account } from "./fixtures.js";

function defaultCredits() {
  const previous = { ...process.env };
  try {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "memory://credit-default";
    process.env.CLOUD_PUBLIC_URL = "http://localhost:3001";
    process.env.CONTROL_PLANE_SECRET = "development-secret-".repeat(3);
    process.env.CLOUD_PLATFORM_TOKEN = "development-token-".repeat(3);
    delete process.env.CLOUD_TRIAL_CREDITS;
    assert.equal(loadConfig().trialCredits, 1_000_000);
    process.env.CLOUD_TRIAL_CREDITS = "0";
    assert.equal(loadConfig().trialCredits, 0);
    process.env.CLOUD_TRIAL_CREDITS = "20";
    assert.equal(loadConfig().trialCredits, 20);
    return 1_000_000;
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

test("fresh accounts receive the default million-credit grant and can spend beyond 20 credits", async () => {
  const cfg = { ...config(), trialCredits: defaultCredits() }, app = await buildCloud(cfg);
  try {
    const a = await account(app, cfg, "million-a@example.test"), b = await account(app, cfg, "million-b@example.test");
    for (const headers of [a.headers, b.headers]) {
      const response = await app.inject({ url: "/api/billing/usage", headers });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal((await app.inject({ url: "/api/billing", headers })).json().balance, 1_000_000);
      assert.equal(response.json().availableCredits, 1_000_000);
      assert.equal(response.json().monthlyConsumed, 0);
    }
    const profile: Profile = { ...createDefaultProfile(), id: "credit-check", name: "Credit check", localRules: [], detectors: [], pipeline: { version: 1, onUncertain: "review", onError: "review", otherwise: "review", steps: [{ id: "support", name: "Support", type: "semantic", question: "Is this support?", context: "Support only", positiveExamples: ["help"], negativeExamples: ["movie"], noThreshold: .2, yesThreshold: .8, onMatch: "allow", onNoMatch: "block" }] } };
    for (let i = 0; i < 25; i++) {
      const response = await app.inject({ method: "POST", url: "/api/playground", headers: a.headers, payload: { profile, appId: "default", input: "help", allowPaid: true, maxCredits: 10 } });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().action, "allow");
      assert.equal(response.json().creditsConsumed, 1);
    }
    const usage = (await app.inject({ url: "/api/billing/usage", headers: a.headers })).json();
    assert.equal(usage.availableCredits, 999_975);
    assert.equal((await app.inject({ url: "/api/billing", headers: a.headers })).json().balance, 999_975);
    assert.equal(usage.monthlyConsumed, 25);
    assert.equal((await app.inject({ url: "/api/billing/usage", headers: b.headers })).json().availableCredits, 1_000_000);
    // A second organization on the same account cannot multiply the signup grant.
    const second = await app.inject({ method: "POST", url: "/api/organizations", headers: a.headers, payload: { name: "Second organization" } });
    assert.equal(second.statusCode, 201, second.body);
    const secondUsage = (await app.inject({ url: "/api/billing", headers: { ...a.headers, "x-pyro-organization": second.json().organization.id } })).json();
    assert.equal(secondUsage.balance, 0);
    assert.equal((await app.inject({ url: "/api/billing", headers: a.headers })).json().balance, 999_975);
  } finally { await app.close(); }
});

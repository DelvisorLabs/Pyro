import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultProfile, type Profile, type SemanticStep } from "@pyro/contracts";
import { PyroClient } from "../../../packages/sdk/src/index.js";
import { buildCloud } from "../src/app.js";
import { account, config } from "./fixtures.js";

test("cloud pipeline preview, SDK decisions and queued jobs remain scoped, metered and model-locked", async () => {
  const cfg = config(), app = await buildCloud(cfg);
  try {
    const a = await account(app, cfg, "pipeline-a@example.test"), b = await account(app, cfg, "pipeline-b@example.test");
    const condition: SemanticStep = { id: "scope", name: "Scope", type: "semantic", question: "Is this support?", context: "Support only", positiveExamples: ["help"], negativeExamples: ["movie"], noThreshold: .2, yesThreshold: .8, onMatch: "continue", onNoMatch: "block" };
    const policy: Profile = { ...createDefaultProfile(), id: "pipeline", name: "Pipeline", detectors: [], localRules: [], pipeline: { version: 1, onUncertain: "review", onError: "review", otherwise: "review", steps: [condition, { ...condition, id: "second", onMatch: "allow" }] } };
    const post = (url: string, payload: object) => app.inject({ method: "POST", url, headers: a.headers, payload });
    assert.equal((await post("/api/playground", { profile: { ...policy, model: "expensive-other-model" }, appId: "default", input: "help" })).statusCode, 400);
    assert.equal((await post("/api/profiles", { ...policy, model: "expensive-other-model" })).statusCode, 400);
    const preview = await post("/api/playground", { profile: policy, appId: "default", input: "help" });
    assert.equal(preview.statusCode, 200, preview.body); assert.equal(preview.json().action, "allow");
    const billing = (await app.inject({ url: "/api/billing", headers: a.headers })).json();
    assert.equal(billing.entries.filter((entry: { kind: string }) => entry.kind === "usage").length, 2);
    assert.equal((await app.inject({ url: "/api/billing", headers: b.headers })).json().consumed, 0);
    assert.equal((await app.inject({ url: "/api/activity", headers: a.headers })).json().events.length, 0);
    const saved = (await post("/api/profiles", policy)).json().profile;
    const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    const sdk = new PyroClient({ apiKey: a.key, baseUrl });
    const classified = await sdk.classify("help", { profile: saved.id });
    assert.equal(classified.action, "allow");
    assert.deepEqual(classified.policyTrace, preview.json().policyTrace);
    assert.equal((await app.inject({ method: "POST", url: "/v1/classify", headers: { authorization: `Bearer ${b.key}` }, payload: { profile: saved.id, input: "help" } })).statusCode, 404);
    const queued = await sdk.createJob("movie", { profile: saved.id });
    let job;
    for (let i = 0; i < 100; i++) { job = await sdk.getJob(queued.id); if (["complete", "failed"].includes(job.status)) break; await new Promise((r) => setTimeout(r, 25)); }
    assert.equal(job!.status, "complete", JSON.stringify(job)); assert.equal(job!.decision!.action, "block");
    assert.equal(job!.decision!.policyTrace[1].outcome, "skipped");
  } finally { await app.close(); }
});

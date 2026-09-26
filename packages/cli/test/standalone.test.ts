import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { classifyStandalone } from "../dist/standalone.js";
import { invoke, server, temporary } from "./helpers.js";

test("a fresh CLI classifies text, files and stdin without a server, account or network", async t => {
  const directory = await temporary(t), config = join(directory, "fresh.json");
  const env = { TYPESAFE_API_KEY: "" };
  for (const [input, action] of [["hello", "allow"], ["-----BEGIN PRIVATE KEY-----", "block"], ["sk-" + "a".repeat(24), "review"]]) {
    const result = await invoke(["classify", "--", input!], { config, env });
    assert.equal(result.code, 0, result.stderr); const decision = JSON.parse(result.stdout);
    assert.equal(decision.action, action); assert.equal(decision.execution, "standalone"); assert.equal(decision.provider, "local-rules");
  }
  const file = join(directory, "input.txt"); await writeFile(file, "-----BEGIN PRIVATE KEY-----");
  assert.equal(JSON.parse((await invoke(["classify", "--file", file], { config, env })).stdout).action, "block");
  assert.equal(JSON.parse((await invoke(["classify"], { config, env, input: "hello stdin" })).stdout).action, "allow");
  const custom = join(directory, "policy.yaml");
  const { readFile } = await import("node:fs/promises");
  await writeFile(custom, await readFile(new URL("../../../profiles/local-secrets.yaml", import.meta.url), "utf8"));
  const customResult = await invoke(["classify", "Example: -----BEGIN PRIVATE KEY-----", "--profile-file", custom], { config, env });
  assert.equal(customResult.code, 0, customResult.stderr); assert.equal(JSON.parse(customResult.stdout).action, "block");
  const doctor = await invoke(["doctor"], { config, env }); assert.equal(doctor.code, 0); assert.equal(JSON.parse(doctor.stdout).serverRequired, false);
  const missing = await invoke(["classify", "hello", "--semantic"], { config, env }); assert.equal(missing.code, 2); assert.match(missing.stderr, /TYPESAFE_API_KEY/);
  const noConsent = await invoke(["classify", "hello", "--profile", "balanced-assistant"], { config, env }); assert.equal(noConsent.code, 2); assert.match(noConsent.stderr, /--semantic/);
  const destination = join(directory, "decision.json");
  const missingFile = await invoke(["classify", "hello", "--profile-file", join(directory, "missing.yaml"), "--output", destination], { config, env }); assert.equal(missingFile.code, 2);
  assert.equal((await invoke(["classify", "hello", "--output", destination], { config, env })).code, 0, "failed local output must not leave a reserved file");
});

test("explicit local mode cannot leak to saved or environment gateway settings", async t => {
  const config = join(await temporary(t), "config.json"); let calls = 0;
  const { url } = await server(t, (_req, res) => { calls++; res.end('{}'); });
  await writeFile(config, JSON.stringify({ version: 1, gatewayUrl: url }));
  const result = await invoke(["classify", "hello", "--local"], { config, env: { PYRO_API_KEY: "key", PYRO_GATEWAY_URL: url } });
  assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).execution, "standalone"); assert.equal(calls, 0);
  assert.equal((await invoke(["classify", "hello", "--remote", "--local"], { config })).code, 2);
});

test("standalone semantic calls require explicit consent and use the official provider directly", async t => {
  const prior = process.env.TYPESAFE_API_KEY; process.env.TYPESAFE_API_KEY = "test-only-typesafe-key";
  t.after(() => { if (prior === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = prior; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    calls++; assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal((options.headers as Record<string, string>).Authorization, "Bearer test-only-typesafe-key");
    const body = JSON.parse(options.body as string); assert.equal(body.state.payload, "synthetic semantic example");
    return Response.json({ model: "test-model", answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, { probability: .05 }])) });
  });
  await classifyStandalone(JSON.stringify({ input: "local hello" }), "application/json", { timeout: 1000 }); assert.equal(calls, 0);
  await assert.rejects(classifyStandalone(JSON.stringify({ input: "never sent", profile: "balanced-assistant" }), "application/json", { timeout: 1000 }), /--semantic/); assert.equal(calls, 0);
  const decision = await classifyStandalone(JSON.stringify({ input: "synthetic semantic example" }), "application/json", { timeout: 1000, semantic: true });
  assert.equal(calls, 1); assert.equal(decision.action, "allow"); assert.equal(decision.execution, "standalone");
});

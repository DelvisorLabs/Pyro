import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { z } from "zod";
import { ProfileSchema, AppSchema, ProviderSettingsSchema } from "@pyro/contracts";
import { createProgram } from "../dist/cli.js";
import { endpoints, specs, optionKey } from "../dist/spec.js";
import { invoke, server, sessionConfig, temporary } from "./helpers.js";

test("bundled contracts match source OpenAPI and every operation has a unique reachable command", async () => {
  for (const [service, file] of Object.entries({ gateway: "openapi.yaml", control: "control-plane.openapi.yaml" })) {
    assert.deepEqual(specs[service as keyof typeof specs], YAML.parse(await readFile(new URL(`../../../docs/${file}`, import.meta.url), "utf8")));
  }
  const program = createProgram();
  const ids = new Set<string>();
  for (const endpoint of endpoints()) {
    assert.ok(!ids.has(endpoint.operationId), endpoint.operationId); ids.add(endpoint.operationId);
    let command = program;
    for (const part of endpoint["x-cli-command"].split(" ")) {
      command = command.commands.find(child => child.name() === part)!;
      assert.ok(command, endpoint.operationId);
    }
    for (const parameter of endpoint.parameters ?? []) {
      if (parameter.in !== "path") assert.ok(command.options.some(option => option.attributeName() === optionKey(parameter.name)), `${endpoint.operationId}: ${parameter.name}`);
    }
  }
  assert.ok(ids.size > 40);
});

test("every gateway and dashboard route is documented (including webhooks and WebSockets)", async () => {
  for (const [service, files] of Object.entries({ gateway: ["apps/gateway/src/app.ts"], control: ["apps/control-plane/src/app.ts", "apps/control-plane/src/integrations.ts", "apps/control-plane/src/policies.ts", "apps/control-plane/src/team.ts", "apps/control-plane/src/oidc.ts"] })) {
    const documented = new Set(endpoints().filter(endpoint => endpoint.service === service).map(endpoint => `${endpoint.method} ${endpoint.path}`));
    for (const file of files) {
      const code = await readFile(new URL(`../../../${file}`, import.meta.url), "utf8");
      for (const match of code.matchAll(/app\.(get|post|put|delete)(?:<[^\n]+?>)?\("([^"]+)"/g)) {
        const path = match[2]!.replace(/:([A-Za-z]+)/g, "{$1}");
        assert.ok(documented.has(`${match[1]!.toUpperCase()} ${path}`), `${service}: ${match[1]} ${path}`);
      }
    }
  }
});

test("documented configuration inputs stay aligned with the server's shared contracts", () => {
  for (const [name, contract, omitted] of [
    ["ProfileInput", ProfileSchema, ["id", "createdAt", "updatedAt"]],
    ["ApplicationInput", AppSchema, ["id", "createdAt", "updatedAt"]],
    ["ProviderSettingsInput", ProviderSettingsSchema, ["updatedAt"]],
  ] as const) {
    const generated = z.toJSONSchema(contract, { io: "input" });
    const expected = Object.keys(generated.properties!).filter(key => !(omitted as readonly string[]).includes(key)).sort();
    const documented = Object.keys(specs.control.components.schemas[name]!.properties!).filter(key => key !== "apiKey" && key !== "clearApiKey").sort();
    assert.deepEqual(documented, expected, name);
    assert.deepEqual(specs.control.components.schemas[name]!.required, generated.required!.filter(key => !(omitted as readonly string[]).includes(key)), name);
  }
});

test("every HTTP command sends the exact documented method, path, body and authentication", async t => {
  const directory = await temporary(t), config = join(directory, "config.json");
  const requests: Array<{ method?: string; path?: string; body: string; auth?: string; cookie?: string }> = [];
  const fixture = await server(t, async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: req.url, body, auth: req.headers.authorization, cookie: req.headers.cookie });
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/auth/login") res.setHeader("set-cookie", "pf_session=test-session; Max-Age=86400; HttpOnly");
    res.end('{"ok":true}');
  });
  for (const endpoint of endpoints().filter(endpoint => !endpoint["x-websocket"])) {
    await sessionConfig(config, fixture.url);
    const args = endpoint["x-cli-command"].split(" ");
    for (const parameter of endpoint.parameters ?? []) if (parameter.in === "path") args.push("id with/slash");
    if (endpoint.requestBody) args.push("--data", '{"exact":"body","enabled":false}');
    const result = await invoke(args, { config, env: { PYRO_API_KEY: "pf_test" } });
    assert.equal(result.code, 0, `${args.join(" ")}: ${result.stderr}`);
    const actual = requests.at(-1)!;
    assert.equal(actual.method, endpoint.method);
    assert.equal(actual.path, endpoint.path.replaceAll("{id}", "id%20with%2Fslash"));
    assert.equal(actual.body, endpoint.requestBody ? '{"exact":"body","enabled":false}' : "");
    const protectedRoute = (endpoint.security ?? endpoint.spec.security).length > 0;
    assert.equal(actual.auth, protectedRoute && endpoint.service === "gateway" ? "Bearer pf_test" : undefined);
    assert.equal(actual.cookie, protectedRoute && endpoint.service === "control" ? "pf_session=test-session" : undefined);
  }
});

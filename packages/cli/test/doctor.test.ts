import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { invoke, server, sessionConfig, temporary } from "./helpers.js";

test("doctor distinguishes a usable local server from missing semantic configuration without credentials", async t => {
  const config = join(await temporary(t), "config.json");
  let configured = false;
  const requests: string[] = [];
  const { url } = await server(t, (req, res) => {
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    requests.push(req.url!);
    res.writeHead(req.url === "/v1/ready" && !configured ? 503 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: configured ? "ready" : "not_ready" }));
  });
  await sessionConfig(config, url);
  const local = await invoke(["doctor"], { config });
  assert.equal(local.code, 0);
  assert.equal(JSON.parse(local.stdout).localRulesReady, true);
  assert.equal(JSON.parse(local.stdout).semantic.ok, false);
  assert.equal((await invoke(["doctor", "--semantic"], { config })).code, 1);
  configured = true;
  assert.equal((await invoke(["doctor", "--semantic"], { config })).code, 0);
  assert.ok(requests.every(path => ["/health", "/v1/health", "/v1/ready"].includes(path)));
});

test("doctor explains server setup when the server is unreachable", async t => {
  const config = join(await temporary(t), "config.json");
  const result = await invoke(["--gateway-url", "http://127.0.0.1:1", "--control-url", "http://127.0.0.1:1", "doctor"], { config });
  assert.equal(result.code, 4);
  assert.match(JSON.parse(result.stdout).guidance, /does not start a server/);
});

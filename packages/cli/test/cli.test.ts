import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";
import { invoke, server, sessionConfig, temporary } from "./helpers.js";

test("classification handles text, structured input, envelopes, files and stdin without losing labels", async t => {
  const directory = await temporary(t), config = join(directory, "config.json");
  const requests: Array<{ body: string; type?: string; requestId?: string }> = [];
  const { url } = await server(t, async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    requests.push({ body, type: req.headers["content-type"], requestId: req.headers["x-request-id"] as string });
    res.setHeader("content-type", "application/json"); res.end('{"action":"allow"}');
  });
  await sessionConfig(config, url);
  const run = (args: string[], input?: string) => invoke(args, { config, input, env: { PYRO_API_KEY: "key" } });
  assert.equal((await run(["classify", "hello", "--profile", "default", "--labels", '{"tenant":"acme"}', "--x-request-id", "trace-123"])).code, 0);
  assert.deepEqual(JSON.parse(requests.at(-1)!.body), { input: "hello", profile: "default", labels: { tenant: "acme" } });
  assert.equal(requests.at(-1)!.requestId, "trace-123");
  assert.equal((await run(["classify"], "stdin\n")).code, 0);
  assert.deepEqual(JSON.parse(requests.at(-1)!.body), { input: "stdin\n" });
  assert.equal((await run(["jobs", "create", "--input", '{"messages":[{"role":"user","content":"hi"}]}'])).code, 0);
  assert.deepEqual(JSON.parse(requests.at(-1)!.body).input, { messages: [{ role: "user", content: "hi" }] });
  const file = join(directory, "input.txt"); await writeFile(file, "from file");
  assert.equal((await run(["classify", "--file", file])).code, 0);
  assert.equal(JSON.parse(requests.at(-1)!.body).input, "from file");
  assert.equal((await run(["classify", "--content-type", "text/plain", "--data", `@${file}`])).code, 0);
  assert.deepEqual(requests.at(-1), { body: "from file", type: "text/plain", requestId: undefined });
  assert.equal((await run(["classify", "--data", "-"], '{"input":{"a":1},"metadata":{"b":2}}')).code, 0);
  assert.deepEqual(JSON.parse(requests.at(-1)!.body), { input: { a: 1 }, metadata: { b: 2 } });
  const before = requests.length;
  for (const args of [["classify", "text", "--data", "{}"], ["classify", "--file", file, "--input", "{}"], ["classify", "--labels", "[]"], ["classify", "--data", "broken"]]) assert.equal((await run(args)).code, 2);
  assert.equal(requests.length, before);
});

test("field flags preserve types and omission; query values are URL encoded", async t => {
  const directory = await temporary(t), config = join(directory, "config.json");
  let received = "", route = "";
  const { url } = await server(t, async (req, res) => {
    route = req.url!; received = ""; for await (const chunk of req) received += chunk;
    res.setHeader("content-type", "application/json"); res.end('{}');
  });
  await sessionConfig(config, url);
  const result = await invoke(["webhooks", "update", "hook", "--enabled", "false", "--minimum-risk", "0", "--app-ids", '[]', "--actions", '["review","block"]'], { config });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(received), { enabled: false, minimumRisk: 0, appIds: [], actions: ["review", "block"] });
  assert.equal((await invoke(["activity", "list", "--app-id", "app-one", "--search", "a&b ?", "--limit", "25", "--minimum-risk", "0.5"], { config })).code, 0);
  const query = new URL(route, url).searchParams;
  assert.equal(query.get("appId"), "app-one"); assert.equal(query.get("search"), "a&b ?"); assert.equal(query.get("limit"), "25"); assert.equal(query.get("minimumRisk"), "0.5");
  for (const args of [["activity", "list", "--limit", "0"], ["usage", "--range", "yesterday"], ["webhooks", "update", "hook", "--enabled", "yes"], ["webhooks", "update", "hook", "--minimum-risk", "NaN"]]) assert.equal((await invoke(args, { config })).code, 2);
});

test("raw YAML, CSV, metrics and empty responses remain usable in pipes and files", async t => {
  const directory = await temporary(t), config = join(directory, "config.json");
  const yaml = "apiVersion: pyro/v1\nkind: Profile\n";
  const { url } = await server(t, (req, res) => {
    if (req.method === "DELETE") { res.writeHead(204); res.end(); return; }
    const [type, value] = req.url!.includes("export") ? ["application/yaml", yaml] : req.url!.includes("metrics") ? ["text/plain", "pyro_requests_total 2\n"] : ["text/csv", "id,action\n1,block"];
    res.setHeader("content-type", type!); res.end(value);
  });
  await sessionConfig(config, url);
  assert.equal((await invoke(["profiles", "export", "default"], { config })).stdout, yaml);
  assert.equal((await invoke(["activity", "list", "--format", "csv"], { config })).stdout, "id,action\n1,block\n");
  assert.equal((await invoke(["metrics"], { config })).stdout, "pyro_requests_total 2\n");
  const empty = await invoke(["webhooks", "delete", "hook"], { config });
  assert.equal(empty.code, 0); assert.equal(empty.stdout, "");
  const file = join(directory, "profile.yaml");
  assert.equal((await invoke(["profiles", "export", "default", "-o", file], { config })).code, 0);
  assert.equal(await readFile(file, "utf8"), yaml);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await invoke(["profiles", "export", "default", "-o", file], { config })).code, 2);
});

test("login stores a private endpoint-bound session, never a password; logout clears it", async t => {
  const directory = await temporary(t), config = join(directory, "nested", "config.json");
  let cookie: string | undefined;
  const { url } = await server(t, async (req, res) => {
    cookie = req.headers.cookie;
    if (req.url === "/api/auth/login") {
      let body = ""; for await (const chunk of req) body += chunk;
      assert.equal(JSON.parse(body).password, "my-password");
      res.setHeader("set-cookie", "pf_session=my-token; Max-Age=86400; HttpOnly");
    }
    res.setHeader("content-type", "application/json"); res.end('{"ok":true}');
  });
  const login = await invoke(["--control-url", url, "auth", "login", "--password-stdin"], { config, input: "my-password\n" });
  assert.equal(login.code, 0, login.stderr);
  assert.equal((await stat(config)).mode & 0o777, 0o600);
  assert.ok(!(await readFile(config, "utf8")).includes("my-password"));
  assert.equal((await invoke(["auth", "status"], { config })).code, 0); assert.equal(cookie, "pf_session=my-token");
  let contacted = false;
  const other = await server(t, (_req, res) => { contacted = true; res.end(); });
  assert.equal((await invoke(["--control-url", other.url, "auth", "status"], { config })).code, 3); assert.equal(contacted, false);
  const show = await invoke(["config", "show"], { config }); assert.ok(!show.stdout.includes("my-token"));
  assert.equal((await invoke(["auth", "logout"], { config })).code, 0);
  assert.deepEqual(JSON.parse(await readFile(config, "utf8")).sessions, {});
  assert.equal((await invoke(["auth", "status"], { config })).code, 3);
});

test("HTTP errors, rate limits, invalid responses, timeouts and redirects fail without retries or credential forwarding", async t => {
  const directory = await temporary(t), config = join(directory, "config.json");
  let mode = "limit", requests = 0, forwarded = false;
  const other = await server(t, (_req, res) => { forwarded = true; res.end(); });
  const { url } = await server(t, (_req, res) => {
    requests++;
    if (mode === "limit") { res.writeHead(429, { "content-type": "application/json", "retry-after": "10", "x-request-id": "trace" }); res.end('{"error":"Slow down"}'); }
    else if (mode === "redirect") { res.writeHead(307, { location: other.url }); res.end(); }
    else if (mode === "invalid") { res.setHeader("content-type", "application/json"); res.end("not-json"); }
    else if (mode === "auth") { res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":"Expired"}'); }
    else { /* Deliberately leave the request open to test timeout and cancellation. */ }
  });
  await sessionConfig(config, url);
  const result = await invoke(["--json", "profiles", "list"], { config });
  assert.equal(result.code, 1); assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), { error: "HTTP 429: Slow down", status: 429, requestId: "trace", retryAfter: "10" });
  assert.equal(requests, 1);
  mode = "redirect"; assert.equal((await invoke(["profiles", "list"], { config })).code, 4); assert.equal(forwarded, false);
  mode = "invalid"; assert.equal((await invoke(["profiles", "list"], { config })).code, 4);
  mode = "auth"; const expired = await invoke(["profiles", "list"], { config }); assert.equal(expired.code, 3); assert.match(expired.stderr, /auth login/);
  mode = "timeout"; assert.equal((await invoke(["--timeout", "50", "profiles", "list"], { config })).code, 4);
});

for (const service of ["gateway", "control"] as const) test(`${service} WebSocket authenticates correctly and emits only NDJSON events`, async t => {
  const directory = await temporary(t), config = join(directory, "config.json");
  const fixture = await server(t, (_req, res) => res.end());
  const wss = new WebSocketServer({ server: fixture.server });
  t.after(() => { for (const client of wss.clients) client.terminate(); wss.close(); });
  let accepted = false;
  wss.on("connection", (socket, req) => {
    assert.equal(req.url, service === "gateway" ? "/v1/events" : "/ws");
    const emit = () => { accepted = true; socket.send(JSON.stringify({ type: "decision", data: { id: "one" } })); };
    if (service === "gateway") {
      assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.cookie, undefined);
      socket.send('{"type":"auth.required"}');
      socket.on("message", raw => { assert.deepEqual(JSON.parse(raw.toString()), { type: "auth", apiKey: "stream-key" }); socket.send('{"type":"auth.ok"}'); emit(); });
    } else { assert.equal(req.headers.cookie, "pf_session=test-session"); socket.send('{"type":"connected"}'); emit(); }
  });
  await sessionConfig(config, fixture.url);
  const result = await invoke([...(service === "gateway" ? ["events"] : ["activity", "watch"]), "--count", "1"], { config, env: { PYRO_API_KEY: "stream-key" } });
  assert.equal(result.code, 0, result.stderr); assert.equal(accepted, true);
  assert.equal(result.stdout, '{"type":"decision","data":{"id":"one"}}\n');
});

test("event authentication failures produce a nonzero exit status", async t => {
  const directory = await temporary(t), config = join(directory, "config.json");
  const fixture = await server(t, (_req, res) => res.end());
  const wss = new WebSocketServer({ server: fixture.server });
  t.after(() => { for (const client of wss.clients) client.terminate(); wss.close(); });
  wss.on("connection", socket => socket.on("message", () => { socket.send('{"type":"auth.failed"}'); socket.close(1008); }));
  await sessionConfig(config, fixture.url);
  const result = await invoke(["events"], { config, env: { PYRO_API_KEY: "bad-key" } });
  assert.equal(result.code, 3); assert.equal(result.stdout, "");
});

test("unwritable output is rejected before creating one-time secrets, and failed exports remove empty files", async t => {
  const directory = await temporary(t), config = join(directory, "config.json");
  let calls = 0;
  const { url } = await server(t, (_req, res) => { calls++; res.writeHead(500, { "content-type": "application/json" }); res.end('{"error":"Failed"}'); });
  await sessionConfig(config, url);
  const existing = join(directory, "existing.json"); await writeFile(existing, "keep");
  for (const destination of [existing, join(directory, "missing", "key.json")]) {
    const result = await invoke(["keys", "create", "--name", "test", "--output", destination], { config });
    assert.equal(result.code, 2);
  }
  assert.equal(calls, 0); assert.equal(await readFile(existing, "utf8"), "keep");
  const failed = join(directory, "failed.json");
  assert.equal((await invoke(["profiles", "list", "--output", failed], { config })).code, 1);
  await assert.rejects(stat(failed), { code: "ENOENT" });
});

test("connection configuration honors flag/env/file precedence and validates URLs and expired sessions", async t => {
  const directory = await temporary(t), config = join(directory, "config.json");
  assert.equal((await invoke(["config", "set", "gateway-url", "http://localhost:8180/"], { config })).code, 0);
  let result = await invoke(["config", "show"], { config }); assert.equal(JSON.parse(result.stdout).gateway, "http://localhost:8180");
  result = await invoke(["config", "show"], { config, env: { PYRO_GATEWAY_URL: "http://localhost:8280" } }); assert.equal(JSON.parse(result.stdout).gateway, "http://localhost:8280");
  result = await invoke(["--gateway-url", "http://localhost:8380", "config", "show"], { config, env: { PYRO_GATEWAY_URL: "http://localhost:8280" } }); assert.equal(JSON.parse(result.stdout).gateway, "http://localhost:8380");
  for (const value of ["file:///tmp/pyro", "http://user:password@localhost", "http://localhost?x=1"]) assert.equal((await invoke(["config", "set", "gateway-url", value], { config })).code, 2);
  await writeFile(config, JSON.stringify({ version: 1, sessions: { "http://localhost:8081": { token: "expired", expiresAt: 1 } } }));
  assert.equal((await invoke(["auth", "status"], { config })).code, 3);
  await writeFile(config, "corrupt");
  result = await invoke(["config", "show"], { config }); assert.equal(result.code, 2); assert.match(result.stderr, /Cannot read CLI config/);
});

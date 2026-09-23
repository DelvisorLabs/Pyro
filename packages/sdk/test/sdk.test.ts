import assert from "node:assert/strict";
import test from "node:test";
import { PyroClient, PyroError } from "../src/index.js";

test("sends classification envelopes with authentication", async () => {
  let captured: RequestInit | undefined;
  const client = new PyroClient({
    apiKey: "pf_test",
    fetch: async (_input, init) => {
      captured = init;
      return new Response(JSON.stringify({ id: "decision-1", action: "allow" }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await client.classify("hello", { profile: "strict", labels: { session_url: "https://example.test/chats/123" } });
  assert.equal(result.id, "decision-1");
  assert.equal(new Headers(captured?.headers).get("Authorization"), "Bearer pf_test");
  assert.deepEqual(JSON.parse(String(captured?.body)), { input: "hello", profile: "strict", labels: { session_url: "https://example.test/chats/123" } });
});

test("throws a typed error for rejected requests", async () => {
  const client = new PyroClient({
    apiKey: "pf_test",
    fetch: async () => new Response(JSON.stringify({ error: "blocked" }), { status: 403, headers: { "Content-Type": "application/json" } }),
  });
  await assert.rejects(() => client.classify("hello"), (error: unknown) => error instanceof PyroError && error.status === 403);
});

test("polling cancels in flight at its deadline and accepts an already aborted signal", async () => {
  const client = new PyroClient({ apiKey: "test", fetch: async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
  }) });
  await assert.rejects(client.waitForJob("job", { timeoutMs: 20 }), (e) => e instanceof PyroError && e.status === 408);
  const abort = new AbortController(); abort.abort(new Error("cancelled"));
  await assert.rejects(client.waitForJob("job", { signal: abort.signal }), /cancelled/);
});

test("preserves rate-limit and request context", async () => {
  const client = new PyroClient({ apiKey: "test", fetch: async () => new Response('{"error":"slow down"}', { status: 429, headers: { "retry-after": "12", "x-request-id": "req-1" } }) });
  await assert.rejects(client.classify("hello"), (e) => e instanceof PyroError && e.retryAfterSeconds === 12 && e.requestId === "req-1");
});

test("webhook verification rejects tampered bytes, stale timestamps and malformed signatures", async () => {
  const { verifyWebhook } = await import("../src/webhooks.js");
  const { createHmac } = await import("node:crypto");
  const body = '{"type":"decision.created"}'; const timestamp = "1234567890";
  const signature = `v1=${createHmac("sha256", "secret").update(`${timestamp}.${body}`).digest("hex")}`;
  const options = { body, timestamp, signature, secret: "secret", now: 1234567890 };
  assert.equal(await verifyWebhook(options), true);
  assert.equal(await verifyWebhook({ ...options, body: body + " " }), false);
  assert.equal(await verifyWebhook({ ...options, now: 1234569999 }), false);
  assert.equal(await verifyWebhook({ ...options, signature: "v1=no" }), false);
});

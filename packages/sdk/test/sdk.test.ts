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

import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { buildControlPlane } from "../src/app.js";

test("OIDC verifies signed identity, browser-bound state, nonce and provisioned subject", async (t) => {
  const issuer = "https://idp.example.test";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" };
  let nonce = "", subject = "alice-subject", wrongNonce = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) return Response.json({ issuer, authorization_endpoint: issuer + "/authorize", token_endpoint: issuer + "/token", jwks_uri: issuer + "/jwks", response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"], token_endpoint_auth_methods_supported: ["client_secret_post"], code_challenge_methods_supported: ["S256"] });
    if (url.endsWith("/jwks")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/token")) {
      const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
      const data = `${encode({ alg: "RS256", kid: "test" })}.${encode({ iss: issuer, sub: subject, aud: "pyro-test", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, nonce: wrongNonce ? "wrong" : nonce })}`;
      return Response.json({ access_token: "test-access-token", token_type: "Bearer", id_token: `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}` });
    }
    throw new Error(`Unexpected provider URL: ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const config = { host: "127.0.0.1", port: 0, databaseUrl: `memory://oidc-${randomUUID()}`, adminPassword: "correct-horse-battery-staple", controlPlaneSecret: "control-plane-test-secret", gatewayInternalUrl: "http://127.0.0.1:1", gatewayApiKey: "test-key", typesafeEndpoint: "https://api.typesafe.ai/v1/systemone", typesafeModel: "jev-latest", oidc: { issuer, clientId: "pyro-test", clientSecret: "test-client-secret", redirectUri: "https://pyro.example.test/control/api/auth/oidc/callback" } };
  const app = await buildControlPlane(config); t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: config.adminPassword } });
  const admin = login.headers["set-cookie"]!.split(";")[0]!;
  const create = await app.inject({ method: "POST", url: "/api/team", headers: { cookie: admin }, payload: { username: "alice", role: "viewer", appIds: ["default"], oidcSubject: subject } });
  assert.equal(create.statusCode, 201); assert.equal(create.json().password, undefined);
  const start = async () => {
    const response = await app.inject({ method: "GET", url: "/api/auth/oidc/start" });
    assert.equal(response.statusCode, 302, response.body);
    const location = new URL(response.headers.location!); nonce = location.searchParams.get("nonce")!;
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    return { cookie: response.headers["set-cookie"]!.split(";")[0]!, url: `/api/auth/oidc/callback?code=test&state=${location.searchParams.get("state")}` };
  };
  const first = await start();
  assert.equal((await app.inject({ method: "GET", url: first.url })).statusCode, 400);
  const callback = await app.inject({ method: "GET", url: first.url, headers: { cookie: first.cookie } });
  assert.equal(callback.statusCode, 302, callback.body);
  const cookies = callback.headers["set-cookie"] as unknown as string[];
  const sessionCookie = (Array.isArray(cookies) ? cookies : [cookies]).find((c) => c.startsWith("pf_session="))!.split(";")[0]!;
  const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: sessionCookie } });
  assert.equal(me.json().user.username, "alice"); assert.equal(me.json().user.role, "viewer");
  assert.equal((await app.inject({ method: "GET", url: first.url, headers: { cookie: first.cookie } })).statusCode, 400);
  wrongNonce = true;
  const invalid = await start();
  assert.equal((await app.inject({ method: "GET", url: invalid.url, headers: { cookie: invalid.cookie } })).statusCode, 401);
  wrongNonce = false; subject = "unprovisioned";
  const unknown = await start();
  assert.equal((await app.inject({ method: "GET", url: unknown.url, headers: { cookie: unknown.cookie } })).statusCode, 403);
});

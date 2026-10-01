import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const container = process.env.CLOUD_SMOKE_CONTAINER;
const base = process.env.CLOUD_SMOKE_URL ?? "http://127.0.0.1:9082";
if (!container || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) throw new Error("Use CLOUD_SMOKE_CONTAINER and a loopback CLOUD_SMOKE_URL for a disposable local deployment.");
const inContainer = (code) => execFileSync("docker", ["exec", "-w", "/app/apps/cloud", container, "node", "--input-type=module", "-e", code], { encoding: "utf8" }).trim();
const settings = JSON.parse(inContainer('console.log(JSON.stringify({email:process.env.CLOUD_EMAIL_MODE,provider:process.env.CLOUD_PROVIDER_MODE}))'));
assert.deepEqual(settings, { email: "outbox", provider: "mock" }, "Only disposable mock/outbox deployments may run this smoke test.");
async function request(path, body, headers = {}, method = "POST") {
  const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
const signup = await request("/api/auth/signup", { email: `docker-${randomUUID()}@example.test`, password: "disposable-docker-password" }); assert.equal(signup.status, 202);
const link = inContainer(`import {openDatabase,decryptText} from '@pyro/storage';const db=await openDatabase(process.env.DATABASE_URL,'platform'); const rows=await db.document('email_outbox',()=>[]).read(); console.log(JSON.parse(decryptText(rows.at(-1).message,process.env.CONTROL_PLANE_SECRET)).text);await db.close();`);
const verified = await request("/api/auth/verify", { token: new URL(link).searchParams.get("verify") }); assert.equal(verified.status, 200);
const headers = { cookie: verified.cookie };
const org = await request("/api/organizations", { name: "Disposable Docker QA" }, headers); assert.equal(org.status, 201, JSON.stringify(org.body));
const key = await request("/api/keys", { name: "Disposable SDK key" }, headers); assert.equal(key.status, 201, JSON.stringify(key.body));
const decision = await request("/v1/classify", { input: "Container packaging and restricted PostgreSQL role test" }, { authorization: `Bearer ${key.body.key}` }); assert.equal(decision.status, 200, JSON.stringify(decision.body));
const removed = await request("/api/organizations/current", { confirmation: "Disposable Docker QA" }, headers, "DELETE"); assert.equal(removed.status, 200);
assert.notEqual((await request("/v1/classify", { input: "Deleted organization" }, { authorization: `Bearer ${key.body.key}` })).status, 200);
console.log("Packaged cloud: signup, verification, organization, API key, classification and scoped deletion passed.");

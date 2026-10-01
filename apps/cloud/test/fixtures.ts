import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, decryptText } from "@pyro/storage";
import { buildCloud } from "../src/app.js";
import type { CloudConfig } from "../src/config.js";
export const config = (databaseUrl = `memory://${randomUUID()}`): CloudConfig => ({ databaseUrl, secret: "cloud-test-secret-".repeat(3), platformToken: "platform-test-token-".repeat(3), publicUrl: "http://localhost:3000", host: "127.0.0.1", port: 0, providerMode: "mock", providerEndpoint: "https://api.typesafe.ai/v1/systemone", providerModel: "jev-latest", maxOrganizations: 25, trialCredits: 100, monthlyProviderBudgetMicros: 100000, providerPricePerMillion: .042, emailMode: "outbox", emailFrom: "accounts@example.test", packPricePaise: 199900, packCredits: 25000, razorpayWebhookSecret: "test-webhook-secret" });
export async function account(app: Awaited<ReturnType<typeof buildCloud>>, cfg: CloudConfig, address: string) {
  const signup = await app.inject({ method: "POST", url: "/api/auth/signup", payload: { email: address, password: "correct-horse-password" } }); assert.equal(signup.statusCode, 202, signup.body);
  const platform = await openDatabase(cfg.databaseUrl, "platform"); const mail = (await platform.document<any[]>("email_outbox", () => []).read()).at(-1); const message = JSON.parse(decryptText(mail.message, cfg.secret)); await platform.close();
  const verified = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token: new URL(message.text).searchParams.get("verify") } }); assert.equal(verified.statusCode, 200, verified.body);
  const cookie = verified.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const org = await app.inject({ method: "POST", url: "/api/organizations", headers: { cookie }, payload: { name: "Test organization" } }); assert.equal(org.statusCode, 201, org.body);
  const orgId = org.json().organization.id; const headers = { cookie, "x-pyro-organization": orgId };
  const key = await app.inject({ method: "POST", url: "/api/keys", headers, payload: { name: "Test key" } }); assert.equal(key.statusCode, 201, key.body);
  return { headers, orgId, userId: verified.json().user.id, key: key.json().key, keyId: key.json().record.id };
}

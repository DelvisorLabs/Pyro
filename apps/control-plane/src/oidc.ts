import * as oidc from "openid-client";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Database } from "@pyro/storage";
import { encryptText, decryptText } from "@pyro/storage";
import type { SessionRecord, StoredSecret, UserRecord } from "@pyro/contracts";
import type { ControlPlaneConfig } from "./config.js";
import { createSession, sha256 } from "./auth.js";

export function registerOidc(app: FastifyInstance, database: Database, config: ControlPlaneConfig) {
  const settings = config.oidc;
  const attempts = database.document<Array<{ stateHash: string; browserHash: string; expires: number; secret: StoredSecret }>>("oidc_attempts", () => []);
  let discovered: Promise<oidc.Configuration> | undefined;
  const provider = () => {
    if (!settings) throw new Error("OIDC is not configured.");
    if (new URL(settings.issuer).protocol !== "https:" || new URL(settings.redirectUri).protocol !== "https:") throw new Error("OIDC issuer and callback must use HTTPS.");
    return discovered ??= oidc.discovery(new URL(settings.issuer), settings.clientId, settings.clientSecret, undefined, { execute: [oidc.enableNonRepudiationChecks] }).catch((error) => { discovered = undefined; throw error; });
  };
  app.get("/api/auth/options", async () => ({ oidc: Boolean(settings) }));
  app.get("/api/auth/oidc/start", async (_request, reply) => {
    if (!settings) return reply.code(404).send({ error: "OIDC is not configured." });
    const client = await provider();
    const state = oidc.randomState(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier();
    const browser = randomBytes(32).toString("base64url");
    await attempts.update((rows) => [...rows.filter((r) => r.expires > Date.now()).slice(-999), { stateHash: sha256(state), browserHash: sha256(browser), expires: Date.now() + 5 * 60_000, secret: encryptText(JSON.stringify({ nonce, verifier }), config.controlPlaneSecret) }]);
    reply.setCookie("pf_oidc", browser, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 300 });
    return reply.redirect(oidc.buildAuthorizationUrl(client, { redirect_uri: settings.redirectUri, scope: "openid profile", state, nonce, code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256" }).href);
  });
  app.get("/api/auth/oidc/callback", async (request, reply) => {
    if (!settings) return reply.code(404).send({ error: "OIDC is not configured." });
    const callback = new URL(settings.redirectUri);
    callback.search = new URL(request.url, callback.origin).search;
    const state = callback.searchParams.get("state");
    const browser = request.cookies.pf_oidc;
    if (!state || !browser) return reply.code(400).send({ error: "SSO session is missing or expired. Sign in again." });
    let match: { secret: StoredSecret } | undefined;
    await attempts.update((rows) => rows.filter((row) => {
      if (row.stateHash === sha256(state) && row.browserHash === sha256(browser) && row.expires > Date.now()) { match = row; return false; }
      return row.expires > Date.now();
    }));
    reply.clearCookie("pf_oidc", { path: "/" });
    if (!match) return reply.code(400).send({ error: "Invalid or already-used SSO state." });
    try {
      const { nonce, verifier } = JSON.parse(decryptText(match.secret, config.controlPlaneSecret));
      const tokens = await oidc.authorizationCodeGrant(await provider(), callback, { expectedState: state, expectedNonce: nonce, pkceCodeVerifier: verifier, idTokenExpected: true });
      const claims = tokens.claims();
      const users = database.document<UserRecord[]>("users", () => []);
      const user = (await users.read()).find((u) => !u.disabled && u.oidcIssuer === settings.issuer && u.oidcSubject === claims?.sub);
      if (!user) return reply.code(403).send({ error: "An administrator must provision this SSO subject before sign-in." });
      const session = await createSession(database.document<SessionRecord[]>("sessions", () => []), user.id);
      request.user = user;
      reply.setCookie("pf_session", session.token, { path: "/", httpOnly: true, secure: true, sameSite: "strict", maxAge: 86_400 });
      return reply.redirect(new URL("/", settings.redirectUri).href);
    } catch {
      return reply.code(401).send({ error: "SSO verification failed. Sign in again or contact the administrator." });
    }
  });
}

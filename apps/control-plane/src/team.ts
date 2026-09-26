import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SessionRecord, UserRecord, AppRecord } from "@pyro/contracts";
import type { Database } from "@pyro/storage";
import { visibleUser } from "./access.js";
const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await scrypt(password, salt, 64) as Buffer).toString("hex")}`;
}
export async function verifyPassword(password: string, stored?: string): Promise<boolean> {
  if (!stored || password.length > 1024) return false;
  const [salt, expected] = stored.split(":");
  const actual = await scrypt(password, salt!, 64) as Buffer;
  const hash = Buffer.from(expected!, "hex");
  return hash.length === actual.length && timingSafeEqual(hash, actual);
}
const input = z.object({ username: z.string().trim().min(2).max(100), role: z.enum(["admin", "operator", "reviewer", "viewer"]), appIds: z.array(z.string()).max(100).default([]), rawPreviews: z.boolean().default(false), disabled: z.boolean().default(false), password: z.string().min(12).max(1024).optional(), oidcSubject: z.string().max(500).optional() });
export interface AuditEntry { id: string; actorId: string; at: string; action: string; resource: string; status: number; revision?: number }
export function registerTeam(app: FastifyInstance, database: Database, requireSession: (r: FastifyRequest, p: FastifyReply) => Promise<unknown>, oidcIssuer?: string) {
  const users = database.document<UserRecord[]>("users", () => []);
  const sessions = database.document<SessionRecord[]>("sessions", () => []);
  const audits = database.document<AuditEntry[]>("audit_log", () => []);
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.user && !request.auditLogged && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      request.auditLogged = true;
      // Only identifiers are audited. Never record bodies, passwords or cookies.
      let revision: number | undefined;
      try { revision = typeof payload === "string" ? JSON.parse(payload)?.profile?.revision : undefined; } catch {}
      await audits.update((rows) => [...rows, { id: randomUUID(), actorId: request.user!.id, at: new Date().toISOString(), action: request.method, resource: request.url.split("?")[0]!, status: reply.statusCode, revision }]);
    }
    return payload;
  });
  app.get("/api/team", { preHandler: requireSession }, async () => ({ users: (await users.read()).map(visibleUser), oidcConfigured: Boolean(oidcIssuer) }));
  app.post("/api/team", { preHandler: requireSession }, async (request, reply) => {
    const parsed = input.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;
    const appIds = new Set((await database.document<AppRecord[]>("apps", () => []).read()).map((a) => a.id));
    if (body.appIds.some((id) => !appIds.has(id))) return reply.code(400).send({ error: "Application grant does not exist." });
    if (body.oidcSubject && !oidcIssuer) return reply.code(400).send({ error: "Configure OIDC before provisioning an SSO account." });
    const password = body.oidcSubject ? undefined : body.password ?? randomBytes(24).toString("base64url");
    const user: UserRecord = { id: randomUUID(), username: body.username, role: body.role, appIds: body.appIds, rawPreviews: body.rawPreviews, disabled: body.disabled, createdAt: new Date().toISOString(), passwordHash: password ? await hashPassword(password) : undefined, oidcIssuer: body.oidcSubject ? oidcIssuer : undefined, oidcSubject: body.oidcSubject };
    let conflict = false;
    await users.update((rows) => { conflict = rows.some((u) => u.username === user.username || user.oidcSubject && u.oidcSubject === user.oidcSubject); return conflict ? rows : [...rows, user]; });
    if (conflict) return reply.code(409).send({ error: "Username or SSO subject already exists." });
    return reply.code(201).send({ user: visibleUser(user), password, warning: password ? "Store this password securely; it is shown only once." : undefined });
  });
  app.put<{ Params: { id: string } }>("/api/team/:id", { preHandler: requireSession }, async (request, reply) => {
    const parsed = input.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const prior = (await users.read()).find((u) => u.id === request.params.id);
    if (!prior) return reply.code(404).send({ error: "User not found." });
    if (prior.username === "admin" || prior.id === request.user!.id) return reply.code(400).send({ error: "The bootstrap administrator and your own account cannot be changed here." });
    const body = parsed.data;
    const apps = await database.document<AppRecord[]>("apps", () => []).read();
    if (body.appIds.some((id) => !apps.some((a) => a.id === id))) return reply.code(400).send({ error: "Application grant does not exist." });
    if (body.username !== prior.username || body.oidcSubject !== prior.oidcSubject) return reply.code(400).send({ error: "Account identity is immutable. Provision a new account to change identity." });
    const passwordHash = body.password ? await hashPassword(body.password) : prior.passwordHash;
    await users.update((rows) => rows.map((u) => u.id === prior.id ? { ...u, role: body.role, appIds: body.appIds, rawPreviews: body.rawPreviews, disabled: body.disabled, passwordHash } : u));
    await sessions.update((rows) => rows.filter((s) => s.userId !== prior.id));
    return { user: visibleUser((await users.read()).find((u) => u.id === prior.id)!) };
  });
  app.delete<{ Params: { id: string } }>("/api/team/:id/sessions", { preHandler: requireSession }, async (request) => { await sessions.update((rows) => rows.filter((s) => s.userId !== request.params.id)); return { ok: true }; });
  app.get("/api/audit", { preHandler: requireSession }, async () => ({ entries: (await audits.read()).slice(-1000).reverse() }));
}

declare module "fastify" { interface FastifyRequest { auditLogged?: boolean } }

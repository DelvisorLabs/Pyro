import { randomUUID } from "node:crypto";
import type { AuditEntry } from "./team.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppRecord, ClassificationEvent, UserRecord } from "@pyro/contracts";
import type { Database } from "@pyro/storage";
import { sessionUserId } from "./auth.js";

export function visibleUser({ passwordHash, ...user }: UserRecord) { return user; }
export const appScope = (user: UserRecord) => user.role === "admin" ? undefined : user.appIds ?? [];
export const canAccessApp = (user: UserRecord, id = "default") => user.role === "admin" || Boolean(user.appIds?.includes(id));
export function visibleEvent(user: UserRecord, event: ClassificationEvent): ClassificationEvent {
  if (user.role === "admin" || user.rawPreviews) return event;
  const { inputPreview, metadata, appRulesSnapshot, ...safe } = event;
  return safe;
}
export function accessGuard(database: Database) {
  const users = database.document<UserRecord[]>("users", () => []);
  const sessions = database.document<import("@pyro/contracts").SessionRecord[]>("sessions", () => []);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const id = await sessionUserId(sessions, request.cookies.pf_session);
    const user = (await users.read()).find((u) => u.id === id && !u.disabled);
    if (!user) return reply.code(401).send({ error: "Authentication required." });
    request.user = user;
    const grant = async () => {
      if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
      await database.document<AuditEntry[]>("audit_log", () => []).update((rows) => [...rows, { id: randomUUID(), actorId: user.id, at: new Date().toISOString(), action: request.method, resource: request.url.split("?")[0]!, status: 0, revision: (request.body as { revision?: number })?.revision }]);
    };
    if (user.role === "admin") return grant();
    const path = request.routeOptions.url ?? "";
    const method = request.method;
    if (path.startsWith("/api/auth/")) return grant();
    if (method === "GET" && ["/api/overview", "/api/usage", "/api/activity", "/api/activity/:id", "/api/apps", "/api/profiles", "/api/profile-presets", "/api/reviews", "/api/reviews/:id", "/api/evaluations", "/api/evaluations/:id", "/api/datasets"].includes(path)) return grant();
    if (path.startsWith("/api/reviews/") && user.role === "reviewer") return grant();
    if (user.role === "operator") {
      if (["/api/evaluations", "/api/evaluations/:id", "/api/datasets", "/api/reviews/:id"].includes(path)) return grant();
      if (path === "/api/keys" && method === "GET") return;
      const body = request.body as { appId?: string } | undefined;
      const params = request.params as { id?: string };
      let appId: string | undefined;
      if (path === "/api/keys" && method === "POST") appId = body?.appId ?? "default";
      if (path === "/api/keys/:id") appId = (await database.document<import("@pyro/contracts").ApiKeyRecord[]>("api_keys", () => []).read()).find((k) => k.id === params.id)?.appId;
      if (appId && canAccessApp(user, appId)) return grant();
    }
    return reply.code(403).send({ error: "Your role does not permit this action." });
  };
}

export async function allowedProfiles(database: Database, user: UserRecord) {
  const apps = (await database.document<AppRecord[]>("apps", () => []).read()).filter((a) => canAccessApp(user, a.id));
  return (id: string) => user.role === "admin" || apps.some((a) => !a.allowedProfileIds.length || a.allowedProfileIds.includes(id));
}

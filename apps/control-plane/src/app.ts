import { createHash, randomBytes, randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, LogController } from "fastify";
import type { WebSocket } from "ws";
import {
  AppSchema,
  createDefaultApp,
  createDefaultProfile,
  createDefaultProviderSettings,
  ProfileSchema,
  ProviderSettingsSchema,
  type AppRecord,
  type ApiKeyRecord,
  type Profile,
  type ProviderSettings,
  type SessionRecord,
  type StoredSecret,
  type UserRecord,
} from "@pyro/contracts";
import { encryptText, openDatabase, PolicyStore, type PolicyRecord, consumeQuota } from "@pyro/storage";
import { createSession, ensureAdmin, sessionUserId, sha256, verifyAdminPassword } from "./auth.js";
import type { ControlPlaneConfig } from "./config.js";

import { accessGuard, appScope, canAccessApp, visibleEvent, visibleUser, allowedProfiles } from "./access.js";
import { registerEvaluations } from "./evaluations.js";
import { registerReviews } from "./reviews.js";
import { registerTeam, verifyPassword } from "./team.js";
import { registerOidc } from "./oidc.js";
import { registerPolicyHistory } from "./policies.js";
import { registerIntegrations } from "./integrations.js";
import { exportProfileYaml, loadPresetProfiles, parseProfileYaml } from "./profile-files.js";

interface SecretFile {
  typesafeApiKey?: StoredSecret;
}

function appIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "app";
}

function usageWindow(value: string | undefined): { name: "24h" | "7d" | "30d"; bucketMs: number; buckets: number } {
  if (value === "24h") return { name: "24h", bucketMs: 60 * 60_000, buckets: 24 };
  if (value === "30d") return { name: "30d", bucketMs: 24 * 60 * 60_000, buckets: 30 };
  return { name: "7d", bucketMs: 24 * 60 * 60_000, buckets: 7 };
}

export async function buildControlPlane(config: ControlPlaneConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 1_000_000,
    trustProxy: true,
  });
  await app.register(cookie);
  await app.register(websocket);

  const database = await openDatabase(config.databaseUrl);
  const usersStore = database.document<UserRecord[]>("users", () => []);
  const sessionsStore = database.document<SessionRecord[]>("sessions", () => []);
  const keysStore = database.document<ApiKeyRecord[]>("api_keys", () => []);
  const appsStore = database.document<AppRecord[]>("apps", () => [createDefaultApp()]);
  const profilesStore = new PolicyStore(database.document<PolicyRecord[]>("profiles", () => [createDefaultProfile()]));
  await profilesStore.initialize();
  const settingsStore = database.document<ProviderSettings>("provider_settings", () => ({
    ...createDefaultProviderSettings(),
    endpoint: config.typesafeEndpoint,
    model: config.typesafeModel,
  }));
  const secretsStore = database.document<SecretFile>("provider_secrets", () => ({}));
  const eventsStore = database.events;

  await ensureAdmin(usersStore);
  const storedApps = await appsStore.read();
  const normalizedApps = storedApps.flatMap((record) => {
    const parsed = AppSchema.safeParse(record);
    return parsed.success ? [parsed.data] : [];
  });
  const validApps = normalizedApps.length ? normalizedApps : [createDefaultApp()];
  if (JSON.stringify(validApps) !== JSON.stringify(storedApps)) await appsStore.write(validApps);
  const storedKeys = await keysStore.read();
  if (storedKeys.some((key) => !key.appId)) {
    await keysStore.write(storedKeys.map((key) => ({ ...key, appId: key.appId ?? "default" })));
  }
  const storedProfiles = await profilesStore.read();
  const normalizedProfiles = storedProfiles.flatMap((profile) => {
    const parsed = ProfileSchema.safeParse(profile);
    return parsed.success ? [parsed.data] : [];
  });
  if (normalizedProfiles.length !== storedProfiles.length || JSON.stringify(normalizedProfiles) !== JSON.stringify(storedProfiles)) {
    await profilesStore.write(normalizedProfiles.length ? normalizedProfiles : [createDefaultProfile()]);
  }
  const storedSettings = await settingsStore.read();
  const normalizedSettings = ProviderSettingsSchema.safeParse(storedSettings);
  if (normalizedSettings.success && JSON.stringify(normalizedSettings.data) !== JSON.stringify(storedSettings)) {
    await settingsStore.write(normalizedSettings.data);
  } else if (!normalizedSettings.success) {
    await settingsStore.write({ ...createDefaultProviderSettings(), endpoint: config.typesafeEndpoint, model: config.typesafeModel });
  }

  const requireSession = accessGuard(database);

  app.decorateRequest("user", null);
  const stopEvaluations = registerEvaluations(app, database, config, requireSession);
  const stopReviews = registerReviews(app, database, requireSession);
  registerTeam(app, database, requireSession, config.oidc?.issuer);
  registerOidc(app, database, config);
  registerIntegrations(app, database, config.controlPlaneSecret, requireSession);

  app.get("/health", async () => {
    await database.ping();
    return { status: "ok", database: database.kind };
  });

  app.post<{ Body: { username?: string; password?: string } }>("/api/auth/login", async (request, reply) => {
    const { password, username = "admin" } = request.body ?? {};
    if (typeof username !== "string" || username.length > 100 || typeof password !== "string" || password.length > 1024) return reply.code(400).send({ error: "Invalid credentials." });
    const quota = await consumeQuota(database, [{ id: `login:${sha256(username)}`, limit: 10 }]);
    if (!quota.allowed) return reply.code(429).send({ error: "Too many sign-in attempts. Try again in a minute." });
    const user = (await usersStore.read()).find((item) => item.username === username && !item.disabled);
    if (!user || !(username === "admin" ? verifyAdminPassword(password, config.adminPassword) : await verifyPassword(password, user.passwordHash))) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return reply.code(401).send({ error: "Invalid administrator password." });
    }
    await usersStore.update((users) => users.map((item) => item.id === user.id
      ? { ...item, lastLoginAt: new Date().toISOString() }
      : item));
    const session = await createSession(sessionsStore, user.id);
    reply.setCookie("pf_session", session.token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: request.protocol === "https",
      maxAge: 24 * 60 * 60,
    });
    request.user = user;
    return { user: visibleUser(user) };
  });

  app.post("/api/auth/logout", { preHandler: requireSession }, async (request, reply) => {
    const token = request.cookies.pf_session;
    if (token) await sessionsStore.update((current) => current.filter((item) => item.tokenHash !== sha256(token)));
    reply.clearCookie("pf_session", { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireSession }, async (request) => {
    const user = (await usersStore.read()).find((item) => item.id === request.user?.id);
    return { user: user ? visibleUser(user) : null };
  });

  app.get("/api/overview", { preHandler: requireSession }, async (request) => {
    const aggregate = await eventsStore.overview(undefined, appScope(request.user!));
    let gateway: unknown = { status: "offline" };
    try {
      const response = await fetch(`${config.gatewayInternalUrl}/v1/health`, { signal: AbortSignal.timeout(1_500) });
      gateway = response.ok ? await response.json() : { status: "degraded" };
    } catch {
      gateway = { status: "offline" };
    }
    return {
      ...aggregate,
      gateway: request.user!.role === "admin" ? gateway : undefined,
    };
  });

  app.get("/api/usage", { preHandler: requireSession }, async (request) => {
    const query = request.query as { range?: string; appId?: string };
    const window = usageWindow(query.range);
    const now = Date.now();
    const from = now - window.bucketMs * window.buckets;
    const aggregate = await eventsStore.usage({
      from: new Date(from).toISOString(),
      to: new Date(now).toISOString(),
      bucketMs: window.bucketMs,
      buckets: window.buckets,
      appId: query.appId,
      appIds: appScope(request.user!),
    });
    return {
      range: window.name,
      from: new Date(from).toISOString(),
      to: new Date(now).toISOString(),
      ...aggregate,
    };
  });

  app.get("/api/activity", { preHandler: requireSession }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const limit = Math.min(500, Math.max(1, Number(query.limit ?? 100)));
    const offset = Math.max(0, Number(query.offset ?? 0));
    const filters = {
      appIds: appScope(request.user!),
      excludeRawSearch: request.user!.role !== "admin" && !request.user!.rawPreviews,
      action: query.action, verdict: query.verdict, status: query.status, profile: query.profile, provider: query.provider,
      apiKey: query.apiKey, appId: query.appId, from: query.from, to: query.to,
      minimumRisk: query.minimumRisk === undefined ? undefined : Number(query.minimumRisk),
      labelKey: query.labelKey, labelValue: query.labelValue, search: query.search,
    };
    if (query.format === "json") {
      const result = await eventsStore.query(filters);
      reply.header("Content-Disposition", `attachment; filename="pyro-events-${Date.now()}.json"`);
      return reply.type("application/json").send(result.events.map((event) => visibleEvent(request.user!, event)));
    }
    if (query.format === "csv") {
      const result = await eventsStore.query(filters);
      const escape = (value: unknown) => {
        const raw = String(value ?? "");
        const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
        return `"${safe.replaceAll('"', '""')}"`;
      };
      const rows = [
        ["id", "request_id", "created_at", "app", "profile", "verdict", "action", "risk", "provider", "model", "latency_ms", "queue_ms", "api_key", "input_hash", "labels", "cost_amount", "cost_currency", "reason"],
        ...result.events.map((event) => [event.id, event.requestId, event.createdAt, event.appName ?? event.appId ?? "default", event.profileId, event.verdict, event.action, event.risk, event.provider, event.model, event.latencyMs, event.queueMs, event.apiKeyName, event.inputHash, JSON.stringify(event.labels ?? {}), event.usage?.cost?.amount, event.usage?.cost?.currency, event.reason]),
      ];
      reply.header("Content-Disposition", `attachment; filename="pyro-events-${Date.now()}.csv"`);
      return reply.type("text/csv").send(rows.map((row) => row.map(escape).join(",")).join("\n"));
    }
    const result = await eventsStore.query({ ...filters, limit, offset });
    return { events: result.events.map((event) => visibleEvent(request.user!, event)), total: result.total, hasMore: offset + limit < result.total, labelKeys: result.labelKeys };
  });

  app.get<{ Params: { id: string } }>("/api/activity/:id", { preHandler: requireSession }, async (request, reply) => {
    const event = await eventsStore.findById(request.params.id);
    if (!event || !canAccessApp(request.user!, event.appId)) return reply.code(404).send({ error: "Trace not found." });
    return { event: visibleEvent(request.user!, event) };
  });

  app.post("/api/classify", { preHandler: requireSession }, async (request, reply) => {
    try {
      const response = await fetch(`${config.gatewayInternalUrl}/v1/classify`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.gatewayApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(125_000),
      });
      const payload = await response.json();
      return reply.code(response.status).send(payload);
    } catch (error) {
      request.log.error(error);
      return reply.code(502).send({ error: "The gateway is unavailable." });
    }
  });

  registerPolicyHistory(app, profilesStore, requireSession);

  const presets = await loadPresetProfiles();
  app.get("/api/profile-presets", { preHandler: requireSession }, async () => ({ presets }));
  app.post<{ Body: { yaml?: string } }>("/api/profiles/preview", { preHandler: requireSession }, async (request, reply) => {
    try {
      if (typeof request.body?.yaml !== "string") throw new Error("A YAML string is required.");
      return { profile: parseProfileYaml(request.body.yaml) };
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid YAML." }); }
  });
  app.post<{ Body: { yaml?: string } }>("/api/profiles/import", { preHandler: requireSession }, async (request, reply) => {
    try {
      if (typeof request.body?.yaml !== "string") throw new Error("A YAML string is required.");
      const profile = parseProfileYaml(request.body.yaml);
      let conflict = false;
      await profilesStore.update((current) => {
        conflict = current.some((p) => p.id === profile.id || p.name.trim().toLowerCase() === profile.name.trim().toLowerCase());
        return conflict ? current : [...current, profile];
      });
      if (conflict) return reply.code(409).send({ error: "A profile with this ID or name already exists. Change it before importing." });
      return reply.code(201).send({ profile: (await profilesStore.read()).find((p) => p.id === profile.id) });
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid YAML." }); }
  });
  app.get<{ Params: { id: string } }>("/api/profiles/:id/export", { preHandler: requireSession }, async (request, reply) => {
    const profile = (await profilesStore.read()).find((p) => p.id === request.params.id);
    if (!profile) return reply.code(404).send({ error: "Profile not found." });
    return reply.header("Content-Disposition", `attachment; filename="${profile.id}.yaml"`).type("application/yaml").send(exportProfileYaml(profile));
  });

  app.get("/api/profiles", { preHandler: requireSession }, async (request) => { const allows = await allowedProfiles(database, request.user!); return { profiles: (await profilesStore.read()).filter((p) => allows(p.id)) }; });

  app.post("/api/profiles", { preHandler: requireSession }, async (request, reply) => {
    const now = new Date().toISOString();
    const body = request.body as Record<string, unknown>;
    const profiles = await profilesStore.read();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (profiles.some((profile) => profile.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      return reply.code(409).send({ error: "A policy with this name already exists." });
    }
    const baseId = name.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56) || "policy";
    let id = baseId;
    for (let suffix = 2; profiles.some((profile) => profile.id === id); suffix += 1) id = `${baseId}-${suffix}`;
    const parsed = ProfileSchema.safeParse({ ...body, id, name, createdAt: now, updatedAt: now });
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid profile." });
    const saved = await profilesStore.update((current) => [...current, parsed.data], request.user!.id);
    return reply.code(201).send({ profile: saved.find((p) => p.id === parsed.data.id) });
  });

  app.put<{ Params: { id: string } }>("/api/profiles/:id", { preHandler: requireSession }, async (request, reply) => {
    const current = (await profilesStore.read()).find((profile) => profile.id === request.params.id);
    if (!current) return reply.code(404).send({ error: "Profile not found." });
    const parsed = ProfileSchema.safeParse({
      ...(request.body as object),
      id: request.params.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    });
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid profile." });
    const duplicateName = (await profilesStore.read()).some((profile) => profile.id !== request.params.id && profile.name.trim().toLocaleLowerCase() === parsed.data.name.trim().toLocaleLowerCase());
    if (duplicateName) return reply.code(409).send({ error: "A policy with this name already exists." });
    const saved = await profilesStore.update((profiles) => profiles.map((item) => item.id === request.params.id ? parsed.data : item), request.user!.id);
    return { profile: saved.find((p) => p.id === request.params.id) };
  });

  app.delete<{ Params: { id: string } }>("/api/profiles/:id", { preHandler: requireSession }, async (request, reply) => {
    if (request.params.id === "default") return reply.code(400).send({ error: "The default profile cannot be deleted." });
    const profiles = await profilesStore.read();
    if (!profiles.some((profile) => profile.id === request.params.id)) return reply.code(404).send({ error: "Profile not found." });
    const [applications, apiKeys] = await Promise.all([appsStore.read(), keysStore.read()]);
    const referencedByApp = applications.some((record) => record.defaultProfileId === request.params.id || record.allowedProfileIds.includes(request.params.id) || Boolean(record.profileRevisions?.[request.params.id]) || record.canary?.profileId === request.params.id);
    const referencedByKey = apiKeys.some((key) => !key.revokedAt && (key.defaultProfileId === request.params.id || key.allowedProfileIds?.includes(request.params.id)));
    const referencedByShadow = profiles.some((profile) => profile.id !== request.params.id && profile.shadowProfileIds.includes(request.params.id));
    if (referencedByApp || referencedByKey || referencedByShadow) {
      return reply.code(409).send({ error: "Remove this policy from applications, active API keys, and shadow policies before deleting it." });
    }
    await profilesStore.update((current) => current.filter((profile) => profile.id !== request.params.id));
    return reply.code(204).send();
  });

  app.get("/api/apps", { preHandler: requireSession }, async (request) => {
    const keys = await keysStore.read();
    return {
      apps: (await appsStore.read()).filter((record) => canAccessApp(request.user!, record.id)).map((record) => ({
        ...record,
        activeKeyCount: keys.filter((key) => (key.appId ?? "default") === record.id && !key.revokedAt).length,
      })),
    };
  });

  app.post("/api/apps", { preHandler: requireSession }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return reply.code(400).send({ error: "An application name is required." });
    const current = await appsStore.read();
    const base = appIdFromName(typeof body.id === "string" ? body.id : name);
    let id = base;
    let suffix = 2;
    while (current.some((record) => record.id === id)) {
      id = `${base.slice(0, 60)}-${suffix}`;
      suffix += 1;
    }
    const now = new Date().toISOString();
    const defaults = createDefaultApp(now);
    const parsed = AppSchema.safeParse({
      ...defaults,
      ...body,
      id,
      name,
      createdAt: now,
      updatedAt: now,
    });
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid application." });
    const records = await profilesStore.records.read();
    for (const [id, revision] of Object.entries(parsed.data.profileRevisions ?? {})) {
      if (!records.find((p) => p.id === id && !p.archived)?.revisions?.some((r) => r.revision === revision && r.state === "published")) return reply.code(400).send({ error: "Pinned policy revision does not exist or is not published." });
    }
    const canary = parsed.data.canary;
    if (canary && !records.find((p) => p.id === canary.profileId && !p.archived)?.revisions?.some((r) => r.revision === canary.revision && r.state === "published")) return reply.code(400).send({ error: "Canary revision must be published." });
    const profiles = new Set((await profilesStore.read()).map((profile) => profile.id));
    if (!profiles.has(parsed.data.defaultProfileId)) return reply.code(400).send({ error: "The default policy does not exist." });
    if (parsed.data.allowedProfileIds.some((profileId) => !profiles.has(profileId))) return reply.code(400).send({ error: "An allowed policy does not exist." });
    if (parsed.data.allowedProfileIds.length > 0 && !parsed.data.allowedProfileIds.includes(parsed.data.defaultProfileId)) return reply.code(400).send({ error: "The default policy must also be allowed." });
    if (new Set(parsed.data.localRules.map((rule) => rule.id)).size !== parsed.data.localRules.length) return reply.code(400).send({ error: "Local rule IDs must be unique within an application." });
    await appsStore.write([...current, parsed.data]);
    return reply.code(201).send({ app: parsed.data });
  });

  app.put<{ Params: { id: string } }>("/api/apps/:id", { preHandler: requireSession }, async (request, reply) => {
    const current = (await appsStore.read()).find((record) => record.id === request.params.id);
    if (!current) return reply.code(404).send({ error: "Application not found." });
    const parsed = AppSchema.safeParse({
      ...(request.body as object),
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    });
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid application." });
    const records = await profilesStore.records.read();
    for (const [id, revision] of Object.entries(parsed.data.profileRevisions ?? {})) {
      if (!records.find((p) => p.id === id && !p.archived)?.revisions?.some((r) => r.revision === revision && r.state === "published")) return reply.code(400).send({ error: "Pinned policy revision does not exist or is not published." });
    }
    const canary = parsed.data.canary;
    if (canary && !records.find((p) => p.id === canary.profileId && !p.archived)?.revisions?.some((r) => r.revision === canary.revision && r.state === "published")) return reply.code(400).send({ error: "Canary revision must be published." });
    const profiles = new Set((await profilesStore.read()).map((profile) => profile.id));
    if (!profiles.has(parsed.data.defaultProfileId)) return reply.code(400).send({ error: "The default policy does not exist." });
    if (parsed.data.allowedProfileIds.some((profileId) => !profiles.has(profileId))) return reply.code(400).send({ error: "An allowed policy does not exist." });
    if (parsed.data.allowedProfileIds.length > 0 && !parsed.data.allowedProfileIds.includes(parsed.data.defaultProfileId)) return reply.code(400).send({ error: "The default policy must also be allowed." });
    if (new Set(parsed.data.localRules.map((rule) => rule.id)).size !== parsed.data.localRules.length) return reply.code(400).send({ error: "Local rule IDs must be unique within an application." });
    await appsStore.update((records) => records.map((record) => record.id === current.id ? parsed.data : record));
    return { app: parsed.data };
  });

  app.delete<{ Params: { id: string } }>("/api/apps/:id", { preHandler: requireSession }, async (request, reply) => {
    if (request.params.id === "default") return reply.code(400).send({ error: "The default application cannot be deleted." });
    const current = await appsStore.read();
    if (!current.some((record) => record.id === request.params.id)) return reply.code(404).send({ error: "Application not found." });
    const hasKeys = (await keysStore.read()).some((key) => (key.appId ?? "default") === request.params.id && !key.revokedAt);
    if (hasKeys) return reply.code(409).send({ error: "Revoke this application's active API keys before deleting it." });
    await appsStore.write(current.filter((record) => record.id !== request.params.id));
    return reply.code(204).send();
  });

  app.get("/api/keys", { preHandler: requireSession }, async (request) => ({
    keys: (await keysStore.read()).filter((key) => canAccessApp(request.user!, key.appId)).map(({ hash: _hash, ...key }) => key),
  }));

  app.post<{ Body: { name?: string; appId?: string; defaultProfileId?: string; allowedProfileIds?: string[]; rateLimitPerMinute?: number } }>("/api/keys", { preHandler: requireSession }, async (request, reply) => {
    const name = request.body?.name?.trim();
    if (!name || name.length > 100) return reply.code(400).send({ error: "A key name is required." });
    const appId = request.body.appId ?? "default";
    const firewallApp = (await appsStore.read()).find((record) => record.id === appId);
    if (!firewallApp) return reply.code(400).send({ error: "Application not found." });
    const raw = `pf_${randomBytes(28).toString("base64url")}`;
    const profileIds = new Set((await profilesStore.read()).map((profile) => profile.id));
    const appAllows = (profileId: string) => firewallApp.allowedProfileIds.length === 0
      || firewallApp.allowedProfileIds.includes(profileId);
    if (request.body.allowedProfileIds?.some((id) => !profileIds.has(id) || !appAllows(id))) {
      return reply.code(400).send({ error: "An API key cannot grant a policy that its application does not allow." });
    }
    const allowedProfileIds = Array.isArray(request.body.allowedProfileIds)
      ? [...new Set(request.body.allowedProfileIds)].slice(0, 100)
      : undefined;
    if (request.body.defaultProfileId && (!profileIds.has(request.body.defaultProfileId) || !appAllows(request.body.defaultProfileId))) {
      return reply.code(400).send({ error: "The API key default policy must be allowed by its application." });
    }
    if (request.body.defaultProfileId && allowedProfileIds?.length && !allowedProfileIds.includes(request.body.defaultProfileId)) {
      return reply.code(400).send({ error: "The API key default policy must be included in its policy access list." });
    }
    const defaultProfileId = request.body.defaultProfileId;
    const rateLimitPerMinute = request.body.rateLimitPerMinute === undefined
      ? undefined
      : Math.max(1, Math.min(1_000_000, Math.floor(request.body.rateLimitPerMinute)));
    const record: ApiKeyRecord = {
      id: randomUUID(),
      name,
      prefix: raw.slice(0, 12),
      hash: createHash("sha256").update(raw).digest("hex"),
      appId,
      createdAt: new Date().toISOString(),
      scopes: ["classify"],
      defaultProfileId,
      allowedProfileIds,
      rateLimitPerMinute,
    };
    await keysStore.update((current) => [...current, record]);
    return reply.code(201).send({
      key: raw,
      record: (({ hash: _hash, ...visible }) => visible)(record),
      warning: "This key is shown only once.",
    });
  });

  app.delete<{ Params: { id: string } }>("/api/keys/:id", { preHandler: requireSession }, async (request, reply) => {
    const now = new Date().toISOString();
    let found = false;
    await keysStore.update((current) => current.map((key) => {
      if (key.id !== request.params.id) return key;
      found = true;
      return { ...key, revokedAt: now };
    }));
    if (!found) return reply.code(404).send({ error: "API key not found." });
    return { ok: true };
  });

  app.get("/api/settings/provider", { preHandler: requireSession }, async () => ({
    settings: await settingsStore.read(),
    apiKeyConfigured: Boolean(config.typesafeApiKey || (await secretsStore.read()).typesafeApiKey),
    apiKeySource: config.typesafeApiKey ? "environment" : (await secretsStore.read()).typesafeApiKey ? "dashboard" : null,
  }));

  app.put("/api/settings/provider", { preHandler: requireSession }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const parsed = ProviderSettingsSchema.safeParse({
      mode: body.mode,
      endpoint: body.endpoint,
      model: body.model,
      maxRetries: body.maxRetries,
      retryBackoffMs: body.retryBackoffMs,
      circuitBreakerFailureThreshold: body.circuitBreakerFailureThreshold,
      circuitBreakerResetMs: body.circuitBreakerResetMs,
      updatedAt: new Date().toISOString(),
    });
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid provider settings." });
    await settingsStore.write(parsed.data);
    if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      await secretsStore.write({ typesafeApiKey: encryptText(body.apiKey.trim(), config.controlPlaneSecret) });
    } else if (body.clearApiKey === true) {
      await secretsStore.write({});
    }
    return {
      settings: parsed.data,
      apiKeyConfigured: Boolean(config.typesafeApiKey || (await secretsStore.read()).typesafeApiKey),
    };
  });

  const sockets = new Map<WebSocket, string>();
  app.get("/ws", { websocket: true }, async (socket: WebSocket, request) => {
    const userId = await sessionUserId(sessionsStore, request.cookies.pf_session);
    const user = (await usersStore.read()).find((u) => u.id === userId && !u.disabled);
    if (!user) {
      socket.close(1008, "Authentication required");
      return;
    }
    sockets.set(socket, request.cookies.pf_session!);
    socket.send(JSON.stringify({ type: "connected", data: { userId } }));
    socket.on("close", () => sockets.delete(socket));
  });

  let eventCursor = await eventsStore.latestCursor() ?? { createdAt: new Date().toISOString(), id: "" };
  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      const profiles = await profilesStore.read();
      const connected = new Map<WebSocket, UserRecord>();
      const users = await usersStore.read();
      for (const [socket, token] of sockets) {
        const userId = await sessionUserId(sessionsStore, token);
        const user = users.find((u) => u.id === userId && !u.disabled);
        if (!user) { socket.close(1008, "Session revoked or expired"); sockets.delete(socket); }
        else connected.set(socket, user);
      }
      while (true) {
        const unseen = await eventsStore.readAfter(eventCursor, 500);
        if (unseen.length === 0) break;
        for (const event of unseen) {
          const profile = profiles.find((item) => item.id === event.profileId);
          for (const [socket, user] of connected) {
            if (socket.readyState === socket.OPEN && canAccessApp(user, event.appId)) socket.send(JSON.stringify({ type: "decision", data: visibleEvent(user, event), notify: profile?.notifyOn.includes(event.action) ?? event.action !== "allow" }));
          }
        }
        const last = unseen.at(-1)!;
        eventCursor = { createdAt: last.createdAt, id: last.id };
        if (unseen.length < 500) break;
      }
    } catch (error) {
      app.log.error(error, "activity notification poll failed");
    } finally {
      polling = false;
    }
  };
  const poller = setInterval(() => void poll(), 500);
  poller.unref();
  app.addHook("onClose", async () => {
    clearInterval(poller);
    await stopEvaluations();
    await stopReviews();
    await database.close();
  });

  return app;
}

declare module "fastify" {
  interface FastifyRequest {
    user: UserRecord | null;
  }
}

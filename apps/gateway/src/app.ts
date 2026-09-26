import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, LogController } from "fastify";
import type { WebSocket } from "ws";
import { evaluatePolicy } from "@pyro/classifiers";
import {
  AppSchema,
  ClassificationEnvelopeSchema,
  ProfileSchema,
  ProviderSettingsSchema,
  createDefaultApp,
  createDefaultProfile,
  createDefaultProviderSettings,
  type AppRecord,
  type ApiKeyRecord,
  type ClassificationDecision,
  type ClassificationEnvelope,
  type ClassificationEvent,
  type Profile,
  type ProviderSettings,
  type StoredSecret,
  type StoredIntegration,
} from "@pyro/contracts";
import { ConcurrentQueue, QueueFullError } from "@pyro/queue";
import { CachedDocument, decryptText, openDatabase, PolicyStore, revisionOf, type PolicyRecord, policyHash, DurableJobs, DurableWorker, consumeQuota, JobCapacityError, JobConflict } from "@pyro/storage";
import { decisionDeliveries, DeliveryWorker } from "@pyro/integrations";
import type { GatewayConfig } from "./config.js";
import { GatewayMetrics } from "./metrics.js";

interface SecretFile {
  typesafeApiKey?: StoredSecret;
}



function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function serializeInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    throw new Error("Input must be serializable as JSON.");
  }
}

function envelopeFromBody(body: unknown): ClassificationEnvelope {
  if (body && typeof body === "object" && !Array.isArray(body) && "input" in body) {
    return ClassificationEnvelopeSchema.parse(body);
  }
  return ClassificationEnvelopeSchema.parse({ input: body });
}

function bearer(request: FastifyRequest): string | undefined {
  const value = request.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() : undefined;
}

function requestIdentity(request: FastifyRequest): { decisionId: string; requestId: string; traceId: string } {
  const providedId = request.headers["x-request-id"];
  const requestId = typeof providedId === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(providedId) ? providedId : randomUUID();
  const traceparent = request.headers.traceparent;
  const traceId = typeof traceparent === "string"
    ? /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i.exec(traceparent)?.[1]
    : undefined;
  return { decisionId: randomUUID(), requestId, traceId: traceId?.toLowerCase() ?? randomUUID().replaceAll("-", "") };
}

export async function buildGateway(config: GatewayConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 2_000_000,
    trustProxy: true,
  });
  await app.register(cors, { origin: true, methods: ["GET", "POST", "OPTIONS"] });
  await app.register(websocket, { options: { maxPayload: 4_096 } });
  app.decorateRequest("apiKey", null);
  app.decorateRequest("firewallApp", null);
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_request, body, done) => done(null, body));

  const database = await openDatabase(config.databaseUrl);
  const profilesStore = database.document<PolicyRecord[]>("profiles", () => [createDefaultProfile()]);
  await new PolicyStore(profilesStore).initialize();
  const appsStore = database.document<AppRecord[]>("apps", () => [createDefaultApp()]);
  const settingsStore = database.document<ProviderSettings>("provider_settings", createDefaultProviderSettings);
  const keysStore = database.document<ApiKeyRecord[]>("api_keys", () => []);
  const secretsStore = database.document<SecretFile>("provider_secrets", () => ({}));
  const eventsStore = database.events;
  const integrations = new CachedDocument(database.document<StoredIntegration[]>("integrations", () => []));
  const deliveryWorker = new DeliveryWorker(database, config.controlPlaneSecret);
  const profiles = new CachedDocument(profilesStore);
  const apps = new CachedDocument(appsStore);
  const settings = new CachedDocument(settingsStore);
  const keys = new CachedDocument(keysStore);
  const secrets = new CachedDocument(secretsStore);

  await appsStore.update((stored) => {
    const valid = stored.flatMap((record) => { const parsed = AppSchema.safeParse(record); return parsed.success ? [parsed.data] : []; });
    return valid.length ? valid : [createDefaultApp()];
  });
  await settingsStore.update((stored) => { const parsed = ProviderSettingsSchema.safeParse(stored); return parsed.success ? parsed.data : createDefaultProviderSettings(); });
  await keysStore.update((stored) => {
    const normalized = stored.map((key) => ({ ...key, appId: key.appId ?? "default" }));
    if (normalized.length || !config.bootstrapApiKey) return normalized;
    return [{ id: randomUUID(), name: "Local development", prefix: config.bootstrapApiKey.slice(0, 8), hash: hash(config.bootstrapApiKey), appId: "default", createdAt: new Date().toISOString() }];
  });

  const queue = new ConcurrentQueue(config.queueConcurrency, config.queueMaxDepth);
  const metrics = new GatewayMetrics();
  const eventBus = new EventEmitter();
  eventBus.setMaxListeners(1_000);
  const jobs = new DurableJobs(database, config.controlPlaneSecret, "classification_jobs", Math.min(config.queueMaxDepth, 200));
  const circuit = { consecutiveFailures: 0, openUntil: 0 };

  const authenticate = async (candidate: string | undefined): Promise<ApiKeyRecord | undefined> => {
    if (!candidate) return undefined;
    const candidateHash = hash(candidate);
    return (await keys.read()).find((key) => !key.revokedAt && secureEqual(key.hash, candidateHash));
  };

  const requireApiKey = async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = await authenticate(bearer(request));
    if (!apiKey) {
      return reply.code(401).send({ error: "A valid gateway API key is required." });
    }
    const firewallApp = (await apps.read()).find((candidate) => candidate.id === (apiKey.appId ?? "default"));
    if (!firewallApp) return reply.code(403).send({ error: "This API key is not assigned to an application." });
    if (!firewallApp.enabled) return reply.code(403).send({ error: "This application is disabled." });
    const limits = [
      ...(firewallApp.rateLimitPerMinute ? [{ id: `app:${firewallApp.id}`, limit: firewallApp.rateLimitPerMinute }] : []),
      ...(apiKey.rateLimitPerMinute ? [{ id: `key:${apiKey.id}`, limit: apiKey.rateLimitPerMinute }] : []),
    ];
    if (limits.length && request.method === "POST") {
      const quota = await consumeQuota(database, limits);
      reply.header("X-RateLimit-Limit", Math.min(...limits.map((l) => l.limit)));
      reply.header("X-RateLimit-Remaining", quota.remaining);
      if (!quota.allowed) { reply.header("Retry-After", 60 - Math.floor((Date.now() % 60_000) / 1_000)); return reply.code(429).send({ error: "Application rate limit exceeded." }); }
    }
    request.apiKey = apiKey;
    request.firewallApp = firewallApp;
  };

  const selectedProfileId = (envelope: ClassificationEnvelope, apiKey: ApiKeyRecord, firewallApp: AppRecord): string =>
    envelope.profile ?? apiKey.defaultProfileId ?? firewallApp.defaultProfileId;

  const profileAllowed = (profileId: string, apiKey: ApiKeyRecord, firewallApp: AppRecord): boolean => {
    const allowedByApp = firewallApp.allowedProfileIds.length === 0 || firewallApp.allowedProfileIds.includes(profileId);
    const allowedByKey = !apiKey.allowedProfileIds?.length || apiKey.allowedProfileIds.includes(profileId);
    return allowedByApp && allowedByKey;
  };

  const loadProfile = async (id: string, firewallApp: AppRecord, requestId: string): Promise<Profile | undefined> => {
    const all = await profiles.read();
    let revision = firewallApp.profileRevisions?.[id];
    const canary = firewallApp.canary;
    if (canary?.profileId === id && parseInt(hash(requestId).slice(0, 8), 16) / 0x100000000 * 100 < canary.percent) revision = canary.revision;
    const record = all.find((p) => p.id === id);
    return record ? revisionOf(record, revision) : undefined;
  };

  const resolveApiKey = async (): Promise<string | undefined> => {
    if (config.typesafeApiKey) return config.typesafeApiKey;
    const stored = (await secrets.read()).typesafeApiKey;
    return stored ? decryptText(stored, config.controlPlaneSecret) : undefined;
  };

  const evaluate = async (id: string, envelope: ClassificationEnvelope, profile: Profile, queueMs: number, traceId: string, firewallApp: AppRecord) => evaluatePolicy({
    id, envelope, profile, queueMs, traceId, firewallApp, provider: await settings.read(), apiKey: resolveApiKey, circuit,
    onRetry: (mode) => metrics.recordRetry(mode), onCircuitOpen: (mode) => metrics.recordCircuitOpen(mode),
  });

  const classify = async (
    id: string,
    envelope: ClassificationEnvelope,
    profile: Profile,
    queueMs: number,
    firewallApp: AppRecord,
    apiKey?: ApiKeyRecord,
    traceId = randomUUID().replaceAll("-", ""),
    requestId?: string,
  ): Promise<ClassificationDecision> => {
    const { decision, failure, localRuleId } = await evaluate(id, envelope, profile, queueMs, traceId, firewallApp);
    decision.policyRevision = profile.revision;
    decision.policyHash = profile.contentHash ?? policyHash(profile);
    decision.appRulesHash = hash(JSON.stringify(firewallApp.localRules));
    decision.requestId = requestId;
    decision.labels = envelope.labels;
    const allProfiles = await profiles.read();
    const shadowProfiles = (profile.shadowProfileIds ?? [])
      .filter((profileId) => profileId !== profile.id)
      .map((profileId) => { const record = allProfiles.find((candidate) => candidate.id === profileId); return record ? revisionOf(record, firewallApp.profileRevisions?.[profileId]) : undefined; })
      .filter((candidate): candidate is Profile => Boolean(candidate))
      .slice(0, 3);
    const shadows = await Promise.all(shadowProfiles.map(async (shadowProfile) => {
      const result = await evaluate(`${id}:shadow:${shadowProfile.id}`, envelope, shadowProfile, 0, traceId, firewallApp);
      return {
        profileId: shadowProfile.id,
        policyRevision: shadowProfile.revision,
        policyHash: shadowProfile.contentHash ?? policyHash(shadowProfile),
        verdict: result.decision.verdict,
        action: result.decision.action,
        risk: result.decision.risk,
        reason: result.decision.reason,
        changed: result.decision.action !== decision.action,
        error: result.failure,
      };
    }));
    if (shadows.length > 0) decision.shadows = shadows;

    const serialized = serializeInput(envelope.input);
    const event: ClassificationEvent = {
      ...decision,
      inputHash: hash(serialized),
      inputBytes: Buffer.byteLength(serialized),
      inputPreview: profile.persistInputs ? serialized.slice(0, 1_000) : undefined,
      apiKeyId: apiKey?.id,
      apiKeyName: apiKey?.name,
      appId: firewallApp.id,
      appName: firewallApp.name,
      appRulesSnapshot: structuredClone(firewallApp.localRules),
      localRuleId,
      error: failure,
    };
    await eventsStore.append(event, decisionDeliveries(event, await integrations.read()));
    app.log.info({ decisionId: id, requestId, traceId, profile: profile.id, action: decision.action, risk: decision.risk, latencyMs: decision.latencyMs }, "classification completed");
    metrics.record(decision, Boolean(failure));
    metrics.updateQueue(queue.snapshot());
    // A recovered lease can overlap an upstream call from a paused worker.
    // The first committed event remains authoritative for every replay.
    const committed = (await eventsStore.findById(id))!;
    eventBus.emit("decision", committed);
    const { inputPreview, inputHash, inputBytes, appRulesSnapshot, localRuleId: storedRule, apiKeyId, apiKeyName, appName, error, ...result } = committed;
    return result;
  };

  const enqueue = (
    id: string,
    envelope: ClassificationEnvelope,
    profile: Profile,
    firewallApp: AppRecord,
    apiKey?: ApiKeyRecord,
    traceId?: string,
    requestId?: string,
  ) => queue.submit((queueMs) => classify(id, envelope, profile, queueMs, firewallApp, apiKey, traceId, requestId), id);

  app.get("/", async () => ({
    name: "Pyro gateway",
    version: "0.3.0-beta.1",
    endpoints: ["POST /v1/classify", "POST /v1/jobs", "GET /v1/jobs/:id", "WS /v1/events"],
  }));

  app.get("/v1/health", async () => {
    await database.ping();
    return {
      status: "ok",
      database: database.kind,
      queue: queue.snapshot(),
      durableJobs: await jobs.stats(),
      circuitBreaker: {
        state: circuit.openUntil > Date.now() ? "open" : circuit.consecutiveFailures > 0 ? "degraded" : "closed",
        consecutiveFailures: circuit.consecutiveFailures,
        retryAt: circuit.openUntil > Date.now() ? new Date(circuit.openUntil).toISOString() : undefined,
      },
    };
  });
  app.get("/v1/ready", async (_request, reply) => {
    const provider = await settings.read();
    const configured = provider.mode === "mock" || Boolean(await resolveApiKey());
    return reply.code(configured ? 200 : 503).send({ status: configured ? "ready" : "not_ready", provider: provider.mode });
  });
  app.get("/metrics", async (_request, reply) => {
    metrics.updateQueue(queue.snapshot());
    reply.header("Content-Type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  app.get("/v1/profiles", { preHandler: requireApiKey }, async (request) => {
    const firewallApp = request.firewallApp!;
    return (await profiles.read())
      .filter((profile) => !profile.archived)
      .filter((profile) => profileAllowed(profile.id, request.apiKey!, firewallApp))
      .map(({ id, name, description }) => ({ id, name, description }));
  });

  app.post("/v1/classify", { preHandler: requireApiKey }, async (request, reply) => {
    const identity = requestIdentity(request);
    reply.header("X-Request-Id", identity.requestId);
    let envelope: ClassificationEnvelope;
    try {
      envelope = envelopeFromBody(request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid request body." });
    }
    const apiKey = request.apiKey!;
    const firewallApp = request.firewallApp!;
    const requestedProfile = selectedProfileId(envelope, apiKey, firewallApp);
    if (!profileAllowed(requestedProfile, apiKey, firewallApp)) return reply.code(403).send({ error: "This application is not allowed to use the requested policy." });
    const profile = await loadProfile(requestedProfile, firewallApp, identity.requestId);
    if (!profile) return reply.code(404).send({ error: "Profile not found." });
    const serialized = serializeInput(envelope.input);
    if (serialized.length > profile.maxInputChars) {
      return reply.code(413).send({ error: `Input exceeds this profile's ${profile.maxInputChars} character limit.` });
    }
    try {
      const result = await enqueue(identity.decisionId, envelope, profile, firewallApp, apiKey, identity.traceId, identity.requestId);
      return reply.send(result.value);
    } catch (error) {
      if (error instanceof QueueFullError) {
        reply.header("Retry-After", "1");
        return reply.code(429).send({ error: error.message, queue: queue.snapshot() });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "Classification failed unexpectedly." });
    }
  });

  app.post("/v1/jobs", { preHandler: requireApiKey }, async (request, reply) => {
    const identity = requestIdentity(request);
    reply.header("X-Request-Id", identity.requestId);
    let envelope: ClassificationEnvelope;
    try {
      envelope = envelopeFromBody(request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid request body." });
    }
    const apiKey = request.apiKey!;
    const firewallApp = request.firewallApp!;
    const requestedProfile = selectedProfileId(envelope, apiKey, firewallApp);
    if (!profileAllowed(requestedProfile, apiKey, firewallApp)) return reply.code(403).send({ error: "This application is not allowed to use the requested policy." });
    const profile = await loadProfile(requestedProfile, firewallApp, identity.requestId);
    if (!profile) return reply.code(404).send({ error: "Profile not found." });
    const serialized = serializeInput(envelope.input);
    if (serialized.length > profile.maxInputChars) return reply.code(413).send({ error: "Input is too large." });

    try {
      const job = await jobs.enqueue({ id: identity.decisionId, appId: firewallApp.id,
        fingerprint: hash(JSON.stringify(envelope)), idempotencyKey: request.headers["idempotency-key"] as string | undefined,
        input: { envelope, profile, firewallApp, apiKey, identity } });
      return reply.code(202).send({ id: job.id, status: job.status, statusUrl: `/v1/jobs/${job.id}` });
    } catch (error) {
      if (error instanceof JobCapacityError || error instanceof JobConflict) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/v1/jobs/:id", { preHandler: requireApiKey }, async (request, reply) => {
    const job = await jobs.get(request.params.id, request.firewallApp!.id);
    if (!job) return reply.code(404).send({ error: "Job not found or expired." });
    return { id: job.id, appId: job.appId, status: job.status, createdAt: job.createdAt, completedAt: job.completedAt, expiresAt: job.expiresAt, decision: job.result, error: job.error };
  });

  const jobWorker = new DurableWorker(jobs, config.queueConcurrency, async (job) => {
    const { envelope, profile, firewallApp, apiKey, identity } = jobs.input<{ envelope: ClassificationEnvelope; profile: Profile; firewallApp: AppRecord; apiKey: ApiKeyRecord; identity: ReturnType<typeof requestIdentity> }>(job);
    const existing = await eventsStore.findById(job.id);
    if (existing) { const { inputPreview, inputHash, appRulesSnapshot, ...decision } = existing; return decision; }
    return classify(job.id, envelope, profile, Date.now() - Date.parse(job.createdAt), firewallApp, apiKey, identity.traceId, identity.requestId);
  }, (error) => app.log.error({ err: error }, "Classification worker failed"));
  jobWorker.start();

  app.get("/v1/events", { websocket: true }, (socket: WebSocket) => {
    let authenticatedAppId: string | undefined;
    let authenticating = false;
    let subscribed = false;
    const onDecision = (event: ClassificationEvent) => {
      if (authenticatedAppId && event.appId === authenticatedAppId && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "decision", data: event }));
      }
    };
    const authTimer = setTimeout(() => socket.close(1008, "Authentication timed out"), 5_000);
    socket.send(JSON.stringify({ type: "auth.required" }));
    socket.on("message", async (raw) => {
      if (authenticatedAppId || authenticating) return;
      if (Buffer.byteLength(raw.toString()) > 4_096) {
        socket.close(1009, "Authentication message is too large");
        return;
      }
      authenticating = true;
      try {
        const message = JSON.parse(raw.toString()) as { type?: string; apiKey?: string };
        const apiKey = message.type === "auth" ? await authenticate(message.apiKey) : undefined;
        const firewallApp = apiKey ? (await apps.read()).find((candidate) => candidate.id === (apiKey.appId ?? "default") && candidate.enabled) : undefined;
        authenticatedAppId = firewallApp?.id;
        socket.send(JSON.stringify({ type: authenticatedAppId ? "auth.ok" : "auth.failed" }));
        if (!authenticatedAppId) socket.close(1008, "Authentication failed");
        else {
          clearTimeout(authTimer);
          eventBus.on("decision", onDecision);
          subscribed = true;
        }
      } catch {
        socket.close(1008, "Invalid authentication message");
      } finally {
        authenticating = false;
      }
    });
    socket.on("close", () => {
      clearTimeout(authTimer);
      if (subscribed) eventBus.off("decision", onDecision);
    });
  });

  const retentionDays = Math.max(1, Number(process.env.EVENT_RETENTION_DAYS) || 30);
  const cleanup = setInterval(() => {
    void database.prune(new Date(Date.now() - retentionDays * 86_400_000).toISOString()).catch((error) => app.log.error(error, "Retention failed"));
  }, 60_000);
  cleanup.unref();
  app.addHook("onClose", async () => {
    clearInterval(cleanup);
    await jobWorker.stop();
    await deliveryWorker.stop();
    await database.close();
  });

  deliveryWorker.start((error) => app.log.error({ err: error }, "Webhook delivery worker failed"));
  return app;
}

declare module "fastify" {
  interface FastifyRequest {
    apiKey: ApiKeyRecord | null;
    firewallApp: AppRecord | null;
  }
}

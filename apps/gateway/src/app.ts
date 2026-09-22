import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, LogController } from "fastify";
import type { WebSocket } from "ws";
import {
  buildDecision,
  buildFailureDecision,
  ClassifierConfigurationError,
  evaluateLocalRules,
  JevClassifier,
  type LocalRuleMatch,
  MockClassifier,
  type ClassifierInput,
  UpstreamClassifierError,
} from "@pyro/classifiers";
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
} from "@pyro/contracts";
import { ConcurrentQueue, QueueFullError } from "@pyro/queue";
import { CachedDocument, decryptText, openDatabase } from "@pyro/storage";
import type { GatewayConfig } from "./config.js";
import { GatewayMetrics } from "./metrics.js";

interface SecretFile {
  typesafeApiKey?: StoredSecret;
}

interface JobRecord {
  id: string;
  appId: string;
  status: "queued" | "running" | "complete" | "failed";
  createdAt: string;
  completedAt?: string;
  decision?: ClassificationDecision;
  error?: string;
}

function localRuleDecision(
  id: string,
  traceId: string,
  profile: Profile,
  queueMs: number,
  match: LocalRuleMatch,
  metadata: Record<string, unknown> | undefined,
  latencyMs: number,
): ClassificationDecision {
  const blocked = match.rule.action === "block";
  return {
    id,
    traceId,
    createdAt: new Date().toISOString(),
    profileId: profile.id,
    verdict: blocked ? "unsafe" : "suspicious",
    action: match.rule.action,
    risk: match.rule.risk,
    confidence: match.rule.risk,
    reason: `Local rule “${match.rule.name}” matched before provider evaluation.`,
    detectors: [{
      id: `local_rule:${match.rule.id}`,
      name: match.rule.name,
      probability: match.rule.risk,
      weightedProbability: match.rule.risk,
    }],
    model: "local-rules",
    provider: "local-rules",
    latencyMs,
    queueMs,
    timings: { providerMs: 0, policyMs: latencyMs, totalMs: latencyMs },
    usage: { inputTokens: 0, outputTokens: 0, cost: { amount: 0, currency: "USD" } },
    metadata,
  };
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
  const profilesStore = database.document<Profile[]>("profiles", () => [createDefaultProfile()]);
  const appsStore = database.document<AppRecord[]>("apps", () => [createDefaultApp()]);
  const settingsStore = database.document<ProviderSettings>("provider_settings", createDefaultProviderSettings);
  const keysStore = database.document<ApiKeyRecord[]>("api_keys", () => []);
  const secretsStore = database.document<SecretFile>("provider_secrets", () => ({}));
  const eventsStore = database.events;
  const profiles = new CachedDocument(profilesStore);
  const apps = new CachedDocument(appsStore);
  const settings = new CachedDocument(settingsStore);
  const keys = new CachedDocument(keysStore);
  const secrets = new CachedDocument(secretsStore);

  const storedProfiles = await profilesStore.read();
  const normalizedProfiles = storedProfiles.flatMap((profile) => {
    const parsed = ProfileSchema.safeParse(profile);
    return parsed.success ? [parsed.data] : [];
  });
  if (normalizedProfiles.length !== storedProfiles.length || JSON.stringify(normalizedProfiles) !== JSON.stringify(storedProfiles)) {
    await profilesStore.write(normalizedProfiles.length ? normalizedProfiles : [createDefaultProfile()]);
  }
  const storedApps = await appsStore.read();
  const normalizedApps = storedApps.flatMap((record) => {
    const parsed = AppSchema.safeParse(record);
    return parsed.success ? [parsed.data] : [];
  });
  const validApps = normalizedApps.length ? normalizedApps : [createDefaultApp()];
  if (JSON.stringify(validApps) !== JSON.stringify(storedApps)) await appsStore.write(validApps);
  const storedSettings = await settingsStore.read();
  const normalizedSettings = ProviderSettingsSchema.safeParse(storedSettings);
  if (normalizedSettings.success && JSON.stringify(normalizedSettings.data) !== JSON.stringify(storedSettings)) {
    await settingsStore.write(normalizedSettings.data);
  } else if (!normalizedSettings.success) {
    await settingsStore.write(createDefaultProviderSettings());
  }
  const storedKeys = await keysStore.read();
  if (storedKeys.some((key) => !key.appId)) {
    await keysStore.write(storedKeys.map((key) => ({ ...key, appId: key.appId ?? "default" })));
  }
  if ((await keysStore.read()).length === 0 && config.bootstrapApiKey) {
    await keysStore.write([
      {
        id: randomUUID(),
        name: "Local development",
        prefix: config.bootstrapApiKey.slice(0, 8),
        hash: hash(config.bootstrapApiKey),
        appId: "default",
        createdAt: new Date().toISOString(),
      },
    ]);
    keys.invalidate();
  }

  const queue = new ConcurrentQueue(config.queueConcurrency, config.queueMaxDepth);
  const metrics = new GatewayMetrics();
  const eventBus = new EventEmitter();
  eventBus.setMaxListeners(1_000);
  const jobs = new Map<string, JobRecord>();
  const rateLimits = new Map<string, { window: number; count: number }>();
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
    const rateLimit = apiKey.rateLimitPerMinute ?? firewallApp.rateLimitPerMinute;
    if (rateLimit) {
      const window = Math.floor(Date.now() / 60_000);
      const current = rateLimits.get(apiKey.id);
      const count = current?.window === window ? current.count + 1 : 1;
      rateLimits.set(apiKey.id, { window, count });
      reply.header("X-RateLimit-Limit", rateLimit);
      reply.header("X-RateLimit-Remaining", Math.max(0, rateLimit - count));
      if (count > rateLimit) {
        reply.header("Retry-After", 60 - Math.floor((Date.now() % 60_000) / 1_000));
        return reply.code(429).send({ error: "Application rate limit exceeded." });
      }
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

  const loadProfile = async (id?: string): Promise<Profile | undefined> => {
    const all = await profiles.read();
    return all.find((profile) => profile.id === (id ?? "default"));
  };

  const resolveApiKey = async (): Promise<string | undefined> => {
    if (config.typesafeApiKey) return config.typesafeApiKey;
    const stored = (await secrets.read()).typesafeApiKey;
    return stored ? decryptText(stored, config.controlPlaneSecret) : undefined;
  };

  const evaluate = async (
    id: string,
    envelope: ClassificationEnvelope,
    profile: Profile,
    queueMs: number,
    traceId: string,
    firewallApp: AppRecord,
  ): Promise<{ decision: ClassificationDecision; failure?: string; localRuleId?: string }> => {
    const started = performance.now();
    const localMatch = evaluateLocalRules(envelope.input, firewallApp.localRules)[0];
    if (localMatch) {
      const latencyMs = performance.now() - started;
      return {
        decision: localRuleDecision(id, traceId, profile, queueMs, localMatch, envelope.metadata, latencyMs),
        localRuleId: localMatch.rule.id,
      };
    }
    const provider = await settings.read();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), profile.timeoutMs || config.defaultTimeoutMs);
    const classifierInput: ClassifierInput = {
      id,
      traceId,
      input: envelope.input,
      profile: { ...profile, model: profile.model || provider.model },
      provider,
      apiKey: await resolveApiKey(),
      metadata: envelope.metadata,
      queueMs,
      signal: controller.signal,
    };
    let decision: ClassificationDecision;
    let failure: string | undefined;
    let providerMs = 0;
    let policyMs = 0;
    try {
      const classifier = provider.mode === "mock" ? new MockClassifier() : new JevClassifier();
      const providerStarted = performance.now();
      if (circuit.openUntil > Date.now()) throw new Error("Provider circuit breaker is open.");
      let raw: Awaited<ReturnType<typeof classifier.classify>> | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt <= provider.maxRetries; attempt += 1) {
        try {
          raw = await classifier.classify(classifierInput);
          circuit.consecutiveFailures = 0;
          circuit.openUntil = 0;
          break;
        } catch (error) {
          lastError = error;
          const nonRetryableUpstream = error instanceof UpstreamClassifierError
            && error.status !== undefined
            && error.status >= 400
            && error.status < 500
            && ![408, 429].includes(error.status);
          if (error instanceof ClassifierConfigurationError || nonRetryableUpstream || attempt >= provider.maxRetries || controller.signal.aborted) break;
          metrics.recordRetry(provider.mode);
          await new Promise((resolve) => setTimeout(resolve, provider.retryBackoffMs * 2 ** attempt));
        }
      }
      if (!raw) {
        circuit.consecutiveFailures += 1;
        if (circuit.consecutiveFailures >= provider.circuitBreakerFailureThreshold) {
          circuit.openUntil = Date.now() + provider.circuitBreakerResetMs;
          metrics.recordCircuitOpen(provider.mode);
        }
        throw lastError ?? new Error("Classifier provider failed.");
      }
      providerMs = performance.now() - providerStarted;
      const policyStarted = performance.now();
      decision = buildDecision(classifierInput, raw, performance.now() - started);
      policyMs = performance.now() - policyStarted;
    } catch (error) {
      providerMs = performance.now() - started;
      failure = error instanceof Error ? error.message : "Unknown classifier error";
      decision = buildFailureDecision(classifierInput, error, performance.now() - started);
    } finally {
      clearTimeout(timeout);
    }
    decision.timings = { providerMs, policyMs, totalMs: performance.now() - started };
    return { decision, failure };
  };

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
    decision.requestId = requestId;
    decision.labels = envelope.labels;
    const allProfiles = await profiles.read();
    const shadowProfiles = (profile.shadowProfileIds ?? [])
      .filter((profileId) => profileId !== profile.id)
      .map((profileId) => allProfiles.find((candidate) => candidate.id === profileId))
      .filter((candidate): candidate is Profile => Boolean(candidate))
      .slice(0, 3);
    const shadows = await Promise.all(shadowProfiles.map(async (shadowProfile) => {
      const result = await evaluate(`${id}:shadow:${shadowProfile.id}`, envelope, shadowProfile, 0, traceId, firewallApp);
      return {
        profileId: shadowProfile.id,
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
      localRuleId,
      error: failure,
    };
    await eventsStore.append(event);
    app.log.info({ decisionId: id, requestId, traceId, profile: profile.id, action: decision.action, risk: decision.risk, latencyMs: decision.latencyMs }, "classification completed");
    metrics.record(decision, Boolean(failure));
    metrics.updateQueue(queue.snapshot());
    eventBus.emit("decision", event);
    return decision;
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
    version: "0.2.0",
    endpoints: ["POST /v1/classify", "POST /v1/jobs", "GET /v1/jobs/:id", "WS /v1/events"],
  }));

  app.get("/v1/health", async () => {
    await database.ping();
    return {
      status: "ok",
      database: database.kind,
      queue: queue.snapshot(),
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
      .filter((profile) => firewallApp.allowedProfileIds.length === 0 || firewallApp.allowedProfileIds.includes(profile.id))
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
    const profile = await loadProfile(requestedProfile);
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
    const profile = await loadProfile(requestedProfile);
    if (!profile) return reply.code(404).send({ error: "Profile not found." });
    const serialized = serializeInput(envelope.input);
    if (serialized.length > profile.maxInputChars) return reply.code(413).send({ error: "Input is too large." });

    const id = identity.decisionId;
    jobs.set(id, { id, appId: firewallApp.id, status: "queued", createdAt: new Date().toISOString() });
    try {
      const pending = queue.submit(async (queueMs) => {
        const current = jobs.get(id);
        if (current) current.status = "running";
        return classify(id, envelope, profile, queueMs, firewallApp, apiKey, identity.traceId, identity.requestId);
      }, id);
      void pending
        .then((result) => {
          jobs.set(id, {
            ...jobs.get(id)!,
            status: "complete",
            completedAt: new Date().toISOString(),
            decision: result.value,
          });
        })
        .catch((error: unknown) => {
          jobs.set(id, {
            ...jobs.get(id)!,
            status: "failed",
            completedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : "Unknown failure",
          });
        });
      return reply.code(202).send({ id, status: "queued", statusUrl: `/v1/jobs/${id}` });
    } catch (error) {
      jobs.delete(id);
      if (error instanceof QueueFullError) return reply.code(429).send({ error: error.message });
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/v1/jobs/:id", { preHandler: requireApiKey }, async (request, reply) => {
    const job = jobs.get(request.params.id);
    if (!job) return reply.code(404).send({ error: "Job not found or expired." });
    if (job.appId !== request.firewallApp!.id) return reply.code(404).send({ error: "Job not found or expired." });
    return job;
  });

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

  const cleanup = setInterval(() => {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [id, job] of jobs) {
      const timestamp = new Date(job.completedAt ?? job.createdAt).getTime();
      if (timestamp < cutoff) jobs.delete(id);
    }
  }, 60_000);
  cleanup.unref();
  app.addHook("onClose", async () => {
    clearInterval(cleanup);
    await database.close();
  });

  return app;
}

declare module "fastify" {
  interface FastifyRequest {
    apiKey: ApiKeyRecord | null;
    firewallApp: AppRecord | null;
  }
}

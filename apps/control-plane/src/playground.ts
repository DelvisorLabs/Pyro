import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ProfileSchema, createDefaultProviderSettings, semanticCheckCount, type AppRecord, type StoredSecret, type Profile } from "@pyro/contracts";
import { evaluatePolicy } from "@pyro/classifiers";
import { consumeQuota, decryptText, policyHash, type Database } from "@pyro/storage";
import type { ControlPlaneConfig } from "./config.js";
import { exportProfileYaml } from "./profile-files.js";

export function registerPlayground(app: FastifyInstance, database: Database, config: ControlPlaneConfig, guard: (r: FastifyRequest, p: FastifyReply) => Promise<unknown>) {
  const drafts = database.document<Array<{ id: string; actorId: string; profile: Profile; isNew: boolean; appId: string; updatedAt: string }>>("policy_drafts", () => []);
  app.get("/api/policy-drafts", { preHandler: guard }, async request => ({ drafts: (await drafts.read()).filter(d => d.actorId === request.user!.id) }));
  app.put<{ Params: { id: string } }>("/api/policy-drafts/:id", { preHandler: guard }, async (request, reply) => {
    const body = z.object({ profile: ProfileSchema, isNew: z.boolean(), appId: z.string(), expectedUpdatedAt: z.string().optional() }).parse(request.body);
    config.validateProfile?.(body.profile);
    if (!(await database.document<AppRecord[]>("apps", () => []).read()).some(a => a.id === body.appId)) return reply.code(400).send({ error: "Choose an application." });
    const id = z.string().uuid().parse(request.params.id);
    let saved!: Awaited<ReturnType<typeof drafts.read>>[number];
    await drafts.update(rows => {
      const prior = rows.find(d => d.id === id);
      if (prior && (prior.actorId !== request.user!.id || prior.updatedAt !== body.expectedUpdatedAt)) throw Object.assign(new Error("Draft changed in another session. Reload before saving."), { statusCode: 409 });
      if (!prior && rows.length >= 100) throw Object.assign(new Error("Draft limit reached. Remove an old draft first."), { statusCode: 409 });
      saved = { id, actorId: request.user!.id, profile: body.profile, isNew: body.isNew, appId: body.appId, updatedAt: new Date().toISOString() };
      return [...rows.filter(d => d.id !== id), saved];
    });
    return { draft: saved };
  });
  app.delete<{ Params: { id: string } }>("/api/policy-drafts/:id", { preHandler: guard }, async (request, reply) => { await drafts.update(rows => rows.filter(d => d.id !== request.params.id || d.actorId !== request.user!.id)); return reply.code(204).send(); });
  let active = 0;
  const circuit = { consecutiveFailures: 0, openUntil: 0 };
  app.post("/api/playground/export", { preHandler: guard }, async (request, reply) => {
    const parsed = z.object({ profile: ProfileSchema }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    return { yaml: exportProfileYaml(parsed.data.profile) };
  });
  app.post("/api/playground/estimate", { preHandler: guard }, async request => {
    const { profile, input } = z.object({ profile: ProfileSchema, input: z.unknown() }).parse(request.body);
    return { maximumCredits: config.estimateCredits?.(profile, input) ?? null };
  });
  app.post("/api/playground", { preHandler: guard }, async (request, reply) => {
    const parsed = z.object({ profile: ProfileSchema, appId: z.string(), input: z.unknown().refine((v) => v !== undefined, "Provide an input."), allowPaid: z.boolean().default(false), maxCredits: z.number().int().nonnegative().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { profile, appId, input, allowPaid, maxCredits } = parsed.data;
    if (profile.shadowProfileIds.length) return reply.code(400).send({ error: "Draft tests evaluate one policy. Use the gateway to include configured shadows." });
    const application = (await database.document<AppRecord[]>("apps", () => []).read()).find((a) => a.id === appId && a.enabled);
    if (!application) return reply.code(400).send({ error: "Choose an enabled application." });
    if ((typeof input === "string" ? input : JSON.stringify(input)).length > profile.maxInputChars) return reply.code(413).send({ error: "Input exceeds this policy's character limit." });
    config.validateProfile?.(profile);
    await config.authorizeEvaluation?.(request.user!.id, appId);
    const provider = await database.document("provider_settings", createDefaultProviderSettings).read();
    const maximumProviderCalls = semanticCheckCount(profile) * (provider.maxRetries + 1);
    if (maximumProviderCalls && provider.mode !== "mock" && !allowPaid) return reply.code(400).send({ error: "Semantic tests send input to the configured provider and may incur charges. Set allowPaid: true to authorize." });
    const maximumCredits = config.estimateCredits?.(profile, input);
    if (maxCredits !== undefined && maximumCredits !== undefined && maximumCredits > maxCredits) return reply.code(400).send({ error: `This test may use ${maximumCredits} credits, exceeding your cap of ${maxCredits}.` });
    const quota = await consumeQuota(database, [{ id: "playground", limit: config.workLimits?.().playgroundRequestsPerMinute ?? 30 }]);
    if (active >= (config.workLimits?.().playgroundConcurrency ?? 2) || !quota.allowed) return reply.code(429).send({ error: "Playground limit reached. Retry shortly." });
    active += 1;
    try {
      const result = await evaluatePolicy({ id: randomUUID(), traceId: randomUUID(), profile, envelope: { input }, firewallApp: application, provider, circuit,
        providerHooks: {
          before: async (call) => { await config.authorizeEvaluation?.(request.user!.id, appId); await (config.playgroundProviderHooks ?? config.providerHooks)?.before(call); },
          after: (config.playgroundProviderHooks ?? config.providerHooks)?.after,
          settled: (config.playgroundProviderHooks ?? config.providerHooks)?.settled,
        },
        apiKey: async () => {
          if (config.typesafeApiKey) return config.typesafeApiKey;
          const secret = (await database.document<{ typesafeApiKey?: StoredSecret }>("provider_secrets", () => ({})).read()).typesafeApiKey;
          return secret ? decryptText(secret, config.controlPlaneSecret) : undefined;
        },
      });
      // Preview is deliberately not a published revision or a retained event.
      return { ...result.decision, policyHash: policyHash(profile), preview: true, maximumProviderCalls, creditsConsumed: await config.chargedCredits?.(result.decision.traceId!), maximumCredits };
    } finally { active -= 1; }
  });
}

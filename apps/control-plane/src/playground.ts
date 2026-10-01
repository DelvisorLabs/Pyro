import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ProfileSchema, createDefaultProviderSettings, semanticCheckCount, type AppRecord, type StoredSecret } from "@pyro/contracts";
import { evaluatePolicy } from "@pyro/classifiers";
import { consumeQuota, decryptText, policyHash, type Database } from "@pyro/storage";
import type { ControlPlaneConfig } from "./config.js";
import { exportProfileYaml } from "./profile-files.js";

export function registerPlayground(app: FastifyInstance, database: Database, config: ControlPlaneConfig, guard: (r: FastifyRequest, p: FastifyReply) => Promise<unknown>) {
  let active = 0;
  const circuit = { consecutiveFailures: 0, openUntil: 0 };
  app.post("/api/playground/export", { preHandler: guard }, async (request, reply) => {
    const parsed = z.object({ profile: ProfileSchema }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    return { yaml: exportProfileYaml(parsed.data.profile) };
  });
  app.post("/api/playground", { preHandler: guard }, async (request, reply) => {
    const parsed = z.object({ profile: ProfileSchema, appId: z.string(), input: z.unknown().refine((v) => v !== undefined, "Provide an input."), allowPaid: z.boolean().default(false) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { profile, appId, input, allowPaid } = parsed.data;
    if (profile.shadowProfileIds.length) return reply.code(400).send({ error: "Draft tests evaluate one policy. Use the gateway to include configured shadows." });
    const application = (await database.document<AppRecord[]>("apps", () => []).read()).find((a) => a.id === appId && a.enabled);
    if (!application) return reply.code(400).send({ error: "Choose an enabled application." });
    if ((typeof input === "string" ? input : JSON.stringify(input)).length > profile.maxInputChars) return reply.code(413).send({ error: "Input exceeds this policy's character limit." });
    config.validateProfile?.(profile);
    await config.authorizeEvaluation?.(request.user!.id, appId);
    const provider = await database.document("provider_settings", createDefaultProviderSettings).read();
    const maximumProviderCalls = semanticCheckCount(profile) * (provider.maxRetries + 1);
    if (maximumProviderCalls && provider.mode !== "mock" && !allowPaid) return reply.code(400).send({ error: "Semantic tests send input to the configured provider and may incur charges. Set allowPaid: true to authorize." });
    const quota = await consumeQuota(database, [{ id: "playground", limit: 30 }]);
    if (active >= 2 || !quota.allowed) return reply.code(429).send({ error: "Playground limit reached. Retry shortly." });
    active += 1;
    try {
      const result = await evaluatePolicy({ id: randomUUID(), traceId: randomUUID(), profile, envelope: { input }, firewallApp: application, provider, circuit,
        providerHooks: {
          before: async (call) => { await config.authorizeEvaluation?.(request.user!.id, appId); await config.providerHooks?.before(call); },
          after: config.providerHooks?.after,
        },
        apiKey: async () => {
          if (config.typesafeApiKey) return config.typesafeApiKey;
          const secret = (await database.document<{ typesafeApiKey?: StoredSecret }>("provider_secrets", () => ({})).read()).typesafeApiKey;
          return secret ? decryptText(secret, config.controlPlaneSecret) : undefined;
        },
      });
      // Preview is deliberately not a published revision or a retained event.
      return { ...result.decision, policyHash: policyHash(profile), preview: true, maximumProviderCalls };
    } finally { active -= 1; }
  });
}

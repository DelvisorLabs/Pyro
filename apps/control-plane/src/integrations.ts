import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { IntegrationSchema, type StoredIntegration } from "@pyro/contracts";
import { deliveryFor, validateDestination } from "@pyro/integrations";
import { decryptText, encryptText, type Database } from "@pyro/storage";

export function registerIntegrations(app: FastifyInstance, database: Database, secret: string, requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>): void {
  const store = database.document<StoredIntegration[]>("integrations", () => []);
  const publicView = ({ destination: _destination, signingSecret, ...value }: StoredIntegration) => ({ ...value, hasSigningSecret: Boolean(signingSecret) });
  const prepare = (body: unknown, previous?: StoredIntegration) => {
    if (!body || typeof body !== "object") throw new Error("Integration settings are required.");
    const input = body as Record<string, unknown>;
    const now = new Date().toISOString();
    const parsed = IntegrationSchema.safeParse({ ...previous, ...input, id: previous?.id ?? randomUUID(), createdAt: previous?.createdAt ?? now, updatedAt: now });
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid integration.");
    if (previous && parsed.data.type !== previous.type) throw new Error("Create a new integration to change its type.");
    let destination = previous?.destination;
    let destinationHost = previous?.destinationHost;
    if (typeof input.url === "string" && input.url.trim()) {
      const url = validateDestination(input.url.trim(), parsed.data.allowPrivateNetwork);
      destination = encryptText(url.href, secret);
      destinationHost = url.host;
    }
    if (!destination || !destinationHost) throw new Error("A destination URL is required.");
    validateDestination(decryptText(destination, secret), parsed.data.allowPrivateNetwork);
    const signingSecret = !previous?.signingSecret ? randomBytes(32).toString("hex") : undefined;
    return { record: { ...parsed.data, destination, destinationHost, signingSecret: signingSecret ? encryptText(signingSecret, secret) : previous?.signingSecret } satisfies StoredIntegration, signingSecret };
  };
  app.get("/api/integrations", { preHandler: requireSession }, async () => ({ integrations: (await store.read()).filter((i) => i.type === "webhook").map(publicView) }));
  app.post("/api/integrations", { preHandler: requireSession }, async (request, reply) => {
    try {
      const { record, signingSecret } = prepare(request.body);
      let full = false;
      await store.update((current) => { full = current.length >= 50; return full ? current : [...current, record]; });
      if (full) return reply.code(409).send({ error: "At most 50 integrations are supported." });
      return reply.code(201).send({ integration: publicView(record), signingSecret });
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid integration." }); }
  });
  app.put<{ Params: { id: string } }>("/api/integrations/:id", { preHandler: requireSession }, async (request, reply) => {
    try {
      let result: StoredIntegration | undefined;
      await store.update((current) => current.map((item) => {
        if (item.id !== request.params.id || item.type !== "webhook") return item;
        result = prepare(request.body, item).record;
        return result;
      }));
      if (!result) return reply.code(404).send({ error: "Integration not found." });
      return { integration: publicView(result) };
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid integration." }); }
  });
  app.delete<{ Params: { id: string } }>("/api/integrations/:id", { preHandler: requireSession }, async (request, reply) => {
    let found = false;
    await store.update((current) => current.filter((item) => { if (item.id === request.params.id) { found = true; return false; } return true; }));
    return found ? reply.code(204).send() : reply.code(404).send({ error: "Integration not found." });
  });
  app.post<{ Params: { id: string } }>("/api/integrations/:id/rotate-secret", { preHandler: requireSession }, async (request, reply) => {
    const signingSecret = randomBytes(32).toString("hex");
    let found = false;
    await store.update((current) => current.map((i) => {
      if (i.id !== request.params.id || i.type !== "webhook") return i;
      found = true;
      return { ...i, signingSecret: encryptText(signingSecret, secret), updatedAt: new Date().toISOString() };
    }));
    return found ? { signingSecret } : reply.code(404).send({ error: "Webhook not found." });
  });
  app.post<{ Params: { id: string } }>("/api/integrations/:id/test", { preHandler: requireSession }, async (request, reply) => {
    const integration = (await store.read()).find((i) => i.id === request.params.id && i.type === "webhook");
    if (!integration) return reply.code(404).send({ error: "Integration not found." });
    if (!integration.enabled) return reply.code(409).send({ error: "Enable the integration before testing." });
    const id = randomUUID();
    const delivery = deliveryFor(integration.id, { id, type: "integration.test", createdAt: new Date().toISOString(), data: { id, profileId: "test", appId: "test", action: "review", verdict: "suspicious", risk: 0.5, provider: "test", latencyMs: 0, failed: false } });
    await database.deliveries.enqueue(delivery);
    return reply.code(202).send({ delivery });
  });
  app.get<{ Querystring: { integrationId?: string } }>("/api/integration-deliveries", { preHandler: requireSession }, async (request) => ({ deliveries: await database.deliveries.list(request.query.integrationId) }));
  app.post<{ Params: { id: string } }>("/api/integration-deliveries/:id/retry", { preHandler: requireSession }, async (request, reply) => {
    return await database.deliveries.retry(request.params.id) ? reply.code(202).send({ ok: true }) : reply.code(409).send({ error: "Only failed deliveries can be retried." });
  });
}

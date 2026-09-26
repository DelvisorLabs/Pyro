import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PolicyStore } from "@pyro/storage";

export function registerPolicyHistory(app: FastifyInstance, store: PolicyStore, requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  app.get<{ Params: { id: string } }>("/api/profiles/:id/revisions", { preHandler: requireSession }, async (request, reply) => {
    const record = (await store.records.read()).find((p) => p.id === request.params.id);
    if (!record) return reply.code(404).send({ error: "Policy not found." });
    return { activeRevision: record.revision, revisions: record.revisions };
  });
  app.post<{ Params: { id: string }; Body: { profile: unknown; expectedRevision: number } }>("/api/profiles/:id/revisions", { preHandler: requireSession }, async (request, reply) => {
    if (!Number.isInteger(request.body?.expectedRevision)) return reply.code(400).send({ error: "expectedRevision is required." });
    try { return reply.code(201).send({ revision: await store.draft(request.params.id, request.body.profile, request.body.expectedRevision, request.user!.id) }); }
    catch (error) { return reply.code(error instanceof Error && "statusCode" in error ? 409 : 400).send({ error: error instanceof Error ? error.message : "Invalid draft." }); }
  });
  app.post<{ Params: { id: string }; Body: { revision: number; expectedRevision: number } }>("/api/profiles/:id/publish", { preHandler: requireSession }, async (request, reply) => {
    const record = (await store.records.read()).find((p) => p.id === request.params.id && !p.archived);
    const revision = record?.revisions?.find((r) => r.revision === request.body?.revision);
    if (!record || !revision) return reply.code(404).send({ error: "Revision not found." });
    if (record.revision !== request.body.expectedRevision) return reply.code(409).send({ error: "Policy changed. Reload before publishing." });
    const profiles = await store.update((current) => current.map((p) => p.id === record.id
      ? { ...revision.profile, revision: request.body.expectedRevision, updatedAt: new Date().toISOString() } : p), request.user!.id);
    return { profile: profiles.find((p) => p.id === record.id) };
  });
}

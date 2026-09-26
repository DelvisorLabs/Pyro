import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ClassificationEvent, Delivery, StoredIntegration, UserRecord } from "@pyro/contracts";
import type { Database } from "@pyro/storage";
import { decisionDeliveries, deliveryFor } from "@pyro/integrations";
import { appScope, canAccessApp, visibleEvent } from "./access.js";
export interface ReviewRecord {
  id: string; appId: string; revision: number; status: "open" | "resolved";
  severity: "low" | "medium" | "high"; assignedTo?: string;
  disposition?: "true_positive" | "false_positive" | "uncertain";
  updatedAt: string; resolvedAt?: string; resolvedBy?: string;
  comments: Array<{ id: string; actorId: string; at: string; text: string }>;
  pendingCallbacks?: Delivery[];
}
const update = z.object({ expectedRevision: z.number().int().nonnegative(), assignedTo: z.string().max(100).nullable().optional(), severity: z.enum(["low", "medium", "high"]).optional(), disposition: z.enum(["true_positive", "false_positive", "uncertain"]).optional(), comment: z.string().trim().min(1).max(2000).optional(), reopen: z.boolean().optional() });
const initial = (event: ClassificationEvent): ReviewRecord => ({ id: event.id, appId: event.appId ?? "default", revision: 0, status: "open", severity: event.risk >= .8 ? "high" : "medium", updatedAt: event.createdAt, comments: [] });
const visible = ({ pendingCallbacks, ...record }: ReviewRecord) => record;
export function registerReviews(app: FastifyInstance, database: Database, guard: (r: FastifyRequest, p: FastifyReply) => Promise<unknown>) {
  const store = database.document<ReviewRecord[]>("reviews", () => []);
  app.get("/api/reviews", { preHandler: guard }, async (request) => {
    const query = request.query as { appId?: string; status?: string; assignedTo?: string; offset?: string };
    const states = await store.read();
    const events = await database.events.query({ action: "review", appId: query.appId, appIds: appScope(request.user!), limit: 500, offset: Math.max(0, Number(query.offset) || 0) });
    const reviews = events.events.map((event) => ({ ...visible(states.find((r) => r.id === event.id) ?? initial(event)), event: visibleEvent(request.user!, event), ageMs: Date.now() - Date.parse(event.createdAt) })).filter((r) => (!query.status || r.status === query.status) && (!query.assignedTo || r.assignedTo === query.assignedTo));
    const users = (await database.document<UserRecord[]>("users", () => []).read()).filter((u) => !u.disabled && ["admin", "reviewer", "operator"].includes(u.role ?? "") && (request.user!.role === "admin" || u.id === request.user!.id));
    return { reviews, totalEvents: events.total, nextOffset: events.events.length === 500 ? (Number(query.offset) || 0) + 500 : null, assignees: users.map((u) => ({ id: u.id, username: u.username })) };
  });
  app.get<{ Params: { id: string } }>("/api/reviews/:id", { preHandler: guard }, async (request, reply) => {
    const event = await database.events.findById(request.params.id);
    if (!event || event.action !== "review" || !canAccessApp(request.user!, event.appId)) return reply.code(404).send({ error: "Review not found." });
    return { review: visible((await store.read()).find((r) => r.id === event.id) ?? initial(event)), event: visibleEvent(request.user!, event) };
  });
  app.put<{ Params: { id: string } }>("/api/reviews/:id", { preHandler: guard }, async (request, reply) => {
    const parsed = update.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const event = await database.events.findById(request.params.id);
    if (!event || event.action !== "review" || !canAccessApp(request.user!, event.appId)) return reply.code(404).send({ error: "Review not found." });
    const body = parsed.data;
    if (body.assignedTo) {
      const user = (await database.document<UserRecord[]>("users", () => []).read()).find((u) => u.id === body.assignedTo && !u.disabled);
      if (!user || !canAccessApp(user, event.appId) || !["admin", "operator", "reviewer"].includes(user.role ?? "")) return reply.code(400).send({ error: "Assignee must be an authorized reviewer for this application." });
    }
    if (body.reopen && body.disposition) return reply.code(400).send({ error: "Choose reopen or a resolution." });
    const integrations = (await database.document<StoredIntegration[]>("integrations", () => []).read()).filter((i) => i.reviewResolutions && i.signingSecret);
    let saved!: ReviewRecord; let conflict = false;
    await store.update((rows) => {
      const current = rows.find((r) => r.id === event.id) ?? initial(event);
      if (current.revision !== body.expectedRevision) { conflict = true; return rows; }
      const now = new Date().toISOString();
      saved = { ...current, revision: current.revision + 1, updatedAt: now, severity: body.severity ?? current.severity, assignedTo: body.assignedTo === null ? undefined : body.assignedTo ?? current.assignedTo, comments: body.comment ? [...current.comments, { id: randomUUID(), actorId: request.user!.id, at: now, text: body.comment }] : current.comments };
      if (body.reopen) { saved.status = "open"; delete saved.disposition; delete saved.resolvedAt; delete saved.resolvedBy; }
      if (body.disposition) {
        saved.status = "resolved"; saved.disposition = body.disposition; saved.resolvedBy = request.user!.id; saved.resolvedAt = now;
        const callbacks = decisionDeliveries(event, integrations).map((d) => deliveryFor(d.integrationId, { ...d.payload, id: `${event.id}:review:${saved.revision}`, type: "review.resolved", createdAt: now, data: { ...d.payload.data, review: { revision: saved.revision, disposition: body.disposition!, actorId: request.user!.id } } }));
        saved.pendingCallbacks = [...current.pendingCallbacks ?? [], ...callbacks];
      }
      return [...rows.filter((r) => r.id !== event.id), saved];
    });
    if (conflict) return reply.code(409).send({ error: "This review changed. Reload before saving." });
    return { review: visible(saved), warning: "Feedback does not change the original decision or execute a tool." };
  });
  // Persist callback intent with the review, then hand off to the existing signed
  // delivery outbox. Stable IDs make retries safe after an interrupted handoff.
  let active: Promise<void> | undefined;
  const flush = async () => {
    const records = await store.read();
    for (const record of records) for (const delivery of record.pendingCallbacks ?? []) {
      await database.deliveries.enqueue(delivery);
      await store.update((rows) => rows.map((r) => r.id === record.id ? { ...r, pendingCallbacks: r.pendingCallbacks?.filter((d) => d.id !== delivery.id) } : r));
    }
    const cutoff = new Date(Date.now() - (Math.max(1, Number(process.env.EVENT_RETENTION_DAYS) || 30)) * 86400_000).toISOString();
    await store.update((rows) => rows.filter((r) => r.updatedAt >= cutoff || r.pendingCallbacks?.length));
  };
  const timer = setInterval(() => { if (!active) { active = flush().catch((e) => app.log.error(e, "Review callback handoff failed")).finally(() => { active = undefined; }); } }, 1000); timer.unref();
  return async () => { clearInterval(timer); await active; };
}

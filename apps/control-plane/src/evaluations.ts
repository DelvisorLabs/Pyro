import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppRecord, Profile, ProviderSettings, StoredSecret } from "@pyro/contracts";
import { createDefaultProviderSettings } from "@pyro/contracts";
import { DurableJobs, DurableWorker, decryptText, encryptText, policyHash, revisionOf, type Database, type PolicyRecord } from "@pyro/storage";
import { evaluatePolicy, evaluationReport, type EvaluationRow } from "@pyro/classifiers";
import type { ControlPlaneConfig } from "./config.js";
import { canAccessApp } from "./access.js";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const CaseSchema = z.object({ id: z.string().min(1).max(100), input: z.unknown().refine((value) => value !== undefined, "input is required"), expected: z.enum(["allow", "review", "block"]), category: z.string().min(1).max(100).default("general") });
type Case = z.infer<typeof CaseSchema>;
interface Dataset { id: string; appId: string; name: string; version: number; contentHash: string; count: number; createdAt: string; expiresAt: string; actorId: string; cases: StoredSecret }
interface Run { id: string; appId: string; datasetId: string; datasetHash: string; status: "queued" | "running" | "cancelled" | "complete" | "failed"; createdAt: string; actorId: string; expiresAt: string; profiles: Profile[]; app: AppRecord; provider: ProviderSettings; configurationHash: string; credential?: StoredSecret; rows: EvaluationRow[]; total: number; error?: string; report?: ReturnType<typeof evaluationReport>; estimate: { maximumProviderCalls: number; cost: string }; generation: number; jobId?: string }
const publicDataset = ({ cases, ...dataset }: Dataset) => dataset;
const publicRun = ({ credential, ...run }: Run) => run;
export function registerEvaluations(app: FastifyInstance, database: Database, config: ControlPlaneConfig, guard: (r: FastifyRequest, p: FastifyReply) => Promise<unknown>) {
  const datasets = database.document<Dataset[]>("evaluation_datasets", () => []);
  const runs = database.document<Run[]>("evaluation_runs", () => []);
  const jobs = new DurableJobs(database, config.controlPlaneSecret, "evaluation_jobs", 20);
  const enqueue = async (run: Run) => {
    const job = await jobs.enqueue({ id: randomUUID(), appId: run.appId, fingerprint: `${run.id}:${run.generation}`, idempotencyKey: `${run.id}:${run.generation}`, input: { runId: run.id, generation: run.generation } });
    await runs.update((rows) => rows.map((r) => r.id === run.id && r.generation === run.generation ? { ...r, jobId: job.id } : r));
  };
  app.get("/api/datasets", { preHandler: guard }, async (request) => ({ datasets: (await datasets.read()).filter((d) => canAccessApp(request.user!, d.appId) && Date.parse(d.expiresAt) > Date.now()).map(publicDataset) }));
  app.post("/api/datasets", { preHandler: guard }, async (request, reply) => {
    const parsed = z.object({ appId: z.string(), name: z.string().trim().min(1).max(100), jsonl: z.string().min(1).max(500_000), retentionDays: z.union([z.literal(1), z.literal(7), z.literal(30)]), retainInputs: z.literal(true) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Provide appId, name, JSONL, retentionDays (1, 7 or 30), and explicit retainInputs: true." });
    const body = parsed.data;
    if (!canAccessApp(request.user!, body.appId)) return reply.code(403).send({ error: "Application access required." });
    if (!(await database.document<AppRecord[]>("apps", () => []).read()).some((a) => a.id === body.appId)) return reply.code(404).send({ error: "Application not found." });
    let cases: Case[];
    try { cases = body.jsonl.split(/\r?\n/).filter((line) => line.trim()).map((line) => CaseSchema.parse(JSON.parse(line))); if (!cases.length || cases.length > 500 || new Set(cases.map((c) => c.id)).size !== cases.length) throw new Error("Use 1–500 cases with unique IDs."); }
    catch (e) { return reply.code(400).send({ error: e instanceof Error ? e.message : "Invalid dataset." }); }
    let dataset!: Dataset;
    await datasets.update((rows) => {
      dataset = { id: randomUUID(), appId: body.appId, name: body.name, version: 1 + Math.max(0, ...rows.filter((d) => d.appId === body.appId && d.name === body.name).map((d) => d.version)), contentHash: digest(cases), count: cases.length, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + body.retentionDays * 86400_000).toISOString(), actorId: request.user!.id, cases: encryptText(JSON.stringify(cases), config.controlPlaneSecret) };
      return [...rows, dataset];
    });
    return reply.code(201).send({ dataset: publicDataset(dataset) });
  });
  app.delete<{ Params: { id: string } }>("/api/datasets/:id", { preHandler: guard }, async (request, reply) => {
    const dataset = (await datasets.read()).find((d) => d.id === request.params.id && canAccessApp(request.user!, d.appId));
    if (!dataset) return reply.code(404).send({ error: "Dataset not found." });
    await runs.update((rows) => rows.map((r) => r.datasetId === dataset.id && ["queued", "running"].includes(r.status) ? { ...r, status: "cancelled", credential: undefined, error: "Dataset deleted." } : r));
    await datasets.update((rows) => rows.filter((d) => d.id !== dataset.id));
    return reply.code(204).send();
  });
  app.get("/api/evaluations", { preHandler: guard }, async (request) => ({ runs: (await runs.read()).filter((r) => canAccessApp(request.user!, r.appId)).map((r) => ({ ...publicRun(r), rows: undefined })) }));
  app.get<{ Params: { id: string } }>("/api/evaluations/:id", { preHandler: guard }, async (request, reply) => {
    const run = (await runs.read()).find((r) => r.id === request.params.id && canAccessApp(request.user!, r.appId));
    if (!run) return reply.code(404).send({ error: "Evaluation not found." });
    return { run: publicRun(run) };
  });
  app.post("/api/evaluations", { preHandler: guard }, async (request, reply) => {
    const parsed = z.object({ datasetId: z.string(), policies: z.array(z.object({ id: z.string(), revision: z.number().int().positive() })).min(1).max(2), allowPaid: z.boolean().default(false) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Choose a dataset and one or two published policy revisions." });
    const body = parsed.data;
    if (new Set(body.policies.map((p) => `${p.id}@${p.revision}`)).size !== body.policies.length) return reply.code(400).send({ error: "Choose distinct policy revisions." });
    const dataset = (await datasets.read()).find((d) => d.id === body.datasetId && Date.parse(d.expiresAt) > Date.now() && canAccessApp(request.user!, d.appId));
    if (!dataset) return reply.code(404).send({ error: "Dataset not found or expired." });
    const application = (await database.document<AppRecord[]>("apps", () => []).read()).find((a) => a.id === dataset.appId && a.enabled);
    if (!application) return reply.code(400).send({ error: "Application is unavailable." });
    const records = await database.document<PolicyRecord[]>("profiles", () => []).read();
    const profiles = body.policies.map((p) => { const record = records.find((r) => r.id === p.id); return record && revisionOf(record, p.revision); });
    if (profiles.some((p) => !p || application.allowedProfileIds.length && !application.allowedProfileIds.includes(p.id))) return reply.code(400).send({ error: "All revisions must be published and allowed by the application." });
    const provider = await database.document<ProviderSettings>("provider_settings", createDefaultProviderSettings).read();
    const semanticCount = profiles.filter((p) => p!.detectors.some((d) => d.enabled)).length;
    const maximumProviderCalls = semanticCount * dataset.count * (1 + provider.maxRetries);
    const paid = semanticCount > 0 && provider.mode !== "mock";
    if (paid && !body.allowPaid) return reply.code(400).send({ error: `This run may send dataset inputs to TypeSafe in up to ${maximumProviderCalls} provider attempts. Cost is unknown. Explicit allowPaid: true is required.` });
    const credential = paid ? config.typesafeApiKey ? encryptText(config.typesafeApiKey, config.controlPlaneSecret) : (await database.document<{ typesafeApiKey?: StoredSecret }>("provider_secrets", () => ({})).read()).typesafeApiKey : undefined;
    if (paid && !credential) return reply.code(400).send({ error: "Configure the TypeSafe API key before running semantic evaluations." });
    const run: Run = { id: randomUUID(), appId: dataset.appId, datasetId: dataset.id, datasetHash: dataset.contentHash, createdAt: new Date().toISOString(), actorId: request.user!.id, expiresAt: dataset.expiresAt, profiles: profiles as Profile[], app: application, provider, configurationHash: digest({ profiles, application, provider }), credential, status: "queued", rows: [], total: dataset.count * profiles.length, estimate: { maximumProviderCalls: provider.mode === "mock" ? 0 : maximumProviderCalls, cost: paid ? "Unknown; provider billing applies." : "No external provider charges." }, generation: 1 };
    await runs.update((rows) => [...rows, run]);
    // A maintenance pass repairs an interrupted enqueue from the persisted run.
    try { await enqueue(run); } catch (e) { app.log.error(e, "Evaluation enqueue will retry"); }
    return reply.code(202).send({ run: publicRun(run) });
  });
  app.put<{ Params: { id: string } }>("/api/evaluations/:id", { preHandler: guard }, async (request, reply) => {
    const parsed = z.object({ action: z.enum(["cancel", "resume"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Choose cancel or resume." });
    let updated: Run | undefined;
    await runs.update((rows) => rows.map((r) => {
      if (r.id !== request.params.id || !canAccessApp(request.user!, r.appId) || r.status === "complete") return r;
      if (parsed.data.action === "resume" && !["cancelled", "failed"].includes(r.status)) return r;
      updated = parsed.data.action === "cancel" ? { ...r, status: "cancelled" } : { ...r, status: "queued", generation: r.generation + 1, jobId: undefined, error: undefined };
      return updated;
    }));
    if (!updated) return reply.code(409).send({ error: "Evaluation is unavailable or already in the requested state." });
    return { run: publicRun(updated) };
  });
  const worker = new DurableWorker(jobs, 1, async (job) => {
    const { runId, generation } = jobs.input<{ runId: string; generation: number }>(job);
    let run = (await runs.read()).find((r) => r.id === runId);
    if (!run || run.generation !== generation || run.status === "cancelled") return;
    const dataset = (await datasets.read()).find((d) => d.id === run!.datasetId && Date.parse(d.expiresAt) > Date.now());
    if (!dataset) throw new Error("Dataset expired or was deleted.");
    const cases = JSON.parse(decryptText(dataset.cases, config.controlPlaneSecret)) as Case[];
    await runs.update((rows) => rows.map((r) => r.id === runId && r.generation === generation && r.status === "queued" ? { ...r, status: "running" } : r));
    for (const sample of cases) for (const profile of run.profiles) {
      run = (await runs.read()).find((r) => r.id === runId)!;
      if (!run || run.generation !== generation || run.status === "cancelled") return;
      if (Date.parse(run.expiresAt) <= Date.now() || Date.parse(job.expiresAt) <= Date.now()) throw new Error("Evaluation deadline or dataset retention expired. Resume with a retained dataset.");
      if (run.rows.some((r) => r.caseId === sample.id && r.profileId === profile.id && r.revision === profile.revision)) continue;
      if (JSON.stringify(sample.input).length > profile.maxInputChars) throw new Error(`Case ${sample.id} exceeds policy input limit.`);
      const result = await evaluatePolicy({ id: randomUUID(), envelope: { input: sample.input }, profile, traceId: runId, firewallApp: run.app, provider: run.provider, apiKey: async () => run!.credential ? decryptText(run!.credential, config.controlPlaneSecret) : undefined });
      delete result.decision.metadata;
      result.decision.policyRevision = profile.revision; result.decision.policyHash = profile.contentHash ?? policyHash(profile);
      const row: EvaluationRow = { caseId: sample.id, category: sample.category, expected: sample.expected, profileId: profile.id, revision: profile.revision!, inputHash: digest(sample.input), decision: result.decision };
      await runs.update((rows) => rows.map((r) => r.id === runId && r.generation === generation && !r.rows.some((old) => old.caseId === row.caseId && old.profileId === row.profileId && old.revision === row.revision) ? { ...r, rows: [...r.rows, row] } : r));
    }
    await runs.update((rows) => rows.map((r) => r.id === runId && r.generation === generation && r.status !== "cancelled" ? { ...r, status: "complete", report: evaluationReport(r.rows), credential: undefined } : r));
    return { runId };
  }, (e) => app.log.error(e, "Evaluation worker failed"));
  worker.start();
  let maintenance: Promise<void> | undefined;
  const maintain = async () => {
    await datasets.update((rows) => rows.filter((d) => Date.parse(d.expiresAt) > Date.now()));
    await runs.update((rows) => rows.filter((r) => Date.parse(r.expiresAt) > Date.now()));
    for (const run of await runs.read()) {
      if (run.status === "queued" && !run.jobId) await enqueue(run);
      if (run.jobId && ["queued", "running"].includes(run.status)) {
        const job = await jobs.get(run.jobId, run.appId);
        if (!job || job.status === "failed") await runs.update((rows) => rows.map((r) => r.id === run.id && r.generation === run.generation ? { ...r, status: "failed", error: job?.error ?? "Worker result expired; resume to continue saved rows." } : r));
      }
    }
  };
  const timer = setInterval(() => { if (!maintenance) maintenance = maintain().catch((e) => app.log.error(e, "Evaluation maintenance failed")).finally(() => { maintenance = undefined; }); }, 500); timer.unref();
  return async () => { clearInterval(timer); await maintenance; await worker.stop(); };
}

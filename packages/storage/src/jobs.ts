import { randomUUID } from "node:crypto";
import type { StoredSecret } from "@pyro/contracts";
import { decryptText, encryptText, type Database, type DocumentStore } from "./index.js";

export interface DurableJob {
  id: string; appId: string; status: "queued" | "running" | "complete" | "failed" | "cancelled";
  createdAt: string; expiresAt: string; completedAt?: string;
  input?: StoredSecret; fingerprint: string; idempotencyKey?: string;
  leaseToken?: string; leaseUntil?: number; attempts: number;
  result?: unknown; error?: string;
}
interface QueueState { jobs: DurableJob[]; served: Record<string, number> }
export class JobConflict extends Error { readonly statusCode = 409; }
export class JobCapacityError extends Error { readonly statusCode = 429; }

// A bounded queue uses the same transactional document lock in every replica.
// This beta implementation deliberately favors correctness over high throughput.
export class DurableJobs {
  private readonly store: DocumentStore<QueueState>;
  constructor(database: Database, readonly secret: string, name = "classification_jobs", readonly maxDepth = 200, readonly leaseMs = 30_000) {
    this.store = database.document<QueueState>(name, () => ({ jobs: [], served: {} }));
  }
  async enqueue(job: { id: string; appId: string; input: unknown; fingerprint: string; idempotencyKey?: string }): Promise<DurableJob> {
    if (job.idempotencyKey && (job.idempotencyKey.length > 128 || !/^[\x21-\x7e]+$/.test(job.idempotencyKey))) throw new JobConflict("Idempotency-Key must contain 1–128 printable characters.");
    let selected!: DurableJob;
    await this.store.update((state) => {
      this.expire(state);
      const prior = job.idempotencyKey ? state.jobs.find((j) => j.appId === job.appId && j.idempotencyKey === job.idempotencyKey) : undefined;
      if (prior) {
        if (prior.fingerprint !== job.fingerprint) throw new JobConflict("Idempotency-Key was already used with a different request.");
        selected = prior; return state;
      }
      if (state.jobs.filter((j) => j.status === "queued" || j.status === "running").length >= this.maxDepth) throw new JobCapacityError("Durable queue is full. Retry later with the same idempotency key.");
      selected = { id: job.id, appId: job.appId, fingerprint: job.fingerprint, idempotencyKey: job.idempotencyKey, input: encryptText(JSON.stringify(job.input), this.secret), status: "queued", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), attempts: 0 };
      state.jobs.push(selected); return state;
    });
    return selected;
  }
  private expire(state: QueueState, now = Date.now()) {
    state.jobs = state.jobs.filter((j) => !j.completedAt || Date.parse(j.expiresAt) > now);
    for (const job of state.jobs) if (!job.completedAt && Date.parse(job.expiresAt) <= now) {
      job.status = "failed"; job.error = "Job deadline exceeded."; job.completedAt = new Date(now).toISOString();
      job.expiresAt = new Date(now + 10 * 60_000).toISOString(); delete job.input; delete job.leaseToken;
    }
    const apps = new Set(state.jobs.map((j) => j.appId));
    for (const id of Object.keys(state.served)) if (!apps.has(id)) delete state.served[id];
  }
  async claim(now = Date.now()): Promise<DurableJob | undefined> {
    let claimed: DurableJob | undefined;
    await this.store.update((state) => {
      this.expire(state, now);
      const due = state.jobs.filter((j) => j.status === "queued" || j.status === "running" && (j.leaseUntil ?? 0) <= now);
      due.sort((a, b) => (state.served[a.appId] ?? 0) - (state.served[b.appId] ?? 0) || a.createdAt.localeCompare(b.createdAt));
      const job = due[0];
      if (job) { job.status = "running"; job.leaseToken = randomUUID(); job.leaseUntil = now + this.leaseMs; job.attempts++; state.served[job.appId] = now; claimed = structuredClone(job); }
      return state;
    });
    return claimed;
  }
  input<T>(job: DurableJob): T { return JSON.parse(decryptText(job.input!, this.secret)) as T; }
  async heartbeat(job: DurableJob): Promise<void> {
    await this.store.update((state) => { const current = state.jobs.find((j) => j.id === job.id && j.status === "running" && j.leaseToken === job.leaseToken); if (current && (current.leaseUntil ?? 0) > Date.now()) current.leaseUntil = Date.now() + this.leaseMs; return state; });
  }
  async finish(job: DurableJob, result?: unknown, error?: string): Promise<boolean> {
    let applied = false;
    await this.store.update((state) => {
      const current = state.jobs.find((j) => j.id === job.id && j.status === "running" && j.leaseToken === job.leaseToken && (j.leaseUntil ?? 0) > Date.now());
      if (current) { current.status = error ? "failed" : "complete"; current.result = result; current.error = error; current.completedAt = new Date().toISOString(); current.expiresAt = new Date(Date.now() + 10 * 60_000).toISOString(); delete current.input; delete current.leaseToken; delete current.leaseUntil; applied = true; }
      return state;
    });
    return applied;
  }
  async get(id: string, appId: string): Promise<DurableJob | undefined> {
    const state = await this.store.update((s) => { this.expire(s); return s; });
    return state.jobs.find((j) => j.id === id && j.appId === appId);
  }
  async stats() {
    const state = await this.store.update((s) => { this.expire(s); return s; });
    const pending = state.jobs.filter((j) => !j.completedAt);
    return { queued: pending.filter((j) => j.status === "queued").length, running: pending.filter((j) => j.status === "running").length, failed: state.jobs.filter((j) => j.status === "failed").length, oldestAgeMs: pending.length ? Date.now() - Math.min(...pending.map((j) => Date.parse(j.createdAt))) : 0, capacity: this.maxDepth };
  }
}

export class DurableWorker {
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private ticking = false;
  private readonly active = new Set<Promise<void>>();
  constructor(private readonly jobs: DurableJobs, private readonly concurrency: number, private readonly handler: (job: DurableJob) => Promise<unknown>, private readonly onError: (error: unknown) => void) {}
  start() { this.timer = setInterval(() => void this.tick(), 100); this.timer.unref(); }
  private async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      while (!this.stopped && this.active.size < this.concurrency) {
        const job = await this.jobs.claim(); if (!job) break;
        const pending = this.run(job); this.active.add(pending); void pending.finally(() => this.active.delete(pending));
      }
    } catch (e) { this.onError(e); } finally { this.ticking = false; }
  }
  private async run(job: DurableJob) {
    const heartbeat = setInterval(() => void this.jobs.heartbeat(job).catch(this.onError), Math.max(10, this.jobs.leaseMs / 3));
    heartbeat.unref();
    try { await this.jobs.finish(job, await this.handler(job)); }
    catch (e) { try { await this.jobs.finish(job, undefined, e instanceof Error ? e.message : "Job failed."); } catch (storageError) { this.onError(storageError); } }
    finally { clearInterval(heartbeat); }
  }
  async stop() { this.stopped = true; clearInterval(this.timer); while (this.ticking) await new Promise((r) => setTimeout(r, 10)); await Promise.allSettled([...this.active]); }
}

export async function consumeQuota(database: Database, limits: Array<{ id: string; limit: number }>, now = Date.now()): Promise<{ allowed: boolean; remaining: number }> {
  const store = database.document<Record<string, { window: number; count: number }>>("rate_limits", () => ({}));
  const window = Math.floor(now / 60_000);
  let remaining = Infinity;
  let allowed = true;
  await store.update((state) => {
    for (const [id, row] of Object.entries(state)) if (row.window !== window) delete state[id];
    for (const { id, limit } of limits) if ((state[id]?.count ?? 0) >= limit) allowed = false;
    for (const { id, limit } of limits) { const row = state[id] ?? { window, count: 0 }; if (allowed) row.count++; state[id] = row; remaining = Math.min(remaining, Math.max(0, limit - row.count)); }
    return state;
  });
  return { allowed, remaining };
}

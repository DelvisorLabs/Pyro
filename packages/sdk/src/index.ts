import type { ClassificationDecision, ClassificationEnvelope } from "@pyro/contracts";

export interface PyroClientOptions {
  baseUrl?: string;
  apiKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface ClassifyOptions {
  profile?: string;
  metadata?: Record<string, unknown>;
  labels?: Record<string, string>;
  requestId?: string;
  signal?: AbortSignal;
}

export interface ProfileSummary { id: string; name: string; description: string }
export interface JobReceipt { id: string; status: "queued"; statusUrl: string }

export interface Job {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  createdAt: string;
  completedAt?: string;
  decision?: ClassificationDecision;
  error?: string;
}

export class PyroError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
    public readonly details?: unknown,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "PyroError";
  }
}

export class PyroClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: PyroClientOptions) {
    if (!options.apiKey) throw new Error("apiKey is required");
    this.baseUrl = (options.baseUrl ?? "http://localhost:8080").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error("timeoutMs must be positive.");
    const url = new URL(this.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("baseUrl must be an HTTP(S) URL without credentials, query or fragment.");
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async classify(input: unknown, options: ClassifyOptions = {}): Promise<ClassificationDecision> {
    return this.request<ClassificationDecision>("/v1/classify", {
      method: "POST",
      body: JSON.stringify(this.envelope(input, options)),
      headers: options.requestId ? { "X-Request-Id": options.requestId } : undefined,
      signal: options.signal,
    });
  }

  async createJob(input: unknown, options: ClassifyOptions = {}): Promise<JobReceipt> {
    return this.request("/v1/jobs", {
      method: "POST",
      body: JSON.stringify(this.envelope(input, options)),
      headers: options.requestId ? { "X-Request-Id": options.requestId } : undefined,
      signal: options.signal,
    });
  }

  async getJob(id: string, signal?: AbortSignal): Promise<Job> {
    return this.request<Job>(`/v1/jobs/${encodeURIComponent(id)}`, { signal });
  }

  async waitForJob(id: string, options: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ClassificationDecision> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const intervalMs = options.intervalMs ?? 250;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("Polling timeout and interval must be positive.");
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new PyroError("Timed out waiting for classification job.", 408)), timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
    try {
      while (true) {
        signal.throwIfAborted();
        const job = await this.getJob(id, signal);
        if (job.status === "complete" && job.decision) return job.decision;
        if (job.status === "failed") throw new PyroError(job.error ?? "Classification job failed.", 500);
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(pause); reject(signal.reason); };
          const pause = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, intervalMs);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw error;
    } finally { clearTimeout(timer); }
  }

  async listProfiles(signal?: AbortSignal): Promise<ProfileSummary[]> {
    return this.request("/v1/profiles", { signal });
  }

  private envelope(input: unknown, options: ClassifyOptions): ClassificationEnvelope {
    return { input, profile: options.profile, metadata: options.metadata, labels: options.labels };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Request timed out.")), this.timeoutMs);
    const signal = init.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        signal,
        redirect: "error",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
      const requestId = response.headers.get("x-request-id") ?? undefined;
      let body: unknown;
      try { body = await response.json(); } catch { body = {}; }
      if (!response.ok) {
        const message = typeof body === "object" && body && "error" in body ? String(body.error) : `Request failed (${response.status}).`;
        const retryAfter = response.headers.get("retry-after");
        throw new PyroError(message, response.status, requestId, body, retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined);
      }
      return body as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type { ClassificationDecision, ClassificationEnvelope } from "@pyro/contracts";

export { verifyWebhook } from "./webhooks.js";
export type { WebhookEvent, PolicyAction, Verdict, DetectorResult } from "@pyro/contracts";

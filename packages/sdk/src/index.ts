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

  async createJob(input: unknown, options: ClassifyOptions = {}): Promise<{ id: string; status: string; statusUrl: string }> {
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
    const started = Date.now();
    const timeoutMs = options.timeoutMs ?? 60_000;
    while (Date.now() - started < timeoutMs) {
      const job = await this.getJob(id, options.signal);
      if (job.status === "complete" && job.decision) return job.decision;
      if (job.status === "failed") throw new PyroError(job.error ?? "Classification job failed.", 500);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, options.intervalMs ?? 250);
        options.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(options.signal?.reason); }, { once: true });
      });
    }
    throw new PyroError("Timed out waiting for classification job.", 408);
  }

  async listProfiles(signal?: AbortSignal): Promise<Array<{ id: string; name: string; description: string }>> {
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
        throw new PyroError(message, response.status, requestId, body);
      }
      return body as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type { ClassificationDecision, ClassificationEnvelope } from "@pyro/contracts";

import type { ApiKeyRecord, ClassificationEvent, Profile, ProviderSettings } from "@pyro/contracts";

export type { ApiKeyRecord, ClassificationEvent, Profile, ProviderSettings };

export interface Overview {
  totals: {
    requests: number;
    blocked: number;
    reviewed: number;
    failed: number;
    blockRate: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    p95QueueMs: number;
    p95ProviderMs: number;
    shadowChanges: number;
  };
  actions: Array<{ action: "allow" | "review" | "block"; count: number }>;
  detectors: Array<{ id: string; name: string; signals: number; averageProbability: number }>;
  timeline: Array<{ at: string; total: number; blocked: number; reviewed: number }>;
  gateway: {
    status?: string;
    queue?: {
      active: number;
      waiting: number;
      concurrency: number;
      maxDepth: number;
      accepted: number;
      completed: number;
      failed: number;
      rejected: number;
    };
    circuitBreaker?: { state: "closed" | "degraded" | "open"; consecutiveFailures: number; retryAt?: string };
  };
}

import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import type { ClassificationDecision } from "@pyro/contracts";
import type { QueueSnapshot } from "@pyro/queue";

export class GatewayMetrics {
  readonly registry = new Registry();
  private readonly decisions: Counter;
  private readonly duration: Histogram;
  private readonly queueWait: Histogram;
  private readonly queueDepth: Gauge;
  private readonly queueActive: Gauge;
  private readonly upstreamFailures: Counter;
  private readonly providerDuration: Histogram;
  private readonly policyDuration: Histogram;
  private readonly detectorSignals: Counter;
  private readonly shadowChanges: Counter;
  private readonly providerRetries: Counter;
  private readonly circuitOpens: Counter;

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: "pyro_" });
    this.decisions = new Counter({
      name: "pyro_classifications_total",
      help: "Classification decisions by verdict and action.",
      labelNames: ["verdict", "action", "profile", "provider"],
      registers: [this.registry],
    });
    this.duration = new Histogram({
      name: "pyro_classification_duration_seconds",
      help: "End-to-end classifier latency.",
      labelNames: ["provider", "profile"],
      buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });
    this.queueWait = new Histogram({
      name: "pyro_queue_wait_seconds",
      help: "Time a request waited before classification began.",
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.5, 1, 5],
      registers: [this.registry],
    });
    this.queueDepth = new Gauge({
      name: "pyro_queue_depth",
      help: "Number of requests waiting for a worker.",
      registers: [this.registry],
    });
    this.queueActive = new Gauge({
      name: "pyro_queue_active",
      help: "Number of active classifier workers.",
      registers: [this.registry],
    });
    this.upstreamFailures = new Counter({
      name: "pyro_upstream_failures_total",
      help: "Classifier failures by provider.",
      labelNames: ["provider"],
      registers: [this.registry],
    });
    this.providerDuration = new Histogram({
      name: "pyro_provider_duration_seconds",
      help: "Time spent waiting for the classifier provider.",
      labelNames: ["provider", "profile"],
      buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });
    this.policyDuration = new Histogram({
      name: "pyro_policy_evaluation_duration_seconds",
      help: "Time spent evaluating the local enforcement policy.",
      labelNames: ["profile"],
      buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05],
      registers: [this.registry],
    });
    this.detectorSignals = new Counter({
      name: "pyro_detector_signals_total",
      help: "Detector results with a probability of at least 0.5.",
      labelNames: ["profile", "detector"],
      registers: [this.registry],
    });
    this.shadowChanges = new Counter({
      name: "pyro_shadow_action_changes_total",
      help: "Shadow policy decisions that differ from the enforced action.",
      labelNames: ["profile", "shadow_profile"],
      registers: [this.registry],
    });
    this.providerRetries = new Counter({
      name: "pyro_provider_retries_total",
      help: "Classifier provider retry attempts.",
      labelNames: ["provider"],
      registers: [this.registry],
    });
    this.circuitOpens = new Counter({
      name: "pyro_provider_circuit_opens_total",
      help: "Times the provider circuit breaker opened.",
      labelNames: ["provider"],
      registers: [this.registry],
    });
  }

  record(decision: ClassificationDecision, failed = false): void {
    this.decisions.inc({
      verdict: decision.verdict,
      action: decision.action,
      profile: decision.profileId,
      provider: decision.provider,
    });
    this.duration.observe(
      { provider: decision.provider, profile: decision.profileId },
      decision.latencyMs / 1_000,
    );
    this.queueWait.observe(decision.queueMs / 1_000);
    if (decision.timings) {
      this.providerDuration.observe(
        { provider: decision.provider, profile: decision.profileId },
        decision.timings.providerMs / 1_000,
      );
      this.policyDuration.observe({ profile: decision.profileId }, decision.timings.policyMs / 1_000);
    }
    for (const detector of decision.detectors) {
      if (detector.probability >= 0.5) this.detectorSignals.inc({ profile: decision.profileId, detector: detector.id });
    }
    for (const shadow of decision.shadows ?? []) {
      if (shadow.changed) this.shadowChanges.inc({ profile: decision.profileId, shadow_profile: shadow.profileId });
    }
    if (failed) this.upstreamFailures.inc({ provider: decision.provider });
  }

  updateQueue(snapshot: QueueSnapshot): void {
    this.queueDepth.set(snapshot.waiting);
    this.queueActive.set(snapshot.active);
  }

  recordRetry(provider: string): void {
    this.providerRetries.inc({ provider });
  }

  recordCircuitOpen(provider: string): void {
    this.circuitOpens.inc({ provider });
  }
}

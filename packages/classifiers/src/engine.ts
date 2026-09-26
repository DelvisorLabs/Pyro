import { buildDecision, buildFailureDecision, ClassifierConfigurationError, evaluateLocalRules, JevClassifier, MockClassifier, UpstreamClassifierError, type LocalRuleMatch, type ClassifierInput } from "./index.js";
import type { AppRecord, ClassificationDecision, ClassificationEnvelope, Profile, ProviderSettings } from "@pyro/contracts";

function localRuleDecision(
  id: string,
  traceId: string,
  profile: Profile,
  queueMs: number,
  match: LocalRuleMatch,
  metadata: Record<string, unknown> | undefined,
  latencyMs: number,
): ClassificationDecision {
  const blocked = match.rule.action === "block";
  return {
    id,
    traceId,
    createdAt: new Date().toISOString(),
    profileId: profile.id,
    verdict: blocked ? "unsafe" : "suspicious",
    action: match.rule.action,
    risk: match.rule.risk,
    confidence: match.rule.risk,
    reason: `Local rule “${match.rule.name}” matched before provider evaluation.`,
    detectors: [{
      id: `local_rule:${match.rule.id}`,
      name: match.rule.name,
      probability: match.rule.risk,
      weightedProbability: match.rule.risk,
    }],
    model: "local-rules",
    provider: "local-rules",
    latencyMs,
    queueMs,
    timings: { providerMs: 0, policyMs: latencyMs, totalMs: latencyMs },
    usage: { inputTokens: 0, outputTokens: 0, cost: { amount: 0, currency: "USD" } },
    metadata,
  };
}

export async function evaluatePolicy({ id, envelope, profile, queueMs = 0, traceId, firewallApp, provider, apiKey, circuit = { consecutiveFailures: 0, openUntil: 0 }, onRetry, onCircuitOpen }: {
  id: string; envelope: ClassificationEnvelope; profile: Profile; queueMs?: number; traceId: string;
  firewallApp: AppRecord; provider: ProviderSettings; apiKey: () => Promise<string | undefined>;
  circuit?: { consecutiveFailures: number; openUntil: number };
  onRetry?: (mode: string) => void; onCircuitOpen?: (mode: string) => void;
}): Promise<{ decision: ClassificationDecision; failure?: string; localRuleId?: string }> {
    const started = performance.now();
    const localMatch = evaluateLocalRules(envelope.input, [
      ...firewallApp.localRules.map((rule) => ({ ...rule, id: `app:${rule.id}` })),
      ...(profile.localRules ?? []).map((rule) => ({ ...rule, id: `profile:${rule.id}` })),
    ])[0];
    if (localMatch) {
      const latencyMs = performance.now() - started;
      return {
        decision: localRuleDecision(id, traceId, profile, queueMs, localMatch, envelope.metadata, latencyMs),
        localRuleId: localMatch.rule.id,
      };
    }
    if (!profile.detectors.some((detector) => detector.enabled)) {
      return { decision: {
        id, traceId, createdAt: new Date().toISOString(), profileId: profile.id,
        verdict: "safe", action: "allow", risk: 0, confidence: 1,
        reason: "No local rule matched; no semantic detectors are enabled.", detectors: [],
        model: "local-rules", provider: "local-rules", latencyMs: performance.now() - started, queueMs,
        usage: { inputTokens: 0, outputTokens: 0, cost: { amount: 0, currency: "USD" } }, metadata: envelope.metadata,
      } };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), profile.timeoutMs);
    const classifierInput: ClassifierInput = {
      id,
      traceId,
      input: envelope.input,
      profile: { ...profile, model: profile.model || provider.model },
      provider,
      apiKey: await apiKey(),
      metadata: envelope.metadata,
      queueMs,
      signal: controller.signal,
    };
    let decision: ClassificationDecision;
    let failure: string | undefined;
    let providerMs = 0;
    let policyMs = 0;
    try {
      const classifier = provider.mode === "mock" ? new MockClassifier() : new JevClassifier();
      const providerStarted = performance.now();
      if (circuit.openUntil > Date.now()) throw new Error("Provider circuit breaker is open.");
      let raw: Awaited<ReturnType<typeof classifier.classify>> | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt <= provider.maxRetries; attempt += 1) {
        try {
          raw = await classifier.classify(classifierInput);
          circuit.consecutiveFailures = 0;
          circuit.openUntil = 0;
          break;
        } catch (error) {
          lastError = error;
          const nonRetryableUpstream = error instanceof UpstreamClassifierError
            && error.status !== undefined
            && error.status >= 400
            && error.status < 500
            && ![408, 429].includes(error.status);
          if (error instanceof ClassifierConfigurationError || nonRetryableUpstream || attempt >= provider.maxRetries || controller.signal.aborted) break;
          onRetry?.(provider.mode);
          await new Promise((resolve) => setTimeout(resolve, provider.retryBackoffMs * 2 ** attempt));
        }
      }
      if (!raw) {
        circuit.consecutiveFailures += 1;
        if (circuit.consecutiveFailures >= provider.circuitBreakerFailureThreshold) {
          circuit.openUntil = Date.now() + provider.circuitBreakerResetMs;
          onCircuitOpen?.(provider.mode);
        }
        throw lastError ?? new Error("Classifier provider failed.");
      }
      providerMs = performance.now() - providerStarted;
      const policyStarted = performance.now();
      decision = buildDecision(classifierInput, raw, performance.now() - started);
      policyMs = performance.now() - policyStarted;
    } catch (error) {
      providerMs = performance.now() - started;
      failure = error instanceof Error ? error.message : "Unknown classifier error";
      decision = buildFailureDecision(classifierInput, error, performance.now() - started);
    } finally {
      clearTimeout(timeout);
    }
    decision.timings = { providerMs, policyMs, totalMs: performance.now() - started };
    return { decision, failure };

}

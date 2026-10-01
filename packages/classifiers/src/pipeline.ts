import type { ClassificationDecision, ClassificationEnvelope, PolicyAction, PolicyTraceEntry, Profile, SemanticStep } from "@pyro/contracts";
import { matchTextStep } from "./local-rules.js";

type Result = { decision: ClassificationDecision; failure?: string };
export async function runPipeline({ id, traceId, profile, envelope, queueMs, evaluateSemantic }: {
  id: string; traceId: string; profile: Profile; envelope: ClassificationEnvelope; queueMs: number;
  evaluateSemantic: (step: SemanticStep, remainingMs: number) => Promise<Result>;
}): Promise<Result> {
  const started = performance.now(), pipeline = profile.pipeline!;
  const trace: PolicyTraceEntry[] = [], calls: ClassificationDecision[] = [];
  let action: PolicyAction | undefined, failure: string | undefined, indeterminate = false;
  let reason = "All continued checks completed; applied the policy's final outcome.";
  for (const step of pipeline.steps) {
    if (action) {
      trace.push({ id: step.id, name: step.name, type: step.type, outcome: "skipped", evidence: "An earlier check ended this policy." });
      continue;
    }
    let outcome: PolicyTraceEntry["outcome"], evidence: string, probability: number | undefined;
    if (step.type === "text") {
      try {
        const match = matchTextStep(envelope.input, step);
        outcome = match.matched ? "match" : "no_match"; evidence = match.evidence;
      } catch {
        outcome = "error"; evidence = "The text check could not inspect the complete input. Applied the policy's error outcome."; failure = evidence;
      }
    } else {
      const remaining = profile.timeoutMs - (performance.now() - started);
      const result = remaining > 0 ? await evaluateSemantic(step, Math.max(1, Math.floor(remaining))) : undefined;
      if (result) calls.push(result.decision);
      if (!result || result.failure || result.decision.verdict === "indeterminate") {
        outcome = "error"; evidence = "The semantic check could not complete. Applied the policy's error outcome.";
        failure = result?.failure ?? "Policy execution deadline exceeded.";
      } else {
        probability = result.decision.detectors[0]?.probability;
        if (probability === undefined || !Number.isFinite(probability)) {
          outcome = "error"; evidence = "No valid condition score was returned."; failure = evidence;
        } else {
          outcome = probability >= step.yesThreshold ? "match" : probability <= step.noThreshold ? "no_match" : "uncertain";
          evidence = `Condition score ${probability.toFixed(3)}; No ≤ ${step.noThreshold}, Yes ≥ ${step.yesThreshold}. This is a model score, not verified evidence or calibrated confidence.`;
        }
      }
    }
    const next = outcome === "error" ? pipeline.onError : outcome === "uncertain" ? pipeline.onUncertain : outcome === "match" ? step.onMatch : step.onNoMatch;
    trace.push({ id: step.id, name: step.name, type: step.type, outcome, evidence, probability, next });
    if (next !== "continue") {
      action = next; indeterminate = outcome === "error" || outcome === "uncertain";
      reason = `“${step.name}”: ${outcome.replace("_", " ")} → ${action}.`;
    }
  }
  action ??= pipeline.otherwise;
  const elapsed = performance.now() - started;
  const providerMs = calls.reduce((sum, call) => sum + (call.timings?.providerMs ?? 0), 0);
  const sumTokens = (field: "inputTokens" | "outputTokens") => calls.every((call) => call.usage?.[field] !== undefined) ? calls.reduce((sum, call) => sum + (call.usage?.[field] ?? 0), 0) : undefined;
  const currency = calls[0]?.usage?.cost?.currency ?? "USD";
  const cost = calls.every((call) => call.usage?.cost?.currency === currency) ? { amount: calls.reduce((sum, call) => sum + (call.usage?.cost?.amount ?? 0), 0), currency } : undefined;
  return { failure, decision: {
    id, traceId, createdAt: new Date().toISOString(), profileId: profile.id, decisionMode: "pipeline", policyTrace: trace,
    action, verdict: indeterminate ? "indeterminate" : action === "allow" ? "safe" : action === "block" ? "unsafe" : "suspicious",
    // Compatibility fields encode the outcome, not a probability of harm.
    risk: action === "allow" ? 0 : action === "block" ? 1 : 0.5, confidence: 0,
    reason, detectors: [], model: calls.at(-1)?.model ?? "local-rules", provider: calls.at(-1)?.provider ?? "local-rules",
    latencyMs: elapsed, queueMs, timings: { providerMs, policyMs: Math.max(0, elapsed - providerMs), totalMs: elapsed },
    usage: { inputTokens: sumTokens("inputTokens"), outputTokens: sumTokens("outputTokens"), cost }, metadata: envelope.metadata,
  } };
}

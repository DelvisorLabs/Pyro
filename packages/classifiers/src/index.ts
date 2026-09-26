import type {
  ClassificationDecision,
  DetectorResult,
  Profile,
  ProviderSettings,
} from "@pyro/contracts";

export interface ClassifierInput {
  id: string;
  traceId?: string;
  input: unknown;
  profile: Profile;
  provider: ProviderSettings;
  apiKey?: string;
  metadata?: Record<string, unknown>;
  queueMs: number;
  signal?: AbortSignal;
}

export interface RawClassification {
  detectors: DetectorResult[];
  model: string;
  provider: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cost?: { amount: number; currency: string };
  };
}

export interface Classifier {
  readonly name: string;
  classify(input: ClassifierInput): Promise<RawClassification>;
}

export class ClassifierConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassifierConfigurationError";
  }
}

export class UpstreamClassifierError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamClassifierError";
  }
}

function clip(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function buildDecision(
  input: ClassifierInput,
  raw: RawClassification,
  latencyMs: number,
): ClassificationDecision {
  const sorted = [...raw.detectors].sort((a, b) => b.weightedProbability - a.weightedProbability);
  const top = sorted[0];
  const detectorConfig = new Map(input.profile.detectors.map((detector) => [detector.id, detector]));
  const blockSignals = raw.detectors.filter((result) => {
    const detector = detectorConfig.get(result.id);
    return result.weightedProbability >= (detector?.blockThreshold ?? input.profile.blockThreshold);
  });
  const reviewSignals = raw.detectors.filter((result) => {
    const detector = detectorConfig.get(result.id);
    return result.weightedProbability >= (detector?.reviewThreshold ?? input.profile.reviewThreshold);
  });

  const strategy = input.profile.decisionStrategy ?? "maximum";
  const risk = strategy === "weighted_average"
    ? clip(raw.detectors.reduce((total, result) => total + result.weightedProbability, 0) / Math.max(1, raw.detectors.length))
    : clip(top?.weightedProbability ?? 0);
  const verdict = strategy === "signal_count"
    ? blockSignals.length >= (input.profile.minimumBlockSignals ?? 1)
      ? "unsafe"
      : reviewSignals.length >= (input.profile.minimumReviewSignals ?? 1)
        ? "suspicious"
        : "safe"
    : strategy === "weighted_average"
      ? risk >= input.profile.blockThreshold
        ? "unsafe"
        : risk >= input.profile.reviewThreshold
          ? "suspicious"
          : "safe"
      : blockSignals.length > 0
        ? "unsafe"
        : reviewSignals.length > 0
          ? "suspicious"
          : "safe";
  const action = verdict === "unsafe" ? "block" : verdict === "suspicious" ? "review" : "allow";
  const confidence = clip(Math.abs(risk - 0.5) * 2);
  return {
    id: input.id,
    traceId: input.traceId,
    createdAt: new Date().toISOString(),
    profileId: input.profile.id,
    verdict,
    action,
    risk,
    confidence,
    reason:
      top && (blockSignals.length > 0 || reviewSignals.length > 0)
        ? `${top.name} was the strongest signal under the ${strategy.replace("_", " ")} policy.`
        : "No enabled detector crossed its risk threshold.",
    detectors: raw.detectors,
    model: raw.model,
    provider: raw.provider,
    latencyMs,
    queueMs: input.queueMs,
    usage: raw.usage,
    metadata: input.metadata,
  };
}

export function buildFailureDecision(
  input: ClassifierInput,
  error: unknown,
  latencyMs: number,
): ClassificationDecision {
  const closed = input.profile.failMode === "closed";
  return {
    id: input.id,
    traceId: input.traceId,
    createdAt: new Date().toISOString(),
    profileId: input.profile.id,
    verdict: "indeterminate",
    action: closed ? "block" : "allow",
    risk: closed ? 1 : 0,
    confidence: 0,
    reason: `${error instanceof ClassifierConfigurationError ? error.message : "Classifier unavailable."} Applied fail-${input.profile.failMode} policy; this is not a detected attack.`,
    detectors: [],
    model: input.profile.model,
    provider: input.provider.mode,
    latencyMs,
    queueMs: input.queueMs,
    metadata: {
      ...input.metadata,
      classifierError: error instanceof Error ? error.message : "Unknown classifier error",
    },
  };
}

export { JevClassifier } from "./jev.js";
export { evaluateLocalRules, type LocalRuleMatch } from "./local-rules.js";
export { MockClassifier } from "./mock.js";

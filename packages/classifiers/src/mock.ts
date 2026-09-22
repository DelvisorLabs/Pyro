import type { DetectorResult } from "@pyro/contracts";
import type { Classifier, ClassifierInput, RawClassification } from "./index.js";

const PATTERNS: Record<string, RegExp[]> = {
  prompt_injection: [
    /ignore (all |any |the )?(previous|prior|above|system|developer) instructions?/i,
    /follow (only )?(these|my) instructions?/i,
    /you are now/i,
    /system\s*:/i,
  ],
  jailbreak: [
    /jailbreak/i,
    /do anything now|\bdan\b/i,
    /unrestricted (mode|assistant|persona)/i,
    /bypass (safety|guardrails?|policy)/i,
  ],
  instruction_override: [
    /override (the )?(rules?|policy|instructions?)/i,
    /disregard/i,
    /new instructions?/i,
    /reveal (your )?(system|developer|hidden) prompt/i,
  ],
  data_exfiltration: [
    /api[-_ ]?key|access[-_ ]?token|password|credential|secret/i,
    /hidden prompt|system prompt/i,
    /send .* to https?:\/\//i,
  ],
  tool_manipulation: [
    /run (this )?(command|code|script)/i,
    /execute|shell|terminal/i,
    /delete (all|the)|transfer (money|funds)|purchase/i,
  ],
  obfuscation: [
    /base64|rot13|decode this/i,
    /[A-Za-z0-9+/]{80,}={0,2}/,
    /zero[- ]width|invisible characters?/i,
  ],
};

function serialize(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

export class MockClassifier implements Classifier {
  readonly name = "mock";

  async classify(input: ClassifierInput): Promise<RawClassification> {
    const content = serialize(input.input);
    const detectors: DetectorResult[] = input.profile.detectors
      .filter((detector) => detector.enabled)
      .map((detector) => {
        const matches = (PATTERNS[detector.id] ?? []).filter((pattern) => pattern.test(content)).length;
        const probability = matches === 0 ? 0.04 : Math.min(0.98, 0.62 + matches * 0.17);
        return {
          id: detector.id,
          name: detector.name,
          probability,
          weightedProbability: Math.min(1, probability * detector.weight),
        };
      });
    return {
      detectors,
      model: "local-pattern-mock",
      provider: "mock",
      usage: { inputTokens: 0, outputTokens: 0, cost: { amount: 0, currency: "USD" } },
    };
  }
}

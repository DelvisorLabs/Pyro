import { createDefaultProfile, ProfileSchema, type Profile } from "@pyro/contracts";

export function newPipeline(model = "jev-latest"): Profile {
  return { ...createDefaultProfile(), id: "support-workflow", name: "Support workflow", description: "Check language, then keep requests within company support.", model,
    detectors: [], localRules: [], notifyOn: [], pipeline: { version: 1, otherwise: "review", onUncertain: "review", onError: "review", steps: [
      { id: "language", name: "Language check", type: "text", match: "word_list", words: ["idiot", "stupid"], pattern: "", caseSensitive: false, onMatch: "block", onNoMatch: "continue" },
      { id: "company_scope", name: "Company scope", type: "semantic", question: "Is this request related to Northstar customer support?", context: "Northstar is an example company selling project-management software. Support covers Northstar accounts, billing and product features. Exclude unrelated topics and requests for other customers' private data.", positiveExamples: ["How do I change my Northstar billing plan?"], negativeExamples: ["Write me a movie review."], yesThreshold: 0.8, noThreshold: 0.2, onMatch: "allow", onNoMatch: "block" },
    ] } };
}

/** Preserve typing-friendly blank lines in the editor; normalize at the boundary. */
export function pipelinePayload(profile: Profile): Profile {
  return ProfileSchema.parse({ ...profile, pipeline: profile.pipeline && { ...profile.pipeline, steps: profile.pipeline.steps.map((step) => step.type === "text"
    ? { ...step, words: step.words.map((word) => word.trim()).filter(Boolean) }
    : { ...step, positiveExamples: step.positiveExamples.map((s) => s.trim()).filter(Boolean), negativeExamples: step.negativeExamples.map((s) => s.trim()).filter(Boolean) }) } });
}

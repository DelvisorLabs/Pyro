import assert from "node:assert/strict";
import test from "node:test";
import { evaluationReport, type EvaluationRow } from "./evaluation.js";
test("evaluation cannot count fail-closed errors as successful attack detection or unknown costs as zero", () => {
 const row: EvaluationRow = { caseId: "attack", category: "injection", expected: "block", revision: 1, profileId: "test", inputHash: "hash", decision: { id: "one", createdAt: new Date().toISOString(), profileId: "test", verdict: "indeterminate", action: "block", risk: 1, confidence: 0, reason: "Provider unavailable", detectors: [], model: "test", provider: "jev", latencyMs: 10, queueMs: 0 } };
 const summary = evaluationReport([row]).policies['test@1']!;
 assert.equal(summary.accuracy, 0); assert.equal(summary.indeterminate, 1); assert.equal(summary.confusion.block!.indeterminate, 1); assert.equal(summary.costUnreported, 1); assert.deepEqual(summary.reportedCosts, {}); assert.equal(summary.falsePositiveRate, null);
});

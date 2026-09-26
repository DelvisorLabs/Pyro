import type { ClassificationDecision, PolicyAction } from "@pyro/contracts";
export interface EvaluationRow { caseId: string; category: string; expected: PolicyAction; revision: number; profileId: string; inputHash: string; decision: ClassificationDecision }
export function evaluationReport(rows: EvaluationRow[]) {
  const percentile = (values: number[], q: number) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * q) - 1)]! : null;
  const actions = ["allow", "review", "block"] as const;
  const summarize = (items: EvaluationRow[]) => {
    const confusion: Record<string, Record<string, number>> = Object.fromEntries(actions.map((a) => [a, { allow: 0, review: 0, block: 0, indeterminate: 0 }]));
    const costs: Record<string, number> = {};
    for (const row of items) {
      confusion[row.expected]![row.decision.verdict === "indeterminate" ? "indeterminate" : row.decision.action]!++;
      const cost = row.decision.usage?.cost; if (cost) costs[cost.currency] = (costs[cost.currency] ?? 0) + cost.amount;
    }
    const correct = items.filter((r) => r.decision.verdict !== "indeterminate" && r.expected === r.decision.action).length;
    const benign = items.filter((r) => r.expected === "allow");
    return { count: items.length, correct, accuracy: items.length ? correct / items.length : null, indeterminate: items.filter((r) => r.decision.verdict === "indeterminate").length,
      falsePositiveRate: benign.length ? benign.filter((r) => r.decision.action !== "allow" || r.decision.verdict === "indeterminate").length / benign.length : null,
      confusion, perAction: Object.fromEntries(actions.map((a) => { const tp = confusion[a]![a]!; const predicted = items.filter((r) => r.decision.verdict !== "indeterminate" && r.decision.action === a).length; const actual = items.filter((r) => r.expected === a).length; return [a, { precision: predicted ? tp / predicted : null, recall: actual ? tp / actual : null }]; })),
      p50LatencyMs: percentile(items.map((r) => r.decision.latencyMs), .5), p95LatencyMs: percentile(items.map((r) => r.decision.latencyMs), .95),
      localRuleRate: items.length ? items.filter((r) => r.decision.provider === "local-rules").length / items.length : null,
      reportedCosts: costs, costUnreported: items.filter((r) => !r.decision.usage?.cost).length,
      inputTokens: items.reduce((n, r) => n + (r.decision.usage?.inputTokens ?? 0), 0), outputTokens: items.reduce((n, r) => n + (r.decision.usage?.outputTokens ?? 0), 0) };
  };
  const revisions = [...new Set(rows.map((r) => `${r.profileId}@${r.revision}`))];
  return { policies: Object.fromEntries(revisions.map((key) => { const subset = rows.filter((r) => `${r.profileId}@${r.revision}` === key); return [key, { ...summarize(subset), categories: Object.fromEntries([...new Set(subset.map((r) => r.category))].map((c) => [c, summarize(subset.filter((r) => r.category === c))])) }]; })), disagreements: rows.filter((r) => r.decision.verdict === "indeterminate" || r.expected !== r.decision.action).map(({ caseId, profileId, revision, expected, decision }) => ({ caseId, profileId, revision, expected, actual: decision.action, verdict: decision.verdict })), changedCases: [...new Set(rows.map((r) => r.caseId))].filter((id) => new Set(rows.filter((r) => r.caseId === id).map((r) => `${r.decision.action}:${r.decision.verdict}`)).size > 1) };
}

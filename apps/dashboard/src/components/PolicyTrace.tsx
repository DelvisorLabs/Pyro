import type { ClassificationDecision } from "@pyro/contracts";
import { HelpTooltip } from "./ui/help-tooltip";
import { Badge } from "./ui/badge";

export function PolicyTrace({ decision }: { decision: ClassificationDecision }) {
  if (!decision.policyTrace) return null;
  return <div className="space-y-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">Executed path</h3><HelpTooltip label="About policy traces">Your application must enforce the final action. A topic match does not establish safety or permission. Semantic scores are model scores, not calibrated confidence.</HelpTooltip></div><ol className="space-y-2" aria-label="Policy execution trace">{decision.policyTrace.map((step, index) => <li key={step.id} className={`rounded-control border border-line p-3 ${step.outcome === "skipped" ? "bg-surface-subtle text-muted" : "bg-surface"}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-[13px]">{index + 1}. {step.name}</strong><Badge>{step.outcome === "match" ? "Yes" : step.outcome === "no_match" ? "No" : step.outcome}{step.next && ` → ${step.next}`}</Badge></div>
    <details className="mt-2 text-xs leading-5 text-muted"><summary className="cursor-pointer">Evidence</summary><p className="mt-1 break-words">{step.evidence}</p></details>
  </li>)}</ol></div>;
}

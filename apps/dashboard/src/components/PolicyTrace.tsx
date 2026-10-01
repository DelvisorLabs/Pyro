import type { ClassificationDecision } from "@pyro/contracts";
import { Badge } from "./ui/badge";

export function PolicyTrace({ decision }: { decision: ClassificationDecision }) {
  if (!decision.policyTrace) return null;
  return <div className="space-y-3"><h3 className="text-sm font-semibold">Executed path</h3><ol className="space-y-2" aria-label="Policy execution trace">{decision.policyTrace.map((step, index) => <li key={step.id} className={`rounded-control border border-line p-3 ${step.outcome === "skipped" ? "bg-surface-subtle text-muted" : "bg-surface"}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-[13px]">{index + 1}. {step.name}</strong><Badge>{step.outcome === "match" ? "Yes" : step.outcome === "no_match" ? "No" : step.outcome}{step.next && ` → ${step.next}`}</Badge></div>
    <p className="mt-2 break-words text-xs leading-5 text-muted">{step.evidence}</p>
  </li>)}</ol><p className="text-xs leading-5 text-muted">This trace records policy evaluation. Your application must enforce the final action; a topic match does not establish safety or permission.</p></div>;
}

import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "./card";
import { HelpTooltip } from "./help-tooltip";

export function MetricCard({ label, value, detail, icon: Icon, help }: { label: string; value: string; detail: string; icon: LucideIcon; help?: string }) {
  return <Card><CardContent className="p-4 sm:p-5">
    <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-xs font-medium text-muted">{label}{help && <HelpTooltip label={`About ${label}`}>{help}</HelpTooltip>}</span><Icon className="size-4 shrink-0 text-subtle" /></div>
    <div className="metric-value">{value}</div><p className="mt-2 text-xs leading-5 text-muted">{detail}</p>
  </CardContent></Card>;
}

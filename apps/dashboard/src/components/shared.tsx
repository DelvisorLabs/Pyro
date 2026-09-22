import type { ReactNode } from "react";
import { AlertTriangle, Check, ShieldX } from "lucide-react";
import type { ClassificationEvent } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 border-b border-neutral-300 pb-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.035em] text-neutral-950">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">{description}</p>
      </div>
      {actions}
    </div>
  );
}

export function VerdictBadge({ event, className }: { event: Pick<ClassificationEvent, "verdict" | "action">; className?: string }) {
  const style = event.verdict === "unsafe"
    ? "border-neutral-950 bg-neutral-950 text-white"
    : event.verdict === "suspicious"
      ? "border-neutral-700 bg-neutral-200 text-neutral-950"
      : event.verdict === "indeterminate"
        ? "border-neutral-400 bg-neutral-100 text-neutral-700"
        : "border-neutral-300 bg-white text-neutral-700";
  return <Badge className={cn(style, className)}>{event.verdict}</Badge>;
}

export function VerdictIcon({ verdict }: { verdict: ClassificationEvent["verdict"] }) {
  if (verdict === "unsafe") return <ShieldX className="size-4 text-neutral-950" />;
  if (verdict === "suspicious" || verdict === "indeterminate") return <AlertTriangle className="size-4 text-neutral-700" />;
  return <Check className="size-4 text-neutral-500" />;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center border border-dashed border-neutral-300 bg-neutral-50 px-6 text-center">
      <strong className="text-sm text-neutral-800">{title}</strong>
      <p className="mt-1 max-w-md text-sm leading-6 text-neutral-500">{children}</p>
    </div>
  );
}

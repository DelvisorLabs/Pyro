import type { ReactNode } from "react";
import { AlertTriangle, Check, ShieldX } from "lucide-react";
import type { ClassificationEvent } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[22px] leading-8 font-semibold tracking-[-0.025em] text-foreground">{title}</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted">{description}</p>
      </div>
      {actions}
    </div>
  );
}

export function VerdictBadge({ event, className }: { event: Pick<ClassificationEvent, "verdict" | "action">; className?: string }) {
  const style = event.verdict === "unsafe"
    ? "border-accent bg-accent text-inverse"
    : event.verdict === "suspicious"
      ? "border-accent bg-surface-hover text-foreground"
      : event.verdict === "indeterminate"
        ? "border-line-strong bg-surface-subtle text-secondary"
        : "border-line-strong bg-surface text-secondary";
  return <Badge className={cn(style, className)}>{event.verdict}</Badge>;
}

export function VerdictIcon({ verdict }: { verdict: ClassificationEvent["verdict"] }) {
  if (verdict === "unsafe") return <ShieldX className="size-4 text-foreground" />;
  if (verdict === "suspicious" || verdict === "indeterminate") return <AlertTriangle className="size-4 text-secondary" />;
  return <Check className="size-4 text-muted" />;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center border border-dashed border-line-strong bg-surface-subtle px-6 text-center">
      <strong className="text-sm text-secondary">{title}</strong>
      <p className="mt-1 max-w-md text-sm leading-6 text-muted">{children}</p>
    </div>
  );
}

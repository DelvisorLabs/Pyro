import type { ReactNode } from "react";
import { HelpTooltip } from "./help-tooltip";
import { Label } from "./label";
import { cn } from "@/lib/utils";

export function FieldLabel({ children, help, required = false, htmlFor, className, invalid = false }: { children: ReactNode; help?: string; required?: boolean; htmlFor?: string; className?: string; invalid?: boolean }) {
  return <div className="mb-1.5 flex items-center gap-1.5"><Label htmlFor={htmlFor} className={cn(invalid && "text-danger", className)}>{children}{required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}</Label>{help && <HelpTooltip label={typeof children === "string" ? `About ${children.toLowerCase()}` : "More information"}>{help}</HelpTooltip>}</div>;
}
export function FieldError({ message, id }: { message?: string; id?: string }) {
  return message ? <p id={id} role="alert" className="text-xs text-danger">{message}</p> : null;
}

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CommandLineIcon, File02Icon, PencilEdit01Icon, RefreshIcon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import "./CallChip.css";

type Status = "idle" | "running" | "done" | "error";
interface Props {
  icon?: "terminal" | "file" | "search" | "edit" | ReactNode;
  name?: string;
  argument?: string;
  status?: Status;
  expectedMs?: number;
  size?: number;
  showTimer?: boolean;
  onRetry?: () => void;
  className?: string;
}

const ICONS = { terminal: CommandLineIcon, file: File02Icon, search: Search01Icon, edit: PencilEdit01Icon };
const WORDS: Record<Status, string> = { idle: "queued", running: "running", done: "done", error: "failed" };
const glyphOf = (status: Status) => status === "done" ? "check" : status === "error" ? "retry" : "tool";
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function CallChip({ icon = "terminal", name = "evaluation", argument = "request", status = "idle", expectedMs = 2_500, size = 32, showTimer = true, onRetry, className = "" }: Props) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<HTMLSpanElement>(null);
  const clock = useRef(0);
  const previousStatus = useRef(status);
  const [mounted, setMounted] = useState(false);
  const previousGlyph = glyphOf(previousStatus.current);
  const currentGlyph = glyphOf(status);

  const apply = (next: Status) => {
    const fill = fillRef.current;
    if (!fill) return;
    if (next === "running") { fill.style.transition = "none"; fill.style.transform = "scaleX(0)"; void fill.offsetHeight; fill.style.transition = ""; fill.style.transform = "scaleX(.9)"; }
    else if (next === "done") fill.style.transform = "scaleX(1)";
    else if (next === "idle") fill.style.transform = "scaleX(0)";
    else if (!reduceMotion() && rootRef.current) rootRef.current.animate([{ transform: "translateX(0)" }, { transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }], 240);
  };

  useEffect(() => { setMounted(true); apply(status); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (mounted) apply(status); previousStatus.current = status; }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (status !== "running") return;
    const start = performance.now();
    const tick = window.setInterval(() => { clock.current = performance.now() - start; if (timerRef.current) timerRef.current.textContent = `${Math.round(clock.current)} ms`; }, 80);
    return () => window.clearInterval(tick);
  }, [status]);

  const toolIcon = typeof icon === "string" ? ICONS[icon as keyof typeof ICONS] : null;
  const glyphState = (glyph: string) => glyph === currentGlyph ? "in" : glyph === previousGlyph ? "out" : undefined;
  return (
    <span ref={rootRef} role="status" aria-busy={status === "running" || undefined} aria-label={`${name} ${argument}, ${WORDS[status]}`} data-status={status} data-mounted={mounted ? "" : undefined} className={`call-chip ${className}`} style={{ "--cc-size": `${size}px`, "--cc-expected": `${expectedMs}ms` } as CSSProperties}>
      <span ref={fillRef} className="call-chip__fill" aria-hidden="true" />
      <span className="call-chip__slot" aria-hidden="true">
        <span className="call-chip__glyph" data-state={glyphState("tool")}>{toolIcon ? <HugeiconsIcon icon={toolIcon} size={14} strokeWidth={1.8} /> : icon}</span>
        <span className="call-chip__glyph" data-state={glyphState("check")}><HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2.2} /></span>
        <span className="call-chip__glyph" data-state={glyphState("retry")}><HugeiconsIcon icon={RefreshIcon} size={14} strokeWidth={2} /></span>
      </span>
      <span className="call-chip__name">{name}</span><span className="call-chip__argument">{argument}</span>
      {showTimer && <span ref={timerRef} className="call-chip__timer">{status === "idle" ? "—" : `${Math.round(clock.current)} ms`}</span>}
      {status === "error" && onRetry && <button type="button" className="call-chip__retry" aria-label={`Retry ${name}`} onClick={onRetry} />}
    </span>
  );
}

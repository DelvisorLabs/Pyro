import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./product-tour.css";
import { BookOpen, Compass } from "lucide-react";
import type { UserRecord } from "@pyro/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TOUR_VERSION, tourSteps, type TourPage } from "@/lib/product-tour";

export function ProductTour({ user, navigate, reduceMotion, open, onOpenChange }: { user: UserRecord; navigate: (page: TourPage) => void; reduceMotion: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  const key = `${TOUR_VERSION}:${user.id}`;
  const [welcome, setWelcome] = useState(() => { try { return !localStorage.getItem(key); } catch { return true; } });
  const [running, setRunning] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const remember = () => { try { localStorage.setItem(key, "seen"); } catch { /* Tour remains usable without storage. */ } setWelcome(false); };

  useEffect(() => {
    if (!running) return;
    const steps = tourSteps(user.role);
    let cancelled = false;
    let generation = 0;
    let observer: MutationObserver | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let tour: Driver;
    const clear = () => { observer?.disconnect(); clearTimeout(timeout); };
    const move = (index: number) => {
      if (index >= steps.length) { finish(); return; }
      clear();
      const request = ++generation;
      const step = steps[index]!;
      flushSync(() => navigateRef.current(step.page));
      const selector = step.target ?? '[data-tour="page-header"]';
      const show = (fallback = false) => {
        if (cancelled || request !== generation) return;
        const target = document.querySelector(selector);
        if (!target && !fallback) return;
        clear();
        tour.drive(index);
      };
      observer = new MutationObserver(() => show());
      observer.observe(document.querySelector("main")!, { childList: true, subtree: true });
      timeout = setTimeout(() => show(true), 4000);
      show();
    };
    const finish = () => {
      if (cancelled) return;
      cancelled = true; clear(); tour.destroy(); setRunning(false); trigger.current?.focus();
    };
    tour = driver({
      animate: !reduceMotion && !matchMedia("(prefers-reduced-motion: reduce)").matches,
      smoothScroll: false, overlayOpacity: 0.5, stagePadding: 8, stageRadius: 6,
      disableActiveInteraction: true, popoverClass: "pyro-tour", showProgress: true,
      progressText: "Step {{current}}/{{total}}", nextBtnText: "Next", prevBtnText: "Back", doneBtnText: "Finish tour",
      steps: steps.map((step) => ({
        element: () => document.querySelector(step.target ?? '[data-tour="page-header"]') ?? document.querySelector('[data-tour="page-header"]') ?? document.querySelector('[data-tour="surface"]')!,
        popover: { title: step.title, description: step.description, side: "bottom", align: "start" },
      })),
      onNextClick: () => move((tour.getActiveIndex() ?? 0) + 1),
      onPrevClick: () => move(Math.max(0, (tour.getActiveIndex() ?? 0) - 1)),
      onPopoverRender: (popover, { state }) => {
        const index = state.activeIndex ?? 0;
        const progress = document.createElement("div");
        progress.className = "pyro-tour-progress";
        progress.setAttribute("aria-hidden", "true");
        steps.forEach((_, i) => {
          const dot = document.createElement("span");
          dot.dataset.state = i < index ? "complete" : i === index ? "current" : "upcoming";
          progress.append(dot);
        });
        popover.wrapper.prepend(progress);
        popover.progress.setAttribute("aria-live", "polite");
        popover.closeButton.setAttribute("aria-label", "Skip tour");
        popover.closeButton.title = "Skip tour";
      },
      onDestroyStarted: finish,
      onDestroyed: finish,
    });
    // Defer beyond the effect so route changes can be committed synchronously.
    const frame = requestAnimationFrame(() => move(0));
    return () => { cancelled = true; clear(); cancelAnimationFrame(frame); tour.destroy(); };
  }, [running, user.role, reduceMotion]);

  return <>
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2 sm:px-7">
      {welcome && <span className="mr-auto text-xs text-muted">New to Pyro? Get to know your workspace.</span>}
      <Button ref={trigger} size="sm" variant="ghost" onClick={() => onOpenChange(true)}><Compass className="size-3.5" />{welcome ? "Take a tour" : "Replay tour"}</Button>
      <a className="inline-flex items-center gap-2 rounded-control px-2 py-1 text-xs text-muted hover:text-foreground" href="https://docs.delvisor.com/pyro" target="_blank" rel="noreferrer"><BookOpen className="size-3.5" />Documentation</a>
      {welcome && <Button size="sm" variant="ghost" onClick={remember}>Dismiss</Button>}
    </div>
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>A quick tour of Pyro</DialogTitle><DialogDescription>{tourSteps(user.role).length} stops, from understanding policies to reviewing decisions. Save any unfinished edits before starting: the tour opens different pages.</DialogDescription></DialogHeader><div className="px-6 py-5 text-sm text-muted">Follow the highlighted controls. Filled marks track your progress, and you can go back or leave at any point.</div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Not now</Button><Button onClick={() => { remember(); onOpenChange(false); setRunning(true); }}>Start tour</Button></DialogFooter></DialogContent></Dialog>
  </>;
}

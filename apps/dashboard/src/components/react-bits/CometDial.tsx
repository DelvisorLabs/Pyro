import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { animate, useReducedMotion } from "motion/react";
import "./CometDial.css";

interface Props {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
  size?: number;
  sweep?: number;
  thickness?: number;
  disabled?: boolean;
  onChange?: (value: number) => void;
  onChangeEnd?: (value: number, detail: { velocity: number; bounce: number }) => void;
  className?: string;
}

const RADIUS = 80;
const TRAIL_SEGMENTS = 10;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const pointAt = (degrees: number) => { const radians = degrees * Math.PI / 180; return [100 + Math.cos(radians) * RADIUS, 100 + Math.sin(radians) * RADIUS] as const; };
const arcPath = (from: number, to: number) => { const [x0, y0] = pointAt(from); const [x1, y1] = pointAt(to); return `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${RADIUS} ${RADIUS} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`; };

export function CometDial({ value, defaultValue = 62, min = 0, max = 100, step = 1, unit = "%", label = "Threshold", size = 132, sweep = 300, thickness = 4, disabled = false, onChange, onChangeEnd, className = "" }: Props) {
  const reduceMotion = useReducedMotion();
  const snap = (next: number) => clamp(Math.round((next - min) / step) * step + min, min, max);
  const initial = snap(value ?? defaultValue);
  const [display, setDisplay] = useState(initial);
  const [velocity, setVelocity] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ id: number; value: number; at: number } | null>(null);
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  const gap = 360 - sweep;
  const start = 90 + gap / 2;
  const end = start + sweep;
  const fraction = clamp((display - min) / Math.max(.0001, max - min), 0, 1);
  const angle = start + fraction * sweep;
  const decimals = String(step).includes(".") ? String(step).split(".")[1]!.length : 0;
  const [draft, setDraft] = useState(initial.toFixed(decimals));
  const typing = useRef(false);

  useEffect(() => {
    if (!typing.current) setDraft(display.toFixed(decimals));
  }, [decimals, display]);

  useEffect(() => {
    if (value === undefined || dragging.current) return;
    const target = snap(value);
    if (Math.abs(target - display) < .0001) return;
    animation.current?.stop();
    if (reduceMotion) setDisplay(target);
    else animation.current = animate(display, target, { duration: .28, ease: [.23, 1, .32, 1], onUpdate: setDisplay });
    return () => animation.current?.stop();
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const valueAt = (clientX: number, clientY: number) => {
    const bounds = svgRef.current!.getBoundingClientRect();
    const x = ((clientX - bounds.left) / bounds.width) * 200 - 100;
    const y = ((clientY - bounds.top) / bounds.height) * 200 - 100;
    let relative = (Math.atan2(y, x) * 180 / Math.PI - start + 720) % 360;
    if (relative > sweep) relative = relative < sweep + gap / 2 ? sweep : 0;
    return snap(min + relative / sweep * (max - min));
  };
  const commit = (next: number) => { const snapped = snap(next); setDisplay(snapped); onChange?.(snapped); return snapped; };
  const commitDraft = () => {
    typing.current = false;
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(display.toFixed(decimals));
      return;
    }
    const settled = commit(parsed);
    setDraft(settled.toFixed(decimals));
    onChangeEnd?.(settled, { velocity: 0, bounce: 0 });
  };
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (disabled || event.button > 0) return;
    event.preventDefault(); animation.current?.stop(); event.currentTarget.setPointerCapture(event.pointerId);
    const next = commit(valueAt(event.clientX, event.clientY));
    dragging.current = { id: event.pointerId, value: next, at: performance.now() };
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragging.current;
    if (!drag || drag.id !== event.pointerId) return;
    const now = performance.now(); const next = valueAt(event.clientX, event.clientY); const currentVelocity = (next - drag.value) / Math.max(1, now - drag.at) * 1_000;
    dragging.current = { id: drag.id, value: next, at: now }; setVelocity(currentVelocity); commit(next);
  };
  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragging.current;
    if (!drag || drag.id !== event.pointerId) return;
    dragging.current = null; const settled = snap(drag.value + velocity * .025); commit(settled); onChangeEnd?.(settled, { velocity, bounce: .12 });
    window.setTimeout(() => setVelocity(0), 220);
  };
  const keyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const direction = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -1 : 0;
    let next = display;
    if (direction) next += direction * step * (event.shiftKey ? 10 : 1); else if (event.key === "Home") next = min; else if (event.key === "End") next = max; else return;
    event.preventDefault(); const settled = commit(next); onChangeEnd?.(settled, { velocity: 0, bounce: 0 });
  };

  const trail = useMemo(() => {
    const strength = clamp(Math.abs(velocity) / Math.max(1, max - min) / 2.5, 0, 1);
    const reach = 130 * strength;
    const direction = velocity >= 0 ? 1 : -1;
    return Array.from({ length: TRAIL_SEGMENTS }, (_, index) => {
      let from = direction > 0 ? angle - reach * (index + 1) / TRAIL_SEGMENTS : angle + reach * index / TRAIL_SEGMENTS;
      let to = direction > 0 ? angle - reach * index / TRAIL_SEGMENTS : angle + reach * (index + 1) / TRAIL_SEGMENTS;
      from = clamp(from, start, end); to = clamp(to, start, end);
      return { path: Math.abs(to - from) > .01 ? arcPath(from, to) : "", opacity: (1 - index / TRAIL_SEGMENTS) * strength, width: thickness + (8 * (1 - index / TRAIL_SEGMENTS) * strength) };
    });
  }, [angle, end, max, min, start, thickness, velocity]);
  const [headX, headY] = pointAt(angle);
  return (
    <div className={`comet-dial ${className}`} data-disabled={disabled ? "" : undefined} style={{ "--cd-size": `${size}px` } as React.CSSProperties}>
      <svg ref={svgRef} className="comet-dial__ring" viewBox="0 0 200 200" role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={snap(display)} aria-valuetext={`${snap(display)}${unit}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onKeyDown={keyDown}>
        <path className="comet-dial__track" d={arcPath(start, end)} strokeWidth={thickness} />
        <path className="comet-dial__lit" d={fraction > 0 ? arcPath(start, angle) : ""} strokeWidth={thickness} />
        <g className="comet-dial__comet">{trail.map((segment, index) => <path key={index} d={segment.path} strokeWidth={segment.width} style={{ opacity: segment.opacity }} />)}</g>
        <circle className="comet-dial__head" cx={headX} cy={headY} r={thickness * 1.7} />
      </svg>
      <div className="comet-dial__readout">
        <input
          className="comet-dial__input"
          type="number"
          min={min}
          max={max}
          step={step}
          inputMode="decimal"
          aria-label={`${label} value`}
          disabled={disabled}
          value={draft}
          onFocus={(event) => { typing.current = true; event.currentTarget.select(); }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              typing.current = false;
              setDraft(display.toFixed(decimals));
              event.currentTarget.blur();
            }
          }}
        />
        <span className="comet-dial__unit" aria-hidden="true">{unit}</span>
      </div>
    </div>
  );
}

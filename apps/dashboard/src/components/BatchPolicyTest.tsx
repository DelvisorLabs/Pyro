import { useEffect, useRef, useState } from "react";
import { semanticCheckCount, type ClassificationDecision, type PolicyAction, type Profile } from "@pyro/contracts";
import { api } from "@/lib/api";
import { useCloud } from "@/lib/cloud";
import { pipelinePayload } from "@/lib/pipeline-editor";
import type { RegressionCase } from "@/lib/playground-session";
import { OutcomeSelect } from "./PipelineEditor";
import { PolicyTrace } from "./PolicyTrace";
import { VerdictBadge } from "./shared";
import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { FieldLabel } from "./ui/field";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
const savedBatches = new Map<string, { rows: Row[]; results: Record<string, ClassificationDecision>; previous: Record<string, ClassificationDecision>; dirty: boolean }>();
export function clearBatchSessions() { savedBatches.clear(); }
interface Row { id: string; input: string; expected: PolicyAction }
export function BatchPolicyTest({ profile, appId, onCases, onComplete, onClose, onBusyChange, storageKey }: { onClose: () => void; onBusyChange: (busy: boolean) => void; storageKey: string; profile: Profile; appId: string; onCases: (cases: RegressionCase[]) => void; onComplete: () => void }) {
  const cloud = useCloud(), stop = useRef(false);
  const [rows, setRows] = useState<Row[]>(() => savedBatches.get(storageKey)?.rows ?? [{ id: crypto.randomUUID(), input: "How do I change my Northstar billing plan?", expected: "allow" }]);
  const [results, setResults] = useState<Record<string, ClassificationDecision>>(() => savedBatches.get(storageKey)?.results ?? {}), [previous, setPrevious] = useState<Record<string, ClassificationDecision>>(() => savedBatches.get(storageKey)?.previous ?? {});
  const [busy, setBusy] = useState(false), [paid, setPaid] = useState(false), [cap, setCap] = useState(20), [message, setMessage] = useState("");
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  const [dirty, setDirty] = useState(savedBatches.get(storageKey)?.dirty ?? false);
  useEffect(() => { savedBatches.set(storageKey, { rows, results, previous, dirty }); }, [storageKey, rows, results, previous, dirty]);
  useEffect(() => { if (!dirty) return; const guard = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty]);
  useEffect(() => () => { stop.current = true; }, []);
  const run = async () => {
    setBusy(true); setMessage(""); stop.current = false; setPrevious(results); setResults({});
    const samples = structuredClone(rows);
    try {
      const policy = pipelinePayload(profile);
      if (cloud) { let maximum = 0; for (const sample of samples) maximum += (await api.post<{ maximumCredits: number }>("/api/playground/estimate", { profile: policy, input: sample.input })).maximumCredits;
        if (maximum > cap) throw new Error(`Up to ${maximum} credits required; your batch cap is ${cap}. Increase the cap or reduce the batch.`);
        setMessage(`Batch authorized for up to ${maximum} credits. Only reached checks are billed.`);
      }
      for (const sample of samples) { if (stop.current) break; const result = await api.post<ClassificationDecision>("/api/playground", { profile: policy, appId, input: sample.input, allowPaid: paid, ...(cloud ? { maxCredits: cap } : {}) }); setResults(values => ({ ...values, [sample.id]: result })); }
    } catch (e) { setMessage(e instanceof Error ? e.message : "Batch failed."); }
    finally { setBusy(false); onComplete(); }
  };
  const edit = (id: string, patch: Partial<Row>) => { setDirty(true); setRows(values => values.map(r => r.id === id ? { ...r, ...patch } : r)); setResults(values => { const next = { ...values }; delete next[id]; return next; }); setPrevious(values => { const next = { ...values }; delete next[id]; return next; }); };
  return <><DialogHeader><DialogTitle>Batch test</DialogTitle><DialogDescription>Run up to 20 examples. Add them to a regression set to keep them.</DialogDescription></DialogHeader><div className="min-h-0 space-y-4 overflow-y-auto px-6 py-4">
    {message && <p role="status" className="text-sm text-secondary">{message}</p>}
    {[...rows].sort((a, b) => Number(Boolean(results[b.id] && results[b.id]!.action !== b.expected)) - Number(Boolean(results[a.id] && results[a.id]!.action !== a.expected))).map(row => <div key={row.id} className="space-y-3 rounded-control border border-line p-3">
      <FieldLabel htmlFor={`batch-${row.id}`}>Sample input</FieldLabel><Textarea id={`batch-${row.id}`} disabled={busy} value={row.input} onChange={e => edit(row.id, { input: e.target.value })} />
      <OutcomeSelect id={`expected-${row.id}`} label="Expected outcome" value={row.expected} onChange={value => { if (!busy) edit(row.id, { expected: value as PolicyAction }); }} />
      {results[row.id] && <div className="space-y-2 text-sm"><VerdictBadge event={results[row.id]!} /><p>{results[row.id]!.action === row.expected && results[row.id]!.verdict !== "indeterminate" ? "Matches expectation" : "Disagrees with expectation"}{previous[row.id] && ` · Previously ${previous[row.id]!.action}`}</p><p className="text-muted">{results[row.id]!.reason}</p><details><summary className="cursor-pointer">Inspect trace</summary><PolicyTrace decision={results[row.id]!} /></details></div>}
      <Button size="sm" variant="ghost" disabled={busy || rows.length === 1} onClick={() => { setDirty(true); setRows(values => values.filter(r => r.id !== row.id)); }}>Remove case</Button>
    </div>)}
    <Button variant="outline" disabled={busy || rows.length >= 20} onClick={() => { setDirty(true); setRows(values => [...values, { id: crypto.randomUUID(), input: "", expected: "allow" }]); }}>Add example</Button>
    {cloud && <div><FieldLabel htmlFor="batch-credit-cap">Maximum batch credits</FieldLabel><Input id="batch-credit-cap" type="number" min={0} disabled={busy} value={cap} onChange={e => setCap(Number(e.target.value))} /></div>}
    <div className="flex items-start gap-2"><Checkbox id="batch-paid" checked={paid} disabled={busy} onCheckedChange={v => setPaid(v === true)} /><Label htmlFor="batch-paid">Allow semantic provider calls and charges for this batch.</Label></div>
    </div><DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Close</Button><Button disabled={busy || semanticCheckCount(profile) > 0 && !paid || !appId || rows.some(r => !r.input.trim()) || !Number.isSafeInteger(cap) || cap < 0} onClick={() => void run()}>Run batch</Button>{busy && <Button variant="outline" onClick={() => { stop.current = true; setMessage("Stopping after the current test."); }}>Stop</Button>}<Button variant="outline" disabled={busy || rows.some(r => !r.input.trim())} onClick={() => { onCases(rows.map(r => ({ ...r, category: "batch" }))); setDirty(false); }}>Add batch to regression set</Button></DialogFooter></>;
}

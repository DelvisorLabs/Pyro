import { PolicyImpact } from "@/components/PolicyImpact";
import { BatchPolicyTest } from "@/components/BatchPolicyTest";
import { CloudUsage } from "@/components/CloudUsage";
import { readPlaygroundSession, writePlaygroundSession } from "@/lib/playground-session";
import { useEffect, useState } from "react";
import { Download, LoaderCircle, Play, Plus, Save, Upload } from "lucide-react";
import { semanticCheckCount, type AppRecord, type ClassificationDecision, type PolicyAction, type Profile } from "@pyro/contracts";
import { PageHeader, VerdictBadge } from "@/components/shared";
import { PipelineEditor, OutcomeSelect } from "@/components/PipelineEditor";
import { PolicyTrace } from "@/components/PolicyTrace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useCloud, useCloudModel } from "@/lib/cloud";
import { newPipeline, pipelinePayload } from "@/lib/pipeline-editor";
import { percent } from "@/lib/format";

type Sample = { id: string; input: unknown; expected: PolicyAction; category: string };
const describeError = (error: unknown) => error instanceof Error && "issues" in error ? (error as { issues: Array<{ message: string }> }).issues[0]?.message ?? "Invalid policy." : error instanceof Error ? error.message : "Request failed.";
function download(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }

export function PlaygroundPage({ onDecision, scope }: { onDecision: () => void; scope: string }) {
  const [savedDrafts, setSavedDrafts] = useState<Array<{ id: string; profile: Profile; isNew: boolean; appId: string; updatedAt: string }>>([]);
  const [draftId, setDraftId] = useState(() => crypto.randomUUID() as string), [savedAt, setSavedAt] = useState<string>();
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [maximumCredits, setMaximumCredits] = useState<number>();
  const [creditCap, setCreditCap] = useState(10);
  const [creditRefresh, setCreditRefresh] = useState(0);
  const cloud = useCloud(), cloudModel = useCloudModel();
  const [profiles, setProfiles] = useState<Profile[]>([]), [apps, setApps] = useState<AppRecord[]>([]);
  const [draft, setDraft] = useState<Profile>(), [isNew, setIsNew] = useState(false), [appId, setAppId] = useState("");
  const [input, setInput] = useState("How do I change my Northstar billing plan?"), [format, setFormat] = useState("text");
  const [decision, setDecision] = useState<ClassificationDecision & { creditsConsumed?: number }>(), [testedInput, setTestedInput] = useState<unknown>();
  const [allowPaid, setAllowPaid] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [cases, setCases] = useState<Sample[]>([]), [expected, setExpected] = useState<PolicyAction>("allow");
  const [datasetName, setDatasetName] = useState("Policy regressions"), [retain, setRetain] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string>(), [dirty, setDirty] = useState(false);
  const load = async () => { const [p, a] = await Promise.all([api.get<{ profiles: Profile[] }>("/api/profiles"), api.get<{ apps: AppRecord[] }>("/api/apps")]); setProfiles(p.profiles); setApps(a.apps.filter((item) => item.enabled)); return { p, a }; };
  useEffect(() => { let stopped = false; void load().then(({ p, a }) => { if (!stopped) { const cached = readPlaygroundSession(scope);
      if (cached?.draft) { setDraft(cached.draft); setIsNew(cached.isNew); setAppId(cached.appId); setInput(cached.input); setFormat(cached.format); setCases(cached.cases); setDirty(cached.dirty); setDraftId(cached.draftId); setSavedAt(cached.savedAt); }
      else { setDraft(p.profiles[0]); setAppId(a.apps.find((item) => item.enabled)?.id ?? ""); }
      void api.get<{ drafts: typeof savedDrafts }>("/api/policy-drafts").then(r => setSavedDrafts(r.drafts)).catch(e => setError(describeError(e))); } }).catch((e) => { if (!stopped) setError(describeError(e)); }).finally(() => { if (!stopped) setLoading(false); }); return () => { stopped = true; }; }, []);
  useEffect(() => { if (!loading && draft) writePlaygroundSession(scope, { draft, isNew, appId, input, format, cases, dirty, draftId, savedAt }); }, [scope, loading, draft, isNew, appId, input, format, cases, dirty, draftId, savedAt]);
  useEffect(() => { if (!dirty && !cases.length) return; const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty, cases.length]);
  const invalidate = () => { setMaximumCredits(undefined); setDecision(undefined); setTestedInput(undefined); setError(""); setMessage(""); };
  const edit = (next: Profile) => { setDraft(next); setDirty(true); invalidate(); };
  const choose = (id: string) => { const saved = savedDrafts.find(d => `draft:${d.id}` === id); setSavedAt(saved?.updatedAt); setDraftId(saved?.id ?? crypto.randomUUID()); setIsNew(saved?.isNew ?? id === "new"); if (saved) setAppId(saved.appId); setDraft(saved ? structuredClone(saved.profile) : id === "new" ? newPipeline(cloud ? cloudModel : "jev-latest") : structuredClone(profiles.find((p) => p.id === id))); setDirty(false); setCases([]); setRetain(false); setAllowPaid(false); invalidate(); };
  const requestSwitch = (id: string) => dirty || cases.length ? setPendingSwitch(id) : choose(id);
  const work = async (fn: () => Promise<void>) => { setBusy(true); setMessage(""); setError(""); try { await fn(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); setCreditRefresh(v => v + 1); } };
  const payload = () => pipelinePayload(draft!);
  const parsedInput = () => format === "json" ? JSON.parse(input) as unknown : input;
  const test = () => work(async () => { setDecision(undefined); setTestedInput(undefined); const value = parsedInput(); const result = await api.post<ClassificationDecision & { creditsConsumed?: number }>("/api/playground", { profile: payload(), input: value, appId, allowPaid, ...(cloud ? { maxCredits: creditCap } : {}) }); setDecision(result); setTestedInput(value); onDecision(); });
  const saveDraft = () => work(async () => { const result = await api.put<{ draft: typeof savedDrafts[number] }>("/api/policy-drafts/" + draftId, { profile: payload(), isNew, appId, expectedUpdatedAt: savedAt }); setSavedAt(result.draft.updatedAt); setSavedDrafts(rows => [...rows.filter(d => d.id !== draftId), result.draft]); setDirty(false); setMessage("Draft saved. No active policy was changed."); });
  const publish = () => work(async () => { const body = payload(); const result = isNew ? await api.post<{ profile: Profile }>("/api/profiles", body) : await api.put<{ profile: Profile }>("/api/profiles/" + body.id, body); setDraft(result.profile); setDecision(undefined); setTestedInput(undefined); setIsNew(false); setDirty(false); if (savedAt) await api.delete("/api/policy-drafts/" + draftId); setSavedAt(undefined); setSavedDrafts(rows => rows.filter(d => d.id !== draftId)); await load(); setMessage("Published revision " + result.profile.revision + ". Manage rollout in History."); });
  const semantic = draft ? semanticCheckCount(draft) : 0;
  if (loading) return <p role="status" className="text-sm text-muted">Loading Playground…</p>;
  return <>
    <PageHeader title="Playground" actions={<Button data-tour="new-pipeline" disabled={busy} onClick={() => requestSwitch("new")}><Plus className="size-4" />New pipeline</Button>} />
    {error && <p role="alert" className="mb-4 rounded-control border border-danger bg-danger-surface px-4 py-3 text-sm text-danger">{error}</p>}
    {message && <p role="status" className="mb-4 rounded-control border border-line bg-surface-subtle px-4 py-3 text-sm">{message}</p>}
    {!draft ? <Card><CardContent><p className="text-sm text-muted">Create a pipeline to start designing a policy.</p><Button className="mt-3" onClick={() => choose("new")}>Create pipeline</Button></CardContent></Card> : <fieldset disabled={busy} className="min-w-0 space-y-5">
      <Card><CardContent className="grid gap-4 sm:grid-cols-2"><div><FieldLabel htmlFor="playground-policy">Policy</FieldLabel><Select disabled={busy} value={savedAt ? `draft:${draftId}` : isNew ? "new" : draft.id} onValueChange={requestSwitch}><SelectTrigger id="playground-policy"><SelectValue /></SelectTrigger><SelectContent>{savedDrafts.map(d => <SelectItem key={d.id} value={`draft:${d.id}`}>{d.profile.name} · saved draft</SelectItem>)}{isNew && <SelectItem value="new">New pipeline (unpublished)</SelectItem>}{profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · revision {p.revision ?? 1}</SelectItem>)}</SelectContent></Select></div><div><FieldLabel htmlFor="playground-app">Application</FieldLabel><Select disabled={busy || cases.length > 0} value={appId} onValueChange={(value) => { setAppId(value); invalidate(); }}><SelectTrigger id="playground-app"><SelectValue placeholder="Choose application" /></SelectTrigger><SelectContent>{apps.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></div></CardContent></Card>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card><CardHeader><CardTitle>{draft.pipeline ? "Checks" : "Signal-based policy"}</CardTitle><CardDescription>{draft.pipeline ? "Tests leave the active revision unchanged." : "Edit rules and detectors in Library, or create a new pipeline."}</CardDescription></CardHeader><CardContent className="space-y-5">
          <div><FieldLabel htmlFor="pipeline-name">Policy name</FieldLabel><Input id="pipeline-name" value={draft.name} maxLength={100} onChange={(e) => edit({ ...draft, name: e.target.value })} /></div>
          {draft.pipeline ? <PipelineEditor key={draft.id} pipeline={draft.pipeline} onChange={(pipeline) => edit({ ...draft, pipeline })} /> : <div className="space-y-2 text-sm text-secondary">{draft.localRules.map((r) => <p key={r.id}>{r.name} · {r.enabled ? r.action : "disabled"}</p>)}{draft.detectors.map((d) => <p key={d.id}>{d.name} · {d.enabled ? "semantic detector" : "disabled"}</p>)}</div>}
          <details className="rounded-control border border-line p-3 text-sm"><summary className="cursor-pointer font-medium">Execution settings</summary><div className="mt-4 space-y-4"><div><FieldLabel htmlFor="pipeline-model">Semantic model</FieldLabel><Input id="pipeline-model" disabled={cloud} value={draft.model} onChange={(e) => edit({ ...draft, model: e.target.value })} /></div><div className="grid gap-3 sm:grid-cols-2"><div><FieldLabel htmlFor="pipeline-timeout">Total timeout (ms)</FieldLabel><Input id="pipeline-timeout" type="number" min={250} max={120000} value={draft.timeoutMs} onChange={(e) => edit({ ...draft, timeoutMs: Number(e.target.value) })} /></div><div><FieldLabel htmlFor="pipeline-limit">Input character limit</FieldLabel><Input id="pipeline-limit" type="number" min={128} max={1000000} value={draft.maxInputChars} onChange={(e) => edit({ ...draft, maxInputChars: Number(e.target.value) })} /></div></div></div></details>
          <div className="flex flex-wrap gap-2 border-t border-line pt-4"><Button variant="outline" onClick={() => void work(async () => { const result = await api.post<{ yaml: string }>("/api/playground/export", { profile: payload() }); download(draft.id + ".yaml", result.yaml, "application/yaml"); })}><Download className="size-4" />Export YAML</Button><Button variant="outline" onClick={() => void saveDraft()}><Save className="size-4" />Save draft</Button><Button onClick={() => setConfirmPublish(true)}><Upload className="size-4" />{isNew ? "Publish new policy" : "Publish revision"}</Button></div>
          <p className="text-xs leading-5 text-muted">Publishing updates applications following the latest revision. Pinned revisions stay unchanged.</p>
        </CardContent></Card>
        <div className="space-y-5">
          <Card><CardHeader><CardTitle>Test input</CardTitle><CardDescription>Includes application rules. Inputs remain in memory while navigating; refresh discards them. Policy configuration is restored in this browser tab. Save a draft to keep it on the server.</CardDescription></CardHeader><CardContent className="space-y-4">
            <CloudUsage compact refreshKey={creditRefresh} /><div><FieldLabel htmlFor="playground-format">Input format</FieldLabel><Select value={format} onValueChange={(value) => { setFormat(value); invalidate(); }}><SelectTrigger id="playground-format"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="text">Plain text</SelectItem><SelectItem value="json">JSON / conversation</SelectItem></SelectContent></Select></div>
            <div><FieldLabel htmlFor="playground-input">Sample input</FieldLabel><Textarea id="playground-input" className="min-h-40" value={input} onChange={(e) => { setInput(e.target.value); invalidate(); }} /></div>
            {semantic > 0 && <div className="flex items-start gap-2.5"><Checkbox id="playground-paid" className="mt-0.5" checked={allowPaid} onCheckedChange={(checked) => setAllowPaid(checked === true)} /><Label htmlFor="playground-paid" className="text-xs font-normal leading-5">Allow this test to send input to the configured semantic provider and incur charges. Up to {semantic} {semantic === 1 ? "check" : "checks"}, plus retries. Mock mode recognizes exact examples only and marks other conditions uncertain.</Label></div>}
            {cloud && <div className="space-y-2"><FieldLabel htmlFor="preview-cap">Maximum credits for this test</FieldLabel><Input id="preview-cap" type="number" min={0} value={creditCap} onChange={e => setCreditCap(Number(e.target.value))} /><Button variant="outline" disabled={!input.trim()} onClick={() => void work(async () => { const result = await api.post<{ maximumCredits: number }>("/api/playground/estimate", { profile: payload(), input: parsedInput() }); setMaximumCredits(result.maximumCredits); })}>Estimate credits</Button>{maximumCredits !== undefined && <p className="text-xs text-muted">Up to {maximumCredits} credits. Early-ending local checks may use fewer. Retries are not charged again.</p>}</div>}
            <Button disabled={busy || !Number.isSafeInteger(creditCap) || creditCap < 0 || !input.trim() || !appId || semantic > 0 && !allowPaid} onClick={() => void test()}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}Test draft</Button>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Result</CardTitle></CardHeader><CardContent className="space-y-4" aria-live="polite">
            {!decision ? <p className="py-8 text-sm leading-6 text-muted">Run a test to see each check, its branch and the final outcome.</p> : <><VerdictBadge event={decision} />{decision.creditsConsumed !== undefined && <p className="text-xs text-muted">This test consumed {decision.creditsConsumed} credits.</p>}<p className="text-sm leading-6 text-secondary">{decision.reason}</p><p className="text-xs text-muted">Provider: {decision.provider} · Model: {decision.model}</p>{decision.verdict === "indeterminate" && <p className="text-xs leading-5 text-muted">The result is uncertain or a check failed. It was not treated as a No match.</p>}<PolicyTrace decision={decision} />{!decision.policyTrace && <div className="space-y-2">{decision.detectors.map((d) => <p key={d.id} className="flex justify-between gap-3 text-xs"><span>{d.name}</span><span>{percent(d.probability)}</span></p>)}</div>}<p className="break-all font-mono text-xs text-muted">Policy hash: {decision.policyHash}</p><div className="grid items-end gap-3 sm:grid-cols-2"><OutcomeSelect id="case-expected" label="Expected outcome" value={expected} onChange={(v) => setExpected(v as PolicyAction)} /><Button variant="outline" disabled={cases.length >= 100} onClick={() => { setCases((rows) => [...rows, { id: crypto.randomUUID(), input: testedInput, expected, category: "playground" }]); setMessage("Case added. Save or download this regression set before leaving the page."); }}>Add regression case</Button></div></>}
          </CardContent></Card>
          <BatchPolicyTest key={draftId} storageKey={`${scope}:${draftId}`} profile={draft} appId={appId} onComplete={() => setCreditRefresh(v => v + 1)} onCases={rows => { setCases(values => [...values.filter(existing => !rows.some(row => row.id === existing.id)), ...rows].slice(0, 100)); setMessage("Batch added. Save the regression dataset below to retain these inputs."); }} />
          {cases.length > 0 && <Card><CardHeader><CardTitle>Regression set · {cases.length} {cases.length === 1 ? "case" : "cases"}</CardTitle><CardDescription>Save or download these cases before leaving. Compare revisions in Evaluations.</CardDescription></CardHeader><CardContent className="space-y-4">
            <div><FieldLabel htmlFor="regression-name">Dataset name</FieldLabel><Input id="regression-name" value={datasetName} maxLength={100} onChange={(e) => setDatasetName(e.target.value)} /></div>
            <div className="flex items-start gap-2.5"><Checkbox id="regression-retain" className="mt-0.5" checked={retain} onCheckedChange={(v) => setRetain(v === true)} /><Label htmlFor="regression-retain" className="text-xs font-normal leading-5">Retain these inputs encrypted for 7 days in this organization. Remove secrets before saving.</Label></div>
            <div className="flex flex-wrap gap-2"><Button disabled={!retain || !datasetName.trim()} onClick={() => void work(async () => { await api.post("/api/datasets", { appId, name: datasetName, jsonl: cases.map((c) => JSON.stringify(c)).join("\n"), retainInputs: true, retentionDays: 7 }); setCases([]); setRetain(false); setMessage("Regression dataset saved. Open Evaluations to compare published revisions."); })}>Save dataset</Button><Button variant="outline" onClick={() => download("policy-regressions.jsonl", cases.map((c) => JSON.stringify(c)).join("\n"), "application/x-ndjson")}>Download JSONL</Button></div>
            <p className="text-xs text-muted">Each save creates a version containing the cases currently in this set.</p>
          </CardContent></Card>}
        </div>
      </div>
    </fieldset>}
    <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Publish policy revision?</DialogTitle><DialogDescription>Review the configuration and application impact before changing the active policy.</DialogDescription></DialogHeader><div className="max-h-[60vh] overflow-auto px-6 py-4">{draft && <PolicyImpact before={isNew ? undefined : profiles.find(p => p.id === draft.id)} after={draft} apps={apps} />}</div><DialogFooter><Button variant="outline" onClick={() => setConfirmPublish(false)}>Keep editing</Button><Button disabled={busy} onClick={() => { setConfirmPublish(false); void publish(); }}>Publish revision</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={pendingSwitch !== undefined} onOpenChange={(open) => { if (!open) setPendingSwitch(undefined); }}><DialogContent><DialogHeader><DialogTitle>Switch policy?</DialogTitle><DialogDescription>Your working copy and unsaved regression cases will be discarded.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setPendingSwitch(undefined)}>Keep editing</Button><Button onClick={() => { choose(pendingSwitch!); setPendingSwitch(undefined); }}>Discard and switch</Button></DialogFooter></DialogContent></Dialog>
  </>;
}

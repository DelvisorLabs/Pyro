import { useEffect, useState } from "react";
import { Download, Play, Upload } from "lucide-react";
import type { AppRecord, Profile } from "@pyro/contracts";
import { api } from "@/lib/api";
import { EmptyState, PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
interface Dataset { id: string; name: string; version: number; count: number; appId: string; contentHash: string; expiresAt: string }
interface Stats { count: number; accuracy: number | null; falsePositiveRate: number | null; indeterminate: number; p50LatencyMs: number | null; p95LatencyMs: number | null; reportedCosts: Record<string, number>; costUnreported: number; confusion: Record<string, Record<string, number>> }
interface Run { id: string; status: string; total: number; datasetHash: string; configurationHash: string; createdAt: string; error?: string; rows?: unknown[]; report?: { policies: Record<string, Stats>; disagreements: unknown[]; changedCases: string[] }; estimate: { maximumProviderCalls: number; cost: string } }
export function EvaluationsPage({ canRun }: { canRun: boolean }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]), [runs, setRuns] = useState<Run[]>([]), [apps, setApps] = useState<AppRecord[]>([]), [profiles, setProfiles] = useState<Profile[]>([]);
  const [appId, setAppId] = useState(""), [name, setName] = useState(""), [jsonl, setJsonl] = useState(""), [retention, setRetention] = useState(7), [retain, setRetain] = useState(false);
  const [datasetId, setDatasetId] = useState(""), [first, setFirst] = useState(""), [second, setSecond] = useState(""), [revision, setRevision] = useState(1), [otherRevision, setOtherRevision] = useState(1), [paid, setPaid] = useState(false);
  const [selected, setSelected] = useState<Run>(), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const load = async () => { const [d, r, a, p] = await Promise.all([api.get<{ datasets: Dataset[] }>("/api/datasets"), api.get<{ runs: Run[] }>("/api/evaluations"), api.get<{ apps: AppRecord[] }>("/api/apps"), api.get<{ profiles: Profile[] }>("/api/profiles")]); setDatasets(d.datasets); setRuns(r.runs); setApps(a.apps); setProfiles(p.profiles); setAppId((id) => id || a.apps[0]?.id || ""); setDatasetId((id) => id || d.datasets[0]?.id || ""); };
  const inspect = async (id: string) => { const { run } = await api.get<{ run: Run }>(`/api/evaluations/${id}`); setSelected(run); };
  useEffect(() => { void load().catch((e) => setMessage(e.message)); }, []);
  useEffect(() => { if (!selected || !["queued", "running"].includes(selected.status)) return; const timer = setInterval(() => void inspect(selected.id).catch((e) => setMessage(e.message)), 1500); return () => clearInterval(timer); }, [selected?.id, selected?.status]);
  const work = async (fn: () => Promise<unknown>) => { setBusy(true); setMessage(""); try { await fn(); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : "Request failed."); } finally { setBusy(false); } };
  const changeProfile = (id: string, other = false) => { const rev = profiles.find((p) => p.id === id)?.revision ?? 1; if (other) { setSecond(id); setOtherRevision(rev); } else { setFirst(id); setRevision(rev); } };
  const dataset = datasets.find((d) => d.id === datasetId);
  const semantic = [first, second].some((id) => profiles.find((p) => p.id === id)?.detectors.some((d) => d.enabled));
  const download = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `pyro-evaluation-${selected!.id}.json`; link.click(); URL.revokeObjectURL(url); };
  const percent = (v: number | null) => v === null ? "—" : `${(v * 100).toFixed(1)}%`;
  return (
    <>
      <PageHeader title="Evaluation lab" description="Compare published policy revisions on a versioned dataset using the same classification engine as the gateway. Results describe this dataset, not general protection coverage." />
      <div className="space-y-5">
        {message && <div role="status" className="rounded-control border border-line-strong bg-surface-subtle px-4 py-3 text-[13px] text-foreground">{message}</div>}

        {canRun && <div className="grid items-stretch gap-5 xl:grid-cols-2">
          <Card className="flex min-w-0 flex-col">
            <CardHeader>
              <CardTitle>Import a dataset version</CardTitle>
              <CardDescription>Upload or paste up to 500 cases. Reuse a name for a new version.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <FieldLabel htmlFor="evaluation-app">Application</FieldLabel>
                  <Select value={appId} onValueChange={setAppId}>
                    <SelectTrigger id="evaluation-app"><SelectValue placeholder="Choose application" /></SelectTrigger>
                    <SelectContent>{apps.map((app) => <SelectItem value={app.id} key={app.id}>{app.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="min-w-0">
                  <FieldLabel htmlFor="evaluation-name">Dataset name</FieldLabel>
                  <Input id="evaluation-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Support safety checks" />
                </div>
              </div>
              <div>
                <FieldLabel htmlFor="evaluation-file">JSONL file</FieldLabel>
                <Input id="evaluation-file" type="file" accept=".jsonl,.ndjson,.json" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void file.text().then(setJsonl).catch((error) => setMessage(error.message));
                }} />
              </div>
              <div>
                <FieldLabel htmlFor="evaluation-jsonl">Dataset contents</FieldLabel>
                <Textarea id="evaluation-jsonl" aria-describedby="evaluation-jsonl-help" className="min-h-36 font-mono text-xs" spellCheck={false} value={jsonl} onChange={(event) => setJsonl(event.target.value)} placeholder={'{"id":"benign-1","input":"Hello","expected":"allow","category":"benign"}'} />
                <p id="evaluation-jsonl-help" className="mt-2 text-xs leading-5 text-muted">One JSON object per line with id, input, expected (allow / review / block), and optional category.</p>
              </div>
              <div>
                <FieldLabel htmlFor="evaluation-retention">Input retention</FieldLabel>
                <Select value={String(retention)} onValueChange={(value) => setRetention(Number(value))}>
                  <SelectTrigger id="evaluation-retention"><SelectValue /></SelectTrigger>
                  <SelectContent>{[1, 7, 30].map((days) => <SelectItem value={String(days)} key={days}>{days} {days === 1 ? "day" : "days"}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-start gap-2.5">
                <Checkbox id="evaluation-retain" className="mt-0.5" checked={retain} onCheckedChange={(checked) => setRetain(checked === true)} />
                <Label htmlFor="evaluation-retain" className="cursor-pointer font-normal leading-5">Retain these redacted inputs encrypted in this deployment for the selected period.</Label>
              </div>
              <div className="mt-auto border-t border-line pt-4">
                <Button disabled={busy || !retain || !jsonl.trim() || !name.trim()} onClick={() => void work(async () => {
                  const result = await api.post<{ dataset: Dataset }>("/api/datasets", { appId, name, jsonl, retentionDays: retention, retainInputs: retain });
                  setDatasetId(result.dataset.id);
                  setJsonl("");
                  setRetain(false);
                  setMessage(`Dataset version ${result.dataset.version} saved.`);
                })}><Upload className="size-4" />Import version</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="flex min-w-0 flex-col">
            <CardHeader>
              <CardTitle>Compare policies</CardTitle>
              <CardDescription>Evaluate a baseline policy, or compare two published revisions.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-5">
              <div className="min-w-0">
                <FieldLabel htmlFor="evaluation-dataset">Dataset</FieldLabel>
                <Select value={datasetId} onValueChange={setDatasetId}>
                  <SelectTrigger id="evaluation-dataset"><SelectValue placeholder="Choose dataset" /></SelectTrigger>
                  <SelectContent>{datasets.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} v{item.version} · {item.count} cases · {item.appId}</SelectItem>)}</SelectContent>
                </Select>
                {dataset ? <div className="mt-2 text-xs leading-5 text-muted">
                  <p>Expires {new Date(dataset.expiresAt).toLocaleString()}</p>
                  <details className="mt-1"><summary className="cursor-pointer hover:text-foreground">Dataset hash</summary><p className="mt-1 break-all font-mono">{dataset.contentHash}</p></details>
                </div> : <p className="mt-2 text-xs leading-5 text-muted">Import a dataset to start an evaluation.</p>}
              </div>
              <div className="space-y-4">
                {[false, true].map((other) => {
                  const prefix = other ? "evaluation-comparison" : "evaluation-baseline";
                  const policyId = other ? second : first;
                  return <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-end gap-3 sm:grid-cols-[minmax(0,1fr)_6rem]" key={prefix}>
                    <div className="min-w-0">
                      <FieldLabel htmlFor={prefix}>{other ? "Compare with (optional)" : "Baseline policy"}</FieldLabel>
                      <Select value={policyId ? `policy:${policyId}` : other ? "none" : ""} onValueChange={(value) => changeProfile(value === "none" ? "" : value.slice("policy:".length), other)}>
                        <SelectTrigger id={prefix}><SelectValue placeholder="Choose policy" /></SelectTrigger>
                        <SelectContent>
                          {other && <SelectItem value="none">No comparison</SelectItem>}
                          {profiles.map((profile) => <SelectItem key={profile.id} value={`policy:${profile.id}`}>{profile.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <FieldLabel htmlFor={`${prefix}-revision`}>Revision</FieldLabel>
                      <Input id={`${prefix}-revision`} aria-label={other ? "Comparison revision" : "Baseline revision"} type="number" min={1} disabled={other ? !second : !first} value={other ? otherRevision : revision} onChange={(event) => other ? setOtherRevision(Number(event.target.value)) : setRevision(Number(event.target.value))} />
                    </div>
                  </div>;
                })}
              </div>
              <div className="rounded-control border border-line bg-surface-subtle px-3 py-3 text-xs leading-5 text-muted">
                {semantic ? `Semantic policies send inputs to TypeSafe unless this deployment uses mock mode. Up to ${(dataset?.count ?? 0) * (second ? 2 : 1) * 6} attempts including retries; actual retries may be lower. Price is unknown. Check provider billing before starting.` : "Local-only policies make no provider calls. Earlier revisions may differ: the server will require confirmation for any semantic run."}
              </div>
              <div className="flex items-start gap-2.5">
                <Checkbox id="evaluation-paid" className="mt-0.5" checked={paid} onCheckedChange={(checked) => setPaid(checked === true)} />
                <Label htmlFor="evaluation-paid" className="cursor-pointer font-normal leading-5">I authorize this dataset to be sent to the configured semantic provider and accept its charges, if these revisions use it.</Label>
              </div>
              <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-4">
                <Button disabled={busy || !datasetId || !first} onClick={() => void work(async () => {
                  const policies = [{ id: first, revision }, ...(second ? [{ id: second, revision: otherRevision }] : [])];
                  const result = await api.post<{ run: Run }>("/api/evaluations", { datasetId, policies, allowPaid: paid });
                  setSelected(result.run);
                })}><Play className="size-4" />Run evaluation</Button>
                <Button variant="danger" disabled={busy || !datasetId} onClick={() => void work(async () => {
                  await api.delete(`/api/datasets/${datasetId}`);
                  setDatasetId("");
                  setMessage("Dataset inputs deleted. Active runs were cancelled.");
                })}>Delete dataset inputs</Button>
              </div>
            </CardContent>
          </Card>
        </div>}

        <Card className="min-w-0">
          <CardHeader><CardTitle>Runs</CardTitle><CardDescription>Select a run to inspect its results or download a report.</CardDescription></CardHeader>
          <CardContent className={runs.length ? "p-0" : undefined}>
            {runs.length ? <Table>
              <TableHeader><TableRow><TableHead>Run</TableHead><TableHead>Created</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>{[...runs].reverse().map((run) => <TableRow key={run.id} className={selected?.id === run.id ? "bg-surface-subtle" : undefined}>
                <TableCell><button type="button" className="rounded-control font-mono text-xs underline decoration-line-strong underline-offset-4 hover:text-muted" aria-label={`View run ${run.id.slice(0, 8)}`} aria-pressed={selected?.id === run.id} onClick={() => void inspect(run.id).catch((error) => setMessage(error.message))}>{run.id.slice(0, 8)}</button></TableCell>
                <TableCell className="whitespace-nowrap text-muted">{new Date(run.createdAt).toLocaleString()}</TableCell>
                <TableCell><Badge className="capitalize">{selected?.id === run.id ? selected.status : run.status}</Badge></TableCell>
              </TableRow>)}</TableBody>
            </Table> : <EmptyState title="No evaluations yet">{canRun ? "Import a dataset and choose a published policy to run your first evaluation." : "Evaluation runs will appear here when an administrator or operator starts one."}</EmptyState>}
          </CardContent>
        </Card>

        {selected && <Card className="min-w-0">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><CardTitle>Evaluation results</CardTitle><CardDescription>{selected.rows?.length ?? 0} / {selected.total} comparisons · Run {selected.id.slice(0, 8)}</CardDescription></div>
              <Badge className="capitalize">{selected.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <p className="max-w-2xl text-[13px] leading-5 text-muted">{selected.estimate.cost} Maximum provider attempts: {selected.estimate.maximumProviderCalls}. A cancellation stops between calls; an in-flight call can still be billed.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={download}><Download className="size-4" />Download report</Button>
                {canRun && selected.status !== "complete" && <Button variant="outline" disabled={busy} onClick={() => void work(async () => {
                  const action = ["cancelled", "failed"].includes(selected.status) ? "resume" : "cancel";
                  await api.put(`/api/evaluations/${selected.id}`, { action });
                  await inspect(selected.id);
                })}>{["cancelled", "failed"].includes(selected.status) ? "Resume" : "Cancel"}</Button>}
              </div>
            </div>
            {selected.error && <p role="alert" className="rounded-control border border-danger bg-danger-surface px-3 py-2 text-[13px] text-danger">{selected.error}</p>}
            {selected.report && <>
              <div className="overflow-hidden rounded-control border border-line">
                <Table>
                  <TableHeader><TableRow><TableHead>Policy</TableHead><TableHead>Cases</TableHead><TableHead>Accuracy</TableHead><TableHead>False positives</TableHead><TableHead>Indeterminate</TableHead><TableHead>p50 / p95 ms</TableHead><TableHead>Reported cost</TableHead></TableRow></TableHeader>
                  <TableBody>{Object.entries(selected.report.policies).map(([key, stats]) => <TableRow key={key}>
                    <TableCell className="whitespace-nowrap font-medium">{key}</TableCell>
                    <TableCell>{stats.count}</TableCell>
                    <TableCell>{percent(stats.accuracy)}</TableCell>
                    <TableCell>{percent(stats.falsePositiveRate)}</TableCell>
                    <TableCell>{stats.indeterminate}</TableCell>
                    <TableCell className="whitespace-nowrap">{stats.p50LatencyMs?.toFixed(1) ?? "—"} / {stats.p95LatencyMs?.toFixed(1) ?? "—"}</TableCell>
                    <TableCell>{Object.entries(stats.reportedCosts).map(([currency, amount]) => `${currency} ${amount}`).join(", ") || "Unknown"}{stats.costUnreported ? ` (${stats.costUnreported} unreported)` : ""}</TableCell>
                  </TableRow>)}</TableBody>
                </Table>
              </div>
              <p className="text-[13px] text-secondary">{selected.report.disagreements.length} disagreements with expected outcomes · {selected.report.changedCases.length} cases changed between policies.</p>
              <details className="rounded-control border border-line px-4 py-3 text-[13px]">
                <summary className="cursor-pointer font-medium text-secondary">Confusion matrices and disagreements</summary>
                <pre className="mt-3 max-h-96 overflow-auto rounded-control bg-surface-subtle p-3 text-xs">{JSON.stringify(selected.report, null, 2)}</pre>
              </details>
            </>}
            <details className="text-xs leading-5 text-muted">
              <summary className="cursor-pointer hover:text-foreground">Dataset and configuration hashes</summary>
              <dl className="mt-2 space-y-2"><div><dt className="font-medium text-secondary">Dataset</dt><dd className="break-all font-mono">{selected.datasetHash}</dd></div><div><dt className="font-medium text-secondary">Configuration</dt><dd className="break-all font-mono">{selected.configurationHash}</dd></div></dl>
            </details>
          </CardContent>
        </Card>}
      </div>
    </>
  );
}

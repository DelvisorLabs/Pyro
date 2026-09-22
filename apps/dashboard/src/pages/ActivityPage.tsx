import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Search } from "lucide-react";
import type { AppRecord, Profile } from "@pyro/contracts";
import { EmptyState, PageHeader, VerdictBadge } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { duration, money, percent, providerLabel, timeAgo } from "@/lib/format";
import type { ClassificationEvent } from "@/lib/types";

interface TraceDetail { event: ClassificationEvent }

function httpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function LabelValue({ value }: { value: string }) {
  const href = httpUrl(value);
  if (!href) return <span className="break-all text-slate-700">{value}</span>;
  return <a href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="inline-flex min-w-0 items-center gap-1 break-all font-medium text-neutral-950 underline decoration-neutral-400 underline-offset-2">{value}<ExternalLink className="size-3 shrink-0" /></a>;
}

export function ActivityPage({ refreshKey }: { refreshKey: number }) {
  const [events, setEvents] = useState<ClassificationEvent[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [labelKeys, setLabelKeys] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [profile, setProfile] = useState("all");
  const [appId, setAppId] = useState("all");
  const [labelKey, setLabelKey] = useState("all");
  const [labelValue, setLabelValue] = useState("");
  const [detail, setDetail] = useState<TraceDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "250" });
    if (search.trim()) params.set("search", search.trim());
    if (status !== "all") params.set("status", status);
    if (profile !== "all") params.set("profile", profile);
    if (appId !== "all") params.set("appId", appId);
    if (labelKey !== "all") params.set("labelKey", labelKey);
    if (labelValue.trim()) params.set("labelValue", labelValue.trim());
    return params.toString();
  }, [search, status, profile, appId, labelKey, labelValue]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timeout = window.setTimeout(() => {
      void api.get<{ events: ClassificationEvent[]; total: number; labelKeys: string[] }>(`/api/activity?${query}`).then((data) => {
        if (!active) return;
        setEvents(data.events);
        setTotal(data.total);
        setLabelKeys(data.labelKeys);
        setError(undefined);
      }).catch((reason: Error) => {
        if (active) setError(reason.message);
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 150);
    return () => { active = false; clearTimeout(timeout); };
  }, [refreshKey, query]);
  useEffect(() => {
    void api.get<{ profiles: Profile[] }>("/api/profiles").then((data) => setProfiles(data.profiles));
    void api.get<{ apps: AppRecord[] }>("/api/apps").then((data) => setApps(data.apps));
  }, []);
  const openTrace = async (id: string) => setDetail(await api.get<TraceDetail>(`/api/activity/${id}`));
  const exportData = (format: "json" | "csv") => window.open(`/control/api/activity?${query}&format=${format}`, "_blank", "noopener");
  return (
    <>
      <PageHeader title="Activity" description="Find decisions by application, policy, outcome, or request labels, then inspect the complete trace." actions={<div className="flex gap-2"><Button variant="outline" onClick={() => exportData("csv")}><Download className="size-4" />CSV</Button><Button variant="outline" onClick={() => exportData("json")}><Download className="size-4" />JSON</Button></div>} />
      <Card className="mb-3 p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-sm font-semibold text-neutral-950">Filter activity</h2><p className="mt-0.5 text-xs text-neutral-500">Search trace details or narrow results with structured fields.</p></div>
          {loading ? <Skeleton className="h-6 w-28 rounded-full" /> : <span className="whitespace-nowrap rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">{total} matching {total === 1 ? "trace" : "traces"}</span>}
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0 space-y-1.5 sm:col-span-2">
            <Label htmlFor="activity-search" className="text-xs text-neutral-600">Search</Label>
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-neutral-400" /><Input id="activity-search" className="pl-9" placeholder="Request, reason, or label…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          </div>
          <div className="min-w-0 space-y-1.5"><Label htmlFor="activity-app" className="text-xs text-neutral-600">Application</Label><Select value={appId} onValueChange={setAppId}><SelectTrigger id="activity-app"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All apps</SelectItem>{apps.map((record) => <SelectItem key={record.id} value={record.id}>{record.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="min-w-0 space-y-1.5"><Label htmlFor="activity-profile" className="text-xs text-neutral-600">Protection profile</Label><Select value={profile} onValueChange={setProfile}><SelectTrigger id="activity-profile"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All policies</SelectItem>{profiles.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="min-w-0 space-y-1.5"><Label htmlFor="activity-outcome" className="text-xs text-neutral-600">Outcome</Label><Select value={status} onValueChange={setStatus}><SelectTrigger id="activity-outcome"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All outcomes</SelectItem><SelectItem value="flagged">Suspicious + blocked</SelectItem><SelectItem value="suspicious">Suspicious only</SelectItem><SelectItem value="blocked">Blocked only</SelectItem><SelectItem value="safe">Safe only</SelectItem></SelectContent></Select></div>
          <div className="min-w-0 space-y-1.5"><Label htmlFor="activity-label-key" className="text-xs text-neutral-600">Label</Label><Select value={labelKey} onValueChange={setLabelKey}><SelectTrigger id="activity-label-key"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any label</SelectItem>{labelKeys.map((key) => <SelectItem key={key} value={key}>{key}</SelectItem>)}</SelectContent></Select></div>
          <div className="min-w-0 space-y-1.5 sm:col-span-2"><Label htmlFor="activity-label-value" className="text-xs text-neutral-600">Label value</Label><Input id="activity-label-value" placeholder={labelKey === "all" ? "Filter any label value" : `Filter ${labelKey}`} value={labelValue} onChange={(event) => setLabelValue(event.target.value)} /></div>
        </div>
      </Card>
      {error && <div className="mb-3 border border-neutral-500 bg-neutral-100 px-4 py-3 text-sm text-neutral-900">{error}</div>}
      {loading ? <ActivityTableSkeleton /> : !events.length ? <EmptyState title="No matching classifications">Change the filters or send a request with labels to the classification API.</EmptyState> : <Card><Table><TableHeader><TableRow><TableHead>Decision</TableHead><TableHead>Application</TableHead><TableHead>Policy</TableHead><TableHead>Labels</TableHead><TableHead>Risk</TableHead><TableHead>Strongest signal</TableHead><TableHead>Time</TableHead></TableRow></TableHeader><TableBody>{events.map((event) => {
        const strongest = [...event.detectors].sort((a, b) => b.weightedProbability - a.weightedProbability)[0];
        const labels = Object.entries(event.labels ?? {});
        return <TableRow className="cursor-pointer" key={`${event.id}-${event.createdAt}`} onClick={() => void openTrace(event.id)}><TableCell><VerdictBadge event={event} /></TableCell><TableCell>{event.appName ?? event.appId ?? "Default app"}</TableCell><TableCell><code className="text-xs">{event.profileId}</code></TableCell><TableCell><div className="flex max-w-[260px] flex-wrap gap-1">{labels.slice(0, 2).map(([key, value]) => <Badge key={key} className="max-w-[120px] normal-case tracking-normal" title={`${key}: ${value}`}><span className="truncate">{key}</span></Badge>)}{labels.length > 2 && <Badge>+{labels.length - 2}</Badge>}{labels.length === 0 && <span className="text-slate-400">—</span>}</div></TableCell><TableCell className="font-medium">{percent(event.risk)}</TableCell><TableCell className="max-w-[240px] truncate text-slate-600">{strongest?.name ?? event.error ?? "—"}</TableCell><TableCell className="whitespace-nowrap text-slate-500" title={new Date(event.createdAt).toLocaleString()}>{timeAgo(event.createdAt)}</TableCell></TableRow>;
      })}</TableBody></Table></Card>}

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(undefined)}><DialogContent><DialogHeader><DialogTitle>Request trace</DialogTitle><DialogDescription className="font-mono">{detail?.event.id}</DialogDescription></DialogHeader>{detail && <div className="space-y-6 px-6 py-5"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><TraceStat label="Action" value={detail.event.action} /><TraceStat label="Risk" value={percent(detail.event.risk)} /><TraceStat label="Policy" value={detail.event.profileId} /><TraceStat label="Decision path" value={providerLabel(detail.event.provider)} /></div>{Object.keys(detail.event.labels ?? {}).length > 0 && <div><h3 className="mb-2 text-sm font-medium">Request labels</h3><div className="divide-y divide-neutral-200 rounded-[2px] border border-neutral-300">{Object.entries(detail.event.labels ?? {}).map(([key, value]) => <div key={key} className="grid gap-2 px-3 py-2.5 text-sm sm:grid-cols-[150px_1fr]"><code className="text-xs text-neutral-500">{key}</code><LabelValue value={value} /></div>)}</div></div>}<div><h3 className="mb-2 text-sm font-medium">Stage timing</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><TraceStat label="Queue" value={duration(detail.event.queueMs)} /><TraceStat label="Evaluation" value={duration(detail.event.timings?.providerMs ?? detail.event.latencyMs)} /><TraceStat label="Policy" value={duration(detail.event.timings?.policyMs ?? 0)} /><TraceStat label="Total" value={duration(detail.event.timings?.totalMs ?? detail.event.latencyMs)} /></div></div><div><h3 className="mb-2 text-sm font-medium">Detector contribution</h3><div className="space-y-2">{[...detail.event.detectors].sort((a, b) => b.weightedProbability - a.weightedProbability).map((detector) => <div key={detector.id}><div className="mb-1 flex justify-between text-xs"><span>{detector.name}</span><span>{percent(detector.probability)} · weighted {percent(detector.weightedProbability)}</span></div><div className="h-1.5 bg-neutral-100"><div className="h-full bg-neutral-950" style={{ width: `${detector.weightedProbability * 100}%` }} /></div></div>)}</div></div>{detail.event.shadows?.length ? <div><h3 className="mb-2 text-sm font-medium">Shadow policies</h3><div className="space-y-2">{detail.event.shadows.map((shadow) => <div key={shadow.profileId} className="flex items-center justify-between rounded-[2px] border border-neutral-300 p-3 text-sm"><div><span className="font-medium">{shadow.profileId}</span><div className="mt-0.5 text-xs text-neutral-500">{shadow.reason}</div></div><div className="flex items-center gap-2"><Badge>{shadow.action}</Badge>{shadow.changed && <Badge>changed</Badge>}</div></div>)}</div></div> : null}<div className="rounded-[2px] border border-neutral-300 bg-neutral-50 p-3 text-sm"><div className="font-medium">{detail.event.reason}</div><div className="mt-2 grid gap-1 font-mono text-xs text-neutral-500"><span>input sha256: {detail.event.inputHash}</span><span>input bytes: {detail.event.inputBytes ?? "unknown"}</span><span>model: {detail.event.model}</span><span>inference cost: {detail.event.usage?.cost ? money(detail.event.usage.cost.amount, detail.event.usage.cost.currency) : "not reported"}</span>{detail.event.error && <span className="text-neutral-950">error: {detail.event.error}</span>}</div></div></div>}<DialogFooter><Button variant="outline" onClick={() => setDetail(undefined)}>Close</Button></DialogFooter></DialogContent></Dialog>
    </>
  );
}

function TraceStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[2px] border border-neutral-300 bg-neutral-50 p-3"><div className="text-[10px] uppercase tracking-[0.12em] text-neutral-500">{label}</div><div className="mt-1 truncate text-sm font-medium capitalize">{value}</div></div>;
}

function ActivityTableSkeleton() {
  return (
    <Card role="status" aria-live="polite" aria-label="Loading activity">
      <span className="sr-only">Loading activity</span>
      <Table>
        <TableHeader><TableRow><TableHead>Decision</TableHead><TableHead>Application</TableHead><TableHead>Policy</TableHead><TableHead>Labels</TableHead><TableHead>Risk</TableHead><TableHead>Strongest signal</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
        <TableBody>{Array.from({ length: 7 }, (_, index) => <TableRow key={index} className="hover:bg-transparent"><TableCell><Skeleton className="h-5 w-16" /></TableCell><TableCell><Skeleton className="h-4 w-24" /></TableCell><TableCell><Skeleton className="h-4 w-20" /></TableCell><TableCell><div className="flex gap-1"><Skeleton className="h-5 w-14" /><Skeleton className="h-5 w-12" /></div></TableCell><TableCell><Skeleton className="h-4 w-10" /></TableCell><TableCell><Skeleton className="h-4 w-32" /></TableCell><TableCell><Skeleton className="h-4 w-14" /></TableCell></TableRow>)}</TableBody>
      </Table>
    </Card>
  );
}

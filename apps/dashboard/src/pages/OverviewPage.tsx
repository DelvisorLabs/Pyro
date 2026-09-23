import { chartTooltipStyle } from "@/components/ui/chart";
import { MetricCard } from "@/components/ui/metric-card";
import { useEffect, useState } from "react";
import { Activity, Clock3, Gauge, ShieldX } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared";
import { useDashboardPreferences } from "@/components/ui/theme";
import { api } from "@/lib/api";
import { compactNumber, duration, percent } from "@/lib/format";
import type { Overview } from "@/lib/types";

const EMPTY: Overview = {
  totals: { requests: 0, blocked: 0, reviewed: 0, failed: 0, blockRate: 0, p50LatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0, p95QueueMs: 0, p95ProviderMs: 0, shadowChanges: 0 },
  actions: [],
  detectors: [],
  timeline: [],
  gateway: { status: "loading" },
};

export function OverviewPage({ refreshKey }: { refreshKey: number }) {
  const { preferences } = useDashboardPreferences();
  const [overview, setOverview] = useState<Overview>(EMPTY);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const load = (showLoading = false) => {
      if (showLoading) setLoading(true);
      return api.get<Overview>("/api/overview").then((data) => {
        if (active) {
          setOverview(data);
          setError(undefined);
          setLoaded(true);
        }
      }).catch((reason: Error) => {
        if (active) setError(reason.message);
      }).finally(() => {
        if (active && showLoading) setLoading(false);
      });
    };
    void load(true);
    const timer = preferences.liveUpdates ? setInterval(() => void load(), 5_000) : undefined;
    return () => { active = false; if (timer !== undefined) clearInterval(timer); };
  }, [refreshKey, preferences.liveUpdates]);

  return (
    <>
      <PageHeader title="Overview" description="Live request throughput, enforcement decisions, and gateway health." />
      {error && <div className="mb-4 border border-line-strong bg-surface-subtle px-4 py-3 text-sm text-foreground">{error}</div>}
      {loading && !loaded ? <OverviewSkeleton /> : loaded ? <OverviewContent overview={overview} /> : null}
    </>
  );
}

function OverviewContent({ overview }: { overview: Overview }) {
  const queue = overview.gateway.queue;
  const cards = [
    { label: "Requests", value: compactNumber(overview.totals.requests), detail: `${overview.totals.reviewed} sent to review`, icon: Activity },
    { label: "Block rate", value: percent(overview.totals.blockRate), detail: `${overview.totals.blocked} blocked`, icon: ShieldX },
    { label: "Median latency", value: duration(overview.totals.p50LatencyMs), detail: `p95 ${duration(overview.totals.p95LatencyMs)} · p99 ${duration(overview.totals.p99LatencyMs)}`, icon: Clock3 },
    { label: "Queue", value: queue ? String(queue.waiting) : "—", detail: queue ? `${queue.active}/${queue.concurrency} workers active` : "Waiting for gateway", icon: Gauge },
  ];

  return (
    <>
      <div className="metric-grid">
        {cards.map((card) => <MetricCard key={card.label} {...card} />)}
      </div>
      <div className="two-column mt-4">
        <Card>
          <CardHeader><CardTitle>Classification volume</CardTitle></CardHeader>
          <CardContent className="h-[320px] pl-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={overview.timeline} margin={{ top: 12, right: 18, bottom: 0, left: -16 }}>
                <defs><linearGradient id="volume" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-primary)" stopOpacity={0.18} /><stop offset="100%" stopColor="var(--chart-primary)" stopOpacity={0.01} /></linearGradient></defs>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="at" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <Tooltip contentStyle={chartTooltipStyle} labelFormatter={(value) => new Date(String(value)).toLocaleString()} />
                <Area type="monotone" dataKey="total" stroke="var(--chart-primary)" strokeWidth={1.5} fill="url(#volume)" />
                <Area type="monotone" dataKey="blocked" stroke="var(--chart-secondary)" fill="transparent" strokeWidth={1.5} strokeDasharray="4 3" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Gateway</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center justify-between border-b border-line pb-3"><span className="text-muted">Status</span><span className="flex items-center gap-2 font-medium"><i className={`size-2 ${overview.gateway.status === "ok" ? "bg-accent" : "bg-surface-hover"}`} />{overview.gateway.status ?? "unknown"}</span></div>
            <div className="flex items-center justify-between border-b border-line pb-3"><span className="text-muted">Concurrency</span><strong>{queue?.concurrency ?? "—"}</strong></div>
            <div className="flex items-center justify-between border-b border-line pb-3"><span className="text-muted">Accepted jobs</span><strong>{queue?.accepted ?? "—"}</strong></div>
            <div className="flex items-center justify-between border-b border-line pb-3"><span className="text-muted">Failed jobs</span><strong>{queue?.failed ?? overview.totals.failed}</strong></div>
            <div className="flex items-center justify-between border-b border-line pb-3"><span className="text-muted">Provider circuit</span><strong className="capitalize">{overview.gateway.circuitBreaker?.state ?? "—"}</strong></div>
            <div className="flex items-center justify-between"><span className="text-muted">Rejected jobs</span><strong>{queue?.rejected ?? "—"}</strong></div>
          </CardContent>
        </Card>
      </div>
      <div className="two-column mt-4">
        <Card><CardHeader><CardTitle>Detector signals</CardTitle></CardHeader><CardContent className="h-[300px] pl-2"><ResponsiveContainer width="100%" height="100%"><BarChart data={overview.detectors.slice(0, 8)} margin={{ top: 12, right: 18, bottom: 30, left: -16 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="name" interval={0} angle={-18} textAnchor="end" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "var(--muted)" }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} /><Tooltip contentStyle={chartTooltipStyle} /><Bar dataKey="signals" fill="var(--chart-primary)" /></BarChart></ResponsiveContainer></CardContent></Card>
        <Card><CardHeader><CardTitle>Latency and policy safety</CardTitle></CardHeader><CardContent className="space-y-4 text-sm"><div className="flex items-center justify-between border-b border-line pb-3"><span className="text-muted">Provider p95</span><strong>{duration(overview.totals.p95ProviderMs)}</strong></div><div className="flex items-center justify-between border-b border-line pb-3"><span className="text-muted">Queue p95</span><strong>{duration(overview.totals.p95QueueMs)}</strong></div><div className="flex items-center justify-between border-b border-line pb-3"><span className="text-muted">Shadow action changes</span><strong>{overview.totals.shadowChanges}</strong></div>{overview.actions.map((item) => <div key={item.action} className="flex items-center justify-between border-b border-line pb-3 capitalize"><span className="text-muted">{item.action}</span><strong>{item.count}</strong></div>)}</CardContent></Card>
      </div>
    </>
  );
}

const overviewMetrics = [
  { label: "Requests", icon: Activity },
  { label: "Block rate", icon: ShieldX },
  { label: "Median latency", icon: Clock3 },
  { label: "Queue", icon: Gauge },
];

const gatewayRows = ["Status", "Concurrency", "Accepted jobs", "Failed jobs", "Provider circuit", "Rejected jobs"];
const safetyRows = ["Provider p95", "Queue p95", "Shadow action changes", "Allowed", "Reviewed", "Blocked"];

function OverviewSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading overview">
      <span className="sr-only">Loading overview</span>
      <div className="metric-grid">
        {overviewMetrics.map((metric) => <Card key={metric.label}><CardContent className="p-4"><div className="flex items-start justify-between"><span className="text-sm text-muted">{metric.label}</span><metric.icon className="size-4 text-subtle" /></div><Skeleton className="mt-5 h-9 w-24" /><Skeleton className="mt-2 h-3 w-32" /></CardContent></Card>)}
      </div>
      <div className="two-column mt-4">
        <Card>
          <CardHeader><CardTitle>Classification volume</CardTitle></CardHeader>
          <CardContent className="h-[320px] pl-2"><ChartSkeleton /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Gateway</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm"><RowSkeleton labels={gatewayRows} /></CardContent>
        </Card>
      </div>
      <div className="two-column mt-4">
        <Card>
          <CardHeader><CardTitle>Detector signals</CardTitle></CardHeader>
          <CardContent className="h-[300px] pl-2"><BarSkeleton /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Latency and policy safety</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm"><RowSkeleton labels={safetyRows} /></CardContent>
        </Card>
      </div>
    </div>
  );
}

function RowSkeleton({ labels }: { labels: string[] }) {
  return labels.map((label, index) => <div key={label} className={`flex items-center justify-between pb-3 ${index < labels.length - 1 ? "border-b border-line" : ""}`}><span className="text-muted">{label}</span><Skeleton className="h-4 w-16" /></div>);
}

function ChartSkeleton() {
  return (
    <div className="flex h-full flex-col justify-between px-4 pb-3 pt-5">
      <Skeleton className="h-px w-full" />
      <Skeleton className="h-px w-full" />
      <Skeleton className="h-px w-full" />
      <Skeleton className="h-px w-full" />
      <div className="flex items-center justify-between"><Skeleton className="h-3 w-12" /><Skeleton className="h-3 w-12" /><Skeleton className="h-3 w-12" /><Skeleton className="h-3 w-12" /></div>
    </div>
  );
}

function BarSkeleton() {
  const heights = [34, 58, 42, 76, 50, 66, 38, 55];
  return <div className="flex h-full items-end gap-4 px-5 pb-7 pt-5">{heights.map((height, index) => <Skeleton key={index} className="min-w-0 flex-1" style={{ height: `${height}%` }} />)}</div>;
}

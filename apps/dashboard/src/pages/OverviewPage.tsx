import { useEffect, useState } from "react";
import { Activity, Clock3, Gauge, ShieldX } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared";
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
  const [overview, setOverview] = useState<Overview>(EMPTY);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    const load = () => api.get<Overview>("/api/overview").then((data) => {
      if (active) { setOverview(data); setError(undefined); }
    }).catch((reason: Error) => active && setError(reason.message));
    void load();
    const timer = setInterval(load, 5_000);
    return () => { active = false; clearInterval(timer); };
  }, [refreshKey]);

  const queue = overview.gateway.queue;
  const cards = [
    { label: "Requests", value: compactNumber(overview.totals.requests), detail: `${overview.totals.reviewed} sent to review`, icon: Activity },
    { label: "Block rate", value: percent(overview.totals.blockRate), detail: `${overview.totals.blocked} blocked`, icon: ShieldX },
    { label: "Median latency", value: duration(overview.totals.p50LatencyMs), detail: `p95 ${duration(overview.totals.p95LatencyMs)} · p99 ${duration(overview.totals.p99LatencyMs)}`, icon: Clock3 },
    { label: "Queue", value: queue ? String(queue.waiting) : "—", detail: queue ? `${queue.active}/${queue.concurrency} workers active` : "Waiting for gateway", icon: Gauge },
  ];

  return (
    <>
      <PageHeader title="Overview" description="Live request throughput, enforcement decisions, and gateway health." />
      {error && <div className="mb-4 border border-neutral-500 bg-neutral-100 px-4 py-3 text-sm text-neutral-900">{error}</div>}
      <div className="metric-grid">
        {cards.map((card) => <Card key={card.label}><CardContent className="p-4"><div className="flex items-start justify-between"><span className="text-sm text-neutral-500">{card.label}</span><card.icon className="size-4 text-neutral-400" /></div><div className="mt-5 text-3xl font-semibold tracking-[-0.04em]">{card.value}</div><p className="mt-1 text-xs text-neutral-500">{card.detail}</p></CardContent></Card>)}
      </div>
      <div className="two-column mt-4">
        <Card>
          <CardHeader><CardTitle>Classification volume</CardTitle></CardHeader>
          <CardContent className="h-[320px] pl-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={overview.timeline} margin={{ top: 12, right: 18, bottom: 0, left: -16 }}>
                <defs><linearGradient id="volume" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1f1f1e" stopOpacity={0.18} /><stop offset="100%" stopColor="#1f1f1e" stopOpacity={0.01} /></linearGradient></defs>
                <CartesianGrid stroke="#deded8" vertical={false} />
                <XAxis dataKey="at" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6f6f6a" }} tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6f6f6a" }} />
                <Tooltip contentStyle={{ borderRadius: 2, border: "1px solid #bdbdb7", fontSize: 12 }} labelFormatter={(value) => new Date(String(value)).toLocaleString()} />
                <Area type="monotone" dataKey="total" stroke="#1f1f1e" strokeWidth={1.5} fill="url(#volume)" />
                <Area type="monotone" dataKey="blocked" stroke="#777772" fill="transparent" strokeWidth={1.5} strokeDasharray="4 3" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Gateway</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3"><span className="text-neutral-500">Status</span><span className="flex items-center gap-2 font-medium"><i className={`size-2 ${overview.gateway.status === "ok" ? "bg-neutral-950" : "bg-neutral-400"}`} />{overview.gateway.status ?? "unknown"}</span></div>
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3"><span className="text-neutral-500">Concurrency</span><strong>{queue?.concurrency ?? "—"}</strong></div>
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3"><span className="text-neutral-500">Accepted jobs</span><strong>{queue?.accepted ?? "—"}</strong></div>
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3"><span className="text-neutral-500">Failed jobs</span><strong>{queue?.failed ?? overview.totals.failed}</strong></div>
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3"><span className="text-neutral-500">Provider circuit</span><strong className="capitalize">{overview.gateway.circuitBreaker?.state ?? "—"}</strong></div>
            <div className="flex items-center justify-between"><span className="text-neutral-500">Rejected jobs</span><strong>{queue?.rejected ?? "—"}</strong></div>
          </CardContent>
        </Card>
      </div>
      <div className="two-column mt-4">
        <Card><CardHeader><CardTitle>Detector signals</CardTitle></CardHeader><CardContent className="h-[300px] pl-2"><ResponsiveContainer width="100%" height="100%"><BarChart data={overview.detectors.slice(0, 8)} margin={{ top: 12, right: 18, bottom: 30, left: -16 }}><CartesianGrid stroke="#deded8" vertical={false} /><XAxis dataKey="name" interval={0} angle={-18} textAnchor="end" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#6f6f6a" }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6f6f6a" }} /><Tooltip contentStyle={{ borderRadius: 2, border: "1px solid #bdbdb7", fontSize: 12 }} /><Bar dataKey="signals" fill="#2a2a28" /></BarChart></ResponsiveContainer></CardContent></Card>
        <Card><CardHeader><CardTitle>Latency and policy safety</CardTitle></CardHeader><CardContent className="space-y-4 text-sm"><div className="flex items-center justify-between border-b border-neutral-100 pb-3"><span className="text-neutral-500">Provider p95</span><strong>{duration(overview.totals.p95ProviderMs)}</strong></div><div className="flex items-center justify-between border-b border-neutral-100 pb-3"><span className="text-neutral-500">Queue p95</span><strong>{duration(overview.totals.p95QueueMs)}</strong></div><div className="flex items-center justify-between border-b border-neutral-100 pb-3"><span className="text-neutral-500">Shadow action changes</span><strong>{overview.totals.shadowChanges}</strong></div>{overview.actions.map((item) => <div key={item.action} className="flex items-center justify-between border-b border-neutral-100 pb-3 capitalize"><span className="text-neutral-500">{item.action}</span><strong>{item.count}</strong></div>)}</CardContent></Card>
      </div>
    </>
  );
}

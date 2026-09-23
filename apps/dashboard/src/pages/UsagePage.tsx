import { chartTooltipStyle } from "@/components/ui/chart";
import { MetricCard } from "@/components/ui/metric-card";
import { useEffect, useState } from "react";
import { Activity, Clock3, Coins, ReceiptText } from "lucide-react";
import type { AppRecord } from "@pyro/contracts";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { compactNumber, duration, money } from "@/lib/format";

interface Usage {
  range: "24h" | "7d" | "30d";
  from: string;
  to: string;
  totals: { requests: number; allowed: number; reviewed: number; blocked: number; failed: number; providerCalls: number; localRuleDecisions: number; costs: Array<{ currency: string; amount: number }>; costReportedCalls: number; inputTokens: number; outputTokens: number; inputBytes: number; averageLatencyMs: number; p95LatencyMs: number };
  timeline: Array<{ at: string; requests: number; blocked: number; reviewed: number; providerCalls: number }>;
  byApp: Array<{ id: string; name: string; requests: number }>;
  byProvider: Array<{ id: string; requests: number }>;
  byPolicy: Array<{ id: string; requests: number }>;
  byApiKey: Array<{ id: string; requests: number }>;
}

const EMPTY: Usage = { range: "7d", from: "", to: "", totals: { requests: 0, allowed: 0, reviewed: 0, blocked: 0, failed: 0, providerCalls: 0, localRuleDecisions: 0, costs: [], costReportedCalls: 0, inputTokens: 0, outputTokens: 0, inputBytes: 0, averageLatencyMs: 0, p95LatencyMs: 0 }, timeline: [], byApp: [], byProvider: [], byPolicy: [], byApiKey: [] };

export function UsagePage({ refreshKey }: { refreshKey: number }) {
  const [usage, setUsage] = useState<Usage>(EMPTY);
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [range, setRange] = useState("7d");
  const [appId, setAppId] = useState("all");
  const [error, setError] = useState<string>();
  useEffect(() => { void api.get<{ apps: AppRecord[] }>("/api/apps").then((result) => setApps(result.apps)); }, []);
  useEffect(() => {
    const params = new URLSearchParams({ range });
    if (appId !== "all") params.set("appId", appId);
    void api.get<Usage>(`/api/usage?${params}`).then((result) => { setUsage(result); setError(undefined); }).catch((reason: Error) => setError(reason.message));
  }, [range, appId, refreshKey]);
  const tokenTotal = usage.totals.inputTokens + usage.totals.outputTokens;
  const costDisplay = usage.totals.costs.length === 1 ? money(usage.totals.costs[0]!.amount, usage.totals.costs[0]!.currency) : usage.totals.costs.length ? "Multiple" : "—";
  const costDetail = usage.totals.providerCalls === 0 ? "No model calls" : usage.totals.costReportedCalls === usage.totals.providerCalls ? "Reported by the provider" : `${usage.totals.costReportedCalls} of ${usage.totals.providerCalls} calls reported`;
  const cards = [
    { label: "Requests", value: compactNumber(usage.totals.requests), detail: `${usage.totals.blocked} blocked · ${usage.totals.reviewed} reviewed`, help: "All requests received in this time range.", icon: Activity },
    { label: "Model evaluations", value: compactNumber(usage.totals.providerCalls), detail: `${usage.totals.localRuleDecisions} local rule matches`, help: "Requests evaluated by the configured classifier.", icon: Coins },
    { label: "Inference cost", value: costDisplay, detail: costDetail, help: "Provider-reported billed amounts. Never estimated.", icon: ReceiptText },
    { label: "Latency", value: duration(usage.totals.averageLatencyMs), detail: `p95 ${duration(usage.totals.p95LatencyMs)}`, help: "Average decision time; p95 covers 95% of requests.", icon: Clock3 },
  ];
  return (
    <>
      <PageHeader title="Usage" description="Request volume, decision paths, latency, and metering by application." actions={<div className="flex w-full gap-2 sm:w-[360px]"><Select value={appId} onValueChange={setAppId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All applications</SelectItem>{apps.map((record) => <SelectItem key={record.id} value={record.id}>{record.name}</SelectItem>)}</SelectContent></Select><Select value={range} onValueChange={setRange}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="24h">24 hours</SelectItem><SelectItem value="7d">7 days</SelectItem><SelectItem value="30d">30 days</SelectItem></SelectContent></Select></div>} />
      {error && <div className="mb-4 border border-line-strong bg-surface-subtle px-4 py-3 text-sm text-foreground">{error}</div>}
      <div className="metric-grid">{cards.map((card) => <MetricCard key={card.label} {...card} />)}</div>
      <div className="two-column mt-4"><Card><CardHeader><CardTitle>Request volume</CardTitle></CardHeader><CardContent className="h-[320px] pl-2"><ResponsiveContainer width="100%" height="100%"><AreaChart data={usage.timeline} margin={{ top: 12, right: 18, left: -16 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="at" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(value) => range === "24h" ? new Date(value).toLocaleTimeString([], { hour: "2-digit" }) : new Date(value).toLocaleDateString([], { month: "short", day: "numeric" })} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} /><Tooltip contentStyle={chartTooltipStyle} /><Area type="monotone" dataKey="requests" name="Requests" stroke="var(--chart-primary)" fill="var(--chart-fill)" /><Area type="monotone" dataKey="providerCalls" name="Model evaluations" stroke="var(--chart-secondary)" fill="transparent" /></AreaChart></ResponsiveContainer></CardContent></Card><Card><CardHeader><CardTitle>Metering</CardTitle></CardHeader><CardContent className="space-y-4 text-sm"><div className="flex justify-between border-b border-line pb-3"><span className="text-muted">Input tokens</span><strong>{compactNumber(usage.totals.inputTokens)}</strong></div><div className="flex justify-between border-b border-line pb-3"><span className="text-muted">Output tokens</span><strong>{compactNumber(usage.totals.outputTokens)}</strong></div><div className="flex justify-between border-b border-line pb-3"><span className="text-muted">Total tokens</span><strong>{compactNumber(tokenTotal)}</strong></div><div className="flex justify-between border-b border-line pb-3"><span className="text-muted">Input bytes</span><strong>{compactNumber(usage.totals.inputBytes)}</strong></div><div className="flex justify-between border-b border-line pb-3"><span className="flex items-center gap-1.5 text-muted">Inference cost<HelpTooltip label="About inference cost">Provider-reported billed amounts. Never estimated.</HelpTooltip></span><strong>{costDisplay}</strong></div><div className="flex justify-between"><span className="text-muted">Failures</span><strong>{usage.totals.failed}</strong></div></CardContent></Card></div>
      <Card className="mt-4"><CardHeader><CardTitle>{appId === "all" ? "Usage by application" : "Usage by policy"}</CardTitle></CardHeader><CardContent className="h-[300px] pl-2"><ResponsiveContainer width="100%" height="100%"><BarChart data={appId === "all" ? usage.byApp : usage.byPolicy} layout="vertical" margin={{ top: 8, right: 18, left: 30 }}><CartesianGrid stroke="var(--line)" horizontal={false} /><XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} /><YAxis type="category" dataKey={appId === "all" ? "name" : "id"} width={110} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} /><Tooltip contentStyle={chartTooltipStyle} /><Bar dataKey="requests" fill="var(--chart-primary)" /></BarChart></ResponsiveContainer></CardContent></Card>
    </>
  );
}

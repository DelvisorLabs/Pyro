import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useCloud } from "@/lib/cloud";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";
export interface CloudUsageData {
  month: string; availableCredits: number; monthlyConsumed: number; requestsUsed: number;
  sources: Record<string, { credits: number; calls: number }>;
  plan: { name: string; concurrency: number; queueDepth: number; durableQueueDepth: number; evaluationConcurrency: number; evaluationQueueDepth: number; playgroundConcurrency: number; requestsPerMinute: number; monthlyRequests: number; monthlyCredits: number; monthlyCreditLimit: number };
}
export function CloudUsage({ refreshKey = 0, compact = false }: { refreshKey?: number; compact?: boolean }) {
  const cloud = useCloud(); const [data, setData] = useState<CloudUsageData>(); const [error, setError] = useState("");
  useEffect(() => { if (cloud) void api.get<CloudUsageData>("/api/billing/usage").then(setData).catch(e => setError(e.message)); }, [cloud, refreshKey]);
  if (!cloud) return null;
  if (error) return <p role="alert" className="mb-4 text-sm text-danger">Credit usage unavailable: {error}</p>;
  if (!data) return <p role="status" className="text-sm text-muted">Loading plan usage…</p>;
  if (compact) return <p className="text-xs leading-5 text-muted">{data.availableCredits.toLocaleString()} credits available · {data.monthlyConsumed.toLocaleString()} / {data.plan.monthlyCreditLimit.toLocaleString()} used this month. Includes application, playground and evaluation usage.</p>;
  return <Card className="mb-5"><CardHeader><CardTitle>{data.plan.name} plan</CardTitle><CardDescription>{data.month} · UTC calendar month. Included credits reset monthly without rollover. Purchased credits remain available, subject to the monthly limit. Contact the operator to change plans.</CardDescription></CardHeader><CardContent className="space-y-4">
    <dl className="grid gap-4 text-sm sm:grid-cols-3">{Object.entries({ "Available credits": data.availableCredits, "Included monthly credits": data.plan.monthlyCredits, "Monthly credits used / limit": `${data.monthlyConsumed} / ${data.plan.monthlyCreditLimit}`, "Requests used / monthly limit": `${data.requestsUsed} / ${data.plan.monthlyRequests}`, "Requests per minute": data.plan.requestsPerMinute, "Shared inference concurrency": data.plan.concurrency, "Waiting classification requests": data.plan.queueDepth, "Pending durable jobs": data.plan.durableQueueDepth, "Parallel playground tests": data.plan.playgroundConcurrency, "Parallel evaluation runs": data.plan.evaluationConcurrency, "Pending evaluation runs": data.plan.evaluationQueueDepth }).map(([label, value]) => <div key={label}><dt className="text-muted">{label}</dt><dd className="mt-1 font-semibold">{value.toLocaleString()}</dd></div>)}</dl>
    <Table><TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Charged semantic checks</TableHead><TableHead>Credits</TableHead></TableRow></TableHeader><TableBody>{["application", "playground", "evaluation"].map(source => <TableRow key={source}><TableCell className="capitalize">{source}</TableCell><TableCell>{data.sources[source]?.calls ?? 0}</TableCell><TableCell>{data.sources[source]?.credits ?? 0}</TableCell></TableRow>)}</TableBody></Table>
    <p className="text-xs text-muted">Organization totals include retries only once per semantic check. Operational charts below cover retained application traffic; preview inputs are not retained. Plan limits are shared across applications and keys.</p>
  </CardContent></Card>;
}

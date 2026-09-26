import { useEffect, useState } from "react";
import { Check, Download, HelpCircle, MessageSquare, RefreshCw, RotateCcw, X } from "lucide-react";
import type { ClassificationEvent } from "@pyro/contracts";
import { api } from "@/lib/api";
import { EmptyState, PageHeader, VerdictBadge } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { percent, timeAgo } from "@/lib/format";

const outcomes = { true_positive: "Correct flag", false_positive: "False positive", uncertain: "Unsure" } as const;
type Outcome = keyof typeof outcomes;
interface Review {
  id: string; revision: number; status: "open" | "resolved"; appId: string; assignedTo?: string;
  severity: "low" | "medium" | "high"; disposition?: Outcome; ageMs: number; resolvedAt?: string; resolvedBy?: string;
  comments: Array<{ id: string; actorId: string; at: string; text: string }>;
  event: ClassificationEvent;
}
type ReviewRecord = Omit<Review, "event" | "ageMs">;

export function ReviewsPage({ canReview }: { canReview: boolean }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [assignees, setAssignees] = useState<Array<{ id: string; username: string }>>([]);
  const [current, setCurrent] = useState<Review>();
  const [status, setStatus] = useState(() => {
    const saved = localStorage.getItem("pyro-review-filter");
    return saved === "resolved" || saved === "" ? saved : "open";
  });
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState("");
  const [expected, setExpected] = useState("allow");
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);

  const load = async () => {
    const result = await api.get<{ reviews: Review[]; assignees: typeof assignees; nextOffset: number | null }>(`/api/reviews?status=${status}&offset=${offset}`);
    setReviews(result.reviews); setAssignees(result.assignees); setNextOffset(result.nextOffset);
  };
  useEffect(() => {
    void load().catch((error) => setMessage(error.message));
    localStorage.setItem("pyro-review-filter", status);
  }, [status, offset]);
  const open = (review: Review) => {
    setCurrent(review); setSample(review.event.inputPreview ?? ""); setExpected("allow"); setComment(""); setMessage("");
  };
  const save = async (changes: Record<string, unknown>) => {
    if (!current) return;
    setBusy(true); setMessage("");
    try {
      const { review } = await api.put<{ review: ReviewRecord }>(`/api/reviews/${current.id}`, { expectedRevision: current.revision, ...changes });
      setCurrent({ ...review, event: current.event, ageMs: current.ageMs });
      if (typeof changes.comment === "string") setComment("");
      await load();
      setMessage(changes.disposition ? "Review outcome saved. The original decision is unchanged." : "Review saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed."); }
    finally { setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true); setMessage("");
    try {
      await load();
      if (current) {
        const { review, event } = await api.get<{ review: ReviewRecord; event: ClassificationEvent }>(`/api/reviews/${current.id}`);
        setCurrent({ ...review, event, ageMs: current.ageMs });
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Refresh failed."); }
    finally { setBusy(false); }
  };
  const exportSample = () => {
    const blob = new Blob([JSON.stringify({ id: current!.id, input: sample, expected, category: "review-feedback" }) + "\n"], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "review-sample.jsonl"; link.click(); URL.revokeObjectURL(url);
  };
  const actorName = (id: string) => assignees.find((user) => user.id === id)?.username ?? id;

  return (
    <>
      <PageHeader title="Review inbox" description="Inspect flagged requests and record whether the flag was correct. Feedback helps tune policies; it does not approve or resume a request." actions={<Button variant="outline" disabled={busy} onClick={() => void refresh()}><RefreshCw className="size-4" />Refresh</Button>} />
      <div className="space-y-5">
        {message && !current && <div role="status" className="rounded-control border border-line-strong bg-surface-subtle px-4 py-3 text-[13px]">{message}</div>}
        <Card className="min-w-0">
          <CardHeader><div className="flex flex-wrap items-end justify-between gap-4"><div><CardTitle>Flagged requests</CardTitle><CardDescription>Only requests with a Pyro action of review appear here. Allow and block decisions are in Activity.</CardDescription></div><div className="w-full sm:w-40"><FieldLabel htmlFor="review-status">Status</FieldLabel><Select disabled={busy} value={status || "all"} onValueChange={(value) => { setStatus(value === "all" ? "" : value); setOffset(0); }}><SelectTrigger id="review-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Open</SelectItem><SelectItem value="resolved">Resolved</SelectItem><SelectItem value="all">All reviews</SelectItem></SelectContent></Select></div></div></CardHeader>
          <CardContent className={reviews.length ? "p-0" : undefined}>
            {reviews.length ? <Table>
              <TableHeader><TableRow><TableHead>Original decision</TableHead><TableHead>Application</TableHead><TableHead>Severity</TableHead><TableHead>Created</TableHead><TableHead>Review outcome</TableHead></TableRow></TableHeader>
              <TableBody>{reviews.map((review) => <TableRow key={review.id}>
                <TableCell className="min-w-60 max-w-sm"><div className="flex flex-wrap items-center gap-2"><Badge className="capitalize">{review.event.action}</Badge><VerdictBadge event={review.event} /></div><p className="mt-2 line-clamp-2 text-[13px] leading-5 text-secondary">{review.event.reason}</p><Button className="mt-3" variant="outline" size="sm" onClick={() => open(review)}>{canReview ? "Review decision" : "View decision"}</Button></TableCell>
                <TableCell><span className="font-medium">{review.event.appName ?? review.appId}</span><p className="mt-1 text-xs text-muted">{review.event.profileId} · {review.event.policyRevision ? `v${review.event.policyRevision}` : "Legacy revision"}</p></TableCell>
                <TableCell><Badge className="capitalize">{review.severity}</Badge></TableCell>
                <TableCell className="whitespace-nowrap text-muted" title={new Date(review.event.createdAt).toLocaleString()}>{timeAgo(review.event.createdAt)}</TableCell>
                <TableCell><Badge>{review.disposition ? outcomes[review.disposition] : "Awaiting feedback"}</Badge><p className="mt-1 text-xs capitalize text-muted">{review.status}</p></TableCell>
              </TableRow>)}</TableBody>
            </Table> : <EmptyState title={status === "resolved" ? "No resolved reviews" : "No matching flagged requests"}>{status === "resolved" ? "Saved review outcomes will appear here. Switch to Open to inspect requests awaiting feedback." : "Requests flagged for review will appear here with their decision and reason. Use Activity to inspect all classifications."}</EmptyState>}
          </CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3"><p className="text-xs text-muted">{reviews.length} {reviews.length === 1 ? "review" : "reviews"} on this page</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy || !offset} onClick={() => setOffset(Math.max(0, offset - 500))}>Previous</Button><Button variant="outline" size="sm" disabled={busy || nextOffset === null} onClick={() => setOffset(nextOffset!)}>Next</Button></div></div>
        </Card>
      </div>

      <Dialog open={Boolean(current)} onOpenChange={(open) => { if (!open && !busy) { setCurrent(undefined); setMessage(""); } }}>
        <DialogContent className="flex max-w-3xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0"><DialogTitle>Review decision</DialogTitle><DialogDescription>Inspect the original classification and record your assessment of the flag.</DialogDescription></DialogHeader>
          {current && <>
            <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Original decision</h3><div className="mt-2 flex flex-wrap items-center gap-2"><Badge className="capitalize">Action: {current.event.action}</Badge><VerdictBadge event={current.event} /><span className="text-xs text-muted">Risk {percent(current.event.risk)}</span></div></div><Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()}><RefreshCw className="size-3.5" />Reload review</Button></div>
                <p className="mt-3 text-[13px] leading-6 text-secondary">{current.event.reason}</p>
                <dl className="mt-4 grid gap-3 rounded-control border border-line bg-surface-subtle p-3 text-xs sm:grid-cols-2"><div><dt className="text-muted">Application</dt><dd className="mt-1 font-medium">{current.event.appName ?? current.appId}</dd></div><div><dt className="text-muted">Policy</dt><dd className="mt-1 font-medium">{current.event.profileId} · {current.event.policyRevision ? `revision ${current.event.policyRevision}` : "legacy revision"}</dd></div><div><dt className="text-muted">Created</dt><dd className="mt-1">{new Date(current.event.createdAt).toLocaleString()}</dd></div><div><dt className="text-muted">Trace / request</dt><dd className="mt-1 break-all font-mono">{current.event.traceId ?? current.event.requestId ?? current.id}</dd></div></dl>
              </div>
              <div><h3 className="text-[13px] font-medium text-secondary">Stored input preview</h3>{current.event.inputPreview ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-control border border-line bg-surface-subtle p-3 text-xs leading-5">{current.event.inputPreview}</pre> : <p className="mt-2 text-xs leading-5 text-muted">No preview is available. The policy may not store inputs, or your account may not have preview access.</p>}</div>
              {current.status === "resolved" && <div className="rounded-control border border-line-strong bg-surface-subtle px-4 py-3"><p className="text-[13px] font-medium">Review outcome: {current.disposition ? outcomes[current.disposition] : "Resolved"}</p>{current.resolvedAt && <p className="mt-1 text-xs text-muted">{current.resolvedBy ? `${actorName(current.resolvedBy)} · ` : ""}{new Date(current.resolvedAt).toLocaleString()}</p>}<p className="mt-2 text-xs leading-5 text-muted">This records feedback only. The original action remains {current.event.action}; no request has been resumed.</p></div>}
              {canReview && <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
                <div><FieldLabel htmlFor="review-assignee">Assignee</FieldLabel><Select disabled={busy} value={current.assignedTo ? `user:${current.assignedTo}` : "unassigned"} onValueChange={(value) => void save({ assignedTo: value === "unassigned" ? null : value.slice("user:".length) })}><SelectTrigger id="review-assignee"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{current.assignedTo && !assignees.some((user) => user.id === current.assignedTo) && <SelectItem value={`user:${current.assignedTo}`} disabled>{current.assignedTo}</SelectItem>}{assignees.map((user) => <SelectItem key={user.id} value={`user:${user.id}`}>{user.username}</SelectItem>)}</SelectContent></Select></div>
                <div><FieldLabel htmlFor="review-severity">Severity</FieldLabel><Select disabled={busy} value={current.severity} onValueChange={(severity) => void save({ severity })}><SelectTrigger id="review-severity"><SelectValue /></SelectTrigger><SelectContent>{["low", "medium", "high"].map((severity) => <SelectItem key={severity} value={severity}><span className="capitalize">{severity}</span></SelectItem>)}</SelectContent></Select></div>
              </div>}
              <div className="space-y-3 border-t border-line pt-4"><h3 className="text-sm font-semibold">Comments</h3>{current.comments.length ? current.comments.map((entry) => <div key={entry.id} className="rounded-control border border-line px-3 py-2.5"><p className="text-xs text-muted">{actorName(entry.actorId)} · {new Date(entry.at).toLocaleString()}</p><p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-secondary">{entry.text}</p></div>) : <p className="text-xs text-muted">No comments yet.</p>}
                {canReview && <><div><FieldLabel htmlFor="review-comment">Add a comment <span className="font-normal text-muted">(optional)</span></FieldLabel><Textarea id="review-comment" className="min-h-20" disabled={busy} maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Explain your assessment. Avoid including secrets." /></div><Button variant="outline" size="sm" disabled={busy || !comment.trim()} onClick={() => void save({ comment })}><MessageSquare className="size-3.5" />Add comment</Button></>}
              </div>
              {canReview && <details className="rounded-control border border-line px-4 py-3 text-[13px]"><summary className="cursor-pointer font-medium text-secondary">Create an evaluation sample</summary><div className="mt-4 space-y-4"><p className="text-xs leading-5 text-muted">Enter a redacted, complete example. Stored previews may be truncated. Download the sample to import it into the evaluation lab.</p><div><FieldLabel htmlFor="review-sample">Redacted evaluation input</FieldLabel><Textarea id="review-sample" value={sample} onChange={(event) => setSample(event.target.value)} /></div><div><FieldLabel htmlFor="review-expected">Expected action</FieldLabel><Select value={expected} onValueChange={setExpected}><SelectTrigger id="review-expected"><SelectValue /></SelectTrigger><SelectContent>{["allow", "review", "block"].map((action) => <SelectItem key={action} value={action}><span className="capitalize">{action}</span></SelectItem>)}</SelectContent></Select></div><Button variant="outline" disabled={!sample.trim()} onClick={exportSample}><Download className="size-4" />Download JSONL sample</Button></div></details>}
              {message && <p role="status" className="rounded-control border border-line-strong bg-surface-subtle px-3 py-2 text-[13px]">{message}</p>}
            </div>
            <DialogFooter className="shrink-0 flex-col">
              {canReview && current.status === "open" ? <><div><p className="text-[13px] font-medium">Review outcome</p><p className="mt-1 text-xs leading-5 text-muted">Was the flag correct? Your assessment does not approve, block or resume the request.</p></div><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void save({ disposition: "true_positive", ...(comment.trim() ? { comment } : {}) })}><Check className="size-4" />Correct flag</Button><Button variant="outline" disabled={busy} onClick={() => void save({ disposition: "false_positive", ...(comment.trim() ? { comment } : {}) })}><X className="size-4" />False positive</Button><Button variant="outline" disabled={busy} onClick={() => void save({ disposition: "uncertain", ...(comment.trim() ? { comment } : {}) })}><HelpCircle className="size-4" />Unsure</Button></div></> : <div className="flex flex-wrap items-center justify-between gap-3"><Badge>{current.disposition ? outcomes[current.disposition] : "Read-only access"}</Badge><div className="flex gap-2">{canReview && current.status === "resolved" && <Button variant="outline" disabled={busy} onClick={() => void save({ reopen: true })}><RotateCcw className="size-4" />Reopen review</Button>}<Button variant="outline" onClick={() => setCurrent(undefined)}>Close review</Button></div></div>}
            </DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </>
  );
}

import { useEffect, useState } from "react";
import { Pin, RefreshCw, Save, Upload } from "lucide-react";
import type { AppRecord, Profile } from "@pyro/contracts";
import { api } from "@/lib/api";
import { EmptyState, PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

interface Revision { revision: number; contentHash: string; state: string; actorId: string; createdAt: string; profile: Profile }
interface History { activeRevision: number; revisions: Revision[] }
const fieldName = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());

export function PolicyHistoryPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [id, setId] = useState("");
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState("");
  const [appId, setAppId] = useState("");
  const [percent, setPercent] = useState(10);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const selectRevision = (revision?: Revision) => {
    setSelected(revision?.revision ?? 0);
    setDraft(revision ? JSON.stringify(revision.profile, null, 2) : "");
  };
  const applyHistory = (data: History, preferred = data.activeRevision, resetDraft = true) => {
    setRevisions(data.revisions); setActive(data.activeRevision);
    const next = data.revisions.find((revision) => revision.revision === preferred)
      ?? data.revisions.find((revision) => revision.revision === data.activeRevision)
      ?? data.revisions.at(-1);
    if (resetDraft || next?.revision !== selected) selectRevision(next);
  };
  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.get<{ profiles: Profile[] }>("/api/profiles"), api.get<{ apps: AppRecord[] }>("/api/apps")])
      .then(([policies, applications]) => {
        if (cancelled) return;
        setProfiles(policies.profiles); setApps(applications.apps);
        setId(policies.profiles[0]?.id ?? ""); setAppId(applications.apps[0]?.id ?? "");
      }).catch((error) => { if (!cancelled) setMessage(error.message); })
      .finally(() => { if (!cancelled) setLoadingCatalog(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoadingHistory(true); setRevisions([]); setActive(0); selectRevision(); setMessage("");
    void api.get<History>(`/api/profiles/${id}/revisions`)
      .then((data) => { if (!cancelled) applyHistory(data); })
      .catch((error) => { if (!cancelled) setMessage(error.message); })
      .finally(() => { if (!cancelled) setLoadingHistory(false); });
    return () => { cancelled = true; };
  }, [id]);
  const run = async (work: () => Promise<string>) => {
    setBusy(true); setMessage("");
    try { setMessage(await work()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Save failed."); }
    finally { setBusy(false); }
  };
  const refresh = () => run(async () => {
    const [policies, applications] = await Promise.all([api.get<{ profiles: Profile[] }>("/api/profiles"), api.get<{ apps: AppRecord[] }>("/api/apps")]);
    setProfiles(policies.profiles); setApps(applications.apps);
    setAppId((value) => applications.apps.some((app) => app.id === value) ? value : applications.apps[0]?.id ?? "");
    if (id && policies.profiles.some((profile) => profile.id === id)) {
      applyHistory(await api.get<History>(`/api/profiles/${id}/revisions`), selected, false);
    } else {
      setId(policies.profiles[0]?.id ?? ""); setRevisions([]); setActive(0); selectRevision();
    }
    return "History refreshed.";
  });
  const selection = revisions.find((revision) => revision.revision === selected);
  const current = revisions.find((revision) => revision.revision === active);
  const application = apps.find((app) => app.id === appId);
  const loading = loadingCatalog || loadingHistory;
  const differences = current && selection ? Object.keys(selection.profile).filter((key) => !["revision", "contentHash", "updatedAt"].includes(key) && JSON.stringify(selection.profile[key as keyof Profile]) !== JSON.stringify(current.profile[key as keyof Profile])) : [];
  const bind = (canary: boolean) => run(async () => {
    if (!application || selection?.state !== "published") throw new Error("Choose an application and a published revision.");
    const { app } = await api.put<{ app: AppRecord }>(`/api/apps/${appId}`, canary
      ? { ...application, canary: { profileId: id, revision: selected, percent } }
      : { ...application, profileRevisions: { ...application.profileRevisions, [id]: selected }, canary: undefined });
    setApps((records) => records.map((record) => record.id === app.id ? app : record));
    return canary ? `Canary started for ${app.name}: ${percent}% on revision ${selected}.` : `${app.name} pinned to revision ${selected}. Its canary has ended.`;
  });

  return (
    <>
      <PageHeader title="Policy history" description="Inspect saved revisions, create a draft, and control which revision each application runs." actions={<Button variant="outline" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw className="size-4" />Refresh</Button>} />
      <div className="space-y-5">
        {message && <div role="status" className="rounded-control border border-line-strong bg-surface-subtle px-4 py-3 text-[13px]">{message}</div>}
        {loadingCatalog ? <Card><CardContent><p role="status" className="text-[13px] text-muted">Loading policies…</p></CardContent></Card> : !profiles.length ? <EmptyState title="No policies yet">Create a protection profile to start tracking its revisions.</EmptyState> : <>
          <Card>
            <CardContent className="flex flex-wrap items-end justify-between gap-4">
              <div className="w-full sm:max-w-sm"><FieldLabel htmlFor="history-policy">Policy</FieldLabel><Select disabled={busy} value={id} onValueChange={setId}><SelectTrigger id="history-policy"><SelectValue placeholder="Choose policy" /></SelectTrigger><SelectContent>{profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="flex h-9 items-center gap-2">{active > 0 && <Badge>Active revision {active}</Badge>}<span className="text-xs text-muted">{revisions.length} saved {revisions.length === 1 ? "revision" : "revisions"}</span></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Revisions</CardTitle><CardDescription>Select a revision to inspect its configuration or manage an application rollout.</CardDescription></CardHeader>
            <CardContent className={revisions.length && !loadingHistory ? "max-h-80 overflow-auto p-0" : undefined}>
              {loadingHistory ? <p role="status" className="text-[13px] text-muted">Loading revision history…</p> : revisions.length ? <Table aria-label="Policy revisions">
                <TableHeader><TableRow><TableHead>Revision</TableHead><TableHead>State</TableHead><TableHead>Saved by</TableHead><TableHead>Created</TableHead><TableHead>Content hash</TableHead></TableRow></TableHeader>
                <TableBody>{[...revisions].reverse().map((revision) => <TableRow key={revision.revision} className={revision.revision === selected ? "bg-surface-subtle" : undefined}>
                  <TableCell><Button variant={revision.revision === selected ? "outline" : "ghost"} size="sm" disabled={busy} aria-pressed={revision.revision === selected} onClick={() => selectRevision(revision)}>Revision {revision.revision}</Button></TableCell>
                  <TableCell><div className="flex flex-wrap gap-2"><Badge className="capitalize">{revision.state}</Badge>{revision.revision === active && <Badge className="border-accent bg-accent text-inverse">Active</Badge>}</div></TableCell>
                  <TableCell className="max-w-48 break-words text-muted">{revision.actorId}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted">{new Date(revision.createdAt).toLocaleString()}</TableCell>
                  <TableCell title={revision.contentHash}><code className="text-xs text-muted">{revision.contentHash.slice(0, 12)}</code></TableCell>
                </TableRow>)}</TableBody>
              </Table> : <EmptyState title="No revisions to display">Saved drafts and published versions will appear here.</EmptyState>}
            </CardContent>
          </Card>
          {selection && <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
            <Card>
              <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Revision {selected}</CardTitle><CardDescription>Create a new draft from this saved configuration.</CardDescription></div><Badge className="capitalize">{selection.state}</Badge></div></CardHeader>
              <CardContent className="space-y-5">
                <div><p className="text-xs font-medium text-secondary">Changes from active revision {active}</p>{differences.length ? <div className="mt-2 flex flex-wrap gap-2">{differences.map((key) => <Badge key={key}>{fieldName(key)}</Badge>)}</div> : <p className="mt-1 text-xs leading-5 text-muted">No configuration changes.</p>}</div>
                <div><FieldLabel htmlFor="history-draft">Draft configuration (JSON)</FieldLabel><Textarea id="history-draft" disabled={busy} aria-describedby="history-draft-help" className="min-h-72 font-mono text-xs" spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} /><p id="history-draft-help" className="mt-2 text-xs leading-5 text-muted">Edits are saved as a new draft. Existing revisions remain unchanged.</p></div>
                <Button disabled={busy || !draft.trim()} onClick={() => void run(async () => {
                  const result = await api.post<{ revision: Revision }>(`/api/profiles/${id}/revisions`, { profile: JSON.parse(draft), expectedRevision: active });
                  applyHistory(await api.get<History>(`/api/profiles/${id}/revisions`), result.revision.revision);
                  return `Draft revision ${result.revision.revision} saved.`;
                })}><Save className="size-4" />Save as new draft</Button>
                <div className="space-y-3 border-t border-line pt-4"><h3 className="text-[13px] font-medium">Publish saved revision</h3><p className="text-xs leading-5 text-muted">{selection.contentHash === current?.contentHash ? "This configuration is already active. Save changes as a new draft before publishing." : `Publishes the stored revision ${selected}. Save editor changes as a draft first. Changed configuration becomes a new active revision; history is preserved.`}</p><Button variant="outline" disabled={busy || selection.contentHash === current?.contentHash} onClick={() => void run(async () => {
                  const result = await api.post<{ profile: Profile }>(`/api/profiles/${id}/publish`, { revision: selected, expectedRevision: active });
                  setProfiles((records) => records.map((profile) => profile.id === result.profile.id ? result.profile : profile));
                  applyHistory(await api.get<History>(`/api/profiles/${id}/revisions`), result.profile.revision);
                  return `Revision ${result.profile.revision} published.`;
                })}><Upload className="size-4" />Publish revision {selected}</Button></div>
                <details className="text-xs leading-5 text-muted"><summary className="cursor-pointer hover:text-foreground">Full content hash</summary><p className="mt-2 break-all font-mono">{selection.contentHash}</p></details>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Application rollout</CardTitle><CardDescription>Pin a revision or start a canary rollout.</CardDescription></CardHeader>
              <CardContent className="space-y-5">
                {selection.state !== "published" ? <p className="rounded-control border border-line bg-surface-subtle px-3 py-3 text-[13px] leading-5 text-muted">Publish this draft before using it in an application.</p> : !apps.length ? <EmptyState title="No applications">Create an application before configuring a rollout.</EmptyState> : <>
                  <div><FieldLabel htmlFor="history-app">Application</FieldLabel><Select disabled={busy} value={appId} onValueChange={setAppId}><SelectTrigger id="history-app"><SelectValue placeholder="Choose application" /></SelectTrigger><SelectContent>{apps.map((app) => <SelectItem key={app.id} value={app.id}>{app.name}</SelectItem>)}</SelectContent></Select></div>
                  <dl className="space-y-3 rounded-control border border-line bg-surface-subtle p-3 text-xs"><div><dt className="text-muted">Pinned revision</dt><dd className="mt-1 font-medium">{application?.profileRevisions?.[id] ? `Revision ${application.profileRevisions[id]}` : "Latest published"}</dd></div><div><dt className="text-muted">Current canary</dt><dd className="mt-1 break-words font-medium">{application?.canary ? `${application.canary.profileId} · revision ${application.canary.revision} · ${application.canary.percent}%` : "None"}</dd></div></dl>
                  <div className="space-y-3"><h3 className="text-[13px] font-medium">Pin revision {selected}</h3><p className="text-xs leading-5 text-muted">Use this revision for the policy and end any active canary for this application.</p><Button disabled={busy || !application} onClick={() => void bind(false)}><Pin className="size-4" />Pin selected revision</Button></div>
                  <div className="space-y-3 border-t border-line pt-4"><h3 className="text-[13px] font-medium">Canary rollout</h3><p className="text-xs leading-5 text-muted">Start with a pin to your stable revision. Requests are assigned consistently using their request ID.</p><div><FieldLabel htmlFor="history-percent">Requests on revision {selected} (%)</FieldLabel><Input id="history-percent" disabled={busy} type="number" min={0} max={100} value={percent} onChange={(event) => setPercent(Number(event.target.value))} /></div><Button variant="outline" disabled={busy || !application || !Number.isFinite(percent) || percent < 0 || percent > 100} onClick={() => void bind(true)}>Start canary</Button></div>
                </>}
              </CardContent>
            </Card>
          </div>}
        </>}
      </div>
    </>
  );
}

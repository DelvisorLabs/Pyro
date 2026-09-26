import { useEffect, useState } from "react";
import type { AppRecord, Profile } from "@pyro/contracts";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

interface Revision { revision: number; contentHash: string; state: string; actorId: string; createdAt: string; profile: Profile }
const selectClass = "border border-line bg-surface p-2 text-sm";
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
  const reload = async () => {
    const [p, a] = await Promise.all([api.get<{ profiles: Profile[] }>("/api/profiles"), api.get<{ apps: AppRecord[] }>("/api/apps")]);
    setProfiles(p.profiles); setApps(a.apps); setId((old) => old || p.profiles[0]?.id || ""); setAppId((old) => old || a.apps[0]?.id || "");
    if (id) {
      const data = await api.get<{ activeRevision: number; revisions: Revision[] }>(`/api/profiles/${id}/revisions`);
      setRevisions(data.revisions); setActive(data.activeRevision);
    }
  };
  useEffect(() => { void reload().catch((e) => setMessage(e.message)); }, [id]);
  const selection = revisions.find((r) => r.revision === selected);
  const current = revisions.find((r) => r.revision === active);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setMessage("");
    try { await work(); await reload(); setMessage("Saved."); } catch (e) { setMessage(e instanceof Error ? e.message : "Save failed."); } finally { setBusy(false); }
  };
  const bind = (canary: boolean) => run(async () => {
    const application = apps.find((a) => a.id === appId)!;
    if (!selection || selection.state !== "published") throw new Error("Choose a published revision.");
    return api.put(`/api/apps/${appId}`, canary
      ? { ...application, canary: { profileId: id, revision: selected, percent } }
      : { ...application, profileRevisions: { ...application.profileRevisions, [id]: selected }, canary: undefined });
  });
  const differences = current && selection ? Object.keys(selection.profile).filter((key) => !["revision", "contentHash", "updatedAt"].includes(key) && JSON.stringify(selection.profile[key as keyof Profile]) !== JSON.stringify(current.profile[key as keyof Profile])) : [];
  return <div className="space-y-6">
    <PageHeader title="Policy history" description="Inspect immutable revisions, save a draft, and control which revision an application runs." />
    <label className="flex items-center gap-3">Policy <select className={selectClass} value={id} onChange={(e) => { setId(e.target.value); setSelected(0); setDraft(""); }}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><span className="text-sm text-muted">Active revision {active}</span></label>
    {message && <p role="status" className="border border-line p-3 text-sm">{message}</p>}
    <Card><CardContent className="overflow-auto p-4"><table className="w-full text-left text-sm"><thead><tr><th>Revision</th><th>State</th><th>Saved by</th><th>Date</th><th>Hash</th></tr></thead><tbody>{[...revisions].reverse().map((r) => <tr key={r.revision} className="border-t border-line"><td className="py-3"><button className="underline" onClick={() => { setSelected(r.revision); setDraft(JSON.stringify(r.profile, null, 2)); }}>{r.revision}{r.revision === active ? " (active)" : ""}</button></td><td>{r.state}</td><td>{r.actorId}</td><td>{new Date(r.createdAt).toLocaleString()}</td><td title={r.contentHash}><code>{r.contentHash.slice(0, 12)}</code></td></tr>)}</tbody></table></CardContent></Card>
    {selection && <Card><CardContent className="space-y-4 p-5">
      <h2 className="font-semibold">Revision {selected}</h2><p className="text-sm text-muted">Changed from active: {differences.join(", ") || "no configuration changes"}. Publishing an older revision records a new revision; history remains intact.</p>
      <label className="block space-y-2"><span>Draft configuration (JSON)</span><Textarea className="min-h-72 font-mono text-xs" value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
      <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => void run(() => api.post(`/api/profiles/${id}/revisions`, { profile: JSON.parse(draft), expectedRevision: active }))}>Save as draft</Button><Button variant="outline" disabled={busy} onClick={() => void run(() => api.post(`/api/profiles/${id}/publish`, { revision: selected, expectedRevision: active }))}>{selection.state === "draft" ? "Publish selected draft" : "Publish selected revision"}</Button></div>
      {selection.state === "published" && <div className="space-y-3 border-t border-line pt-4"><h3 className="font-semibold">Application rollout</h3><label className="flex gap-3">Application<select className={selectClass} value={appId} onChange={(e) => setAppId(e.target.value)}>{apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><p className="text-sm text-muted">Pinned revision: {apps.find((a) => a.id === appId)?.profileRevisions?.[id] ?? "latest published"}. Canary selection is stable for a request ID. Start with a pin to the current stable revision.</p><div className="flex flex-wrap items-end gap-3"><Button disabled={busy || !appId} onClick={() => void bind(false)}>Pin selected revision / end canary</Button><label className="text-sm">Canary percentage<Input type="number" min={0} max={100} value={percent} onChange={(e) => setPercent(Number(e.target.value))} /></label><Button variant="outline" disabled={busy || !appId} onClick={() => void bind(true)}>Start canary</Button></div></div>}
    </CardContent></Card>}
  </div>;
}

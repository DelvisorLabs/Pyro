import { useEffect, useState } from "react";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import type { ApiKeyRecord, AppRecord, Profile } from "@pyro/contracts";
import { EmptyState, PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCloud } from "@/lib/cloud";
import { api } from "@/lib/api";

export function ApiKeysPage() {
  const cloud = useCloud();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [revoking, setRevoking] = useState<string>();
  const [keys, setKeys] = useState<Omit<ApiKeyRecord, "hash">[]>([]);
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [newKey, setNewKey] = useState<string>();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [appId, setAppId] = useState("default");
  const [defaultProfileId, setDefaultProfileId] = useState("default");
  const [profileAccess, setProfileAccess] = useState("all");
  const [rateLimit, setRateLimit] = useState("");
  const selectedApp = apps.find((record) => record.id === appId);
  const availableProfiles = profiles.filter((profile) => !selectedApp?.allowedProfileIds.length || selectedApp.allowedProfileIds.includes(profile.id));
  const load = () => api.get<{ keys: Omit<ApiKeyRecord, "hash">[] }>("/api/keys").then((data) => setKeys(data.keys));
  useEffect(() => { void Promise.all([load(), api.get<{ profiles: Profile[] }>("/api/profiles").then((data) => setProfiles(data.profiles)), api.get<{ apps: AppRecord[] }>("/api/apps").then((data) => setApps(data.apps))]).catch((e) => setMessage(e.message)); }, []);
  const run = async (work: () => Promise<void>) => { setBusy(true); setMessage(""); try { await work(); } catch (e) { setMessage(e instanceof Error ? e.message : "Request failed."); } finally { setBusy(false); } };
  const create = async () => {
    const result = await api.post<{ key: string }>("/api/keys", {
      name,
      appId,
      defaultProfileId,
      allowedProfileIds: profileAccess === "all" ? undefined : [profileAccess],
      rateLimitPerMinute: Number(rateLimit) || undefined,
    });
    setNewKey(result.key); setName(""); await load();
  };
  const revoke = async () => { await api.delete(`/api/keys/${revoking}`); setRevoking(undefined); await load(); };
  return (
    <>
      <PageHeader title="API keys" actions={<Button onClick={() => { setNewKey(undefined); setOpen(true); }}><Plus className="size-4" />Create key</Button>} />
      {message && !open && !revoking && <p role="alert" className="mb-4 text-sm text-danger">{message}</p>}
      {!keys.length ? <EmptyState title="No API keys">Create a key before sending traffic to the classification endpoint.</EmptyState> : <Card><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Application</TableHead><TableHead>Prefix</TableHead><TableHead>Default policy</TableHead><TableHead>Rate limit</TableHead><TableHead>Status</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{keys.map((key) => <TableRow key={key.id}><TableCell className="font-medium"><span className="flex items-center gap-2"><KeyRound className="size-4 text-subtle" />{key.name}</span></TableCell><TableCell>{apps.find((record) => record.id === (key.appId ?? "default"))?.name ?? key.appId ?? "Default app"}</TableCell><TableCell><code>{key.prefix}…</code></TableCell><TableCell><code>{key.defaultProfileId ?? "app default"}</code></TableCell><TableCell>{key.rateLimitPerMinute ? `${key.rateLimitPerMinute}/min` : "app default"}</TableCell><TableCell>{key.revokedAt ? <Badge className="border-line-strong text-muted">revoked</Badge> : <Badge className="border-accent bg-accent text-inverse">active</Badge>}</TableCell><TableCell>{!key.revokedAt && <Button variant="ghost" size="icon" disabled={busy} onClick={() => setRevoking(key.id)} aria-label={`Revoke ${key.name}`}><Trash2 className="size-4" /></Button>}</TableCell></TableRow>)}</TableBody></Table></Card>}
      <Dialog open={open} onOpenChange={(value) => { if (!busy) { setOpen(value); if (!value) setNewKey(undefined); } }}><DialogContent className="flex max-w-lg flex-col overflow-hidden"><DialogHeader><DialogTitle>{newKey ? "Copy your API key" : "Create API key"}</DialogTitle><DialogDescription>{newKey ? "Shown once. Copy and store it securely." : "Choose the application and policies this key can access."}</DialogDescription></DialogHeader><div className="min-h-0 overflow-y-auto px-6 py-5">{newKey ? <div className="flex gap-2"><Input aria-label="New API key" value={newKey} readOnly className="font-mono text-xs" /><Button size="icon" onClick={() => void navigator.clipboard.writeText(newKey)} aria-label="Copy API key"><Copy className="size-4" /></Button></div> : <div className="space-y-4"><div className="space-y-2"><Label htmlFor="key-name">Key name</Label><Input id="key-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Production chat service" /></div><div className="space-y-2"><Label htmlFor="key-app">Application</Label><Select value={appId} onValueChange={(value) => { setAppId(value); const selected = apps.find((record) => record.id === value); if (selected) { setDefaultProfileId(selected.defaultProfileId); setProfileAccess("all"); } }}><SelectTrigger id="key-app"><SelectValue /></SelectTrigger><SelectContent>{apps.map((record) => <SelectItem key={record.id} value={record.id}>{record.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="key-policy">Default policy</Label><Select value={defaultProfileId} onValueChange={setDefaultProfileId}><SelectTrigger id="key-policy"><SelectValue /></SelectTrigger><SelectContent>{availableProfiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="key-policy-access">Policy access</Label><Select value={profileAccess} onValueChange={(value) => { setProfileAccess(value); if (value !== "all") setDefaultProfileId(value); }}><SelectTrigger id="key-policy-access"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Inherit app access</SelectItem>{availableProfiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>Only {profile.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="rate-limit">Requests per minute</Label><Input id="rate-limit" type="number" min="1" value={rateLimit} onChange={(event) => setRateLimit(event.target.value)} placeholder="Inherit app limit" /></div></div>}{cloud && newKey && <div className="mt-4 space-y-2"><p className="text-sm text-muted">Use this key on your backend. Keep it out of browser code.</p><pre className="overflow-x-auto rounded-control bg-surface-subtle p-3 text-xs">{`import { PyroClient } from "@pyro/sdk";
const pyro = new PyroClient({ apiKey: process.env.PYRO_API_KEY! });
const result = await pyro.classify("Hello");`}</pre></div>}{message && <p role="alert" className="mt-4 text-sm text-danger">{message}</p>}</div><DialogFooter>{newKey ? <Button onClick={() => setOpen(false)}>Done</Button> : <><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => void run(create)} disabled={busy || !name.trim() || !appId}>Create key</Button></>}</DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(revoking)} onOpenChange={(value) => { if (!value && !busy) setRevoking(undefined); }}><DialogContent><DialogHeader><DialogTitle>Revoke API key</DialogTitle><DialogDescription>Clients using this key will lose access immediately.</DialogDescription></DialogHeader>{message && <p role="alert" className="px-6 py-4 text-sm text-danger">{message}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setRevoking(undefined)}>Cancel</Button><Button disabled={busy} onClick={() => void run(revoke)}>Revoke key</Button></DialogFooter></DialogContent></Dialog>
    </>
  );
}

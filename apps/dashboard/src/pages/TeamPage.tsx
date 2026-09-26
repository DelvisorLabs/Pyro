import { useEffect, useState } from "react";
import { KeyRound, Pencil, RefreshCw, Save, UserPlus } from "lucide-react";
import type { UserRecord, AppRecord } from "@pyro/contracts";
import { api } from "@/lib/api";
import { EmptyState, PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const roles = ["admin", "operator", "reviewer", "viewer"] as const;
const roleDescriptions = {
  admin: "Full access to all applications, raw previews, shared policies, provider settings, webhooks and team management.",
  operator: "Manage API keys, run evaluations and resolve reviews for the selected applications.",
  reviewer: "Inspect activity and resolve reviews for the selected applications.",
  viewer: "Read activity, usage, evaluations and reviews for the selected applications.",
};
const newAccount = (): Partial<UserRecord> => ({ username: "", role: "viewer", appIds: [] });
interface AuditEntry { id: string; at: string; actorId: string; action: string; resource: string; status: number; revision?: number }

export function TeamPage({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [draft, setDraft] = useState<Partial<UserRecord>>(newAccount);
  const [accountOpen, setAccountOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [oidc, setOidc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const load = async () => {
    const [team, applications, log] = await Promise.all([
      api.get<{ users: UserRecord[]; oidcConfigured: boolean }>("/api/team"),
      api.get<{ apps: AppRecord[] }>("/api/apps"),
      api.get<{ entries: AuditEntry[] }>("/api/audit"),
    ]);
    setUsers(team.users); setOidc(team.oidcConfigured); setApps(applications.apps); setAudit(log.entries);
  };
  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, []);
  const run = async (work?: () => Promise<unknown>) => {
    setBusy(true); setMessage("");
    try { await work?.(); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Save failed."); }
    finally { setBusy(false); }
  };
  const edit = (user?: UserRecord) => {
    setDraft(user ? { ...user, appIds: [...user.appIds ?? []] } : newAccount());
    setMessage(""); setAccountOpen(true);
  };
  const save = () => void run(async () => {
    const result = draft.id
      ? await api.put<{ password?: string }>(`/api/team/${draft.id}`, draft)
      : await api.post<{ password?: string }>("/api/team", draft);
    setPassword(result.password ?? "");
    setMessage(draft.id ? "Account updated. Its existing sessions were revoked." : "Account created.");
    setAccountOpen(false); setDraft(newAccount());
  });

  return (
    <>
      <PageHeader title="Team & audit" description="Manage access to your applications and inspect account and configuration changes." actions={
        <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => void run()}><RefreshCw className="size-4" />Refresh</Button><Button disabled={busy} onClick={() => edit()}><UserPlus className="size-4" />New account</Button></div>
      } />
      <div className="space-y-5">
        {message && !accountOpen && <div role="status" className="rounded-control border border-line-strong bg-surface-subtle px-4 py-3 text-[13px]">{message}</div>}
        {password && <Card>
          <CardHeader><CardTitle>Account password</CardTitle><CardDescription>Copy this password and share it securely. It will not be shown again after dismissal.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-4"><code className="min-w-0 break-all rounded-control bg-surface-subtle px-3 py-2 text-sm">{password}</code><Button variant="outline" onClick={() => setPassword("")}>Dismiss password</Button></CardContent>
        </Card>}
        <Card className="min-w-0">
          <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Team members</CardTitle><CardDescription>Application access and sign-in methods for each account.</CardDescription></div><div className="flex flex-wrap gap-2"><Badge>{users.length} {users.length === 1 ? "account" : "accounts"}</Badge><Badge>{oidc ? "SSO configured" : "Password sign-in"}</Badge></div></div></CardHeader>
          <CardContent className={users.length ? "p-0" : undefined}>
            {users.length ? <Table>
              <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Role</TableHead><TableHead>Applications</TableHead><TableHead>Access</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>{users.map((user) => <TableRow key={user.id}>
                <TableCell><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{user.username}</span>{user.id === currentUserId && <Badge>You</Badge>}</div>{user.username === "admin" && <p className="mt-1 text-xs text-muted">Bootstrap administrator</p>}</TableCell>
                <TableCell><Badge className="capitalize">{user.role ?? "viewer"}</Badge></TableCell>
                <TableCell className="max-w-xs"><p className="text-secondary">{user.role === "admin" ? "All applications" : user.appIds?.map((id) => apps.find((app) => app.id === id)?.name ?? id).join(", ") || "No applications"}</p></TableCell>
                <TableCell><Badge className={user.disabled ? "text-muted" : undefined}>{user.disabled ? "Disabled" : "Active"}</Badge><p className="mt-1 text-xs text-muted">{user.oidcSubject ? "Single sign-on" : "Password"}</p></TableCell>
                <TableCell><div className="flex justify-end gap-2"><Button variant="ghost" size="sm" aria-label={`Edit ${user.username}`} disabled={busy || user.username === "admin" || user.id === currentUserId} onClick={() => edit(user)}><Pencil className="size-3.5" />Edit</Button><Button variant="outline" size="sm" aria-label={`Revoke sessions for ${user.username}`} disabled={busy} onClick={() => void run(async () => { await api.delete(`/api/team/${user.id}/sessions`); setMessage(`Sessions revoked for ${user.username}.`); })}><KeyRound className="size-3.5" />Revoke sessions</Button></div></TableCell>
              </TableRow>)}</TableBody>
            </Table> : <EmptyState title="No accounts to display">Create an account to give a teammate access to Pyro.</EmptyState>}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Audit log</CardTitle><CardDescription>Latest 1,000 entries. Each change records a request intent and a separate outcome.</CardDescription></div><Badge>{audit.length} {audit.length === 1 ? "entry" : "entries"}</Badge></div></CardHeader>
          <CardContent className={audit.length ? "max-h-[480px] overflow-auto p-0" : undefined}>
            {audit.length ? <Table>
              <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Resource</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
              <TableBody>{audit.map((entry) => <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap text-muted">{new Date(entry.at).toLocaleString()}</TableCell>
                <TableCell className="font-medium">{users.find((user) => user.id === entry.actorId)?.username ?? entry.actorId}</TableCell>
                <TableCell><Badge className="font-mono">{entry.action}</Badge></TableCell>
                <TableCell><code className="break-all text-xs">{entry.resource}</code>{entry.revision !== undefined && <p className="mt-1 text-xs text-muted">Revision {entry.revision}</p>}</TableCell>
                <TableCell><Badge className={entry.status >= 400 ? "border-danger/30 bg-danger-surface text-danger" : "whitespace-nowrap"}>{entry.status === 0 ? "Request recorded" : `${entry.status < 400 ? "Success" : "Failed"} · ${entry.status}`}</Badge></TableCell>
              </TableRow>)}</TableBody>
            </Table> : <EmptyState title="No audit entries yet">Account and configuration changes will appear here with their actor and result.</EmptyState>}
          </CardContent>
        </Card>
      </div>

      <Dialog open={accountOpen} onOpenChange={(open) => { if (!busy) { setAccountOpen(open); setMessage(""); } }}>
        <DialogContent className="flex max-w-2xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0"><DialogTitle>{draft.id ? "Edit account" : "Create account"}</DialogTitle><DialogDescription>{draft.id ? "Update application access and permissions. Saving revokes this account’s existing sessions." : "Choose a role and the applications this teammate can access."}</DialogDescription></DialogHeader>
          <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><FieldLabel htmlFor="team-username">Username</FieldLabel><Input id="team-username" autoFocus value={draft.username ?? ""} disabled={busy || Boolean(draft.id)} maxLength={100} onChange={(event) => setDraft({ ...draft, username: event.target.value })} placeholder="alex" /></div>
              <div><FieldLabel htmlFor="team-role">Role</FieldLabel><Select disabled={busy} value={draft.role ?? "viewer"} onValueChange={(role) => setDraft({ ...draft, role: role as UserRecord["role"] })}><SelectTrigger id="team-role"><SelectValue /></SelectTrigger><SelectContent>{roles.map((role) => <SelectItem key={role} value={role}><span className="capitalize">{role}</span></SelectItem>)}</SelectContent></Select></div>
            </div>
            <p className="rounded-control border border-line bg-surface-subtle px-3 py-3 text-xs leading-5 text-muted">{roleDescriptions[draft.role ?? "viewer"]}</p>
            {draft.role !== "admin" && <>
              <fieldset><legend className="text-[13px] font-medium text-secondary">Application access</legend><p className="mt-1 text-xs leading-5 text-muted">Select the applications this account can access. No selection grants access to none.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{apps.map((app) => <label key={app.id} className="flex cursor-pointer items-start gap-2.5 rounded-control border border-line px-3 py-2.5 text-[13px] text-secondary"><Checkbox className="mt-0.5" disabled={busy} checked={draft.appIds?.includes(app.id) ?? false} onCheckedChange={(checked) => setDraft({ ...draft, appIds: checked === true ? [...draft.appIds ?? [], app.id] : draft.appIds?.filter((id) => id !== app.id) })} /><span className="min-w-0 break-words">{app.name}</span></label>)}</div></fieldset>
              <div className="flex items-start gap-2.5"><Checkbox id="team-previews" className="mt-0.5" disabled={busy} checked={draft.rawPreviews ?? false} onCheckedChange={(checked) => setDraft({ ...draft, rawPreviews: checked === true })} /><div><Label htmlFor="team-previews" className="cursor-pointer">Allow raw input previews and caller metadata</Label><p className="mt-1 text-xs leading-5 text-muted">Applies to the selected applications. Previews are available only when a policy stores them.</p></div></div>
            </>}
            {oidc && <div><FieldLabel htmlFor="team-subject">SSO subject <span className="font-normal text-muted">(optional)</span></FieldLabel><Input id="team-subject" disabled={busy || Boolean(draft.id)} value={draft.oidcSubject ?? ""} onChange={(event) => setDraft({ ...draft, oidcSubject: event.target.value || undefined })} placeholder="Exact subject from your identity provider" /><p className="mt-2 text-xs leading-5 text-muted">{draft.id ? "The sign-in identity cannot be changed after creation." : "Leave empty to generate a password. SSO accounts use the identity provider instead."}</p></div>}
            {draft.id && <div className="flex items-start gap-2.5 border-t border-line pt-4"><Checkbox id="team-disabled" className="mt-0.5" disabled={busy} checked={draft.disabled ?? false} onCheckedChange={(checked) => setDraft({ ...draft, disabled: checked === true })} /><div><Label htmlFor="team-disabled" className="cursor-pointer">Disable account</Label><p className="mt-1 text-xs leading-5 text-muted">Prevents sign-in and revokes existing sessions when saved.</p></div></div>}
            {message && <p role="alert" className="rounded-control border border-danger/30 bg-danger-surface px-3 py-2 text-[13px] text-danger">{message}</p>}
          </div>
          <DialogFooter className="shrink-0"><Button variant="outline" disabled={busy} onClick={() => setAccountOpen(false)}>Cancel</Button><Button disabled={busy || (draft.username?.trim().length ?? 0) < 2} onClick={save}><Save className="size-4" />{busy ? "Saving…" : draft.id ? "Save changes" : "Create account"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

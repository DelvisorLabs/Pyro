import { CloudContext, CloudModelContext, type Organization } from "@/lib/cloud";
import { OrganizationPage } from "@/pages/OrganizationPage";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useRef, useState } from "react";
import { Activity, BookOpenCheck, Boxes, ChartColumn, KeyRound, LogOut, Menu, Settings, SlidersHorizontal, TerminalSquare, X } from "lucide-react";
import type { ClassificationEvent, UserRecord } from "@pyro/contracts";
import { PyroMark } from "@/components/PyroMark";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";
import { BranchedMenu, type BranchedMenuItem } from "@/components/react-bits/BranchedMenu";
import { Button } from "@/components/ui/button";
import { useDashboardPreferences } from "@/components/ui/theme";
import { api, ApiError, controlWebSocketUrl, selectOrganization } from "@/lib/api";
import { ActivityPage } from "@/pages/ActivityPage";
import { ApiKeysPage } from "@/pages/ApiKeysPage";
import { AppsPage } from "@/pages/AppsPage";
import { LoginPage } from "@/pages/LoginPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { PlaygroundPage } from "@/pages/PlaygroundPage";
import { PolicyHistoryPage } from "@/pages/PolicyHistoryPage";
import { ProfilesPage } from "@/pages/ProfilesPage";
import { IntegrationsPage } from "@/pages/IntegrationsPage";
import { EvaluationsPage } from "@/pages/EvaluationsPage";
import { ReviewsPage } from "@/pages/ReviewsPage";
import { TeamPage } from "@/pages/TeamPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { UsagePage } from "@/pages/UsagePage";

type Page = "organization" | "evaluations" | "reviews" | "team" | "history" | "overview" | "apps" | "usage" | "playground" | "profiles" | "activity" | "keys" | "settings" | "integrations";
type User = UserRecord;

const NAV: BranchedMenuItem[] = [
  { label: "Observe", children: [
    { value: "overview", label: "Overview", icon: <Activity className="size-3.5" /> },
    { value: "usage", label: "Usage", icon: <ChartColumn className="size-3.5" /> },
    { value: "evaluations", label: "Evaluation lab", icon: <ChartColumn className="size-3.5" /> },
    { value: "reviews", label: "Review inbox", icon: <BookOpenCheck className="size-3.5" /> },
    { value: "activity", label: "Activity", icon: <BookOpenCheck className="size-3.5" /> },
    { value: "playground", label: "Playground", icon: <TerminalSquare className="size-3.5" /> },
  ] },
  { label: "Configure", children: [
    { value: "team", label: "Team & audit", icon: <KeyRound className="size-3.5" /> },
    { value: "apps", label: "Applications", icon: <Boxes className="size-3.5" /> },
    { value: "history", label: "Policy history", icon: <BookOpenCheck className="size-3.5" /> },
    { value: "profiles", label: "Protection Profiles", icon: <SlidersHorizontal className="size-3.5" /> },
    { value: "keys", label: "API keys", icon: <KeyRound className="size-3.5" /> },
    { value: "integrations", label: "Webhooks", icon: <Activity className="size-3.5" /> },
  ] },
];

export default function App() {
  const { preferences } = useDashboardPreferences();
  const [user, setUser] = useState<User>();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [switching, setSwitching] = useState(false);
  const [scopeError, setScopeError] = useState("");
  const [invite, setInvite] = useState(() => { const value = new URLSearchParams(location.search).get("invite"); if (value) sessionStorage.setItem("pyro-invite", value); return value ?? sessionStorage.getItem("pyro-invite"); });
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState<Page>(() => {
    const saved = localStorage.getItem("pf-page");
    return saved === "settings" || saved === "organization" || NAV.some((group) => group.children?.some((item) => item.value === saved)) ? saved as Page : "overview";
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<string>();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);

  const refreshSession = async () => {
    const data = await api.get<{ user: User; organizations?: Organization[] }>("/api/auth/me");
    selectOrganization(data.user.organizationId); setUser(data.user); setOrganizations(data.organizations ?? []);
  };
  useEffect(() => {
    const tokens = new URLSearchParams(location.search);
    // Email recovery/verification links must work even when another session exists.
    if (tokens.has("reset") || tokens.has("verify")) { setChecking(false); return; }
    void refreshSession().catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") return;
      if (!(error instanceof ApiError && error.status === 401)) setScopeError(error instanceof Error ? error.message : "Could not load your account.");
    }).finally(() => setChecking(false));
  }, []);
  const switchOrganization = async (id: string) => {
    setSwitching(true); setScopeError(""); setToast(undefined);
    try { await api.post("/api/organizations/select", { orgId: id }); selectOrganization(id); await refreshSession(); setRefreshKey(0); }
    catch (error) { setScopeError(error instanceof Error ? error.message : "Could not switch organization."); }
    finally { setSwitching(false); }
  };

  useEffect(() => {
    if (!user || switching || user.cloud && !user.organizationId) return;
    let socket: WebSocket | undefined;
    let retry: number | undefined;
    let stopped = false;
    const connect = () => {
      socket = new WebSocket(controlWebSocketUrl());
      socket.onclose = () => {
        if (!stopped) retry = window.setTimeout(connect, 1_500);
      };
      socket.onmessage = (message) => {
        if (stopped) return;
        const event = JSON.parse(message.data) as { type: string; data?: ClassificationEvent; notify?: boolean };
        if (event.type === "decision" && event.data) {
          if (preferences.liveUpdates) setRefreshKey((value) => value + 1);
          if (event.notify && preferences.decisionToasts) {
            setToast(`${event.data.action === "block" ? "Blocked" : "Review"}: ${event.data.reason}`);
            window.setTimeout(() => setToast(undefined), 4_000);
          }
        }
      };
    };
    connect();
    return () => { stopped = true; if (retry) clearTimeout(retry); socket?.close(); };
  }, [user, switching, preferences.liveUpdates, preferences.decisionToasts]);

  useEffect(() => { if (!preferences.decisionToasts) setToast(undefined); }, [preferences.decisionToasts]);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [page]);

  const navigate = (next: Page) => {
    setPage(next);
    localStorage.setItem("pf-page", next);
    if (mobileNavOpen) { setMobileNavOpen(false); mobileMenuRef.current?.focus(); }
  };
  const logout = async () => { await api.post("/api/auth/logout"); selectOrganization(undefined); setUser(undefined); setOrganizations([]); };

  if (checking) return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Starting Pyro…</div>;
  if (!user) return <LoginPage onLogin={(next) => { setUser(next); void refreshSession().catch((e) => setScopeError(e.message)); }} />;

  const visiblePages = user.role === "admin" ? undefined : ["overview", "usage", "activity", "reviews", "evaluations", ...(user.role === "operator" ? ["keys"] : [])];
  const navigation = [...NAV, ...(user.cloud ? [{ label: "Workspace", children: [{ value: "organization", label: "Organization & billing", icon: <Boxes className="size-3.5" /> }] }] : [])].map((group) => ({ ...group, children: group.children?.filter((item) => !visiblePages || item.value === "organization" || visiblePages.includes(String(item.value))) })).filter((group) => group.children?.length);
  const organization = organizations.find((o) => o.id === user.organizationId);
  const content = {
    organization: <OrganizationPage user={user} organization={organization} onChanged={refreshSession} />,
    overview: <OverviewPage refreshKey={refreshKey} />,
    apps: <AppsPage />,
    usage: <UsagePage refreshKey={refreshKey} />,
    playground: <PlaygroundPage onDecision={() => setRefreshKey((value) => value + 1)} />,
    profiles: <ProfilesPage />,
    history: <PolicyHistoryPage />,
    evaluations: <EvaluationsPage canRun={user.role === "admin" || user.role === "operator"} />,
    reviews: <ReviewsPage canReview={user.role !== "viewer"} />,
    activity: <ActivityPage refreshKey={refreshKey} />,
    keys: <ApiKeysPage />,
    settings: <SettingsPage />,
    team: <TeamPage currentUserId={user.id} />,
    integrations: <IntegrationsPage />,
  }[user.cloud && !user.organizationId ? "organization" : !user.cloud && page === "organization" || visiblePages && !visiblePages.includes(page) && page !== "organization" ? "overview" : page];

  return (
    <CloudContext.Provider value={Boolean(user.cloud)}><CloudModelContext.Provider value={user.cloudModel ?? "jev-latest"}><div className="app-grid">
      <aside className="sidebar sticky top-0 flex h-screen flex-col border-r border-line bg-surface text-foreground max-sm:relative max-sm:h-auto max-sm:border-b max-sm:border-r-0">
        <div className="flex h-[68px] shrink-0 items-center justify-between border-b border-line px-5 max-sm:border-b-0">
          <div className="flex items-center gap-3"><PyroMark className="size-7 shrink-0 text-foreground" /><strong className="text-base font-semibold tracking-[-0.025em]">Pyro</strong></div>
          <div className="flex items-center gap-1 sm:hidden"><Button ref={mobileMenuRef} variant="ghost" size="icon" aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileNavOpen} aria-controls="dashboard-navigation" onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? <X className="size-4" /> : <Menu className="size-4" />}</Button></div>
        </div>
        <div id="dashboard-navigation" className={`flex min-h-0 flex-1 flex-col ${mobileNavOpen ? "" : "max-sm:hidden"}`}>
          {user.cloud && organizations.length > 0 && <div className="px-4 pt-4"><label htmlFor="organization-switcher" className="mb-2 block text-xs font-medium text-muted">Organization</label><Select value={user.organizationId} disabled={switching} onValueChange={(id) => void switchOrganization(id)}><SelectTrigger id="organization-switcher"><SelectValue placeholder="Select organization" /></SelectTrigger><SelectContent>{organizations.map((org) => <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>)}</SelectContent></Select></div>}
          <div className="flex-1 overflow-y-auto px-4 py-5"><BranchedMenu rowHeight={38} indent={26} items={navigation} defaultOpen={[0, 1]} activeValue={page} onSelect={(value) => navigate(value as Page)} /></div>
          <div className="flex items-center justify-between border-t border-line px-3 py-3"><button type="button" className={`flex h-9 flex-1 items-center gap-3 px-3 text-left text-[13px] hover:text-foreground ${page === "settings" ? "font-semibold text-foreground" : "text-muted"}`} aria-current={page === "settings" ? "page" : undefined} onClick={() => navigate("settings")}><Settings className="size-4" />{user.role === "admin" ? "Settings" : user.username}</button><Button variant="ghost" size="icon" className="size-8 hover:bg-transparent" onClick={() => void logout()} aria-label="Log out" title="Log out"><LogOut className="size-3.5" /></Button></div>
        </div>
      </aside>
      <main className="min-w-0"><div className="page-shell">{scopeError && <p role="alert" className="mb-5 rounded-control border border-danger/30 p-3 text-sm text-danger">{scopeError}</p>}{invite && user.cloud && <div className="mb-5 flex flex-wrap items-center gap-3 rounded-control border border-line bg-surface-subtle p-4"><p className="text-sm">You have an organization invitation.</p><Button size="sm" disabled={switching} onClick={() => { setSwitching(true); void api.post("/api/invitations/accept", { token: invite }).then(async () => { sessionStorage.removeItem("pyro-invite"); setInvite(null); history.replaceState(null, "", "/"); selectOrganization(undefined); await refreshSession(); }).catch((e) => setScopeError(e.message)).finally(() => setSwitching(false)); }}>Accept invitation</Button><Button variant="ghost" size="sm" onClick={() => { sessionStorage.removeItem("pyro-invite"); setInvite(null); }}>Dismiss</Button></div>}{switching ? <p role="status" className="p-5 text-sm text-muted">Opening organization…</p> : <PageErrorBoundary key={`${user.organizationId ?? "local"}:${page}`}>{content}</PageErrorBoundary>}</div></main>
      {toast && <div className="fixed bottom-5 right-5 z-50 max-w-sm border border-accent bg-accent px-4 py-3 text-sm leading-5 text-inverse shadow-xl">{toast}</div>}
    </div></CloudModelContext.Provider></CloudContext.Provider>
  );
}

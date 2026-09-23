import { useEffect, useRef, useState } from "react";
import { Activity, BookOpenCheck, Boxes, ChartColumn, KeyRound, LogOut, Menu, Settings, SlidersHorizontal, TerminalSquare, X } from "lucide-react";
import type { ClassificationEvent } from "@pyro/contracts";
import { PyroMark } from "@/components/PyroMark";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";
import { BranchedMenu, type BranchedMenuItem } from "@/components/react-bits/BranchedMenu";
import { Button } from "@/components/ui/button";
import { useDashboardPreferences } from "@/components/ui/theme";
import { api, ApiError, controlWebSocketUrl } from "@/lib/api";
import { ActivityPage } from "@/pages/ActivityPage";
import { ApiKeysPage } from "@/pages/ApiKeysPage";
import { AppsPage } from "@/pages/AppsPage";
import { LoginPage } from "@/pages/LoginPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { PlaygroundPage } from "@/pages/PlaygroundPage";
import { ProfilesPage } from "@/pages/ProfilesPage";
import { IntegrationsPage } from "@/pages/IntegrationsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { UsagePage } from "@/pages/UsagePage";

type Page = "overview" | "apps" | "usage" | "playground" | "profiles" | "activity" | "keys" | "settings" | "integrations";
interface User { id: string; username: string; role?: "admin" | "viewer" }

const NAV: BranchedMenuItem[] = [
  { label: "Observe", children: [
    { value: "overview", label: "Overview", icon: <Activity className="size-3.5" /> },
    { value: "usage", label: "Usage", icon: <ChartColumn className="size-3.5" /> },
    { value: "activity", label: "Activity", icon: <BookOpenCheck className="size-3.5" /> },
    { value: "playground", label: "Playground", icon: <TerminalSquare className="size-3.5" /> },
  ] },
  { label: "Configure", children: [
    { value: "apps", label: "Applications", icon: <Boxes className="size-3.5" /> },
    { value: "profiles", label: "Protection Profiles", icon: <SlidersHorizontal className="size-3.5" /> },
    { value: "keys", label: "API keys", icon: <KeyRound className="size-3.5" /> },
    { value: "integrations", label: "Webhooks", icon: <Activity className="size-3.5" /> },
  ] },
];

export default function App() {
  const { preferences } = useDashboardPreferences();
  const [user, setUser] = useState<User>();
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState<Page>(() => {
    const saved = localStorage.getItem("pf-page");
    return saved === "settings" || NAV.some((group) => group.children?.some((item) => item.value === saved)) ? saved as Page : "overview";
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<string>();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api.get<{ user: User }>("/api/auth/me").then((data) => setUser(data.user)).catch((error: unknown) => {
      if (!(error instanceof ApiError && error.status === 401)) console.error(error);
    }).finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!user) return;
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
  }, [user, preferences.liveUpdates, preferences.decisionToasts]);

  useEffect(() => { if (!preferences.decisionToasts) setToast(undefined); }, [preferences.decisionToasts]);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [page]);

  const navigate = (next: Page) => {
    setPage(next);
    localStorage.setItem("pf-page", next);
    if (mobileNavOpen) { setMobileNavOpen(false); mobileMenuRef.current?.focus(); }
  };
  const logout = async () => { await api.post("/api/auth/logout"); setUser(undefined); };

  if (checking) return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Starting Pyro…</div>;
  if (!user) return <LoginPage onLogin={setUser} />;

  const content = {
    overview: <OverviewPage refreshKey={refreshKey} />,
    apps: <AppsPage />,
    usage: <UsagePage refreshKey={refreshKey} />,
    playground: <PlaygroundPage onDecision={() => setRefreshKey((value) => value + 1)} />,
    profiles: <ProfilesPage />,
    activity: <ActivityPage refreshKey={refreshKey} />,
    keys: <ApiKeysPage />,
    settings: <SettingsPage />,
    integrations: <IntegrationsPage />,
  }[page];

  return (
    <div className="app-grid">
      <aside className="sidebar sticky top-0 flex h-screen flex-col border-r border-line bg-surface text-foreground max-sm:relative max-sm:h-auto max-sm:border-b max-sm:border-r-0">
        <div className="flex h-[68px] shrink-0 items-center justify-between border-b border-line px-5 max-sm:border-b-0">
          <div className="flex items-center gap-3"><PyroMark className="size-7 shrink-0 text-foreground" /><strong className="text-base font-semibold tracking-[-0.025em]">Pyro</strong></div>
          <div className="flex items-center gap-1 sm:hidden"><Button ref={mobileMenuRef} variant="ghost" size="icon" aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileNavOpen} aria-controls="dashboard-navigation" onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? <X className="size-4" /> : <Menu className="size-4" />}</Button></div>
        </div>
        <div id="dashboard-navigation" className={`flex min-h-0 flex-1 flex-col ${mobileNavOpen ? "" : "max-sm:hidden"}`}>
          <div className="flex-1 overflow-y-auto px-4 py-5"><BranchedMenu rowHeight={38} indent={26} items={NAV} defaultOpen={[0, 1]} activeValue={page} onSelect={(value) => navigate(value as Page)} /></div>
          <div className="flex items-center justify-between border-t border-line px-3 py-3"><button type="button" className={`flex h-9 flex-1 items-center gap-3 px-3 text-left text-[13px] hover:text-foreground ${page === "settings" ? "font-semibold text-foreground" : "text-muted"}`} aria-current={page === "settings" ? "page" : undefined} onClick={() => navigate("settings")}><Settings className="size-4" />Settings</button><Button variant="ghost" size="icon" className="size-8 hover:bg-transparent" onClick={() => void logout()} aria-label="Log out" title="Log out"><LogOut className="size-3.5" /></Button></div>
        </div>
      </aside>
      <main className="min-w-0"><div className="page-shell"><PageErrorBoundary key={page}>{content}</PageErrorBoundary></div></main>
      {toast && <div className="fixed bottom-5 right-5 z-50 max-w-sm border border-accent bg-accent px-4 py-3 text-sm leading-5 text-inverse shadow-xl">{toast}</div>}
    </div>
  );
}

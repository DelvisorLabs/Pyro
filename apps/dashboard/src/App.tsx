import { useEffect, useState } from "react";
import { Activity, BookOpenCheck, Boxes, ChartColumn, KeyRound, LogOut, Settings, SlidersHorizontal, TerminalSquare } from "lucide-react";
import type { ClassificationEvent } from "@pyro/contracts";
import { PyroMark } from "@/components/PyroMark";
import { BranchedMenu, type BranchedMenuItem } from "@/components/react-bits/BranchedMenu";
import { Button } from "@/components/ui/button";
import { api, ApiError, controlWebSocketUrl } from "@/lib/api";
import { ActivityPage } from "@/pages/ActivityPage";
import { ApiKeysPage } from "@/pages/ApiKeysPage";
import { AppsPage } from "@/pages/AppsPage";
import { LoginPage } from "@/pages/LoginPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { PlaygroundPage } from "@/pages/PlaygroundPage";
import { ProfilesPage } from "@/pages/ProfilesPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { UsagePage } from "@/pages/UsagePage";

type Page = "overview" | "apps" | "usage" | "playground" | "profiles" | "activity" | "keys" | "settings";
interface User { id: string; username: string; role?: "admin" | "viewer" }

const NAV: BranchedMenuItem[] = [
  { label: "Observe", children: [
    { value: "overview", label: "Overview", icon: <Activity className="size-3.5" /> },
    { value: "usage", label: "Usage", icon: <ChartColumn className="size-3.5" /> },
    { value: "activity", label: "Activity", icon: <BookOpenCheck className="size-3.5" /> },
  ] },
  { label: "Configure", children: [
    { value: "apps", label: "Applications", icon: <Boxes className="size-3.5" /> },
    { value: "profiles", label: "Protection Profiles", icon: <SlidersHorizontal className="size-3.5" /> },
    { value: "keys", label: "API keys", icon: <KeyRound className="size-3.5" /> },
    { value: "settings", label: "Settings", icon: <Settings className="size-3.5" /> },
  ] },
  { label: "Test", children: [{ value: "playground", label: "Playground", icon: <TerminalSquare className="size-3.5" /> }] },
];

export default function App() {
  const [user, setUser] = useState<User>();
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState<Page>(() => (localStorage.getItem("pf-page") as Page) || "overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<string>();

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
        const event = JSON.parse(message.data) as { type: string; data?: ClassificationEvent; notify?: boolean };
        if (event.type === "decision" && event.data) {
          setRefreshKey((value) => value + 1);
          if (event.notify) {
            setToast(`${event.data.action === "block" ? "Blocked" : "Review"}: ${event.data.reason}`);
            window.setTimeout(() => setToast(undefined), 4_000);
          }
        }
      };
    };
    connect();
    return () => { stopped = true; if (retry) clearTimeout(retry); socket?.close(); };
  }, [user]);

  const navigate = (next: Page) => { setPage(next); localStorage.setItem("pf-page", next); };
  const logout = async () => { await api.post("/api/auth/logout"); setUser(undefined); };

  if (checking) return <div className="flex min-h-screen items-center justify-center text-sm text-neutral-500">Starting Pyro…</div>;
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
  }[page];

  return (
    <div className="app-grid">
      <aside className="sidebar sticky top-0 flex h-screen flex-col border-r border-[#252525] bg-[#0c0c0c] text-neutral-100 max-sm:relative max-sm:h-auto max-sm:border-b max-sm:border-r-0">
        <div className="flex h-[68px] items-center gap-3 border-b border-[#252525] px-5"><PyroMark className="size-7 shrink-0 text-white" /><strong className="text-sm tracking-[-0.01em]">Pyro</strong></div>
        <div className="flex-1 overflow-y-auto px-4 py-5"><BranchedMenu items={NAV} defaultOpen={[0, 1, 2]} activeValue={page} onSelect={(value) => navigate(value as Page)} /></div>
        <div className="flex items-center justify-between border-t border-[#252525] px-4 py-3"><span className="font-mono text-[11px] text-neutral-400">v0.2.0</span><Button variant="ghost" size="icon" className="size-8 text-neutral-300 hover:bg-white/10 hover:text-white" onClick={() => void logout()} aria-label="Log out" title="Log out"><LogOut className="size-3.5" /></Button></div>
      </aside>
      <main className="min-w-0"><div className="page-shell">{content}</div></main>
      {toast && <div className="fixed bottom-5 right-5 z-50 max-w-sm border border-neutral-900 bg-neutral-950 px-4 py-3 text-sm leading-5 text-white shadow-xl">{toast}</div>}
    </div>
  );
}

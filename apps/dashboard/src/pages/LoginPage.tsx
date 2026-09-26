import { useState, useEffect, type FormEvent } from "react";
import type { UserRecord } from "@pyro/contracts";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { PyroMark } from "@/components/PyroMark";

export function LoginPage({ onLogin }: { onLogin: (user: UserRecord) => void }) {
  const [username, setUsername] = useState("admin");
  const [oidc, setOidc] = useState(false);
  useEffect(() => { void api.get<{ oidc: boolean }>("/api/auth/options").then((r) => setOidc(r.oidc)).catch(() => {}); }, []);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError(undefined);
    try {
      const result = await api.post<{ user: UserRecord }>("/api/auth/login", { username, password });
      onLogin(result.user);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign in failed."); }
    finally { setLoading(false); }
  };
  return (
    <main className="subtle-grid flex min-h-screen items-center justify-center p-5">
      <Card className="w-full max-w-md">
        <CardContent className="p-7">
          <div className="mb-8 flex items-center gap-3"><PyroMark className="size-9 text-foreground" /><strong className="block text-sm">Pyro</strong></div>
          <h1 className="text-2xl font-semibold tracking-[-0.025em]">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use your account credentials or your organization’s single sign-on.</p>
          {oidc && <a className="mt-5 block border border-line p-3 text-center" href="/control/api/auth/oidc/start">Continue with SSO</a>}
          <form onSubmit={submit} className="mt-7 space-y-5">
            <div className="space-y-2"><Label htmlFor="username">Username</Label><Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" autoComplete="current-password" type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} /></div>
            {error && <div className="border border-line-strong bg-surface-subtle px-3 py-2 text-sm text-foreground">{error}</div>}
            <Button className="w-full" disabled={loading || !password}>{loading && <Loader2 className="size-4 animate-spin" />}{loading ? "Signing in" : "Sign in"}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

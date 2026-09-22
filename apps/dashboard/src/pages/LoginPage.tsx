import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { PyroMark } from "@/components/PyroMark";

export function LoginPage({ onLogin }: { onLogin: (user: { id: string; username: string }) => void }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError(undefined);
    try {
      const result = await api.post<{ user: { id: string; username: string } }>("/api/auth/login", { password });
      onLogin(result.user);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign in failed."); }
    finally { setLoading(false); }
  };
  return (
    <main className="subtle-grid flex min-h-screen items-center justify-center p-5">
      <Card className="w-full max-w-md shadow-sm">
        <CardContent className="p-7">
          <div className="mb-8 flex items-center gap-3"><PyroMark className="size-9 text-neutral-950" /><strong className="block text-sm">Pyro</strong></div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em]">Sign in</h1>
          <p className="mt-1 text-sm text-neutral-500">Enter the administrator password configured for this instance.</p>
          <form onSubmit={submit} className="mt-7 space-y-5">
            <div className="space-y-2"><Label htmlFor="password">Administrator password</Label><Input id="password" autoComplete="current-password" type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} /></div>
            {error && <div className="border border-neutral-500 bg-neutral-100 px-3 py-2 text-sm text-neutral-900">{error}</div>}
            <Button className="w-full" disabled={loading || !password}>{loading && <Loader2 className="size-4 animate-spin" />}{loading ? "Signing in" : "Sign in"}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

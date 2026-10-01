import { useState, type FormEvent } from "react";
import type { UserRecord } from "@pyro/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PyroMark } from "@/components/PyroMark";
import { api, selectOrganization } from "@/lib/api";
export function CloudLoginPage({ onLogin }: { onLogin: (user: UserRecord) => void }) {
  const query = new URLSearchParams(location.search);
  const [mode, setMode] = useState<"login" | "signup" | "recover" | "reset" | "verify">(query.has("reset") ? "reset" : query.has("verify") ? "verify" : "login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      if (mode === "login" || mode === "verify") {
        const result = await api.post<{ user: UserRecord }>(`/api/auth/${mode}`, mode === "login" ? { username: email, password } : { token: query.get("verify") });
        if (mode === "verify") history.replaceState(null, "", "/"); selectOrganization(result.user.organizationId); onLogin(result.user);
      } else if (mode === "reset") { await api.post("/api/auth/reset", { token: query.get("reset"), password }); history.replaceState(null, "", "/"); setMode("login"); setMessage("Password updated. Sign in to continue."); }
      else { const result = await api.post<{ message: string }>(`/api/auth/${mode === "signup" ? "signup" : "recover"}`, { email, password: mode === "signup" ? password : undefined }); setMessage(result.message); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); } finally { setBusy(false); }
  };
  const titles = { login: "Sign in to Pyro", signup: "Create your account", recover: "Recover your account", reset: "Set a new password", verify: "Verify your email" };
  return <main className="subtle-grid flex min-h-screen items-center justify-center p-5"><Card className="w-full max-w-md"><CardContent className="p-7">
    <div className="mb-8 flex items-center gap-3"><PyroMark className="size-9" /><strong>Pyro Cloud</strong></div><h1 className="text-2xl font-semibold tracking-tight">{titles[mode]}</h1>
    <p className="mt-2 text-sm text-muted">Design, test and operate policies with your team.</p>
    <form onSubmit={submit} className="mt-7 space-y-5">
      {!["verify", "reset"].includes(mode) && <div className="space-y-2"><Label htmlFor="cloud-email">{mode === "login" ? "Email or username" : "Email"}</Label><Input id="cloud-email" type={mode === "login" ? "text" : "email"} autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>}
      {["login", "signup", "reset"].includes(mode) && <div className="space-y-2"><Label htmlFor="cloud-password">Password</Label><Input id="cloud-password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 12} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />{mode !== "login" && <p className="text-xs text-muted">Use at least 12 characters.</p>}</div>}
      {message && <p role="status" className="rounded-control border border-line bg-surface-subtle p-3 text-sm">{message}</p>}
      <Button className="w-full" disabled={busy}>{busy ? "Please wait…" : mode === "verify" ? "Verify and continue" : mode === "recover" ? "Send recovery email" : mode === "reset" ? "Update password" : mode === "signup" ? "Create account" : "Sign in"}</Button>
    </form>
    <div className="mt-4 flex flex-wrap gap-2">{(["login", "signup", "recover"] as const).filter((m) => m !== mode).map((m) => <Button key={m} variant="ghost" size="sm" disabled={busy} onClick={() => { setMode(m); setMessage(""); }}>{m === "signup" ? "Create account" : m === "recover" ? "Forgot password?" : "Sign in"}</Button>)}</div>
    {(mode === "signup" || mode === "login") && <Button variant="ghost" size="sm" className="mt-1" disabled={busy || !email} onClick={() => { setBusy(true); void api.post<{ message: string }>("/api/auth/recover", { email, kind: "verify" }).then((r) => setMessage(r.message)).catch((e) => setMessage(e.message)).finally(() => setBusy(false)); }}>Resend verification email</Button>}
  </CardContent></Card></main>;
}

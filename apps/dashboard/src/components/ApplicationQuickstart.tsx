import { useState } from "react";
import type { AppRecord } from "@pyro/contracts";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { FieldLabel } from "./ui/field";
import { ViewTabs } from "./ui/view-tabs";
export function ApplicationQuickstart({ app }: { app: AppRecord }) {
  const [base, setBase] = useState(`${location.origin}/gateway`), [language, setLanguage] = useState<"curl" | "typescript" | "sdk">("curl"), [message, setMessage] = useState("");
  const payload = JSON.stringify({ input: "How do I change my billing plan?", profile: app.defaultProfileId });
  const sdk = `// Backend only. Uses the @pyro/sdk package from this repository.
import { PyroClient } from "@pyro/sdk";
const pyro = new PyroClient({
  baseUrl: ${JSON.stringify(base)},
  apiKey: process.env.PYRO_API_KEY!,
  timeoutMs: 10_000
});
const decision = await pyro.classify("How do I change my billing plan?", {
  profile: ${JSON.stringify(app.defaultProfileId)}
});
// Only proceed when action is allow and verdict is not indeterminate.
// Hold review decisions; reject block decisions. Handle errors by holding.
if (decision.action === "allow" && decision.verdict !== "indeterminate") {
  // Perform your authorization checks, then call your assistant.
}`;
  const code = language === "sdk" ? sdk : language === "curl" ? `# Create an API key scoped to ${app.name} in API keys.\nexport PYRO_API_KEY='replace-with-your-application-key'\ncurl --fail-with-body ${JSON.stringify(base.replace(/\/$/, "") + "/v1/classify")} \\\n  -H "Authorization: Bearer $PYRO_API_KEY" \\\n  -H 'Content-Type: application/json' \\\n  --data '${payload.replaceAll("'", "'\\''")}'\n# Inspect action: allow, review, or block. HTTP 200 alone does not mean allow.` : `// Backend only. Keep the API key in an environment variable.\nconst response = await fetch(${JSON.stringify(base.replace(/\/$/, "") + "/v1/classify")}, {\n  method: "POST",\n  headers: { Authorization: \`Bearer \${process.env.PYRO_API_KEY}\`, "Content-Type": "application/json" },\n  body: JSON.stringify(${payload})\n});\nif (!response.ok) throw new Error(\`Policy check unavailable: \${response.status}\`);\nconst decision = await response.json();\nif (decision.action === "block") return { status: "rejected" };\nif (decision.action === "review") return { status: "held", decisionId: decision.id };\nif (decision.action !== "allow" || decision.verdict === "indeterminate") throw new Error("No allow decision");\n// Perform your own authorization checks, then call the assistant.\nreturn { status: "allowed", decisionId: decision.id };`;
  return <Card><CardHeader><CardTitle>Connect {app.name}</CardTitle><CardDescription>Create a key assigned to this application, then run this from your backend. This uses the saved default policy. After the first request, check Overview and Activity.</CardDescription></CardHeader><CardContent className="space-y-4"><div><FieldLabel htmlFor="integration-url">Gateway base URL</FieldLabel><Input id="integration-url" value={base} onChange={e => setBase(e.target.value)} /><p className="mt-2 text-xs text-muted">The dashboard proxy is prefilled. Replace it with your externally reachable gateway URL when integrating elsewhere.</p></div><ViewTabs label="Integration language" value={language} options={[{ value: "curl", label: "cURL" }, { value: "typescript", label: "TypeScript / fetch" }, { value: "sdk", label: "TypeScript SDK" }]} onChange={setLanguage} /><pre className="max-h-96 overflow-auto rounded-control bg-surface-subtle p-3 text-xs">{code}</pre><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(code).then(() => setMessage("Example copied.")).catch(() => setMessage("Select and copy the example above.")); }}>Copy example</Button>{message && <p role="status" className="text-xs text-muted">{message}</p>}<p className="text-xs leading-5 text-muted">Review means hold or use a safe fallback. Inbox feedback does not automatically execute the held operation. Recheck trusted permissions before resuming. On timeout, 429, or other errors, use a bounded retry or hold the request; do not continue as allowed.</p></CardContent></Card>;
}

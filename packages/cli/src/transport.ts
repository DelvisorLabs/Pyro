import WebSocket from "ws";
import type { Config } from "./config.js";
import type { Endpoint } from "./spec.js";

export class CliError extends Error {
  constructor(message: string, public readonly exitCode = 1, public readonly details?: Record<string, unknown>) { super(message); }
}

export function credentials(endpoint: Endpoint, baseUrl: string, config: Config): Record<string, string> {
  if ((endpoint.security ?? endpoint.spec.security).length === 0) return {};
  if (endpoint.service === "gateway") {
    const key = process.env.PYRO_API_KEY;
    if (!key?.trim()) throw new CliError("Set PYRO_API_KEY to an application API key. Dashboard sessions cannot authenticate the gateway.", 3);
    return { Authorization: `Bearer ${key}` };
  }
  const session = config.sessions?.[baseUrl];
  if (!session || session.expiresAt <= Date.now()) throw new CliError("Sign in to this control plane with `pyro auth login` (use the same --control-url).", 3);
  return { Cookie: `pf_session=${session.token}` };
}

export async function request(url: URL, method: string, headers: Record<string, string>, body: string | undefined, timeout: number) {
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, { method, headers, body, redirect: "error", signal: AbortSignal.timeout(timeout) });
    text = await response.text();
  } catch (error) {
    if (error instanceof Error && /Timeout|Abort/.test(error.name)) throw new CliError(`Request timed out after ${timeout} ms.`, 4);
    throw new CliError(`Cannot reach ${url.origin}. Check the server URL and that Pyro is running. Redirects are not followed.`, 4);
  }
  let data: unknown = text;
  if (response.headers.get("content-type")?.includes("json") && text) {
    try { data = JSON.parse(text); } catch { throw new CliError("The server returned invalid JSON.", 4); }
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : response.statusText;
    const details = { status: response.status, requestId: response.headers.get("x-request-id") ?? undefined, retryAfter: response.headers.get("retry-after") ?? undefined };
    throw new CliError(`HTTP ${response.status}: ${message}${response.status === 401 && headers.Cookie ? " Run `pyro auth login` to renew the session." : ""}`, response.status === 401 || response.status === 403 ? 3 : 1, details);
  }
  return { response, data, text };
}

export async function stream(url: URL, endpoint: Endpoint, headers: Record<string, string>, timeout: number, count: number | undefined): Promise<void> {
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const gateway = endpoint.service === "gateway";
  // Gateway authenticates in its first message, not via a query string or cookie.
  const socket = new WebSocket(url, { headers: gateway ? {} : headers, handshakeTimeout: timeout, followRedirects: false });
  await new Promise<void>((resolve, reject) => {
    let received = 0;
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      if (error) reject(error); else resolve();
    };
    const interrupt = () => finish();
    const timer = setTimeout(() => finish(new CliError("Event stream authentication timed out.", 4)), timeout);
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    socket.on("open", () => {
      if (gateway) socket.send(JSON.stringify({ type: "auth", apiKey: headers.Authorization!.slice(7) }));
    });
    socket.on("message", raw => {
      try {
        const text = raw.toString();
        const message = JSON.parse(text) as { type: string };
        if (message.type === "auth.failed") return finish(new CliError("Event stream authentication failed.", 3));
        if (message.type === "auth.ok" || message.type === "connected") { clearTimeout(timer); return; }
        if (message.type === "auth.required") return;
        process.stdout.write(`${text}\n`);
        received++;
        if (count && received >= count) finish();
      } catch { finish(new CliError("The server returned an invalid event message.", 4)); }
    });
    socket.on("close", code => finish(new CliError(`Event stream closed (code ${code}).${code === 1008 ? " Check your credentials." : ""}`, code === 1008 ? 3 : 4)));
    socket.on("error", () => finish(new CliError(`Cannot connect to event stream at ${url.origin}.`, 4)));
  });
}

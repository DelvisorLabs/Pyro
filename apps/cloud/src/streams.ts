import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { ClassificationEvent, UserRecord } from "@pyro/contracts";
import type { CloudStore } from "./store.js";
import type { Runtimes, Runtime } from "./runtime.js";
function visible(event: ClassificationEvent, user?: UserRecord) {
  if (!user || user.role === "admin" || user.rawPreviews) return event;
  const { inputPreview, metadata, appRulesSnapshot, ...rest } = event; return rest;
}
export function registerStreams(app: FastifyInstance, store: CloudStore, runtimes: Runtimes) {
  let connections = 0;
  const counts = new Map<Runtime, number>();
  const admit = (socket: WebSocket) => {
    if (connections >= 100) { socket.close(1013, "Stream capacity reached"); return false; }
    connections++; socket.once("close", () => { connections--; }); return true;
  };
  const stops = new Set<() => void>();
  const start = async (socket: WebSocket, runtime: Runtime, authorize: () => Promise<{ user?: UserRecord; appId?: string }>) => {
    if ((counts.get(runtime) ?? 0) >= 10) throw new Error("Organization stream limit reached");
    counts.set(runtime, (counts.get(runtime) ?? 0) + 1);
    socket.once("close", () => { counts.set(runtime, Math.max(0, (counts.get(runtime) ?? 1) - 1)); });
    let cursor = await runtime.database.events.latestCursor() ?? { createdAt: new Date().toISOString(), id: "" };
    let busy = false, stopped = false;
    const timer = setInterval(async () => {
      if (busy || stopped) return; busy = true;
      try {
        const access = await authorize();
        const events = await runtime.database.events.readAfter(cursor, 100);
        for (const event of events) {
          const allowed = access.appId ? (event.appId ?? "default") === access.appId : access.user?.role === "admin" || access.user?.appIds?.includes(event.appId ?? "default");
          if (allowed && socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "decision", data: visible(event, access.user), notify: event.action !== "allow" }));
          cursor = { createdAt: event.createdAt, id: event.id };
        }
      } catch { socket.close(1008, "Access revoked or expired"); stop(); }
      finally { busy = false; }
    }, 500);
    timer.unref();
    const stop = () => { stopped = true; clearInterval(timer); stops.delete(stop); };
    stops.add(stop); socket.on("close", stop); if (socket.readyState !== socket.OPEN) stop();
  };
  app.get("/ws", { websocket: true }, (socket, request) => {
    if (!admit(socket)) return;
    if (request.headers.origin && request.headers.origin !== new URL(store.config.publicUrl).origin) { socket.close(1008, "Origin not permitted"); return; }
    void (async () => {
      const selected = (request.query as { organization?: string }).organization;
      const authorize = async () => { const ctx = await store.resolve(request.cookies.pf_session, selected); if (!ctx.organization) throw new Error("Select an organization."); return { user: ctx.user }; };
      try { const { user } = await authorize(); const runtime = await runtimes.get(user.organizationId!); await start(socket, runtime, authorize); socket.send(JSON.stringify({ type: "connected" })); }
      catch { socket.close(1008, "Authentication required"); }
    })();
  });
  app.get("/v1/events", { websocket: true }, (socket) => {
    if (!admit(socket)) return;
    let authenticating = false;
    const timeout = setTimeout(() => socket.close(1008, "Authentication timed out"), 5000);
    socket.on("close", () => clearTimeout(timeout)); socket.send(JSON.stringify({ type: "auth.required" }));
    socket.on("message", (raw) => { if (authenticating) return; authenticating = true;
      void (async () => {
        try {
          const message = JSON.parse(raw.toString()) as { type?: string; apiKey?: string };
          if (message.type !== "auth") throw new Error("Invalid authentication.");
          const authorize = async () => {
            const { runtime, key } = await runtimes.authenticateKey(message.apiKey);
            const apps = await runtime.database.document<import("@pyro/contracts").AppRecord[]>("apps", () => []).read();
            if (!apps.some((a) => a.id === (key.appId ?? "default") && a.enabled)) throw new Error("Application disabled.");
            return { appId: key.appId ?? "default" };
          };
          await authorize(); const { runtime } = await runtimes.authenticateKey(message.apiKey); clearTimeout(timeout);
          await start(socket, runtime, authorize); socket.send(JSON.stringify({ type: "auth.ok" }));
        } catch { socket.close(1008, "Authentication failed"); }
      })();
    });
  });
  app.addHook("onClose", async () => { for (const stop of [...stops]) stop(); });
}

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import Fastify, { LogController, type FastifyRequest, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { openDatabase, consumeQuota, decryptText } from "@pyro/storage";
import type { AppRecord, ClassificationEvent } from "@pyro/contracts";
import { Billing } from "./billing.js";
import { Runtimes } from "./runtime.js";
import { CloudStore, CloudError, hash, token, passwordHash, verifyPassword, projectUser, type Role, type IdentityState } from "./store.js";
import type { CloudConfig } from "./config.js";
import { registerStreams } from "./streams.js";
const email = z.string().trim().email().max(254).transform((s) => s.toLowerCase());
const password = z.string().min(12).max(128);
const role = z.enum(["admin", "operator", "reviewer", "viewer"]);
const equal = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
export async function buildCloud(config: CloudConfig) {
  const app = Fastify({ bodyLimit: 2_000_000, logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization", "req.headers.cookie"] }, logController: new LogController({ disableRequestLogging: true }), trustProxy: config.trustProxy ?? false });
  await app.register(cookie); await app.register(websocket, { options: { maxPayload: 4096 } });
  // Preserve exact signed webhook bytes before parsing JSON.
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_request, body, done) => done(null, body));
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    request.rawBody = String(body);
    try { done(null, body ? JSON.parse(String(body)) : {}); } catch { done(new CloudError(400, "Invalid JSON."), undefined); }
  });
  const platform = await openDatabase(config.databaseUrl, "platform");
  const store = new CloudStore(platform, config); await store.migrateLegacy();
  const billing = new Billing(store), runtimes = new Runtimes(store, billing);
  const context = (request: FastifyRequest) => store.resolve(request.cookies.pf_session, typeof request.headers["x-pyro-organization"] === "string" ? request.headers["x-pyro-organization"] : typeof (request.query as { organization?: unknown }).organization === "string" ? (request.query as { organization: string }).organization : undefined);
  const authorized = async (request: FastifyRequest, roles?: Role[]) => {
    const ctx = await context(request);
    if (!ctx.organization || !ctx.membership) throw new CloudError(409, "Create or select an organization first.");
    if (roles && !roles.includes(ctx.membership.role)) throw new CloudError(403, "Your organization role does not permit this action.");
    return { ...ctx, organization: ctx.organization, membership: ctx.membership };
  };
  const assertMembership = (state: IdentityState, orgId: string, userId: string, roles: Role[]) => {
    if (!state.organizations.some((o) => o.id === orgId && o.status === "active") || !state.memberships.some((m) => m.orgId === orgId && m.userId === userId && !m.disabled && roles.includes(m.role))) throw new CloudError(403, "Your organization permission has changed.");
  };
  const eraseOrganization = async (orgId: string) => {
    await runtimes.retire(orgId);
    const db = await openDatabase(config.databaseUrl, orgId); try { await db.erase(); } finally { await db.close(); }
    await store.identity.update((state) => { state.organizations.find((o) => o.id === orgId)!.erasedAt = new Date().toISOString(); return state; });
  };
  const platformOnly = (request: FastifyRequest) => { if (!equal(request.headers.authorization ?? "", `Bearer ${config.platformToken}`)) throw new CloudError(401, "Platform authentication required."); };
  const audit = async (orgId: string, userId: string, action: string) => {
    const db = await openDatabase(config.databaseUrl, orgId);
    try { await db.document<Array<object>>("audit_log", () => []).update((rows) => [...rows.slice(-9999), { id: randomUUID(), actorId: userId, at: new Date().toISOString(), action, resource: "/api/organizations", status: 200 }]); } finally { await db.close(); }
  };
  const setSession = async (reply: FastifyReply, userId: string) => {
    const raw = token(); let orgId: string | undefined;
    await store.identity.update((state) => { orgId = state.memberships.find((m) => m.userId === userId && !m.disabled && state.organizations.some((o) => o.id === m.orgId && o.status === "active"))?.orgId;
      state.sessions = [...state.sessions.filter((s) => s.expiresAt > Date.now() && s.userId !== userId), ...state.sessions.filter((s) => s.expiresAt > Date.now() && s.userId === userId).slice(-4), { hash: hash(raw), userId, orgId, expiresAt: Date.now() + 86400_000 }]; return state; });
    reply.setCookie("pf_session", raw, { path: "/", httpOnly: true, secure: new URL(config.publicUrl).protocol === "https:", sameSite: "strict", maxAge: 86400 });
    return store.resolve(raw, orgId);
  };
  const who = (ctx: Awaited<ReturnType<typeof context>>) => ({ user: ctx.user, cloud: true, organizationId: ctx.organization?.id,
    organizations: ctx.state.organizations.filter((o) => o.status === "active" && ctx.state.memberships.some((m) => m.orgId === o.id && m.userId === ctx.account.id && !m.disabled)) });
  app.setErrorHandler((error, _request, reply) => { const status = (error as { statusCode?: number }).statusCode ?? (error instanceof z.ZodError ? 400 : 500); if (status >= 500) app.log.error({ err: error }, "Cloud request failed"); return reply.code(status).send({ error: status >= 500 ? "Service temporarily unavailable." : error instanceof z.ZodError ? error.issues[0]?.message : (error as Error).message }); });
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/") && !["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin && request.headers.origin !== new URL(config.publicUrl).origin) return reply.code(403).send({ error: "Origin is not permitted." });
    if (request.url.startsWith("/api/") && !request.url.startsWith("/api/billing/webhook")) {
      const quota = await consumeQuota(platform, [{ id: `dashboard-ip:${hash(request.ip)}`, limit: 300 }]);
      if (!quota.allowed) return reply.code(429).header("Retry-After", "60").send({ error: "Dashboard request limit exceeded. Try again shortly." });
    }
    if (request.url.startsWith("/api/auth/")) {
      const quota = await consumeQuota(platform, [{ id: `auth:${hash(request.ip)}`, limit: 30 }]);
      if (!quota.allowed) return reply.code(429).header("Retry-After", "60").send({ error: "Too many authentication attempts. Try again shortly." });
    }
  });
  app.addHook("preValidation", async (request) => {
    let path: string; try { path = decodeURIComponent(request.url.split("?")[0]!); } catch { throw new CloudError(400, "Invalid request path."); }
    if (request.method === "POST" && ["/v1/classify", "/v1/jobs", "/api/classify"].includes(path!)) {
      const body = request.body as { metadata?: unknown; labels?: unknown } | undefined;
      if (Buffer.byteLength(JSON.stringify({ metadata: body?.metadata, labels: body?.labels })) > 4096) throw new CloudError(413, "Cloud metadata and labels must fit within 4 KB.");
    }
  });
  app.get("/health", async () => { await platform.ping(); return { status: "ok", mode: "cloud" }; });
  app.get("/v1/health", async () => { await platform.ping(); return { status: "ok" }; });
  app.get("/api/auth/options", async () => ({ cloud: true, oidc: false, signup: true }));
  app.get("/api/auth/me", async (request) => who(await context(request)));
  app.post("/api/auth/signup", async (request, reply) => {
    const body = z.object({ email, password }).parse(request.body);
    const digest = await passwordHash(body.password); const raw = token(); let userId: string | undefined;
    await store.identity.update((state) => {
      if (state.accounts.some((a) => a.email === body.email || a.username === body.email)) return state;
      if (state.accounts.length >= config.maxOrganizations * 20) throw new CloudError(409, "The beta is at account capacity. Contact support.");
      state.tokens = state.tokens.filter((t) => t.expiresAt > Date.now());
      userId = randomUUID(); state.accounts.push({ id: userId, email: body.email, username: body.email, passwordHash: digest, verified: false, createdAt: new Date().toISOString() });
      state.tokens.push({ hash: hash(raw), userId, kind: "verify", expiresAt: Date.now() + 86400_000 }); return state;
    });
    if (userId) await store.mail(body.email, "Verify your Pyro account", `${config.publicUrl}/?verify=${raw}`);
    return reply.code(202).send({ message: "Check your email to verify your account. Existing accounts can sign in or recover access." });
  });
  app.post("/api/auth/verify", async (request, reply) => {
    const body = z.object({ token: z.string().max(200) }).parse(request.body); let userId: string | undefined;
    await store.identity.update((state) => { const item = state.tokens.find((t) => t.hash === hash(body.token) && t.kind === "verify" && t.expiresAt > Date.now());
      if (!item) throw new CloudError(400, "Verification link is invalid or expired."); userId = item.userId;
      const account = state.accounts.find((a) => a.id === userId)!; account.verified = true;
      state.tokens = state.tokens.filter((t) => t.hash !== item.hash); return state; });
    return who(await setSession(reply, userId!));
  });
  app.post("/api/auth/login", async (request, reply) => {
    const body = z.object({ username: z.string().min(1).max(254), password: z.string().max(128) }).parse(request.body);
    const account = (await store.identity.read()).accounts.find((a) => a.username === body.username.toLowerCase() && a.verified && !a.disabled);
    if (!account || !await verifyPassword(body.password, account.passwordHash)) throw new CloudError(401, "Invalid credentials or account not verified.");
    return who(await setSession(reply, account.id));
  });
  app.post("/api/auth/logout", async (request, reply) => {
    const digest = hash(request.cookies.pf_session ?? ""); await store.identity.update((state) => { state.sessions = state.sessions.filter((s) => s.hash !== digest); return state; });
    reply.clearCookie("pf_session", { path: "/" }); return { ok: true };
  });
  app.post("/api/auth/recover", async (request) => {
    const body = z.object({ email, kind: z.enum(["reset", "verify"]).default("reset") }).parse(request.body);
    const account = (await store.identity.read()).accounts.find((a) => a.email === body.email && !a.disabled);
    if (account && (body.kind === "reset" || !account.verified)) { const raw = token(); await store.identity.update((state) => { state.tokens = state.tokens.filter((t) => t.expiresAt > Date.now() && !(t.userId === account.id && t.kind === body.kind)); state.tokens.push({ hash: hash(raw), userId: account.id, kind: body.kind, expiresAt: Date.now() + 3600_000 }); return state; });
      await store.mail(account.email, body.kind === "reset" ? "Reset your Pyro password" : "Verify your Pyro account", `${config.publicUrl}/?${body.kind}=${raw}`); }
    return { message: "If the account exists, an email is on its way." };
  });
  app.post("/api/auth/reset", async (request) => {
    const body = z.object({ token: z.string().max(200), password }).parse(request.body), digest = await passwordHash(body.password);
    await store.identity.update((state) => { const item = state.tokens.find((t) => t.hash === hash(body.token) && t.kind === "reset" && t.expiresAt > Date.now()); if (!item) throw new CloudError(400, "Reset link is invalid or expired.");
      const account = state.accounts.find((a) => a.id === item.userId)!; account.passwordHash = digest; account.verified = true;
      state.sessions = state.sessions.filter((s) => s.userId !== account.id); state.tokens = state.tokens.filter((t) => t.userId !== account.id); return state; }); return { ok: true };
  });
  app.get("/api/organizations", async (request) => who(await context(request)));
  app.post("/api/organizations", async (request, reply) => {
    const ctx = await context(request), body = z.object({ name: z.string().trim().min(2).max(100) }).parse(request.body);
    const organization = { id: randomUUID(), name: body.name, status: "active" as const, createdAt: new Date().toISOString() };
    await store.identity.update((state) => { if (state.organizations.length >= config.maxOrganizations * 10) throw new CloudError(409, "Organization creation limit reached. Contact support."); if (state.organizations.filter((o) => o.status !== "deleted").length >= config.maxOrganizations) throw new CloudError(409, "The beta is at capacity. Contact support.");
      if (state.memberships.filter((m) => m.userId === ctx.account.id && m.role === "owner" && state.organizations.some((o) => o.id === m.orgId && o.status !== "deleted")).length >= 3) throw new CloudError(409, "You can own up to three beta organizations.");
      state.organizations.push(organization); state.memberships.push({ orgId: organization.id, userId: ctx.account.id, role: "owner", appIds: [], rawPreviews: true });
      const session = state.sessions.find((s) => s.hash === ctx.session.hash)!; session.orgId = organization.id; return state; });
    if (config.trialCredits) await billing.grant(organization.id, config.trialCredits, `trial:${ctx.account.id}`);
    await runtimes.get(organization.id); await audit(organization.id, ctx.account.id, "organization.created");
    return reply.code(201).send({ organization });
  });
  app.post("/api/organizations/select", async (request) => {
    const body = z.object({ orgId: z.string() }).parse(request.body); const ctx = await store.resolve(request.cookies.pf_session, body.orgId);
    await store.identity.update((state) => { const session = state.sessions.find((s) => s.hash === ctx.session.hash)!; session.orgId = body.orgId; return state; }); return who(ctx);
  });
  app.put("/api/organizations/current", async (request) => {
    const ctx = await authorized(request, ["owner"]), body = z.object({ name: z.string().trim().min(2).max(100) }).parse(request.body);
    await store.identity.update((state) => { assertMembership(state, ctx.organization.id, ctx.account.id, ["owner"]); state.organizations.find((o) => o.id === ctx.organization.id)!.name = body.name; return state; });
    await audit(ctx.organization.id, ctx.account.id, "organization.renamed"); return { ok: true };
  });
  app.post("/api/organizations/transfer", async (request) => {
    const ctx = await authorized(request, ["owner"]), body = z.object({ userId: z.string() }).parse(request.body);
    await store.identity.update((state) => {
      const owner = state.memberships.find((m) => m.orgId === ctx.organization.id && m.userId === ctx.account.id && m.role === "owner" && !m.disabled);
      const next = state.memberships.find((m) => m.orgId === ctx.organization.id && m.userId === body.userId && !m.disabled);
      if (!owner || !next || next.userId === owner.userId) throw new CloudError(409, "Choose another active organization member.");
      owner.role = "admin"; next.role = "owner"; return state;
    }); await audit(ctx.organization.id, ctx.account.id, "ownership.transferred"); return { ok: true };
  });
  app.get("/api/organizations/export", async (request, reply) => {
    const ctx = await authorized(request, ["owner"]), { database } = await runtimes.get(ctx.organization.id);
    const documents: Record<string, unknown> = {};
    for (const name of ["apps", "profiles", "reviews", "audit_log"]) documents[name] = await database.document(name, () => []).read();
    documents.datasets = (await database.document<Array<{ cases: import("@pyro/contracts").StoredSecret; expiresAt: string }>>("evaluation_datasets", () => []).read()).filter((d) => Date.parse(d.expiresAt) > Date.now()).map(({ cases, ...rest }) => ({ ...rest, cases: JSON.parse(decryptText(cases, config.secret)) }));
    documents.evaluations = (await database.document<Array<{ credential?: unknown; expiresAt: string }>>("evaluation_runs", () => []).read()).filter((r) => Date.parse(r.expiresAt) > Date.now()).map(({ credential, ...rest }) => rest);
    documents.integrations = (await database.document<Array<{ destination: unknown; signingSecret?: unknown }>>("integrations", () => []).read()).map(({ destination, signingSecret, ...rest }) => rest);
    documents.memberships = await store.members(ctx.organization.id);
    documents.billing = await billing.summary(ctx.organization.id);
    const offset = z.coerce.number().int().min(0).default(0).parse((request.query as { offset?: string }).offset);
    const events = await database.events.query({ limit: 10000, offset });
    return reply.header("Content-Disposition", 'attachment; filename="pyro-organization.json"').send({ organization: ctx.organization, documents, events: events.events, totalEvents: events.total, pageSize: 10000 });
  });
  app.delete("/api/organizations/current", async (request) => {
    const ctx = await authorized(request, ["owner"]), body = z.object({ confirmation: z.string() }).parse(request.body);
    if (body.confirmation !== ctx.organization.name) throw new CloudError(400, "Enter the organization name to confirm deletion.");
    // Stop admission before draining workers, then erase only this tenant's operational data.
    await store.identity.update((state) => { assertMembership(state, ctx.organization.id, ctx.account.id, ["owner"]); state.organizations.find((o) => o.id === ctx.organization.id)!.status = "deleted"; state.memberships = state.memberships.filter((m) => m.orgId !== ctx.organization.id); state.invitations = state.invitations.filter((i) => i.orgId !== ctx.organization.id); state.sessions = state.sessions.map((s) => s.orgId === ctx.organization.id ? { ...s, orgId: undefined } : s); return state; });
    await eraseOrganization(ctx.organization.id);
    return { ok: true, message: "Organization data deleted. Payment records and expiring backups follow the operator’s retention policy." };
  });
  app.get("/api/team", async (request) => { const ctx = await authorized(request, ["owner", "admin"]); return { users: await store.members(ctx.organization.id), cloud: true, oidcConfigured: false, invitations: ctx.state.invitations.filter((i) => i.orgId === ctx.organization.id && i.expiresAt > Date.now()).map(({ hash: _hash, ...rest }) => rest) }; });
  app.post("/api/invitations", async (request, reply) => {
    const ctx = await authorized(request, ["owner", "admin"]); const body = z.object({ email, role, appIds: z.array(z.string()).max(100).default([]), rawPreviews: z.boolean().default(false) }).parse(request.body);
    const runtime = await runtimes.get(ctx.organization.id); const apps = await runtime.database.document<AppRecord[]>("apps", () => []).read();
    if (body.appIds.some((id) => !apps.some((a) => a.id === id))) throw new CloudError(400, "An application grant is invalid.");
    const raw = token(); await store.identity.update((state) => { assertMembership(state, ctx.organization.id, ctx.account.id, ["owner", "admin"]); if (state.invitations.filter((i) => i.orgId === ctx.organization.id && i.expiresAt > Date.now()).length >= 50 || state.memberships.filter((m) => m.orgId === ctx.organization.id).length >= 50) throw new CloudError(409, "Organization member limit reached."); state.invitations = state.invitations.filter((i) => i.expiresAt > Date.now() && !(i.orgId === ctx.organization.id && i.email === body.email)); state.invitations.push({ ...body, hash: hash(raw), orgId: ctx.organization.id, expiresAt: Date.now() + 7 * 86400_000 }); return state; });
    await store.mail(body.email, `Join ${ctx.organization.name} on Pyro`, `${config.publicUrl}/?invite=${raw}`);
    await audit(ctx.organization.id, ctx.account.id, "member.invited"); return reply.code(201).send({ ok: true });
  });
  app.delete("/api/invitations", async (request) => {
    const ctx = await authorized(request, ["owner", "admin"]), body = z.object({ email }).parse(request.body);
    await store.identity.update((state) => { assertMembership(state, ctx.organization.id, ctx.account.id, ["owner", "admin"]); state.invitations = state.invitations.filter((i) => i.orgId !== ctx.organization.id || i.email !== body.email); return state; });
    await audit(ctx.organization.id, ctx.account.id, "invitation.revoked"); return { ok: true };
  });
  app.post("/api/invitations/accept", async (request) => {
    const ctx = await context(request); const body = z.object({ token: z.string().max(200) }).parse(request.body);
    await store.identity.update((state) => { const invitation = state.invitations.find((i) => i.hash === hash(body.token) && i.expiresAt > Date.now() && i.email === ctx.account.email);
      if (!invitation || !state.organizations.some((o) => o.id === invitation.orgId && o.status === "active")) throw new CloudError(400, "Invitation is invalid, expired, or belongs to another email address.");
      if (state.memberships.filter((m) => m.orgId === invitation.orgId).length >= 50) throw new CloudError(409, "Organization member limit reached.");
      if (!state.memberships.some((m) => m.orgId === invitation.orgId && m.userId === ctx.account.id)) state.memberships.push({ orgId: invitation.orgId, userId: ctx.account.id, role: invitation.role, appIds: invitation.appIds, rawPreviews: invitation.rawPreviews });
      state.invitations = state.invitations.filter((i) => i.hash !== invitation.hash); state.sessions.find((s) => s.hash === ctx.session.hash)!.orgId = invitation.orgId; return state; }); return { ok: true };
  });
  app.put<{ Params: { id: string } }>("/api/team/:id", async (request) => {
    const ctx = await authorized(request, ["owner", "admin"]); const body = z.object({ role, appIds: z.array(z.string()).max(100).default([]), rawPreviews: z.boolean().default(false), disabled: z.boolean().default(false) }).parse(request.body);
    const runtime = await runtimes.get(ctx.organization.id); const apps = await runtime.database.document<AppRecord[]>("apps", () => []).read();
    if (body.appIds.some((id) => !apps.some((a) => a.id === id))) throw new CloudError(400, "An application grant is invalid.");
    await store.identity.update((state) => { assertMembership(state, ctx.organization.id, ctx.account.id, ["owner", "admin"]); const member = state.memberships.find((m) => m.orgId === ctx.organization.id && m.userId === request.params.id);
      if (!member) throw new CloudError(404, "Member not found."); if (member.role === "owner" || member.userId === ctx.account.id) throw new CloudError(403, "The owner and your own membership cannot be changed here."); Object.assign(member, body); return state; });
    await audit(ctx.organization.id, ctx.account.id, "member.updated"); return { ok: true };
  });
  app.delete<{ Params: { id: string } }>("/api/team/:id/sessions", async (request) => {
    const ctx = await authorized(request, ["owner", "admin"]);
    // Revoke organization membership access, never another organization's sessions.
    await store.identity.update((state) => { assertMembership(state, ctx.organization.id, ctx.account.id, ["owner", "admin"]); const member = state.memberships.find((m) => m.orgId === ctx.organization.id && m.userId === request.params.id); if (!member) throw new CloudError(404, "Member not found."); if (member.role === "owner" || member.userId === ctx.account.id) throw new CloudError(403, "The owner and your own membership cannot be disabled here."); member.disabled = true; return state; });
    await audit(ctx.organization.id, ctx.account.id, "member.disabled"); return { ok: true };
  });
  app.get("/api/billing", async (request) => billing.summary((await authorized(request, ["owner", "admin"])).organization.id));
  app.post("/api/billing/order", async (request) => {
    const ctx = await authorized(request, ["owner"]);
    if (!config.razorpayKey || !config.razorpaySecret || !config.razorpayWebhookSecret) throw new CloudError(503, "Payments are not configured. Contact support.");
    const response = await fetch("https://api.razorpay.com/v1/orders", { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${config.razorpayKey}:${config.razorpaySecret}`).toString("base64")}`, "Content-Type": "application/json" }, body: JSON.stringify({ amount: config.packPricePaise, currency: "INR", receipt: randomUUID(), notes: { orgId: ctx.organization.id } }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new CloudError(502, "Payment provider is unavailable.");
    const order = z.object({ id: z.string(), amount: z.number(), currency: z.literal("INR") }).parse(await response.json());
    if (order.amount !== config.packPricePaise) throw new CloudError(502, "Payment amount mismatch.");
    await billing.orders.update((rows) => [...rows, { ...order, orgId: ctx.organization.id, credits: config.packCredits }]); return { ...order, key: config.razorpayKey };
  });
  app.post("/api/billing/webhook", async (request) => {
    const signature = request.headers["x-razorpay-signature"];
    if (!config.razorpayWebhookSecret || typeof signature !== "string" || !equal(signature, createHmac("sha256", config.razorpayWebhookSecret).update(request.rawBody ?? "").digest("hex"))) throw new CloudError(401, "Invalid payment signature.");
    const body = z.object({ event: z.string(), payload: z.unknown() }).parse(request.body);
    if (body.event !== "payment.captured") return { ok: true };
    const payment = z.object({ payment: z.object({ entity: z.object({ id: z.string(), order_id: z.string(), amount: z.number(), currency: z.string(), status: z.literal("captured") }) }) }).parse(body.payload).payment.entity;
    const order = (await billing.orders.read()).find((o) => o.id === payment.order_id);
    if (!order || order.amount !== payment.amount || order.currency !== payment.currency) throw new CloudError(400, "Unknown order or mismatched payment.");
    await billing.grant(order.orgId, order.credits, `payment-order:${order.id}`);
    await billing.orders.update((orders) => orders.map((o) => o.id === order.id ? { ...o, paid: true } : o)); return { ok: true };
  });
  app.post("/platform/credits", async (request) => { platformOnly(request); const body = z.object({ orgId: z.string(), credits: z.number().int().positive(), reference: z.string().min(8).max(200) }).parse(request.body); await billing.grant(body.orgId, body.credits, `manual:${body.reference}`); await audit(body.orgId, "platform", "credits.granted"); return { ok: true }; });
  app.put<{ Params: { id: string } }>("/platform/organizations/:id", async (request) => { platformOnly(request); const body = z.object({ status: z.enum(["active", "suspended"]) }).parse(request.body); await store.identity.update((state) => { const org = state.organizations.find((o) => o.id === request.params.id && o.status !== "deleted"); if (!org) throw new CloudError(404, "Organization not found."); org.status = body.status; return state; }); await runtimes.retire(request.params.id); await audit(request.params.id, "platform", `organization.${body.status}`); if (body.status === "active") await runtimes.get(request.params.id); return { ok: true }; });
  app.get("/platform/status", async (request) => { platformOnly(request); const state = await store.identity.read(), meter = await billing.meter.read(), eventStorage = await platform.document("cloud_event_budget", () => ({ month: "", total: 0, organizations: {} })).read(); return { organizations: state.organizations, eventStorage, provider: { month: meter.month, reservedMicros: meter.reservedMicros, attempts: meter.attempts, limitMicros: config.monthlyProviderBudgetMicros, reportedMicros: meter.reportedMicros, reportedInputTokens: meter.reportedInputTokens, reportedOutputTokens: meter.reportedOutputTokens, reportedCalls: meter.reportedCalls } }; });
  registerStreams(app, store, runtimes);
  app.all("/v1/*", async (request, reply) => {
    const raw = request.headers.authorization?.replace(/^Bearer /, ""); const { orgId, runtime } = await runtimes.authenticateKey(raw);
    if (!/^\/v1\/(classify|jobs(?:\/[^/]+)?|profiles)$/.test(request.url.split("?")[0]!)) throw new CloudError(404, "Endpoint not found.");
    const quota = await consumeQuota(platform, [{ id: `org:${orgId}`, limit: 120 }, { id: "cloud:requests", limit: 1000 }]);
    if (!quota.allowed) return reply.code(429).header("Retry-After", "60").send({ error: "Request limit exceeded." });
    const result = await runtime.gateway.inject({ method: request.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS", url: request.url, headers: request.headers, payload: request.body as object });
    for (const [key, value] of Object.entries(result.headers)) if (value !== undefined && !["content-length", "connection", "transfer-encoding"].includes(key)) reply.header(key, value);
    return reply.code(result.statusCode).send(result.body);
  });
  app.all("/api/*", async (request, reply) => {
    const ctx = await authorized(request); let path: string;
    try { path = decodeURIComponent(request.url.split("?")[0]!).replace(/\/+$/, ""); } catch { throw new CloudError(400, "Invalid request path."); }
    if (path.startsWith("/api/auth/") || path.startsWith("/api/team") && request.method !== "GET") throw new CloudError(404, "Use cloud account and membership endpoints.");
    if (path === "/api/settings/provider" && request.method !== "GET") throw new CloudError(403, "Classifier settings are managed by Pyro Cloud.");
    if (path === "/api/keys/cloud-playground") throw new CloudError(403, "This key is managed by the platform.");
    const body = request.body as { allowPrivateNetwork?: boolean } | undefined;
    if (path.startsWith("/api/integrations") && body?.allowPrivateNetwork) throw new CloudError(400, "Cloud webhooks require public HTTPS destinations.");
    const quota = await consumeQuota(platform, [{ id: `dashboard:${ctx.organization.id}`, limit: 300 }]);
    if (!quota.allowed) return reply.code(429).header("Retry-After", "60").send({ error: "Dashboard request limit exceeded." });
    const runtime = await runtimes.get(ctx.organization.id);
    const result = await runtime.control.inject({ method: request.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS", url: request.url, headers: request.headers, payload: request.body as object });
    if (path === "/api/keys" && request.method === "GET" && result.statusCode === 200) { const data = result.json(); data.keys = data.keys.filter((k: { id: string }) => k.id !== "cloud-playground"); return data; }
    for (const [key, value] of Object.entries(result.headers)) if (value !== undefined && !["content-length", "connection", "transfer-encoding"].includes(key)) reply.header(key, value);
    return reply.code(result.statusCode).send(result.body);
  });
  app.addHook("onClose", async () => { await runtimes.close(); await platform.close(); });
  // Eagerly recover outstanding work after a process restart, even without new requests.
  try {
    for (const org of (await store.identity.read()).organizations) {
      if (org.status === "deleted" && !org.erasedAt) await eraseOrganization(org.id);
      if (org.status === "active") await runtimes.get(org.id);
    }
  } catch (error) { await app.close(); throw error; }
  return app;
}
declare module "fastify" { interface FastifyRequest { rawBody?: string } }

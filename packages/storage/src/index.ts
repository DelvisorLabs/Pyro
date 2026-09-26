import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { ClassificationEvent, StoredSecret, Delivery } from "@pyro/contracts";

export interface DocumentStore<T> {
  read(): Promise<T>;
  write(value: T): Promise<void>;
  update(updater: (current: T) => T | Promise<T>): Promise<T>;
}

export interface EventStore {
  append(value: ClassificationEvent, deliveries?: Delivery[]): Promise<void>;
  readRecent(limit?: number): Promise<ClassificationEvent[]>;
  findById(id: string): Promise<ClassificationEvent | undefined>;
  query(options: EventQuery): Promise<EventQueryResult>;
  latestCursor(): Promise<EventCursor | undefined>;
  readAfter(cursor: EventCursor, limit?: number): Promise<ClassificationEvent[]>;
  overview(now?: Date, appIds?: string[]): Promise<EventOverview>;
  usage(options: EventUsageOptions): Promise<EventUsage>;
}

export interface EventCursor { createdAt: string; id: string }

export interface EventQuery {
  limit?: number;
  offset?: number;
  action?: string;
  verdict?: string;
  status?: string;
  profile?: string;
  provider?: string;
  apiKey?: string;
  appId?: string;
  appIds?: string[];
  from?: string;
  to?: string;
  minimumRisk?: number;
  labelKey?: string;
  labelValue?: string;
  search?: string;
  excludeRawSearch?: boolean;
}

export interface EventQueryResult {
  events: ClassificationEvent[];
  total: number;
  labelKeys: string[];
}

export interface EventOverview {
  from: string;
  to: string;
  totals: {
    requests: number;
    blocked: number;
    reviewed: number;
    failed: number;
    blockRate: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    p95QueueMs: number;
    p95ProviderMs: number;
    shadowChanges: number;
  };
  actions: Array<{ action: "allow" | "review" | "block"; count: number }>;
  detectors: Array<{ id: string; name: string; signals: number; averageProbability: number }>;
  timeline: Array<{ at: string; total: number; blocked: number; reviewed: number }>;
}

export interface EventUsageOptions {
  from: string;
  to: string;
  bucketMs: number;
  buckets: number;
  appId?: string;
  appIds?: string[];
}

export interface EventUsage {
  totals: {
    requests: number;
    allowed: number;
    reviewed: number;
    blocked: number;
    failed: number;
    providerCalls: number;
    localRuleDecisions: number;
    costs: Array<{ currency: string; amount: number }>;
    costReportedCalls: number;
    inputTokens: number;
    outputTokens: number;
    inputBytes: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
  };
  labels: { requests: number; keys: Array<{ key: string; requests: number }> };
  timeline: Array<{ at: string; requests: number; blocked: number; reviewed: number; providerCalls: number }>;
  byApp: Array<{ id: string; name: string; requests: number }>;
  byProvider: Array<{ id: string; requests: number }>;
  byPolicy: Array<{ id: string; requests: number }>;
  byApiKey: Array<{ id: string; requests: number }>;
}

export interface DeliveryStore {
  enqueue(delivery: Delivery): Promise<void>;
  claim(limit?: number, now?: Date): Promise<Delivery[]>;
  finish(delivery: Delivery): Promise<void>;
  list(integrationId?: string): Promise<Delivery[]>;
  retry(id: string): Promise<boolean>;
}

export interface Database {
  readonly kind: "postgresql" | "memory";
  document<T>(key: string, fallback: () => T): DocumentStore<T>;
  readonly events: EventStore;
  readonly deliveries: DeliveryStore;
  prune(before: string): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

const migrations = [
  `
    CREATE TABLE IF NOT EXISTS pyro_schema_migrations (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS pyro_documents (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS pyro_events (
      id text PRIMARY KEY,
      created_at timestamptz NOT NULL,
      app_id text,
      profile_id text NOT NULL,
      verdict text NOT NULL,
      action text NOT NULL,
      risk double precision NOT NULL,
      provider text NOT NULL,
      api_key_id text,
      labels jsonb NOT NULL DEFAULT '{}'::jsonb,
      payload jsonb NOT NULL
    );

    CREATE INDEX IF NOT EXISTS pyro_events_created_at_idx ON pyro_events (created_at DESC);
    CREATE INDEX IF NOT EXISTS pyro_events_app_created_idx ON pyro_events (app_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS pyro_events_profile_created_idx ON pyro_events (profile_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS pyro_events_action_created_idx ON pyro_events (action, created_at DESC);
    CREATE INDEX IF NOT EXISTS pyro_events_verdict_created_idx ON pyro_events (verdict, created_at DESC);
    CREATE INDEX IF NOT EXISTS pyro_events_provider_created_idx ON pyro_events (provider, created_at DESC);
    CREATE INDEX IF NOT EXISTS pyro_events_api_key_created_idx ON pyro_events (api_key_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS pyro_events_labels_idx ON pyro_events USING gin (labels);
  `,
  `CREATE TABLE IF NOT EXISTS pyro_deliveries (
    id text PRIMARY KEY, integration_id text NOT NULL, event_id text NOT NULL,
    created_at timestamptz NOT NULL, status text NOT NULL, next_attempt_at timestamptz NOT NULL,
    payload jsonb NOT NULL, UNIQUE (integration_id, event_id)
  );
  CREATE INDEX IF NOT EXISTS pyro_deliveries_due_idx ON pyro_deliveries(next_attempt_at) WHERE status IN ('pending', 'delivering');
  CREATE INDEX IF NOT EXISTS pyro_deliveries_integration_idx ON pyro_deliveries(integration_id, created_at DESC);`,
];

async function adoptLegacyTableNames(client: PoolClient): Promise<void> {
  const legacyPrefix = ["saro", "ma"].join("");
  const tables = ["schema_migrations", "documents", "events"];
  for (const suffix of tables) {
    const legacy = `${legacyPrefix}_${suffix}`;
    const current = `pyro_${suffix}`;
    const result = await client.query<{ legacy: string | null; current: string | null }>(
      "SELECT to_regclass($1) AS legacy, to_regclass($2) AS current",
      [`public.${legacy}`, `public.${current}`],
    );
    if (result.rows[0]?.legacy && !result.rows[0]?.current) {
      await client.query(`ALTER TABLE "${legacy}" RENAME TO "${current}"`);
    }
  }

  const indexSuffixes = ["created_at_idx", "app_created_idx", "profile_created_idx", "action_created_idx", "verdict_created_idx", "provider_created_idx", "api_key_created_idx", "labels_idx"];
  for (const suffix of indexSuffixes) {
    const legacy = `${legacyPrefix}_events_${suffix}`;
    const current = `pyro_events_${suffix}`;
    const result = await client.query<{ legacy: string | null; current: string | null }>(
      "SELECT to_regclass($1) AS legacy, to_regclass($2) AS current",
      [`public.${legacy}`, `public.${current}`],
    );
    if (result.rows[0]?.legacy && !result.rows[0]?.current) {
      await client.query(`ALTER INDEX "${legacy}" RENAME TO "${current}"`);
    }
  }
}

async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [1_934_203_841]);
    await adoptLegacyTableNames(client);
    await client.query("CREATE TABLE IF NOT EXISTS pyro_schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = new Set((await client.query<{ version: number }>("SELECT version FROM pyro_schema_migrations")).rows.map((row) => row.version));
    for (let index = 0; index < migrations.length; index += 1) {
      const version = index + 1;
      if (applied.has(version)) continue;
      await client.query(migrations[index]!);
      await client.query("INSERT INTO pyro_schema_migrations (version) VALUES ($1)", [version]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

class PostgresDocument<T> implements DocumentStore<T> {
  constructor(
    private readonly pool: Pool,
    private readonly key: string,
    private readonly fallback: () => T,
  ) {}

  private async initialize(client: Pool | PoolClient): Promise<T> {
    const initial = this.fallback();
    await client.query(
      "INSERT INTO pyro_documents (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING",
      [this.key, JSON.stringify(initial)],
    );
    const result = await client.query<{ value: T }>("SELECT value FROM pyro_documents WHERE key = $1", [this.key]);
    return result.rows[0]?.value ?? initial;
  }

  async read(): Promise<T> {
    const result = await this.pool.query<{ value: T }>("SELECT value FROM pyro_documents WHERE key = $1", [this.key]);
    return result.rows[0]?.value ?? this.initialize(this.pool);
  }

  async write(value: T): Promise<void> {
    await this.pool.query(
      `INSERT INTO pyro_documents (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [this.key, JSON.stringify(value)],
    );
  }

  async update(updater: (current: T) => T | Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.initialize(client);
      const locked = await client.query<{ value: T }>("SELECT value FROM pyro_documents WHERE key = $1 FOR UPDATE", [this.key]);
      const updated = await updater(locked.rows[0]!.value);
      await client.query("UPDATE pyro_documents SET value = $2::jsonb, updated_at = now() WHERE key = $1", [this.key, JSON.stringify(updated)]);
      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

class PostgresEvents implements EventStore {
  constructor(private readonly pool: Pool) {}

  private where(options: EventQuery): { sql: string; values: unknown[] } {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const add = (clause: (parameter: string) => string, value: unknown) => {
      values.push(value);
      clauses.push(clause(`$${values.length}`));
    };
    if (options.action) add((p) => `action = ${p}`, options.action);
    if (options.verdict) add((p) => `verdict = ${p}`, options.verdict);
    if (options.status === "flagged") clauses.push("verdict IN ('suspicious', 'unsafe')");
    else if (options.status === "suspicious") clauses.push("verdict = 'suspicious'");
    else if (options.status === "blocked") clauses.push("action = 'block'");
    else if (options.status === "safe") clauses.push("verdict = 'safe'");
    if (options.profile) add((p) => `profile_id = ${p}`, options.profile);
    if (options.provider) add((p) => `provider = ${p}`, options.provider);
    if (options.apiKey) add((p) => `api_key_id = ${p}`, options.apiKey);
    if (options.appIds) add((p) => `COALESCE(app_id, 'default') = ANY(${p}::text[])`, options.appIds);
    if (options.appId) add((p) => `COALESCE(app_id, 'default') = ${p}`, options.appId);
    if (options.from) add((p) => `created_at >= ${p}::timestamptz`, options.from);
    if (options.to) add((p) => `created_at <= ${p}::timestamptz`, options.to);
    if (options.minimumRisk !== undefined && Number.isFinite(options.minimumRisk)) add((p) => `risk >= ${p}`, options.minimumRisk);
    if (options.labelKey) add((p) => `labels ? ${p}`, options.labelKey);
    if (options.labelValue) {
      const pattern = `%${options.labelValue}%`;
      if (options.labelKey) {
        values.push(options.labelKey, pattern);
        clauses.push(`COALESCE(labels ->> $${values.length - 1}, '') ILIKE $${values.length}`);
      } else {
        add((p) => `EXISTS (SELECT 1 FROM jsonb_each_text(labels) AS label WHERE label.value ILIKE ${p})`, pattern);
      }
    }
    if (options.search) {
      add((p) => `concat_ws(' ', id, payload->>'requestId', payload->>'inputHash', payload->>'apiKeyName', ${options.excludeRawSearch ? "NULL" : "payload->>'inputPreview'"}, payload->>'reason', labels::text) ILIKE ${p}`, `%${options.search}%`);
    }
    return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
  }

  async append(event: ClassificationEvent, deliveries: Delivery[] = []): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO pyro_events
        (id, created_at, app_id, profile_id, verdict, action, risk, provider, api_key_id, labels, payload)
       VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [event.id, event.createdAt, event.appId ?? null, event.profileId, event.verdict, event.action, event.risk,
        event.provider, event.apiKeyId ?? null, JSON.stringify(event.labels ?? {}), JSON.stringify(event)],
    );
      if (inserted.rowCount) for (const delivery of deliveries) await insertDelivery(client, delivery);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async readRecent(limit = 100): Promise<ClassificationEvent[]> {
    const safeLimit = Math.max(1, Math.min(100_000, Math.floor(limit)));
    const result = await this.pool.query<{ payload: ClassificationEvent }>(
      "SELECT payload FROM pyro_events ORDER BY created_at DESC, id DESC LIMIT $1",
      [safeLimit],
    );
    return result.rows.map((row) => row.payload);
  }

  async findById(id: string): Promise<ClassificationEvent | undefined> {
    const result = await this.pool.query<{ payload: ClassificationEvent }>("SELECT payload FROM pyro_events WHERE id = $1", [id]);
    return result.rows[0]?.payload;
  }

  async query(options: EventQuery): Promise<EventQueryResult> {
    const where = this.where(options);
    const limit = options.limit === undefined ? undefined : Math.max(1, Math.min(10_000, Math.floor(options.limit)));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const pageValues = [...where.values];
    let pageSql = "";
    if (limit !== undefined) {
      pageValues.push(limit, offset);
      pageSql = ` LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`;
    }
    const [rows, count, labels] = await Promise.all([
      this.pool.query<{ payload: ClassificationEvent }>(`SELECT payload FROM pyro_events ${where.sql} ORDER BY created_at DESC, id DESC${pageSql}`, pageValues),
      this.pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM pyro_events ${where.sql}`, where.values),
      this.pool.query<{ key: string }>(`SELECT DISTINCT key FROM pyro_events CROSS JOIN LATERAL jsonb_object_keys(labels) AS key ${where.sql} ORDER BY key`, where.values),
    ]);
    return {
      events: rows.rows.map((row) => row.payload),
      total: Number(count.rows[0]?.total ?? 0),
      labelKeys: labels.rows.map((row) => row.key),
    };
  }

  async latestCursor(): Promise<EventCursor | undefined> {
    const result = await this.pool.query<{ id: string; created_at: Date }>("SELECT id, created_at FROM pyro_events ORDER BY created_at DESC, id DESC LIMIT 1");
    const row = result.rows[0];
    return row ? { id: row.id, createdAt: row.created_at.toISOString() } : undefined;
  }

  async readAfter(cursor: EventCursor, limit = 500): Promise<ClassificationEvent[]> {
    const safeLimit = Math.max(1, Math.min(10_000, Math.floor(limit)));
    const result = await this.pool.query<{ payload: ClassificationEvent }>(
      "SELECT payload FROM pyro_events WHERE (created_at, id) > ($1::timestamptz, $2) ORDER BY created_at ASC, id ASC LIMIT $3",
      [cursor.createdAt, cursor.id, safeLimit],
    );
    return result.rows.map((row) => row.payload);
  }

  async overview(now = new Date(), appIds?: string[]): Promise<EventOverview> {
    const bucketMs = 2 * 60 * 60_000;
    const toMs = Math.ceil(now.getTime() / bucketMs) * bucketMs;
    const fromMs = toMs - 12 * bucketMs;
    const from = new Date(fromMs).toISOString();
    const to = new Date(toMs).toISOString();
    const values: unknown[] = [from, to, appIds ?? null];
    const windowSql = "WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz AND ($3::text[] IS NULL OR COALESCE(app_id, 'default') = ANY($3))";
    const [totalsResult, actionsResult, detectorsResult, timelineResult] = await Promise.all([
      this.pool.query<{
        requests: number; blocked: number; reviewed: number; failed: number;
        p50_latency: number | null; p95_latency: number | null; p99_latency: number | null;
        p95_queue: number | null; p95_provider: number | null; shadow_changes: number;
      }>(`
        SELECT count(*)::int AS requests,
          count(*) FILTER (WHERE action = 'block')::int AS blocked,
          count(*) FILTER (WHERE action = 'review')::int AS reviewed,
          count(*) FILTER (WHERE NULLIF(payload->>'error', '') IS NOT NULL)::int AS failed,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY (payload->>'latencyMs')::double precision) AS p50_latency,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY (payload->>'latencyMs')::double precision) AS p95_latency,
          percentile_cont(0.99) WITHIN GROUP (ORDER BY (payload->>'latencyMs')::double precision) AS p99_latency,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY COALESCE((payload->>'queueMs')::double precision, 0)) AS p95_queue,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY COALESCE((payload#>>'{timings,providerMs}')::double precision, (payload->>'latencyMs')::double precision)) AS p95_provider,
          COALESCE(sum((SELECT count(*) FROM jsonb_array_elements(COALESCE(payload->'shadows', '[]'::jsonb)) shadow WHERE COALESCE((shadow->>'changed')::boolean, false))), 0)::int AS shadow_changes
        FROM pyro_events ${windowSql}`, values),
      this.pool.query<{ action: "allow" | "review" | "block"; count: number }>(
        `SELECT action, count(*)::int AS count FROM pyro_events ${windowSql} GROUP BY action ORDER BY action`, values,
      ),
      this.pool.query<{ id: string; name: string; signals: number; average_probability: number }>(`
        SELECT detector->>'id' AS id, max(detector->>'name') AS name,
          count(*) FILTER (WHERE (detector->>'probability')::double precision >= 0.5)::int AS signals,
          avg((detector->>'probability')::double precision) AS average_probability
        FROM pyro_events
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(payload->'detectors', '[]'::jsonb)) detector
        ${windowSql}
        GROUP BY detector->>'id'
        ORDER BY signals DESC`, values),
      this.pool.query<{ bucket: number; total: number; blocked: number; reviewed: number }>(`
        SELECT floor((extract(epoch FROM created_at) * 1000 - $4) / $5)::int AS bucket,
          count(*)::int AS total,
          count(*) FILTER (WHERE action = 'block')::int AS blocked,
          count(*) FILTER (WHERE action = 'review')::int AS reviewed
        FROM pyro_events ${windowSql}
        GROUP BY bucket ORDER BY bucket`, [...values, fromMs, bucketMs]),
    ]);
    const raw = totalsResult.rows[0];
    const requests = Number(raw?.requests ?? 0);
    const timelineMap = new Map(timelineResult.rows.map((row) => [Number(row.bucket), row]));
    return {
      from, to,
      totals: {
        requests,
        blocked: Number(raw?.blocked ?? 0),
        reviewed: Number(raw?.reviewed ?? 0),
        failed: Number(raw?.failed ?? 0),
        blockRate: requests ? Number(raw?.blocked ?? 0) / requests : 0,
        p50LatencyMs: Number(raw?.p50_latency ?? 0),
        p95LatencyMs: Number(raw?.p95_latency ?? 0),
        p99LatencyMs: Number(raw?.p99_latency ?? 0),
        p95QueueMs: Number(raw?.p95_queue ?? 0),
        p95ProviderMs: Number(raw?.p95_provider ?? 0),
        shadowChanges: Number(raw?.shadow_changes ?? 0),
      },
      actions: actionsResult.rows.map((row) => ({ action: row.action, count: Number(row.count) })),
      detectors: detectorsResult.rows.map((row) => ({ id: row.id, name: row.name, signals: Number(row.signals), averageProbability: Number(row.average_probability) })),
      timeline: Array.from({ length: 12 }, (_, bucket) => {
        const row = timelineMap.get(bucket);
        return { at: new Date(fromMs + bucket * bucketMs).toISOString(), total: Number(row?.total ?? 0), blocked: Number(row?.blocked ?? 0), reviewed: Number(row?.reviewed ?? 0) };
      }),
    };
  }

  async usage(options: EventUsageOptions): Promise<EventUsage> {
    const fromMs = new Date(options.from).getTime();
    const whereValues: unknown[] = [options.from, options.to];
    let whereSql = "WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz";
    if (options.appIds) {
      whereValues.push(options.appIds);
      whereSql += ` AND COALESCE(app_id, 'default') = ANY($${whereValues.length}::text[])`;
    }
    if (options.appId) {
      whereValues.push(options.appId);
      whereSql += ` AND COALESCE(app_id, 'default') = $${whereValues.length}`;
    }
    const [totalsResult, costsResult, labelTotalsResult, labelKeysResult, timelineResult, appsResult, providersResult, policiesResult, keysResult] = await Promise.all([
      this.pool.query<{
        requests: number; allowed: number; reviewed: number; blocked: number; failed: number;
        provider_calls: number; local_decisions: number; cost_reported: number; input_tokens: string;
        output_tokens: string; input_bytes: string; average_latency: number | null; p95_latency: number | null;
      }>(`
        SELECT count(*)::int AS requests,
          count(*) FILTER (WHERE action = 'allow')::int AS allowed,
          count(*) FILTER (WHERE action = 'review')::int AS reviewed,
          count(*) FILTER (WHERE action = 'block')::int AS blocked,
          count(*) FILTER (WHERE NULLIF(payload->>'error', '') IS NOT NULL)::int AS failed,
          count(*) FILTER (WHERE provider <> 'local-rules')::int AS provider_calls,
          count(*) FILTER (WHERE provider = 'local-rules')::int AS local_decisions,
          count(*) FILTER (WHERE provider <> 'local-rules' AND payload#>'{usage,cost}' IS NOT NULL)::int AS cost_reported,
          COALESCE(sum(COALESCE((payload#>>'{usage,inputTokens}')::bigint, 0)), 0)::text AS input_tokens,
          COALESCE(sum(COALESCE((payload#>>'{usage,outputTokens}')::bigint, 0)), 0)::text AS output_tokens,
          COALESCE(sum(COALESCE((payload->>'inputBytes')::bigint, 0)), 0)::text AS input_bytes,
          avg((payload->>'latencyMs')::double precision) AS average_latency,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY (payload->>'latencyMs')::double precision) AS p95_latency
        FROM pyro_events ${whereSql}`, whereValues),
      this.pool.query<{ currency: string; amount: number }>(`
        SELECT payload#>>'{usage,cost,currency}' AS currency,
          sum((payload#>>'{usage,cost,amount}')::numeric)::double precision AS amount
        FROM pyro_events ${whereSql} AND payload#>'{usage,cost}' IS NOT NULL
        GROUP BY payload#>>'{usage,cost,currency}'`, whereValues),
      this.pool.query<{ requests: number }>(`SELECT count(*) FILTER (WHERE labels <> '{}'::jsonb)::int AS requests FROM pyro_events ${whereSql}`, whereValues),
      this.pool.query<{ key: string; requests: number }>(`
        SELECT label.key, count(*)::int AS requests FROM pyro_events
        CROSS JOIN LATERAL jsonb_object_keys(labels) AS label(key)
        ${whereSql} GROUP BY label.key ORDER BY requests DESC, label.key`, whereValues),
      this.pool.query<{ bucket: number; requests: number; blocked: number; reviewed: number; provider_calls: number }>(`
        SELECT floor((extract(epoch FROM created_at) * 1000 - $${whereValues.length + 1}) / $${whereValues.length + 2})::int AS bucket,
          count(*)::int AS requests,
          count(*) FILTER (WHERE action = 'block')::int AS blocked,
          count(*) FILTER (WHERE action = 'review')::int AS reviewed,
          count(*) FILTER (WHERE provider <> 'local-rules')::int AS provider_calls
        FROM pyro_events ${whereSql} GROUP BY bucket ORDER BY bucket`, [...whereValues, fromMs, options.bucketMs]),
      this.pool.query<{ id: string; name: string; requests: number }>(`
        SELECT COALESCE(app_id, 'default') AS id,
          max(COALESCE(payload->>'appName', app_id, 'Default app')) AS name,
          count(*)::int AS requests FROM pyro_events ${whereSql}
        GROUP BY COALESCE(app_id, 'default') ORDER BY requests DESC`, whereValues),
      this.pool.query<{ id: string; requests: number }>(`SELECT provider AS id, count(*)::int AS requests FROM pyro_events ${whereSql} GROUP BY provider ORDER BY requests DESC`, whereValues),
      this.pool.query<{ id: string; requests: number }>(`SELECT profile_id AS id, count(*)::int AS requests FROM pyro_events ${whereSql} GROUP BY profile_id ORDER BY requests DESC`, whereValues),
      this.pool.query<{ id: string; requests: number }>(`SELECT COALESCE(payload->>'apiKeyName', 'unknown') AS id, count(*)::int AS requests FROM pyro_events ${whereSql} GROUP BY COALESCE(payload->>'apiKeyName', 'unknown') ORDER BY requests DESC`, whereValues),
    ]);
    const raw = totalsResult.rows[0];
    const timelineMap = new Map(timelineResult.rows.map((row) => [Number(row.bucket), row]));
    return {
      totals: {
        requests: Number(raw?.requests ?? 0), allowed: Number(raw?.allowed ?? 0), reviewed: Number(raw?.reviewed ?? 0), blocked: Number(raw?.blocked ?? 0), failed: Number(raw?.failed ?? 0),
        providerCalls: Number(raw?.provider_calls ?? 0), localRuleDecisions: Number(raw?.local_decisions ?? 0),
        costs: costsResult.rows.filter((row) => row.currency).map((row) => ({ currency: row.currency, amount: Number(row.amount) })),
        costReportedCalls: Number(raw?.cost_reported ?? 0), inputTokens: Number(raw?.input_tokens ?? 0), outputTokens: Number(raw?.output_tokens ?? 0), inputBytes: Number(raw?.input_bytes ?? 0),
        averageLatencyMs: Number(raw?.average_latency ?? 0), p95LatencyMs: Number(raw?.p95_latency ?? 0),
      },
      labels: { requests: Number(labelTotalsResult.rows[0]?.requests ?? 0), keys: labelKeysResult.rows.map((row) => ({ key: row.key, requests: Number(row.requests) })) },
      timeline: Array.from({ length: options.buckets }, (_, bucket) => {
        const row = timelineMap.get(bucket);
        return { at: new Date(fromMs + bucket * options.bucketMs).toISOString(), requests: Number(row?.requests ?? 0), blocked: Number(row?.blocked ?? 0), reviewed: Number(row?.reviewed ?? 0), providerCalls: Number(row?.provider_calls ?? 0) };
      }),
      byApp: appsResult.rows.map((row) => ({ id: row.id, name: row.name, requests: Number(row.requests) })),
      byProvider: providersResult.rows.map((row) => ({ id: row.id, requests: Number(row.requests) })),
      byPolicy: policiesResult.rows.map((row) => ({ id: row.id, requests: Number(row.requests) })),
      byApiKey: keysResult.rows.map((row) => ({ id: row.id, requests: Number(row.requests) })),
    };
  }
}

async function insertDelivery(client: Pool | PoolClient, delivery: Delivery): Promise<void> {
  await client.query(`INSERT INTO pyro_deliveries (id, integration_id, event_id, created_at, status, next_attempt_at, payload)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT DO NOTHING`,
    [delivery.id, delivery.integrationId, delivery.eventId, delivery.createdAt, delivery.status, delivery.nextAttemptAt, JSON.stringify(delivery)]);
}

class PostgresDeliveries implements DeliveryStore {
  constructor(private readonly pool: Pool) {}
  async enqueue(delivery: Delivery): Promise<void> { await insertDelivery(this.pool, delivery); }
  async claim(limit = 10, now = new Date()): Promise<Delivery[]> {
    const token = randomUUID();
    const until = new Date(now.getTime() + 30_000).toISOString();
    const result = await this.pool.query<{ payload: Delivery }>(`
      WITH due AS (SELECT id FROM pyro_deliveries
        WHERE status IN ('pending', 'delivering') AND next_attempt_at <= $1
        ORDER BY next_attempt_at LIMIT $2 FOR UPDATE SKIP LOCKED)
      UPDATE pyro_deliveries d SET status = 'delivering', next_attempt_at = $3::text::timestamptz,
        payload = d.payload || jsonb_build_object('status', 'delivering', 'nextAttemptAt', $3::text,
          'leaseToken', $4::text, 'attempts', (d.payload->>'attempts')::int + 1)
      FROM due WHERE d.id = due.id RETURNING d.payload`, [now.toISOString(), limit, until, token]);
    return result.rows.map((row) => row.payload);
  }
  async finish(delivery: Delivery): Promise<void> {
    await this.pool.query(`UPDATE pyro_deliveries SET status = $2, next_attempt_at = $3, payload = $4::jsonb
      WHERE id = $1 AND payload->>'leaseToken' = $5 AND status = 'delivering'`,
      [delivery.id, delivery.status, delivery.nextAttemptAt, JSON.stringify(delivery), delivery.leaseToken]);
  }
  async list(integrationId?: string): Promise<Delivery[]> {
    const result = await this.pool.query<{ payload: Delivery }>(`SELECT payload FROM pyro_deliveries
      WHERE ($1::text IS NULL OR integration_id = $1) ORDER BY created_at DESC LIMIT 100`, [integrationId ?? null]);
    return result.rows.map((row) => row.payload);
  }
  async retry(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.pool.query(`UPDATE pyro_deliveries SET status = 'pending', next_attempt_at = $2::text::timestamptz,
      payload = (payload - 'error' - 'leaseToken' - 'lastStatus') || jsonb_build_object('status', 'pending', 'attempts', 0, 'nextAttemptAt', $2::text)
      WHERE id = $1 AND status = 'failed'`, [id, now]);
    return result.rowCount === 1;
  }
}

class PostgresDatabase implements Database {
  readonly kind = "postgresql" as const;
  readonly events: EventStore;
  readonly deliveries: DeliveryStore;

  constructor(private readonly pool: Pool) {
    this.events = new PostgresEvents(pool);
    this.deliveries = new PostgresDeliveries(pool);
  }

  document<T>(key: string, fallback: () => T): DocumentStore<T> {
    if (!/^[a-z0-9_-]{1,64}$/.test(key)) throw new Error(`Invalid database document key: ${key}`);
    return new PostgresDocument(this.pool, key, fallback);
  }

  async prune(before: string): Promise<void> {
    await this.pool.query("DELETE FROM pyro_deliveries WHERE created_at < $1 AND status IN ('delivered', 'failed')", [before]);
    await this.pool.query("DELETE FROM pyro_events WHERE created_at < $1", [before]);
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

const memoryLocks = new WeakMap<Map<string, unknown>, Map<string, Promise<unknown>>>();

class MemoryDocument<T> implements DocumentStore<T> {
  constructor(private readonly documents: Map<string, unknown>, private readonly key: string, private readonly fallback: () => T) {}

  async read(): Promise<T> {
    if (!this.documents.has(this.key)) this.documents.set(this.key, structuredClone(this.fallback()));
    return structuredClone(this.documents.get(this.key) as T);
  }

  async write(value: T): Promise<void> {
    this.documents.set(this.key, structuredClone(value));
  }

  async update(updater: (current: T) => T | Promise<T>): Promise<T> {
    const locks = memoryLocks.get(this.documents) ?? new Map<string, Promise<unknown>>();
    memoryLocks.set(this.documents, locks);
    const previous = locks.get(this.key) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const updated = await updater(await this.read());
      await this.write(updated);
      return updated;
    });
    locks.set(this.key, pending);
    try { return await pending; }
    finally { if (locks.get(this.key) === pending) locks.delete(this.key); }
  }
}

function quantile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function eventMatches(event: ClassificationEvent, options: EventQuery): boolean {
  if (options.appIds && !options.appIds.includes(event.appId ?? "default")) return false;
  if (options.action && event.action !== options.action) return false;
  if (options.verdict && event.verdict !== options.verdict) return false;
  if (options.status === "flagged" && !["suspicious", "unsafe"].includes(event.verdict)) return false;
  if (options.status === "suspicious" && event.verdict !== "suspicious") return false;
  if (options.status === "blocked" && event.action !== "block") return false;
  if (options.status === "safe" && event.verdict !== "safe") return false;
  if (options.profile && event.profileId !== options.profile) return false;
  if (options.provider && event.provider !== options.provider) return false;
  if (options.apiKey && event.apiKeyId !== options.apiKey) return false;
  if (options.appId && (event.appId ?? "default") !== options.appId) return false;
  if (options.from && new Date(event.createdAt).getTime() < new Date(options.from).getTime()) return false;
  if (options.to && new Date(event.createdAt).getTime() > new Date(options.to).getTime()) return false;
  if (options.minimumRisk !== undefined && event.risk < options.minimumRisk) return false;
  if (options.labelKey && !(options.labelKey in (event.labels ?? {}))) return false;
  if (options.labelValue) {
    const values = options.labelKey ? [event.labels?.[options.labelKey]] : Object.values(event.labels ?? {});
    if (!values.some((value) => value?.toLowerCase().includes(options.labelValue!.toLowerCase()))) return false;
  }
  if (options.search) {
    const haystack = `${event.id} ${event.requestId ?? ""} ${event.inputHash} ${event.apiKeyName ?? ""} ${options.excludeRawSearch ? "" : event.inputPreview ?? ""} ${event.reason} ${JSON.stringify(event.labels ?? {})}`.toLowerCase();
    if (!haystack.includes(options.search.toLowerCase())) return false;
  }
  return true;
}

class MemoryDatabase implements Database {
  readonly kind = "memory" as const;
  private readonly documents = new Map<string, unknown>();
  private readonly eventRows: ClassificationEvent[] = [];
  private readonly deliveryRows = new Map<string, Delivery>();
  readonly deliveries: DeliveryStore = {
    enqueue: async (delivery) => {
      if (![...this.deliveryRows.values()].some((d) => d.integrationId === delivery.integrationId && d.eventId === delivery.eventId)) this.deliveryRows.set(delivery.id, structuredClone(delivery));
    },
    claim: async (limit = 10, now = new Date()) => {
      const due = [...this.deliveryRows.values()].filter((d) => ["pending", "delivering"].includes(d.status) && d.nextAttemptAt <= now.toISOString()).sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt)).slice(0, limit);
      for (const d of due) { d.status = "delivering"; d.leaseToken = randomUUID(); d.attempts++; d.nextAttemptAt = new Date(now.getTime() + 30_000).toISOString(); }
      return structuredClone(due);
    },
    finish: async (delivery) => {
      const current = this.deliveryRows.get(delivery.id);
      if (current?.status === "delivering" && current.leaseToken === delivery.leaseToken) this.deliveryRows.set(delivery.id, structuredClone(delivery));
    },
    list: async (integrationId) => structuredClone([...this.deliveryRows.values()].filter((d) => !integrationId || d.integrationId === integrationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)),
    retry: async (id) => {
      const d = this.deliveryRows.get(id);
      if (!d || d.status !== "failed") return false;
      d.status = "pending"; d.attempts = 0; d.nextAttemptAt = new Date().toISOString(); delete d.error; delete d.leaseToken; delete d.lastStatus;
      return true;
    },
  };
  readonly events: EventStore = {
    append: async (event, deliveries = []) => {
      if (this.eventRows.some((item) => item.id === event.id)) return;
      this.eventRows.push(structuredClone(event));
      for (const delivery of deliveries) await this.deliveries.enqueue(delivery);
    },
    readRecent: async (limit = 100) => this.eventRows.slice(-Math.max(1, limit)).reverse().map((event) => structuredClone(event)),
    findById: async (id) => {
      const event = this.eventRows.find((item) => item.id === id);
      return event ? structuredClone(event) : undefined;
    },
    query: async (options) => {
      const filtered = [...this.eventRows].filter((event) => eventMatches(event, options)).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
      const offset = Math.max(0, Math.floor(options.offset ?? 0));
      const limit = options.limit === undefined ? filtered.length : Math.max(1, Math.floor(options.limit));
      return {
        events: structuredClone(filtered.slice(offset, offset + limit)),
        total: filtered.length,
        labelKeys: [...new Set(filtered.flatMap((event) => Object.keys(event.labels ?? {})))].sort(),
      };
    },
    latestCursor: async () => {
      const latest = [...this.eventRows].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0];
      return latest ? { createdAt: latest.createdAt, id: latest.id } : undefined;
    },
    readAfter: async (cursor, limit = 500) => structuredClone(this.eventRows
      .filter((event) => event.createdAt > cursor.createdAt || (event.createdAt === cursor.createdAt && event.id > cursor.id))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .slice(0, limit)),
    overview: async (now = new Date(), appIds?: string[]) => {
      const bucketMs = 2 * 60 * 60_000;
      const toMs = Math.ceil(now.getTime() / bucketMs) * bucketMs;
      const fromMs = toMs - 12 * bucketMs;
      const events = this.eventRows.filter((event) => { const time = new Date(event.createdAt).getTime(); return time >= fromMs && time < toMs && (!appIds || appIds.includes(event.appId ?? "default")); });
      const detectors = new Map<string, { id: string; name: string; signals: number; probabilities: number[] }>();
      for (const event of events) for (const detector of event.detectors) {
        const item = detectors.get(detector.id) ?? { id: detector.id, name: detector.name, signals: 0, probabilities: [] };
        if (detector.probability >= .5) item.signals += 1;
        item.probabilities.push(detector.probability); detectors.set(detector.id, item);
      }
      const latencies = events.map((event) => event.latencyMs);
      const blocked = events.filter((event) => event.action === "block").length;
      return {
        from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(),
        totals: {
          requests: events.length, blocked, reviewed: events.filter((event) => event.action === "review").length, failed: events.filter((event) => Boolean(event.error)).length,
          blockRate: events.length ? blocked / events.length : 0, p50LatencyMs: quantile(latencies, .5), p95LatencyMs: quantile(latencies, .95), p99LatencyMs: quantile(latencies, .99),
          p95QueueMs: quantile(events.map((event) => event.queueMs), .95), p95ProviderMs: quantile(events.map((event) => event.timings?.providerMs ?? event.latencyMs), .95),
          shadowChanges: events.reduce((total, event) => total + (event.shadows?.filter((shadow) => shadow.changed).length ?? 0), 0),
        },
        actions: (["allow", "review", "block"] as const).map((action) => ({ action, count: events.filter((event) => event.action === action).length })),
        detectors: [...detectors.values()].map((item) => ({ id: item.id, name: item.name, signals: item.signals, averageProbability: item.probabilities.reduce((sum, value) => sum + value, 0) / item.probabilities.length })).sort((left, right) => right.signals - left.signals),
        timeline: Array.from({ length: 12 }, (_, bucket) => {
          const start = fromMs + bucket * bucketMs; const end = start + bucketMs;
          const rows = events.filter((event) => { const time = new Date(event.createdAt).getTime(); return time >= start && time < end; });
          return { at: new Date(start).toISOString(), total: rows.length, blocked: rows.filter((event) => event.action === "block").length, reviewed: rows.filter((event) => event.action === "review").length };
        }),
      };
    },
    usage: async (options) => {
      const fromMs = new Date(options.from).getTime(); const toMs = new Date(options.to).getTime();
      const events = this.eventRows.filter((event) => { const time = new Date(event.createdAt).getTime(); return time >= fromMs && time <= toMs && (!options.appId || (event.appId ?? "default") === options.appId) && (!options.appIds || options.appIds.includes(event.appId ?? "default")); });
      const group = (key: (event: ClassificationEvent) => string) => {
        const values = new Map<string, number>(); for (const event of events) values.set(key(event), (values.get(key(event)) ?? 0) + 1);
        return [...values].map(([id, requests]) => ({ id, requests })).sort((left, right) => right.requests - left.requests);
      };
      const costs = new Map<string, number>(); const labelKeys = new Map<string, number>();
      for (const event of events) {
        const cost = event.usage?.cost; if (cost) costs.set(cost.currency, (costs.get(cost.currency) ?? 0) + cost.amount);
        for (const key of Object.keys(event.labels ?? {})) labelKeys.set(key, (labelKeys.get(key) ?? 0) + 1);
      }
      const providerEvents = events.filter((event) => event.provider !== "local-rules");
      return {
        totals: {
          requests: events.length, allowed: events.filter((event) => event.action === "allow").length, reviewed: events.filter((event) => event.action === "review").length, blocked: events.filter((event) => event.action === "block").length,
          failed: events.filter((event) => Boolean(event.error)).length, providerCalls: providerEvents.length, localRuleDecisions: events.filter((event) => event.provider === "local-rules").length,
          costs: [...costs].map(([currency, amount]) => ({ currency, amount })), costReportedCalls: providerEvents.filter((event) => Boolean(event.usage?.cost)).length,
          inputTokens: events.reduce((sum, event) => sum + (event.usage?.inputTokens ?? 0), 0), outputTokens: events.reduce((sum, event) => sum + (event.usage?.outputTokens ?? 0), 0), inputBytes: events.reduce((sum, event) => sum + (event.inputBytes ?? 0), 0),
          averageLatencyMs: events.length ? events.reduce((sum, event) => sum + event.latencyMs, 0) / events.length : 0, p95LatencyMs: quantile(events.map((event) => event.latencyMs), .95),
        },
        labels: { requests: events.filter((event) => Object.keys(event.labels ?? {}).length > 0).length, keys: [...labelKeys].map(([key, requests]) => ({ key, requests })).sort((left, right) => right.requests - left.requests) },
        timeline: Array.from({ length: options.buckets }, (_, bucket) => {
          const start = fromMs + bucket * options.bucketMs; const end = start + options.bucketMs;
          const rows = events.filter((event) => { const time = new Date(event.createdAt).getTime(); return time >= start && time < end; });
          return { at: new Date(start).toISOString(), requests: rows.length, blocked: rows.filter((event) => event.action === "block").length, reviewed: rows.filter((event) => event.action === "review").length, providerCalls: rows.filter((event) => event.provider !== "local-rules").length };
        }),
        byApp: group((event) => event.appId ?? "default").map((item) => ({ ...item, name: events.find((event) => (event.appId ?? "default") === item.id)?.appName ?? item.id })),
        byProvider: group((event) => event.provider), byPolicy: group((event) => event.profileId), byApiKey: group((event) => event.apiKeyName ?? "unknown"),
      };
    },
  };

  document<T>(key: string, fallback: () => T): DocumentStore<T> {
    return new MemoryDocument(this.documents, key, fallback);
  }

  async prune(before: string): Promise<void> {
    this.eventRows.splice(0, this.eventRows.length, ...this.eventRows.filter((e) => e.createdAt >= before));
  }
  async ping(): Promise<void> {}
  async close(): Promise<void> {}
}

const memoryDatabases = new Map<string, MemoryDatabase>();

export async function openDatabase(connectionString: string): Promise<Database> {
  if (connectionString.startsWith("memory://")) {
    const existing = memoryDatabases.get(connectionString);
    if (existing) return existing;
    const database = new MemoryDatabase();
    memoryDatabases.set(connectionString, database);
    return database;
  }
  if (!connectionString.startsWith("postgres://") && !connectionString.startsWith("postgresql://")) {
    throw new Error("DATABASE_URL must use PostgreSQL.");
  }
  const pool = new Pool({ connectionString, max: 20, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  try {
    await migrate(pool);
    return new PostgresDatabase(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
}

export class CachedDocument<T> implements DocumentStore<T> {
  private value?: T;
  private checkedAt = 0;

  constructor(private readonly document: DocumentStore<T>, private readonly ttlMs = 500) {}

  async read(): Promise<T> {
    const now = Date.now();
    if (this.value !== undefined && now - this.checkedAt < this.ttlMs) return this.value;
    this.value = await this.document.read();
    this.checkedAt = now;
    return this.value;
  }

  async write(value: T): Promise<void> {
    await this.document.write(value);
    this.value = value;
    this.checkedAt = Date.now();
  }

  async update(updater: (current: T) => T | Promise<T>): Promise<T> {
    const updated = await this.document.update(updater);
    this.value = updated;
    this.checkedAt = Date.now();
    return updated;
  }

  invalidate(): void {
    this.value = undefined;
    this.checkedAt = 0;
  }
}

function encryptionKey(secret: string): Buffer {
  if (secret.length < 16) throw new Error("CONTROL_PLANE_SECRET must be at least 16 characters.");
  return createHash("sha256").update(secret).digest();
}

export function encryptText(value: string, secret: string): StoredSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptText(value: StoredSecret, secret: string): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(secret),
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export * from "./policies.js";

export * from "./jobs.js";

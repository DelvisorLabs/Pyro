function integer(name: string, fallback: number, minimum: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

export interface GatewayConfig {
  host: string;
  port: number;
  databaseUrl: string;
  queueConcurrency: number;
  queueMaxDepth: number;
  defaultTimeoutMs: number;
  controlPlaneSecret: string;
  typesafeApiKey?: string;
  bootstrapApiKey?: string;
}

function required(name: string, minimumLength = 1): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < minimumLength) {
    throw new Error(`${name} is required and must be at least ${minimumLength} characters.`);
  }
  return value;
}

export function loadConfig(): GatewayConfig {
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: integer("PORT", 8080, 1),
    databaseUrl: required("DATABASE_URL"),
    queueConcurrency: integer("QUEUE_CONCURRENCY", 16, 1),
    queueMaxDepth: integer("QUEUE_MAX_DEPTH", 1_000, 1),
    defaultTimeoutMs: integer("CLASSIFICATION_TIMEOUT_MS", 8_000, 250),
    controlPlaneSecret: required("CONTROL_PLANE_SECRET", 32),
    typesafeApiKey: process.env.TYPESAFE_API_KEY || undefined,
    bootstrapApiKey: required("GATEWAY_API_KEY", 24),
  };
}

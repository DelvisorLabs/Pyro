export interface ControlPlaneConfig {
  oidc?: { issuer: string; clientId: string; clientSecret: string; redirectUri: string };
  host: string;
  port: number;
  databaseUrl: string;
  adminPassword: string;
  controlPlaneSecret: string;
  gatewayInternalUrl: string;
  gatewayApiKey: string;
  typesafeApiKey?: string;
  typesafeEndpoint: string;
  typesafeModel: string;
}

function required(name: string, minimumLength = 1): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < minimumLength) {
    throw new Error(`${name} is required and must be at least ${minimumLength} characters.`);
  }
  return value;
}

export function loadConfig(): ControlPlaneConfig {
  return {
    oidc: process.env.OIDC_ISSUER ? { issuer: required("OIDC_ISSUER"), clientId: required("OIDC_CLIENT_ID"), clientSecret: required("OIDC_CLIENT_SECRET"), redirectUri: required("OIDC_REDIRECT_URI") } : undefined,
    host: process.env.HOST ?? "0.0.0.0",
    port: Number.parseInt(process.env.PORT ?? "8081", 10),
    databaseUrl: required("DATABASE_URL"),
    adminPassword: required("ADMIN_PASSWORD", 12),
    controlPlaneSecret: required("CONTROL_PLANE_SECRET", 32),
    gatewayInternalUrl: process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:8080",
    gatewayApiKey: required("GATEWAY_API_KEY", 24),
    typesafeApiKey: process.env.TYPESAFE_API_KEY || undefined,
    typesafeEndpoint: process.env.TYPESAFE_ENDPOINT ?? "https://api.typesafe.ai/v1/systemone",
    typesafeModel: process.env.TYPESAFE_MODEL ?? "jev-latest",
  };
}

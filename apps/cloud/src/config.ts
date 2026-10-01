export interface CloudConfig {
  trustProxy?: string[];
  databaseUrl: string; secret: string; publicUrl: string; port: number; host: string;
  platformToken: string; legacyAdminPassword?: string;
  providerKey?: string; providerEndpoint: string; providerModel: string; providerMode: "jev" | "mock";
  maxOrganizations: number; trialCredits: number; monthlyProviderBudgetMicros: number;
  providerPricePerMillion: number; emailMode: "outbox" | "resend"; emailKey?: string; emailFrom: string;
  razorpayKey?: string; razorpaySecret?: string; razorpayWebhookSecret?: string;
  packPricePaise: number; packCredits: number;
}
export function loadConfig(): CloudConfig {
  const required = (key: string, length = 1) => { const value = process.env[key]?.trim(); if (!value || value.length < length) throw new Error(`${key} must contain at least ${length} characters.`); return value; };
  const number = (key: string, fallback: number) => { const value = Number(process.env[key] ?? fallback); if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer.`); return value; };
  const production = process.env.NODE_ENV === "production";
  const publicUrl = required("CLOUD_PUBLIC_URL");
  if (production && new URL(publicUrl).protocol !== "https:") throw new Error("Cloud production requires HTTPS.");
  const emailMode = process.env.CLOUD_EMAIL_MODE === "resend" ? "resend" : "outbox";
  if (production && emailMode !== "resend") throw new Error("Production requires configured email delivery.");
  const providerMode = process.env.CLOUD_PROVIDER_MODE === "mock" ? "mock" : "jev";
  if (production && providerMode === "mock") throw new Error("Mock classification cannot be used in production cloud.");
  const providerEndpoint = process.env.TYPESAFE_ENDPOINT ?? "https://api.typesafe.ai/v1/systemone";
  if (production && new URL(providerEndpoint).protocol !== "https:") throw new Error("The provider must use HTTPS.");
  const providerPricePerMillion = Number(production ? required("CLOUD_PROVIDER_PRICE_PER_MILLION") : process.env.CLOUD_PROVIDER_PRICE_PER_MILLION ?? 1);
  if (!Number.isFinite(providerPricePerMillion) || providerPricePerMillion <= 0) throw new Error("CLOUD_PROVIDER_PRICE_PER_MILLION must be a positive finite USD price ceiling.");
  if (production && !/^postgres(ql)?:/.test(required("DATABASE_URL"))) throw new Error("Production requires PostgreSQL.");
  return { trustProxy: process.env.CLOUD_TRUST_PROXY?.split(",").map((s) => s.trim()).filter(Boolean), databaseUrl: required("DATABASE_URL"), secret: required("CONTROL_PLANE_SECRET", 32), platformToken: required("CLOUD_PLATFORM_TOKEN", 32),
    publicUrl, host: process.env.HOST ?? "127.0.0.1", port: number("PORT", 8082), legacyAdminPassword: process.env.ADMIN_PASSWORD,
    providerKey: production ? required("TYPESAFE_API_KEY") : process.env.TYPESAFE_API_KEY,
    providerEndpoint, providerModel: process.env.TYPESAFE_MODEL ?? "jev-latest", providerMode,
    maxOrganizations: number("CLOUD_MAX_ORGANIZATIONS", 25), trialCredits: number("CLOUD_TRIAL_CREDITS", 100),
    monthlyProviderBudgetMicros: number("CLOUD_PROVIDER_BUDGET_MICROS", 30_000_000), providerPricePerMillion,
    emailMode, emailKey: emailMode === "resend" ? required("RESEND_API_KEY") : undefined, emailFrom: process.env.CLOUD_EMAIL_FROM ?? "Pyro <accounts@example.com>",
    razorpayKey: process.env.RAZORPAY_KEY_ID, razorpaySecret: process.env.RAZORPAY_KEY_SECRET, razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    packPricePaise: number("CLOUD_PACK_PRICE_PAISE", 199900), packCredits: number("CLOUD_PACK_CREDITS", 25000),
  };
}

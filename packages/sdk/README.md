# Pyro TypeScript SDK

```ts
import { PyroClient } from "@pyro/sdk";

const pyro = new PyroClient({
  baseUrl: "http://localhost:8080",
  apiKey: process.env.PYRO_API_KEY!,
});

const decision = await pyro.classify({
  messages: [{ role: "user", content: "Summarize this document." }],
}, {
  labels: { session_url: "https://support.example/chats/123", tenant: "acme" },
});

if (decision.action === "block") throw new Error(decision.reason);
```

The API key selects the application and its policy/rules; an application ID is never trusted from request data. The client also exposes `createJob`, `getJob`, `waitForJob`, and `listProfiles`.

## Install locally

Node.js 22 or newer is supported. Keep API keys on the server. This change does not publish packages to npm.

```sh
# From the Pyro repository:
npm ci
npm run build:packages
npm pack -w @pyro/contracts
npm pack -w @pyro/sdk
# In your application, npm install both generated tarballs by absolute path.
```

The SDK exports `ClassificationDecision`, `ClassifyOptions`, `Job`, `JobReceipt`, `ProfileSummary`, `PolicyAction`, `Verdict`, and `WebhookEvent` types. Use `PyroError.status`, `requestId`, `details`, and `retryAfterSeconds` for HTTP error handling. The SDK does not automatically retry billable POSTs or follow redirects.

## Jobs and cancellation

```ts
const job = await pyro.createJob("Summarize this document.", {
  requestId: "support-123",
});
const result = await pyro.waitForJob(job.id, {
  intervalMs: 250,
  timeoutMs: 30_000,
  signal: AbortSignal.timeout(20_000),
});
```

The overall polling deadline includes HTTP calls and delays. Abort listeners are removed after each delay. Gateway jobs currently expire after about ten minutes and are process-local.

## Verify a webhook

```ts
import { verifyWebhook } from "@pyro/sdk";

const valid = await verifyWebhook({
  body: rawRequestBody, // exact bytes decoded as UTF-8; do not JSON.stringify parsed input
  secret: process.env.PYRO_WEBHOOK_SECRET!,
  signature: request.headers.get("x-pyro-signature") ?? "",
  timestamp: request.headers.get("x-pyro-timestamp") ?? "",
});
if (!valid) return new Response("Invalid signature", { status: 401 });
```

The default timestamp tolerance is five minutes. After verification, parse the JSON and deduplicate using X-Pyro-Delivery-Id. Retries keep the same ID and body but receive a fresh timestamp/signature. This helper uses Web Crypto and works in Node.js 22 and modern browser runtimes.

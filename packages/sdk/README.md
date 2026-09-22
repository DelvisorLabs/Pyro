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

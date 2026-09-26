<p align="center">
  <img src="./apps/dashboard/public/pyro-mark.svg" width="120" height="120" alt="Pyro" />
</p>

<h1 align="center">Pyro</h1>

<p align="center">
  Self-hosted prompt monitoring and protection with fast local rules,<br />
  configurable semantic detectors, and
  <a href="https://typesafe.ai/blog/introducing-system-one-models-and-jev">System One models</a>.
</p>

<p align="center">
  <strong>Inspect every rule</strong> ·
  <strong>Set every threshold</strong> ·
  <strong>Trace every decision</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-pyro-does">How it works</a> ·
  <a href="./docs/openapi.yaml">API reference</a>
</p>

## What Pyro does

Pyro is a standalone CLI, self-hosted policy API and dashboard for teams adding LLM features or
tool-using agents. Call it before forwarding an untrusted prompt, retrieved
passage, or tool payload. It returns `allow`, `review`, or `block`; your application
must hold review decisions and reject blocked ones before executing work.

Local rules run in the CLI process or on your server. Semantic detectors currently use **TypeSafe
System One** and send inputs to that provider. Your application's LLM can be from
any vendor, but the semantic classifier implementation is currently TypeSafe.
Pyro does not automatically intercept a model or tool call and cannot guarantee
that prompt injection will be detected. Keep authorization, tool permissions,
sandboxing and output validation in the application.

This is a beta for supervised pilots. The [evaluation guide](docs/evaluations/README.md)
contains a reproducible 20-case local-rule smoke test and its report. There is no
published independent semantic accuracy, false-positive or cross-vendor cost
benchmark. Provider charges depend on actual traffic and the provider's billing.

## Operate and improve a policy

- Immutable policy history, draft/publish, explicit application pins and canaries.
- A labeled evaluation lab that compares published revisions using the gateway engine.
- A review inbox with assignment, comments, dispositions and signed callbacks.
- Individual accounts, OIDC, application-scoped roles and an audit history.
- Encrypted durable jobs, shared quotas, bounded fair scheduling and data retention.

See [deployment and data retention](docs/deployment.md), [release/support notes](docs/releases.md),
[security reporting](SECURITY.md), and [license notices](THIRD_PARTY_NOTICES.md).

## Quick start

### Install and classify — no Docker required

With Node.js 22.13+ and pnpm:

```sh
pnpm add --global @delvisor/pyro
pyro classify 'Summarize this document.'
pyro classify -- '-----BEGIN PRIVATE KEY-----'
```

CLI 0.2+ bundles the classification engine and local-secrets policy. Expect
`allow` then `block`, with `execution: standalone`. No server, database, account,
policy download or provider key is needed. The synthetic header tests a specific
local rule; it is not a semantic detection benchmark.

```sh
pyro classify --file prompt.txt
pyro classify 'A document to inspect' --profile-file ./my-policy.yaml
pyro doctor --local
```

Standalone results go to stdout; no input history or background services are
created. A configured gateway URL or `PYRO_API_KEY` selects the existing server
mode. `--local` overrides those settings; `--remote` explicitly uses the server.
See the [CLI guide](packages/cli/README.md) for files, stdin and structured inputs.

### Optional semantic screening

Set `TYPESAFE_API_KEY` in your environment, then run:

```sh
pyro classify 'Text to inspect' --semantic
```

This calls TypeSafe directly using the bundled balanced-assistant policy.
`--semantic` explicitly authorizes sending inputs to that provider and its usage
charges. It needs no Docker or Pyro server. Missing keys fail before the request;
provider failures return an indeterminate verdict and the policy's failure action.
A fail-closed block is not evidence that an attack was detected.

### Optional shared dashboard and team workflows

For durable jobs, activity history, policy rollouts, evaluations and team access,
use an existing server or save [compose.yaml](https://delvisor.com/pyro/compose.yaml)
and [.env.example](https://delvisor.com/pyro/pyro.env.example) in an empty folder.
No source clone is needed. With Docker Compose installed:

```sh
cp .env.example .env
# Fill in the four required credentials using the generation commands in the file.
docker compose up --build --wait --wait-timeout 180
pyro config set gateway-url http://localhost:8080
pyro config set control-url http://localhost:8081
pyro auth login
```

Open [the dashboard](http://localhost:3000) and sign in with `ADMIN_PASSWORD`.
Keep the interfaces private; see [deployment guidance](docs/deployment.md).
Download [local-secrets.yaml](https://delvisor.com/pyro/profiles/local-secrets.yaml),
then import it for server use and create an application key:

```sh
pyro profiles import --file ./local-secrets.yaml
pyro apps create --name Support --default-profile-id local-secrets
pyro keys create --name 'Support backend' --app-id APP_ID
# Set PYRO_API_KEY to the one-time key shown above; use the returned APP_ID.
pyro classify 'Summarize this document.' --remote --profile local-secrets
```

Server semantic profiles use the provider configured in dashboard Settings.
Standalone semantic checks use your local `TYPESAFE_API_KEY`. Your application
must enforce the returned action: continue only on allow, hold review, and reject
block. Successful classification exits 0 for any action; scripts must inspect it.

## Protection profiles

A profile describes what should be evaluated and how Pyro should act on the result. Each profile can configure:

- natural-language detector questions;
- detector weights and optional threshold overrides;
- maximum-signal, weighted-average, or signal-count decisions;
- review and block thresholds;
- fail-open or fail-closed behavior;
- input limits and evaluation timeouts;
- dashboard notifications and optional input previews;
- reusable local rules with literal or RE2 regex matching;
- YAML import/export and curated preset selection;
- up to three shadow profiles for side-by-side policy testing.

The new-profile editor starts empty. Add only the signals and notifications that are relevant to the application; Pyro does not silently attach a bundle of default protections.

## Applications, labels, and local rules

Create one Pyro application for each workload—for example, a support assistant, document pipeline, or internal copilot. Applications have their own API keys, profile access, request limits, usage breakdown, and local rules.

Labels add searchable context to a decision without changing policy behavior. A session URL, tenant, environment, feature name, or release identifier can be attached to a request and filtered later in Activity.

Local rules handle clear organization-specific cases before a model is called. The rule engine supports bounded literal `contains`/`equals` matching and linear-time RE2 `regex` matching and can send a request to review or block it immediately. Because a matching rule skips model evaluation, it also avoids that request's inference cost and latency.

Local rules can belong to a profile or an application. Both sets run together: block takes priority over review, then highest risk. Local-only profiles allow unmatched inputs without a provider call. See the [profile format and precedence guide](./profiles/README.md).

## Webhooks

Route decisions to signed outgoing webhooks from **Webhooks**. Filter by application, profile, action and minimum risk; test destinations and inspect or retry deliveries. PostgreSQL stores the event and outbound delivery atomically, and the gateway delivers asynchronously with bounded retries. Destination URLs and signing keys are encrypted.

Run `pnpm run test:webhook` against your local running stack for a signed delivery and retry smoke test. For manual testing, run `pnpm run webhook:receiver` and follow the [webhook guide](./docs/integrations.md).

## Command line

Source builds use Node.js 22.13 or newer and pnpm 11.10.0 (pinned in `package.json`).

The CLI uses the same profiles, applications, activity, API keys, webhooks and
provider settings as the dashboard. It covers every operation in both OpenAPI
specifications, including background jobs and live event streams.

```sh
pnpm add --global @delvisor/pyro
pyro auth login
pyro profiles list
```

The [published CLI](https://www.npmjs.com/package/@delvisor/pyro) is separate from the optional source-only SDKs. See the [CLI guide](./packages/cli/README.md) for installation, diagnostics, YAML/CSV exports, scripting and tests.

## Use it from code

### TypeScript

The TypeScript client is available in this workspace:

```ts
import { PyroClient } from "@pyro/sdk";

const pyro = new PyroClient({
  baseUrl: "http://localhost:8080",
  apiKey: process.env.PYRO_API_KEY!,
});

const decision = await pyro.classify(
  { message: "Summarize this document." },
  { labels: { environment: "production" } },
);

if (decision.action !== "allow") {
  throw new Error(decision.reason);
}
```

### Python

Install the local Python client with `pip install -e ./sdks/python`:

```python
import os
from pyro import Pyro

pyro = Pyro(
    base_url="http://localhost:8080",
    api_key=os.environ["PYRO_API_KEY"],
)

decision = pyro.classify(
    {"message": "Summarize this document."},
    labels={"environment": "production"},
)

if decision["action"] != "allow":
    raise RuntimeError(decision["reason"])
```

The TypeScript and Python clients support immediate decisions, background jobs, job polling, profile discovery, custom request IDs, labels, and configurable timeouts. See the [TypeScript client guide](./packages/sdk/README.md) and [Python client guide](./sdks/python/README.md).

### Rust

An async Rust client is available in [`sdks/rust`](./sdks/rust/README.md), with typed decisions, background jobs, polling, labels, request IDs and webhook verification. Add it as a local Cargo path dependency. TypeScript also includes webhook signature verification and bounded, cancellable job polling. No SDK packages are published by this change.

## API and data

- API base URL: `http://localhost:8080`
- Interactive dashboard: [http://localhost:3000](http://localhost:3000)
- Gateway HTTP contract: [`docs/openapi.yaml`](./docs/openapi.yaml)
- Profiles and integrations contract: [`docs/control-plane.openapi.yaml`](./docs/control-plane.openapi.yaml)
- Prometheus metrics: `http://localhost:8080/metrics`

Configuration, policies, sessions, and activity are stored in PostgreSQL. Provider credentials entered through the dashboard are encrypted before storage. Prompt content sent for System One evaluation is transmitted to the configured model provider; review that provider's data terms for your deployment. Synchronous classifications omit raw input previews unless the policy enables them. Durable jobs temporarily retain encrypted inputs, and evaluation datasets retain encrypted inputs for the explicitly selected period. Caller metadata and labels are also stored with events; keep secrets out of them. See the retention controls in the deployment guide.

## Development

Development setup and contribution checks are documented in [`CONTRIBUTING.md`](./CONTRIBUTING.md). Before opening a pull request, run:

```bash
pnpm run check
PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -v
```

Security issues should be reported privately as described in [`SECURITY.md`](./SECURITY.md).

## Feature status

See [feature status and follow-ups](./docs/roadmap.md) for the implemented beta workflows and remaining scale/measurement work.

## Scope

Pyro helps detect, monitor, and enforce policy on untrusted prompt input. It should complement—not replace—application authorization, tool permissions, sandboxing, output validation, and least-privilege design.

Pyro is licensed under Apache-2.0. Adapted UI components retain the licenses listed in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

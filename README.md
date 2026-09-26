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
  <a href="#why-pyro">Why Pyro?</a> ·
  <a href="./docs/openapi.yaml">API reference</a>
</p>

## What Pyro does
<img width="960" height="540" alt="pyro_readme" src="https://github.com/user-attachments/assets/bed043a4-d990-4315-9a53-b5e5d4068ae9" />

<br />

Pyro turns untrusted user input into explicit decisions: <strong>allow, review, or block</strong>. You configure what is evaluated, what each signal means, and which thresholds cause an intervention.

<br />

Each request follows a simple path:

1. Application and profile local rules handle known cases immediately. No model involved.
2. If no local rule matches, Pyro evaluates enabled semantic detectors together in one System One request.
3. The selected protection profile combines the returned probabilities using thresholds and a decision strategy you control.
4. Pyro records the outcome, contributing signals, labels, and trace context so the decision can be understood later.

The dashboard gives you one place to:

- monitor prompt decisions in real time;
- search activity by application, outcome, policy, or custom label;
- define semantic detectors as plain-language questions;
- tune review and block thresholds without changing application code;
- compare new policies in shadow mode before enforcing them;
- add fast local rules for known phrases, values, or tool names;
- issue API keys and policies for different applications;
- inspect the rule or detector behind a decision;
- track model usage, cost, latency, and decision traces.

Pyro records hashes and decision metadata unless raw storage is explicitly enabled.

## Why Pyro?

Most prompt-security products give you a fixed detector, a collection of scanners, or a framework that becomes part of the application runtime. Pyro focuses on: **visible, configurable protection that operators and developers can work on together**.

A protection profile is not a hidden vendor policy. It is a configuration you can open and change: detectors, questions, weights, thresholds, decision strategy, failure behavior, notifications, and shadow profiles. Local rules are visible on the application or profile that owns them. Results show the signals that contributed to the final action.

System One models are designed to return typed decisions and calibrated probabilities instead of generated prose. Pyro uses that shape directly: all enabled detectors are evaluated together, and the result is immediately usable by software and visible to operators.

This creates a practical evaluation cascade:

```text
request
  ├─ known local rule ───────────────→ decide locally (no model cost)
  └─ no local match
       └─ semantic detectors ────────→ one System One request
            └─ profile thresholds ──→ allow, review, or block
```

You can keep simple checks fast and deterministic while reserving model analysis for ambiguity and context. The result is not merely a risk score: it is a decision tied to the exact configuration that produced it.

### Cost of analyzing prompts

Prompt monitoring becomes much less useful when cost forces you to sample only a small part of your traffic. Pyro sends all enabled detector questions in one System One request instead of making a separate generative-model call for every check.

The following estimate uses public list prices checked on September 22, 2026. To make different billing units comparable, it assumes **1 million input analyses**, each containing **1,000 tokens (about 4,000 characters)**, with no response scanning. That is 1 billion analyzed input tokens in total.

| Analyzer | Public billing basis | Estimated analysis cost | Cost vs. Pyro | What the estimate covers |
| --- | --- | ---: | ---: | --- |
| **Pyro with [Jev](https://typesafe.ai/)** | $0.042 per million input tokens; output decisions are not metered | **$42.00** + Pyro infrastructure | **1×** | One Jev request returning every enabled detector probability. The 1,000-token allowance must include Pyro's detector questions as well as the input. |
| [Google Cloud Model Armor](https://cloud.google.com/security/products/model-armor) | First 2 million tokens each month are free, then $0.10 per million tokens | **$99.80** | **2.38×** | Input screening only. Google meters the combined prompt and response tokens when both are screened. |
| [Amazon Bedrock Guardrails](https://aws.amazon.com/bedrock/pricing/) | Prompt-attack filter via `InvokeGuardrailChecks`: $0.08 per 1,000 text units; one text unit is up to 1,000 characters | **$320.00** | **7.62×** | The prompt-attack filter only. Content, sensitive-information, and other filters are charged separately. |
| [Check Point AI Guardrails / Lakera Guard](https://docs.lakera.ai/docs/api) | Public product documentation; [pricing is sales-quoted](https://www.checkpoint.com/about-us/contact-us/) | **Not publicly calculable** | — | Managed prompt and agent screening. Check Point does not publish a self-serve usage rate. |
| [Protect AI LLM Guard](https://protectai.github.io/llm-guard/) | Open-source software; you supply the compute for each configured scanner | **Deployment-dependent** | — | Model hosting, CPU/GPU time, and operations. Multiple scanners run individually, so cost depends on the selected set and hardware. |
| [NVIDIA NeMo Guardrails](https://docs.nvidia.com/nemo/guardrails/latest/home) | Open-source framework; configured models and services supply the inference | **Deployment-dependent** | — | Model/API calls and infrastructure used by the selected rails. The framework itself is not a metered prompt-analysis service. |

Under these assumptions, Pyro's external analysis charge is about **58% lower than Model Armor** and **87% lower than Bedrock's prompt-attack filter**.

The arithmetic is based on each vendor's billing meter, not a claim that the products provide identical detection quality or coverage. [Google documents](https://docs.cloud.google.com/model-armor/overview#tokens) roughly four characters per token; AWS bills each 4,000-character input as four text units. The Google estimate subtracts its 2-million-token monthly free tier. Taxes, commitments, logging, networking, Pyro hosting, and storage are excluded. Prices change, so verify the linked vendor pages before budgeting.

TypeSafe separately reports up to **444.6× lower cost** and **193.6× faster execution** in its [System One workflow evaluations](https://typesafe.ai/blog/introducing-system-one-models-and-jev). Those are vendor-run workflow benchmarks against generation models—not head-to-head tests against Google Model Armor, Bedrock Guardrails, or Lakera—so they are not used in the table above. No cross-vendor quality score is presented here because the available public results do not test every product against the same attacks, policy, traffic, and billing boundaries.

### How the products differ

| Existing approach | What it is designed for | When Pyro is the better fit |
| --- | --- | --- |
| [Lakera Guard / Check Point AI Guardrails](https://docs.lakera.ai/docs/prompt-defense) | A managed security product with built-in prompt-attack detection and enforcement. | You want to self-host the monitoring and policy layer, define organization-specific signals, and keep searchable history in your own PostgreSQL database. |
| [Google Cloud Model Armor](https://cloud.google.com/security/products/model-armor) and [Amazon Bedrock Guardrails](https://aws.amazon.com/bedrock/guardrails/) | Managed cloud controls with vendor-defined detectors and integrations. | You want provider-independent application profiles, visible detector questions and thresholds, and a dashboard you operate yourself. |
| [Protect AI LLM Guard](https://protectai.github.io/llm-guard/get_started/quickstart/) | A Python toolkit of individual input and output scanners for concerns such as prompt injection, toxicity, secrets, and anonymization. | You want a language-agnostic HTTP service, application-level policies, and operational history rather than coordinating scanner models inside a Python application. |
| [NVIDIA NeMo Guardrails](https://docs.nvidia.com/nemo/guardrails/latest/home) | A broad Python framework for programmable input, output, retrieval, dialog, and execution rails. | You need focused prompt monitoring and explicit allow/review/block decisions without introducing a conversation runtime or guardrail configuration language. |

These products are not exact substitutes. LLM Guard is a stronger match when you need local PII transformation or many specialized scanners. NeMo Guardrails is a stronger match when you need to control an entire conversation or agent workflow. A managed cloud service may be the easiest choice when all of your inference already lives with that provider. Pyro is strongest when prompt visibility, organization-specific detection, cost control, and editable policy are the priority.

## Configurations are part of the product

Pyro treats protection as configuration rather than magic hidden behind an API. New profiles begin empty, so an application receives only the checks its team deliberately chooses. Teams can start narrowly, inspect real decisions, adjust thresholds, and test a replacement profile in shadow mode before enforcing it.

The **rule and profile library** in [`profiles/`](./profiles/README.md) provides four opt-in YAML presets. Import, export, inspect and edit them from Protection Profiles. Reusable protection packs remain:

- opt-in rather than silently installed;
- readable before they are enabled;
- forkable and editable for each organization;
- stored as readable YAML so changes can be reviewed in source control;
- validated on import, with coverage evaluated against your own traffic.

The goal is not a marketplace of opaque promises. It is a practical catalog of configurations that teams can understand, adapt, and improve.

## Quick start

Pyro is early-beta software. The CLI connects to a server; installing it does not start one. Local rules need no provider account. Semantic screening uses TypeSafe's hosted API and sends the input there.

### 1. Start a server, or use an existing instance

Save [compose.yaml](https://delvisor.com/pyro/compose.yaml) and [.env.example](https://delvisor.com/pyro/pyro.env.example) in an empty folder. No source checkout is needed. With Docker Compose installed:

```sh
cp .env.example .env
# Fill in the four required credentials using the template's generation commands.
docker compose up --build -d
```

Open [the dashboard](http://localhost:3000) and sign in using `ADMIN_PASSWORD` from `.env`. The gateway listens on port 8080 and the management API on 8081. Keep those interfaces private; see [deployment guidance](./SECURITY.md).

### 2. Install the published CLI

Use Node.js 22.13+ and pnpm, or install the same package with your preferred npm-compatible package manager:

```sh
pnpm add --global @delvisor/pyro
pyro config set gateway-url http://localhost:8080
pyro config set control-url http://localhost:8081
pyro auth login
```

Use your own server URLs if connecting to an existing instance. CLI 0.2.0 adds `pyro doctor` for connection diagnostics and `pyro doctor --semantic` to check provider configuration. These checks send no prompts; configured credentials do not prove that a provider is reachable or accurate.

### 3. Get a decision without a provider key

Download [local-secrets.yaml](https://delvisor.com/pyro/profiles/local-secrets.yaml), then run from that folder:

```sh
pyro profiles import --file ./local-secrets.yaml
pyro playground 'Summarize this document.' --profile local-secrets
pyro playground 'Example: -----BEGIN PRIVATE KEY-----' --profile local-secrets
```

Expect `allow` for the first request and `block` for the second. Both use local rules and appear in Activity. The fake header is test data, not a real secret. This verifies integration, not general prompt-injection detection. Imports reject duplicate IDs; skip the import if already installed.

### 4. Enable semantic screening explicitly

Get a key from [TypeSafe](https://console.typesafe.ai/) and add it in **Settings → Classifier provider**. Hosted screening sends inputs to TypeSafe; review its data terms and usage charges. Download and import [balanced-assistant.yaml](https://delvisor.com/pyro/profiles/balanced-assistant.yaml), then select that profile. Local patterns can flag quoted or educational text; evaluate representative benign and attack examples before enforcement.

Without a configured provider, a semantic request returns an `indeterminate` verdict and follows the profile's failure policy. A fail-closed `block` is not evidence of an attack. Keep fail-closed behavior for workloads that require it; use the explicit local-only preset to try Pyro without a key.

### 5. Connect an application

```sh
pyro apps create --name 'Support' --default-profile-id local-secrets
# Substitute the ID returned above.
pyro keys create --name 'Support backend' --app-id APP_ID
# Set PYRO_API_KEY to the one-time key shown in the response.
pyro classify 'Summarize this document.' --profile local-secrets
```

Keep the key on your backend. Your application enforces `allow`, `review`, and `block`; Pyro does not automatically intercept model calls. Begin in staging, or record decisions without changing your existing controls. A successful CLI classification exits 0 for any decision; scripts must inspect `action` and `verdict`.

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

if (decision.action === "block") {
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

if decision["action"] == "block":
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

Configuration, policies, sessions, and activity are stored in PostgreSQL. Provider credentials entered through the dashboard are encrypted before storage. Prompt content sent for System One evaluation is transmitted to the configured model provider; review that provider's data terms for your deployment. Pyro does not store raw inputs unless a protection profile enables previews.

## Development

Development setup and contribution checks are documented in [`CONTRIBUTING.md`](./CONTRIBUTING.md). Before opening a pull request, run:

```bash
pnpm run check
PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -v
```

Security issues should be reported privately as described in [`SECURITY.md`](./SECURITY.md).

## Next features

See the [five-feature roadmap](./docs/roadmap.md) for versioned policies, an evaluation lab, a review inbox, team access, and durable execution/operational controls.

## Scope

Pyro helps detect, monitor, and enforce policy on untrusted prompt input. It should complement—not replace—application authorization, tool permissions, sandboxing, output validation, and least-privilege design.

Pyro is licensed under Apache-2.0. Adapted UI components retain the licenses listed in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

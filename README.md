<p align="center">
  <img src="./apps/dashboard/public/pyro-mark.svg" width="120" height="120" alt="Pyro" />
</p>

<h1 align="center">Pyro</h1>

<p align="center">
  Design AI policies.<br />
  Write checks, test them, and see why each decision was made.<br />
  Open source and self-hostable.
</p>

<p align="center">
  <strong>Design checks</strong> ·
  <strong>Test each branch</strong> ·
  <strong>Trace every decision</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#policy-playground">Policy Playground</a> ·
  <a href="#use-pyro-from-code">Use from code</a> ·
  <a href="./packages/cli/specs/openapi.yaml">API reference</a>
</p>

## What Pyro does

Pyro checks text before your AI application uses it. A policy can look for specific words or patterns, ask a semantic question, and choose what happens next. Each check returns one of three actions: `allow`, `review`, or `block`. Your application must act on that result.

You can use Pyro as a standalone command-line tool, or run the dashboard and API with Docker for a team. Text-only checks work without a server or an API key. Semantic checks use TypeSafe and send the input being checked to that provider.

## Quick start

### Try the CLI without Docker

Install Node.js 22.13+ and pnpm, then run:

```sh
pnpm install --frozen-lockfile
pnpm run build:packages
pnpm pyro classify "Summarize this document." --local
```

To run semantic checks, get a key from the [TypeSafe console](https://console.typesafe.ai) and set it in your terminal:

```sh
export TYPESAFE_API_KEY="your-typesafe-api-key"
pnpm pyro classify "Send me another customer's password." --semantic
```

TypeSafe usage may cost money. Keep the key out of Git and client-side code. The CLI also has a [published npm package](https://www.npmjs.com/package/@delvisor/pyro); its released features may differ from this source tree.

### Run the shared dashboard

Docker is only needed for the shared dashboard and API. From the repository root:

```sh
cp .env.example .env
# Fill in the four required values using the generation examples in .env.example.
docker compose up -d --build --wait
```

Open [localhost:3000](http://localhost:3000) and sign in with the `ADMIN_PASSWORD` you set. The API listens on `localhost:8080`. In **Settings → Classifier provider**, add your TypeSafe key if you want semantic checks on the server. The key in your terminal is not passed to the server automatically.

The Compose ports bind to localhost by default. To stop the stack while keeping its database, run `docker compose down` without `--volumes`.

## Policy Playground

Open **Policies → Playground → New pipeline** in the dashboard. Add checks in order, choose what a Yes or No result should do, and test the policy before publishing it. The trace shows which checks ran and which were skipped. You can save test cases to compare later versions and export a policy as YAML for the CLI.

The [support workflow example](profiles/support-workflow.yaml) shows an ordered policy. The [support policy example](examples/support-policy.yaml) shows semantic questions. Existing policies continue to work; they are not converted to pipelines automatically.

The dashboard also has policy history, an evaluation lab, a review inbox, activity logs, application keys, and team access. A review decision is a request for your application to pause or hand off work; Pyro does not run the application's tools for you.

## Use Pyro from code

Create an application and API key in the dashboard, then call the API from your backend. Keep the key on the server.

### TypeScript

The TypeScript client is in [`packages/sdk`](packages/sdk):

```ts
import { PyroClient } from "@pyro/sdk";

const pyro = new PyroClient({
  baseUrl: "http://localhost:8080",
  apiKey: process.env.PYRO_API_KEY!,
});

const decision = await pyro.classify({ message: "Summarize this document." });
if (decision.action !== "allow") throw new Error(decision.reason);
```

### Python

Install the source client with `pip install -e ./sdks/python`:

```python
import os
from pyro import Pyro

pyro = Pyro(base_url="http://localhost:8080", api_key=os.environ["PYRO_API_KEY"])
decision = pyro.classify({"message": "Summarize this document."})
if decision["action"] != "allow":
    raise RuntimeError(decision["reason"])
```

An async Rust client is also available in [`sdks/rust`](sdks/rust). These SDKs are currently source packages; setting up the cloud service is a separate step.

## Cloud source

This repository also contains the optional cloud application. It uses the same policy engine and dashboard, and adds user accounts, organizations, and API-key access. The hosted service is not public yet. Cloud deployment files are kept outside the public repository; `docker compose up` starts the self-hosted product described above.

## API and data

The [gateway API](packages/cli/specs/openapi.yaml) and [dashboard API](packages/cli/specs/control-plane.openapi.yaml) have OpenAPI specifications. Policies, accounts, and activity are stored in PostgreSQL. Pyro encrypts stored provider credentials and certain retained inputs. Semantic checks send their input to the configured provider, so review that provider's terms before sending sensitive data.

Use unique secrets, back up both PostgreSQL and `CONTROL_PLANE_SECRET`, and restrict access before exposing a server beyond localhost. Pyro has not undergone an independent security audit. If you find a vulnerability, use GitHub's **Report a vulnerability** button rather than opening a public issue.

## Development

Run `pnpm run check` for the TypeScript build and tests. The Python and Rust clients can be checked with:

```sh
PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -v
cargo test --locked --manifest-path sdks/rust/Cargo.toml
```

Pyro helps you make and inspect policy decisions, but it cannot guarantee that an AI application is safe. Your application still needs its own access controls, tool permissions, and handling for `review` and `block` results.

Pyro is licensed under [Apache 2.0](LICENSE). Adapted UI components and dependencies retain the licenses in [Third-Party Notices](THIRD_PARTY_NOTICES.md).

# Pyro Cloud beta

Implemented locally October 2, 2026. This is an optional managed deployment of the existing engine, dashboard and SDKs. It has not been published or deployed by this change. [Local verification results and reproduction commands](cloud-verification.md) document the tested boundaries. The CLI and self-hosted deployment still work independently.

## Architecture

```text
Dashboard / backend SDK
        │ HTTPS
        ▼
Caddy (TLS, static dashboard, public route allowlist)
        │ private Docker network
        ▼
Cloud front door (accounts, organizations, memberships, billing, admission)
        │ fixed organization context
        ├── in-process control plane + gateway + bounded workers per organization
        ├── shared PostgreSQL pool → transaction-local RLS tenant role
        ├── hosted semantic classifier (platform-owned credential)
        ├── Resend (verification, password recovery, invitations)
        └── Razorpay (optional prepaid checkout; signed capture webhook)

PostgreSQL → encrypted pg_dump → separate backup storage
```

Run one cloud process and one PostgreSQL instance on one 4 GB Linux VM initially. No Redis, Kubernetes, per-customer VM or separate vector database is required. Caddy serves the existing dashboard. The packaged cloud image sets `PYRO_PROFILES_DIRECTORY=/app/profiles` so preset discovery also works through installed workspace dependencies. The cloud process reuses the engine and creates fixed organization instances of the gateway and control plane in memory, so caches, queues, circuit breakers and emitters cannot change tenant mid-request. All organizations share one connection pool (maximum 20 connections).

Users are global; memberships belong to organizations. Owner is separate from admin. Existing roles/application grants continue to apply within the selected organization. Customer admins cannot change the supplier key, endpoint, pricing or platform settings. Organization selection requires a current membership; SDK organization comes from the validated key, never a caller-selected organization header.

Every PostgreSQL operation begins a transaction, assumes `pyro_tenant` (no superuser/RLS bypass), and sets `pyro.organization_id` locally. Documents, events and deliveries have composite organization keys and forced RLS. Platform identity/payment documents occupy the reserved `platform` context. The runtime login has no schema ownership or role-creation privileges. RLS protects accidental cross-tenant queries; trusted server code and database administrators remain privileged infrastructure.

This deliberately retains the existing locked JSON document stores. Identity and the credit ledger serialize updates in PostgreSQL, so concurrent spending is atomic. This is a bounded pilot architecture: split identity, ledger entries and large documents into normalized tables before raising the admission caps or running multiple replicas. It is not a claim of enterprise scale or high availability.

## Implemented behavior and limits

- Signup, email verification/resend, password recovery, session logout, invitation acceptance/revocation, organization creation/switching, ownership transfer and organization deletion/export.
- Hash-only application API keys; organization and application isolation for policies/revisions, decisions, reviews, evaluations, jobs, exports and WebSocket events. Live streams recheck access every 500 ms; accepted in-flight work may finish after revocation.
- New organization defaults: 100 trial credits once per account, 120 API requests/minute, 300 dashboard forwarded requests/minute, 2 synchronous classification slots, 2 draft-preview slots (30 previews/minute), 2 durable classification workers, queue depth 20 and 1 evaluation worker. Global API admission: 1,000 requests/minute. Polls count toward these limits.
- Beta capacity: 25 active/suspended organizations, 3 owned organizations per account, 500 accounts, 250 lifetime organizations, 50 members/pending invitations per organization. Up to 20 apps, 100 policies (including archived IDs), 100 customer key records, 10 webhooks, 20 retained datasets and 100 evaluation runs per organization. Stored document byte caps also apply. Expired datasets/runs are cleaned by existing maintenance.
- 100 simultaneous public streams, at most 10 per organization. Dashboard endpoints are capped at 300 requests/minute per client IP and authentication endpoints additionally at 30; outbound production email is capped at 100/day across the deployment. Verify trusted proxy configuration before exposing the service.
- Customer credits are charged before each reached semantic check (a legacy detector batch counts as one): one credit per started 2,000 UTF-8 bytes of the complete provider request, including questions/context. Local-only decisions cost zero credits. Shadow policies and evaluation cases are separate decisions. Automatic provider retries/recovered work reuse the customer charge for the same check for 31 days. Successful and failed admitted attempts consume credits; support can issue an audited corrective grant.
- Every upstream attempt reserves estimated provider spend, including retries, shadows and evaluations. The default monthly reservation ceiling is $30. Reservations use request bytes as a conservative input-token estimate at the configured USD/million-token ceiling; they are not a supplier invoice or an absolute monetary guarantee. Configure the supplier's own hard billing limit and account for any output/fixed fees in your chosen ceiling. Unknown/failed attempts are not refunded automatically. Provider-reported tokens/USD are tracked separately. Metering failure stops work even for a policy with fail-open behavior.
- Cloud semantic policies must use the configured model. Existing incompatible revisions are preserved but cannot execute until an appropriate revision is selected. Provider configuration is managed centrally.
- Webhooks require public HTTPS. DNS validation pins the public address and does not follow redirects. Migrated private-network integrations are disabled before workers start; reconfigure/re-enable them for a public destination.
- Event admission reserves at most 500 MB per organization and 5 GB across the deployment per UTC month, with a 64 KB maximum decision record and 4 KB combined caller metadata/labels. This bounds growth even for free local checks; exhausted storage returns 429, oversized records 413. These are serialized event-byte allowances, not exact physical disk accounting; indexes, replicas, delivery records and backups add overhead. Audit history is capped at 10,000 records per organization.
- Event retention defaults to seven days in the cloud Compose deployment. Input previews default off. Dataset inputs require consent and are encrypted with the installation secret. Organization export includes retained datasets and evaluation results, excluding credentials. Exports are paginated snapshots; stop writes if a consistent point-in-time export is required.
- Deletion blocks admission, drains workers, erases organization operational tables and clears memberships/invitations. Interrupted erasure resumes at startup. Minimal organization tombstones and financial records remain; backups expire according to the operator's retention schedule. Financial/tax retention and public privacy terms must be settled before accepting paying customers.

## Local development

For a complete local cloud dashboard and API, run `pnpm cloud:local` from the repository root with Docker running. This starts `docker-compose.cloud.local.yml` as the separate `pyro-cloud-local` project, generates ignored development secrets in `.env.cloud.local`, and uses a dedicated PostgreSQL volume with the restricted runtime role. It does not reuse the default self-hosted database.

1. Open **http://127.0.0.1:3001** and create an account.
2. Run `pnpm cloud:local:mail your@email.test` and open the verification link. The same command reads local invitations and recovery messages.
3. Create an organization. The sidebar now shows its switcher and **Manage → Org & billing**. Create keys under **API keys**, invite teammates under **Team & audit**, and design a pipeline under **Policies → Playground → New pipeline**.
4. SDK calls can use `baseUrl: "http://127.0.0.1:3001"` or the direct local API at `http://127.0.0.1:9082`. Local mock inference only tests integration and branching, not semantic accuracy. Payments are unconfigured.

Run `pnpm cloud:local:stop` to stop the preview without deleting its data. Keep `.env.cloud.local` with that data volume: changing the encryption secret makes retained data unreadable. To invoke Compose directly after first setup, use `docker compose --env-file .env.cloud.local -f docker-compose.cloud.local.yml up -d --build`.

The default `docker-compose.yml` remains self-hosted mode at http://localhost:3000; rebuilding it does not activate cloud accounts/organizations. Use the documented different hostnames when running both dashboards to keep their browser sessions separate. The production cloud Compose file below requires real HTTPS/email/provider configuration and is not the local preview.

### Without Docker

Use an isolated PostgreSQL database, or `memory://cloud-dev` for disposable single-process experiments. Build workspace dependencies first:

```sh
pnpm install --frozen-lockfile
pnpm --filter @pyro/cloud... build
DATABASE_URL=memory://cloud-dev \
CONTROL_PLANE_SECRET=disposable-development-secret-32-characters \
CLOUD_PLATFORM_TOKEN=disposable-platform-token-32-characters \
CLOUD_PUBLIC_URL=http://localhost:3000 \
CLOUD_EMAIL_MODE=outbox CLOUD_PROVIDER_MODE=mock \
pnpm --filter @pyro/cloud dev
```

In another terminal:

```sh
VITE_CONTROL_TARGET=http://localhost:8082 VITE_GATEWAY_TARGET=http://localhost:8082 \
pnpm --filter @pyro/dashboard dev
```

Outbox mode stores the latest 100 encrypted messages in the platform `email_outbox` document; read/decrypt them through `@pyro/storage` for local tests. There is deliberately no public email-debug endpoint. Production startup rejects memory storage, mock inference, outbox email and non-HTTPS URLs. The TypeScript/Python SDKs detect `pyro_` cloud keys; override `baseUrl`/`base_url` for local tests or another hostname. Rust exposes `PyroClient::cloud(key)`. The built-in API hostname is `https://api.pyro.delvisor.com`; provision that hostname or provide an explicit override before using an unreleased SDK build.

## Production setup (operator-run; not performed by this change)

1. Provision a 4 GB Linux VM, enable provider account budgets, firewall SSH to trusted addresses and expose only 80/443 publicly. Install Docker Compose. Keep PostgreSQL unexposed; cloud admin port 8082 binds localhost. The Compose subnet `172.29.48.0/24` must not overlap your network.
2. Point dashboard/API DNS records at the VM. Copy `.env.cloud.example` to `.env.cloud`; generate each secret separately with `openssl rand -hex 32`. Use hex database passwords so they are safe in the connection URLs. Keep this file mode 600. Back up the encryption secret separately: database backups alone cannot decrypt retained inputs.
3. Configure/verify the sender domain with Resend, supply the upstream key/model, verify supplier pricing, and set `CLOUD_PROVIDER_PRICE_PER_MILLION`. Configure the supplier billing cap. Set the actual dashboard and API domains. Do not reuse local test secrets.
4. Build on a development machine/CI if the VM lacks build memory. Start with `docker compose --env-file .env.cloud -f docker-compose.cloud.yml up -d --build`. Fresh database initialization creates the restricted runtime login. The one-shot migration service uses a separate privileged login; its password is not injected into the running cloud service. Health checks gate startup.
5. If using Razorpay, complete merchant onboarding, configure automatic capture, add `https://YOUR_API_DOMAIN/api/billing/webhook` for `payment.captured`, and configure the exact webhook secret. The browser callback never grants credits; only the verified raw-body webhook with the stored order/amount/currency does. Duplicate capture notifications grant once. Test both successful and failed payments with test credentials before enabling live checkout. Leave payment variables blank for invitation-only pilots with manual prepaid grants.
6. Run an external uptime check on `/health`, monitor disk/memory/container restarts, configure host alerts at 70% disk and 80% memory, and check `/platform/status` through SSH for provider reservations. Set alerts before public signup; container restart alone is not an incident response plan.
7. Publish pricing, credit unit/failure semantics, retention/privacy/provider disclosure, terms, refund/support policy and appropriate invoices. The sample ₹1,999/25,000-credit pack is configurable, not a validated business price or tax calculation. Complete a real email delivery, backup recovery, live provider and payment sandbox smoke test before admitting customers.

The Caddy configuration hides `/platform/*` (including prefixed variants) from the public edge. Over an SSH tunnel to localhost:8082, use `Authorization: Bearer $CLOUD_PLATFORM_TOKEN` with:

- `GET /platform/status`: organization states and reserved/reported provider usage.
- `POST /platform/credits`: `{ "orgId": "...", "credits": 100, "reference": "unique-support-ticket-123" }`. Reusing the reference grants once; never use it for a different organization.
- `PUT /platform/organizations/:id`: `{ "status": "suspended" }` or `active`. Suspension stops new work and closes access through periodic stream checks.

Rotate application keys through the dashboard. Rotate the platform token by restarting with the new value. Preserve `CONTROL_PLANE_SECRET` during upgrades; changing it requires decrypting/re-encrypting retained data and invalidates the internal playground key. Replacing the supplier key is a configuration restart.

## Migrating an existing self-hosted installation

Stop all old gateway/control-plane processes and take an encrypted database backup before schema migration. Keep the same encryption secret. Test on a restored copy first.

Schema migration 3 backfills legacy rows into `default`, changes constraints/indexes to include organization and adds RLS. It accepts the previously renamed legacy table constraint names. Migration requires table ownership and permission to create/grant the tenant role. The new code continues to support self-hosted operation in `default`; old binaries cannot safely write this new schema.

On first cloud startup, existing users become global accounts with memberships in `Default organization`. The existing active `admin` (or first active administrator) becomes owner; passwords/hashes and app grants are preserved. Supply `ADMIN_PASSWORD` for a bootstrap administrator whose password was previously environment-only. Cloud sessions require a fresh login. Email-based legacy SSO users can recover a password; cloud OIDC is not implemented, and non-email SSO usernames need an operator-assisted identity migration before cutover. Existing profiles, events, datasets, API keys and durable jobs remain in the default organization. Legacy keys need an explicit cloud base URL because their prefix keeps the self-hosted SDK default.

For an existing database, `init-db.sh` is not rerun by PostgreSQL. Create the restricted `pyro_runtime` login manually and grant membership in `pyro_tenant` after running migrations; do not switch cloud to runtime credentials until that step is verified. The legacy organization needs an audited credit grant before semantic calls resume. The platform does not import a customer's supplier credentials as the managed cloud supplier key.

Rollback means stopping cloud, restoring the pre-migration database into a fresh database/volume and starting the previous binaries with their original secret. Do not run the old version against migrated tables or drop RLS to make it work.

## Backups and recovery

Install `age` on the backup host. Keep its private identity off the service VM where possible. From the repository root, run `AGE_RECIPIENT=... BACKUP_DIRECTORY=... deploy/cloud/backup.sh`. It writes an encrypted custom-format PostgreSQL archive atomically. Copy it to independent storage. Configure a nightly schedule and seven-day expiry there; the script intentionally does not assume a storage account or silently configure a scheduler.

Run a monthly recovery exercise with `AGE_IDENTITY=/secure/key.txt BACKUP_FILE=... deploy/cloud/restore-drill.sh`. It restores into a new database, verifies schema/organization counts, and never overwrites production. Start a test cloud instance against that database using the matching encryption secret and mock/outbox development settings, then verify logins, keys, organization isolation and retained inputs before declaring the drill successful. Reapply deletion/suspension records newer than the backup before reopening traffic. A daily backup has up to 24 hours of potential data loss; restore duration is not an availability guarantee.

A single VM is a deliberate cost tradeoff: host failure interrupts service until restore. Add a managed database/second instance after paid demand justifies the recurring expense and after testing multi-process behavior.

## Six-month spending envelope

Allocation, not a promise of a fixed bill. AWS currently lists a Linux Lightsail 4 GB/2 vCPU/80 GB public IPv4 bundle at $24/month; check the selected region, transfer allowance and applicable taxes before ordering ([official pricing](https://aws.amazon.com/lightsail/pricing/), checked October 2, 2026). Use ₹100/USD as a conservative planning conversion, not a live exchange-rate quote.

| Item | Monthly ceiling | Six months |
|---|---:|---:|
| VM | ₹2,400 | ₹14,400 |
| Inference reservation budget ($30) | ₹3,000 | ₹18,000 |
| Encrypted backups, domain, email/monitoring allowance | ₹600 | ₹3,600 |
| Infrastructure tax/FX/incident cushion | ₹1,000 | ₹6,000 |
| Marketing experiments, released after user validation | — | ₹30,000 |
| Unallocated reserve/support | — | ₹28,000 |
| Total allocation | | **₹1,00,000** |

This leaves six months without assuming revenue. Resend's free plan currently has a 100-email daily limit; the application mirrors that cap ([official pricing](https://resend.com/pricing/)). Payment fees, tax obligations and refunds must be funded from sales or the reserve. Don't buy annual infrastructure commitments or raise inference limits to chase traffic before measuring conversion and cost per useful decision.

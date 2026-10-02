# Cloud migration verification — October 2, 2026

All work was verified locally using disposable databases/accounts. Nothing was pushed, published or deployed to a public host. See [cloud architecture, cost envelope and launch runbook](cloud.md).

| Check | Result |
|---|---|
| `pnpm check` with both PostgreSQL test URLs configured | Passed: all workspace type checks, production builds and **93 Node tests**, zero failures/skips |
| Python SDK unit tests | 2 passed |
| Rust SDK tests | 2 passed |
| PostgreSQL migration | Actual pre-cloud v2 DDL and renamed historical constraints migrate into `default`; same record IDs in another organization remain independent |
| RLS | Concurrent reads through the shared pool isolate tenants; unset context returns no rows; cross-tenant inserts fail |
| Cloud API | Authentication/recovery, email-bound invitations, membership revocation, key revocation, scoped decisions/jobs/datasets/evaluations/exports, model restrictions, encoded managed-key paths and resource limits pass |
| Credit/provider admission | Concurrent calls cannot overspend; signed duplicate captures grant once; tampered payment bodies fail; every retry reserves spend; metering failures cannot fail open |
| WebSocket streams | SDK and dashboard receive only their organization’s decisions; revocation closes streams |
| Durable recovery | Existing legacy keys work; queued work and idempotency survive a cloud process restart |
| Packaged Docker service | Fresh restricted runtime role (no superuser, role creation or RLS bypass); signup → verification → organization → key → mock classification → deletion passes |
| Caddy edge | Serves built dashboard and API; denies platform administration through normal, prefixed and encoded paths |
| Encrypted backups | `backup.sh` produced an age-encrypted archive; `restore-drill.sh` restored it into a separate database; restored cloud login, memberships and encrypted outbox decryption passed |
| Recovery of populated data | Separate restored database preserved password login, both organizations and an existing API key; classification succeeded after restore |
| Browser | Desktop/mobile, light/dark, signup/verification, organization creation/switching, key creation, SDK snippet, billing/storage allowance, team dialog, managed provider/model controls and recovery-link routing checked |
| Local load smoke | 25 organization runtimes, 100 HTTP mock classifications at concurrency 10; all returned 200 |

The load smoke used local PostgreSQL and a mock classifier. It is not a production capacity benchmark or latency/SLO claim. Real email delivery, paid upstream inference, payment sandbox/live capture, public DNS/TLS issuance, scheduled off-site backup uploads and alerts require the operator accounts/configuration listed in the launch runbook. Those external actions were not performed.

The build retains the existing Vite warning about a large dashboard JavaScript chunk. Builds succeed; bundle optimization is a separate performance task.

## Private staging configuration follow-up — October 2, 2026

The staging template now uses `docker-compose.cloud.staging.yml`, binding its web and administration ports only to loopback for Tailscale Serve. A completed temporary env file passed generated-secret uniqueness/permissions and Compose preflight; missing tailnet hostname and existing-file overwrite were rejected. The rendered Compose configuration was checked for non-loopback published ports and the private Caddyfile validated with Caddy 2. No VM, Tailscale tailnet, real email delivery or live provider call was available for an external smoke test; those remain operator steps.

## Local preview follow-up — October 2, 2026

The default self-hosted Compose stack was confirmed to contain the new pipeline UI and engine: authenticated draft previews returned both allow/block branches with traces, and YAML export succeeded. Existing saved signal-based policies were preserved, so the pipeline editor is reached through **Policy Playground → New pipeline**. Organization and billing controls require the cloud backend and do not appear in self-hosted mode.

`pnpm cloud:local` now provides a separate local cloud stack at http://127.0.0.1:3001 with generated ignored secrets, a dedicated persistent PostgreSQL volume, the restricted runtime role, mock inference and an encrypted local email outbox. The fresh Docker build/start, packaged account/organization/key/classification/deletion smoke, dashboard/API edge routing and encoded platform-route denials passed. Browser verification covered sign-in, organization creation, the organization switcher, opening the pipeline builder and its mock semantic execution trace. `pnpm cloud:local:mail` successfully reads local verification emails. The preview needs no external email, inference or payment account.

Repeating `pnpm cloud:local` preserved the generated secrets and the existing browser session, organization and credit balance after container recreation. The original self-hosted containers remained running throughout verification.

## Reproduce

Use dedicated databases with migration privileges. The migration test creates and removes a randomly named test database. Never point these test variables at production:

```sh
TEST_DATABASE_URL=postgresql://.../pyro_storage_test \
CLOUD_TEST_DATABASE_URL=postgresql://.../pyro_cloud_test \
LOG_LEVEL=silent pnpm check
PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests
cargo test --manifest-path sdks/rust/Cargo.toml
```

`pnpm check` builds services before tests because the cloud tests exercise the compiled gateway/control-plane package exports. The recovery tests use deterministic lease expiry/cancellation coordination instead of narrow wall-clock races.

For the Docker smoke, use a **disposable** cloud Compose project with `NODE_ENV=development`, `CLOUD_EMAIL_MODE=outbox`, `CLOUD_PROVIDER_MODE=mock`, a loopback HTTP public URL and a loopback port mapping. The script verifies mock/outbox mode before creating test accounts. It deletes its organization but leaves a global test account/tombstone; dispose of the test database afterward.

```sh
CLOUD_SMOKE_CONTAINER=your-disposable-cloud-container \
CLOUD_SMOKE_URL=http://127.0.0.1:9082 \
pnpm --filter @pyro/cloud test:docker

# Run the cloud-web image on a loopback HTTP port with the same private network.
CLOUD_EDGE_SMOKE_URL=http://127.0.0.1:9180 pnpm --filter @pyro/cloud test:edge
```

Backup scripts accept `CLOUD_ENV_FILE` and `CLOUD_COMPOSE_FILE` to select a disposable/private environment, plus normal Compose project selection through `COMPOSE_PROJECT_NAME`. They require Docker Compose and age; the restore script always creates a new database. Keep backup decryption identities out of Git.

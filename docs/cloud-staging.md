# Cloud staging setup

This is the cheapest internet-facing deployment of the real cloud stack. It uses one VM for PostgreSQL, the cloud API and Caddy; Cloudflare only hosts the DNS zone on its [free DNS plan](https://developers.cloudflare.com/dns/faq/), with both staging records set to **DNS only**. Caddy obtains HTTPS certificates. The website can remain on Vercel. No managed database, Kubernetes, paid DNS or Google OAuth setup is involved. The local mock/outbox preview remains `pnpm cloud:local` and is separate from this staging stack.

## Accounts and cost

| Component | Staging choice | Cost control |
|---|---|---|
| Compute | Try an Oracle Cloud Always Free **Ampere A1** VM with 2 OCPUs and 12 GB RAM, Ubuntu ARM64, in your chosen home region. If capacity is unavailable, use a 4 GB VM; AWS Lightsail's public-IPv4 4 GB Linux bundle is listed at $24/month. | A1 capacity can be unavailable; do not treat a temporary free trial credit as an enduring free tier. The production Compose images also run on Linux ARM64, but perform the real staging smoke below before inviting testers. [Oracle Always Free limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Lightsail pricing](https://aws.amazon.com/lightsail/pricing/) |
| DNS/TLS | Existing Cloudflare zone, free DNS-only A records; Caddy on the VM. | No Cloudflare proxy or paid certificate. [Caddy HTTPS requirements](https://caddyserver.com/docs/quick-starts/https) |
| Account email | Resend Free after verifying a sender domain. | Resend currently lists 3,000/month and 100/day; the application also caps production email at 100/day. [Resend pricing](https://resend.com/pricing/) |
| Semantic provider | TypeSafe/Jev platform account and one API key. | `CLOUD_PROVIDER_BUDGET_MICROS=5000000` reserves at most $5/month in Pyro; set a supplier-side billing limit too. This application reservation is not a guaranteed invoice cap. Verify the supplier's actual current pricing before setting `CLOUD_PROVIDER_PRICE_PER_MILLION`. |
| Payments | Disabled. | Leave all three `RAZORPAY_*` variables blank. |

The VM is the only unavoidable recurring server charge if an Always Free instance is unavailable. Do not put real customer data on this staging instance. If staging data matters, use the encrypted backup procedure in [cloud.md](cloud.md#backups-and-recovery) and copy the archive off the VM.

## 1. Prepare the VM and DNS

Provision the VM with a **stable public IPv4 address**. Install Docker Engine and the Compose plugin; open TCP 80/443 to the internet and restrict SSH to your IP. Keep PostgreSQL and port 8082 closed externally: Compose binds its admin port only to VM loopback. Confirm that `172.29.48.0/24` does not conflict with a VM network. An A1 VM is ARM64, so use an ARM64 Ubuntu image. Build on the VM if it has enough memory, otherwise build images elsewhere and transfer them using your normal image workflow.

In **Cloudflare → delvisor.com → DNS**, add these two records, both pointing to the VM's public IPv4. Set **Proxy status: DNS only** (gray cloud); do not add an AAAA record unless the VM has working public IPv6 and you have tested it. Leave the website's existing DNS records alone.

| Type | Name in the `delvisor.com` zone | Resulting hostname |
|---|---|---|
| A | `staging.pyro` | `staging.pyro.delvisor.com` |
| A | `api.staging.pyro` | `api.staging.pyro.delvisor.com` |

The names can be changed in the staging env file, but the DNS and env values must agree. You do not configure these VM hostnames in Vercel. Verify the answers with `dig +short A staging.pyro.delvisor.com` and `dig +short A api.staging.pyro.delvisor.com` before starting Caddy.

## 2. Obtain the external values

1. In Resend, add and verify a sending domain such as `mail.pyro.delvisor.com`. Add the exact SPF/DKIM records Resend shows to the same Cloudflare DNS zone. Create a Resend API key. Use a sender such as `Pyro Staging <accounts@mail.pyro.delvisor.com>` only after verification. `ACME_EMAIL` is a separate, working inbox for certificate notices; it does not send account emails.
2. Create a TypeSafe/Jev API key. Confirm its current endpoint, model and **USD per million tokens** price ceiling from the supplier. [TypeSafe's September 2026 announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev) lists $0.042 per million input tokens for the direct model, with free output tokens; check the rate in your own account before using it. If your direct-account rate matches, `0.10` is a conservative staging ceiling. Set the supplier account's own billing limit as low as practical (for example $5/month) before giving the key to staging.
3. Keep Razorpay unset. Staging runs the same production-mode signup, email verification, organization and SDK paths as the intended cloud offer. Mock inference and the local email outbox are rejected in this mode.

## 3. Create and check the env file

From the Pyro repository root, with Node 22+ and pnpm installed:

```sh
pnpm cloud:staging:init
```

This creates ignored `.env.cloud.staging` with four independently generated 32-byte secrets and file mode 600. It will never overwrite an existing file. Fill every blank value:

| Variable | Set it to |
|---|---|
| `STAGING_VM_IPV4` | VM public IPv4; used by the staging DNS preflight, not injected into the app. |
| `CLOUD_DOMAIN`, `CLOUD_API_DOMAIN` | The two staging hostnames above, without `https://`. |
| `ACME_EMAIL` | An inbox you control for Caddy's certificate account. |
| `CLOUD_EMAIL_FROM`, `RESEND_API_KEY` | Verified Resend sender and its API key. |
| `TYPESAFE_API_KEY`, `TYPESAFE_ENDPOINT`, `TYPESAFE_MODEL` | Real supplier credentials/configuration. |
| `CLOUD_PROVIDER_PRICE_PER_MILLION` | Supplier-verified positive USD price ceiling. |

The generated `POSTGRES_PASSWORD`, `PYRO_RUNTIME_PASSWORD`, `CONTROL_PLANE_SECRET` and `CLOUD_PLATFORM_TOKEN` are already filled. Keep them unchanged while the staging database exists, especially `CONTROL_PLANE_SECRET`, which encrypts retained data. The template sets a $5 monthly application reservation budget, five organizations and 20 trial credits per account; adjust only if needed. All `RAZORPAY_*` values should remain blank. The Compose file derives `CLOUD_PUBLIC_URL=https://CLOUD_DOMAIN` and fixes `CLOUD_EMAIL_MODE=resend`, `CLOUD_PROVIDER_MODE=jev` and both database URLs; do not add those variables to the env file. There is no Google OAuth configuration because cloud OIDC is not implemented.

```sh
pnpm cloud:staging:check
```

The check verifies required fields, separate secrets, safe file permissions and `docker compose config --quiet`. It does not reveal secret values or contact the supplier. Once DNS is live, run `pnpm cloud:staging:dns`; it requires both hostnames to resolve directly and only to `STAGING_VM_IPV4`, with no stray AAAA record.

## 4. Start and verify staging

Transfer the code and `.env.cloud.staging` to the VM through a secure channel; keep the env file at mode 600 and out of Git. On the VM, from the repository root:

```sh
pnpm cloud:staging:check
pnpm cloud:staging:up
```

`cloud:staging:up` repeats the config/DNS checks and starts `docker-compose.cloud.yml` as the separate `pyro-cloud-staging` project with `--build --wait`. It does not use the self-hosted or local-preview volumes. If the VM lacks Node/pnpm, perform the preflight on a machine with the same checkout/env file, then on the VM run `docker compose --project-name pyro-cloud-staging --env-file .env.cloud.staging -f docker-compose.cloud.yml up -d --build --wait`.

Smoke test in order: `curl -f https://api.staging.pyro.delvisor.com/health`, open `https://staging.pyro.delvisor.com`, sign up, receive the verification email, create an organization and key, then make one SDK call using **explicit** `baseUrl: "https://api.staging.pyro.delvisor.com"` (Python: `base_url`). Published SDK defaults still target the production API hostname. Test one local-only policy and one semantic policy; confirm the latter changes supplier usage and Pyro's `/platform/status` reservation. Do not enable paid checkout for staging.

If you take backups, use `CLOUD_ENV_FILE=.env.cloud.staging COMPOSE_PROJECT_NAME=pyro-cloud-staging` with the existing backup/restore scripts. Set an external uptime check and a VM budget alert before sharing the link. The script does not provision accounts, DNS or a VM; those operator steps require your provider credentials.

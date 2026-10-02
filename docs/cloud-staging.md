# Private cloud staging

Staging runs the real cloud app, PostgreSQL, Resend email and Jev integration on one VM. **It does not publish the dashboard or API to the internet.** Docker binds the web edge to `127.0.0.1:3001` and administration to `127.0.0.1:8082`; [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) gives approved tailnet devices a private HTTPS `*.ts.net` URL. The dashboard and API share that one origin. Use Serve, **not Funnel**: [Funnel makes a service public](https://tailscale.com/docs/features/tailscale-funnel).

No staging A records, Cloudflare proxy, Vercel configuration, public 80/443 ingress or `ACME_EMAIL` are needed. Caddy routes requests internally, while Tailscale handles HTTPS. Cloudflare remains relevant only for Resend's sender-domain verification records if you use `delvisor.com` for account email.

## Cost choices

| Component | Choice |
|---|---|
| VM | An [AWS Lightsail 2 GB VM in Mumbai](aws-staging.md) is the chosen low-traffic staging host; the Linux public-IPv4 bundle is currently [listed at $12/month](https://aws.amazon.com/lightsail/pricing/), before snapshots and tax. Build application images on the development machine. |
| Tailnet | Pyro is Apache-2.0 under a GitHub organization, so investigate Tailscale's [Community on GitHub plan](https://tailscale.com/docs/reference/free-plans-discounts) for a free project test server; eligibility/application is external. The free Personal plan is [for non-commercial use](https://tailscale.com/pricing), so do not assume it covers a business pilot. Standard is currently $8/user/month plus $1/month per tagged resource if the community plan is unavailable. |
| Account email | [Resend Free](https://resend.com/pricing/) currently lists 3,000 emails/month and 100/day. |
| Inference | The template reserves at most $5/month in Pyro (`CLOUD_PROVIDER_BUDGET_MICROS=5000000`); set a supplier-side cap where available. Provider charges remain separate, and Pyro's reservation is not an invoice guarantee. |
| Payments | Disabled; all `RAZORPAY_*` values stay blank. |

For one-person, mock-only testing with no Tailscale or external credentials, run `pnpm cloud:local` and use an SSH tunnel to its loopback port on a remote VM. That path does **not** exercise real email, TLS or semantic inference. Self-managed WireGuard is another private-network option but requires maintaining VPN keys and HTTPS certificates yourself.

## 1. Prepare the VM and tailnet

For the chosen AWS Mumbai Lightsail instance, follow the [console, firewall,
host-install, off-VM build and transfer steps](aws-staging.md). The instructions
below also apply to another VM provider.

Provision the VM and install a current Docker Engine and Compose plugin. Docker versions before 28 had a [loopback port-publishing caveat](https://docs.docker.com/engine/network/port-publishing/); use Engine 28+ and keep the cloud firewall closed for public 80/443 and 3001/8082. Restrict SSH to trusted addresses. The Compose subnet `172.29.48.0/24` must not overlap your VM network.

Install Tailscale on the VM and every device that should access staging. Connect the VM with `tailscale up`; enable MagicDNS and HTTPS certificates in the tailnet settings. Restrict access to the VM's HTTPS service with your tailnet policy. Get the VM's full MagicDNS name (for example `pyro-staging.your-tailnet.ts.net`) from `tailscale status --json` or the Tailscale admin console. The name appears in public certificate-transparency logs, but the service remains tailnet-only. The staging `up` command checks that the configured name matches the VM, then starts Tailscale Serve in the background.

## 2. Obtain email and inference credentials

In Resend, verify a sending domain such as `mail.pyro.delvisor.com`; add the exact DNS records Resend gives you to the current DNS zone. Set `CLOUD_EMAIL_FROM` to a verified sender such as `Pyro Staging <accounts@mail.pyro.delvisor.com>`. Email verification, recovery and invite links will point to the private tailnet URL, so recipients must have tailnet access to open them.

Create a TypeSafe/Jev API key and confirm its endpoint, model and rate. [TypeSafe's September 2026 announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev) lists $0.042 per million input tokens on the direct route, with output free; confirm your account's rate before entering `CLOUD_PROVIDER_PRICE_PER_MILLION`. If the direct-account rate matches, `0.10` is a conservative staging ceiling. Configure the supplier's own spending limit if it offers one.

## 3. Fill and check the staging env

From the Pyro repository root, with Node 22+ and pnpm installed:

```sh
pnpm cloud:staging:init
```

This creates ignored `.env.cloud.staging` with four unique 32-byte secrets at file mode 600. It never overwrites existing secrets. Fill these values:

| Variable | Meaning |
|---|---|
| `TAILSCALE_DOMAIN` | VM's exact `*.ts.net` MagicDNS hostname, without `https://`. |
| `CLOUD_EMAIL_FROM`, `RESEND_API_KEY` | Verified outbound sender and Resend API key. |
| `TYPESAFE_API_KEY`, `TYPESAFE_ENDPOINT`, `TYPESAFE_MODEL` | Real supplier credentials and model. |
| `CLOUD_PROVIDER_PRICE_PER_MILLION` | Supplier-verified positive USD price ceiling. |

The generated `POSTGRES_PASSWORD`, `PYRO_RUNTIME_PASSWORD`, `CONTROL_PLANE_SECRET` and `CLOUD_PLATFORM_TOKEN` are already set; retain them while staging data exists. The template limits staging to five organizations and 20 trial credits per account. The Compose file derives `CLOUD_PUBLIC_URL=https://TAILSCALE_DOMAIN`, uses production mode with Resend and Jev, and creates the two database URLs. There is no Google OAuth env because cloud OIDC is not implemented.

If you have an `.env.cloud.staging` from the earlier **public** staging template, retain its four generated secrets, remove `STAGING_VM_IPV4`, `CLOUD_DOMAIN`, `CLOUD_API_DOMAIN` and `ACME_EMAIL`, then add `TAILSCALE_DOMAIN=`. The validator rejects the old public fields rather than silently opening a public service.

```sh
pnpm cloud:staging:check
```

The check validates required fields, secrets, file permissions and the rendered Compose configuration. It explicitly rejects any published port that is not bound to loopback. It does not print secrets, call the supplier or require Tailscale on your local development machine.

## 4. Start and verify

Transfer the code and `.env.cloud.staging` to the VM through a secure channel. Keep the env file out of Git and at mode 600. On the VM:

```sh
pnpm cloud:staging:check
pnpm cloud:staging:up
tailscale serve status
```

`up` checks the VM's tailnet name, starts `docker-compose.cloud.staging.yml` as the isolated `pyro-cloud-staging` project with `--build --wait`, and runs `tailscale serve --bg --https=443 http://127.0.0.1:3001`. The AWS 2 GB runbook uses prebuilt images and `--no-build` instead; prefer that path on the small VM. Give the invoking user Tailscale operator permission or rerun the Serve command with the needed privileges if Tailscale refuses it. Do not use the public `docker-compose.cloud.yml` for staging.

From a permitted tailnet device, `curl -f https://YOUR-VM-NAME.ts.net/health`, open the same URL in a browser, sign up, receive the verification email, create an organization and API key, and make a TypeScript/Python SDK call with `baseUrl`/`base_url` set to that **same** private HTTPS origin. Published SDK defaults point to the future production API hostname. Test a local-only policy and one semantic policy; check supplier usage and Pyro's `/platform/status` reservation through SSH.

For encrypted backup and restore scripts, set `CLOUD_ENV_FILE=.env.cloud.staging`, `CLOUD_COMPOSE_FILE=docker-compose.cloud.staging.yml` and `COMPOSE_PROJECT_NAME=pyro-cloud-staging`. If staging holds useful data, copy encrypted backups off the VM. An external uptime monitor cannot reach this private service; use an approved tailnet device or a VM-local check instead. The scripts do not provision the VM or external accounts.

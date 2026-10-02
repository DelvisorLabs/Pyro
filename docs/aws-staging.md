# AWS Mumbai private staging runbook

Use this with [private cloud staging](cloud-staging.md). Staging is a single
Lightsail VM in `ap-south-1` (Mumbai), with PostgreSQL, Pyro Cloud and the
dashboard/Caddy edge in Docker. Tailscale Serve gives approved tailnet devices
private HTTPS. Do not create a public DNS record or open web/database ports in
the Lightsail firewall. Production is a separate deployment and is not covered
by these commands.

## 1. Create and secure the VM

1. Use an AWS identity with MFA, then create a monthly AWS budget and alert.
   In [Lightsail](https://lightsail.aws.amazon.com/), select **Mumbai
   (`ap-south-1`)**. Create an **OS Only → Ubuntu 24.04 LTS** Linux instance,
   **4 GB RAM / 2 vCPU / 80 GB** (currently $24/month before tax, snapshots and
   any excess transfer), named `pyro-staging-in`. Record its public IP and
   download/protect the SSH key. Do not put the key in this repository. On the
   instance's browser SSH terminal, record
   `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` and compare that
   fingerprint with your first terminal SSH connection.
2. In **Networking → IPv4 firewall**, delete the default HTTP/80 rule. Restrict
   SSH/22 to your current public IPv4 `/32` while bootstrapping. If you need
   Lightsail browser SSH, enable its separate browser SSH allowance for the SSH
   rule. Check the **IPv6 firewall separately** and remove broad ingress there.
   Leave 443, 3001, 8082 and 5432 closed. Do not attach a load balancer.
3. In **Snapshots**, enable daily automatic snapshots. Lightsail retains the
   latest seven, bills by stored GB, and removes them with the instance; they
   are an initial recovery layer, not an independent database backup.

Lightsail's firewall governs the public interface. Docker publishes only
`127.0.0.1:3001` for web and `127.0.0.1:8082` for administration. Docker Engine
28 or later is required because older versions could expose loopback-published
ports to a local network segment.

## 2. Install host software

SSH into the new VM as `ubuntu`. Install security updates and Docker from its
official Ubuntu repository. Keep Docker commands behind `sudo`; membership in
the `docker` group is root-equivalent.

```sh
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker version
sudo docker compose version
```

Install Tailscale from its [Ubuntu 24.04 package repository](https://dl.tailscale.com/stable/#ubuntu-noble):

```sh
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list >/dev/null
sudo apt-get update
sudo apt-get install -y tailscale
sudo tailscale up --hostname=pyro-staging-in
tailscale status
```

Open the one-time URL printed by `tailscale up` to add the VM to your tailnet.
Do not paste an auth key into a shared terminal or this repository. In the
[Tailscale DNS settings](https://tailscale.com/docs/how-to/set-up-https-certificates),
enable MagicDNS and HTTPS certificates. Pick a machine name you are willing to
have appear in public certificate-transparency logs. Copy the VM's full
`*.ts.net` name from the Tailscale Machines page.

In [Tailscale Access controls](https://tailscale.com/docs/features/access-control/grants),
tag this server `tag:pyro-staging` and grant your own account TCP 22 and 443 to
that tag. Audit existing wildcard allow rules: a new restrictive grant does not
cancel a broad rule. Test both an allowed and an unapproved tailnet identity
before treating staging as private. Once SSH works over Tailscale, remove the
public SSH/22 firewall rule too. Your laptop must also be connected to the
tailnet to open the site or SSH to it.

## 3. Set local credentials and preflight

On your development machine, from the Pyro repository root:

```sh
pnpm cloud:staging:init
```

If `.env.cloud.staging` already exists, keep its four generated secrets; `init`
will deliberately refuse to overwrite it. Edit the ignored file locally and
set `TAILSCALE_DOMAIN` to the VM's exact `*.ts.net` name, plus
`CLOUD_EMAIL_FROM`, `RESEND_API_KEY`, `TYPESAFE_API_KEY` and
`CLOUD_PROVIDER_PRICE_PER_MILLION`. Use a verified Resend sender. The provider
key is a **service-level TypeSafe/Jev credential**; a Pyro API key created inside
an organization is for SDK authentication and cannot replace it. Check the
supplier rate and set a supplier-side spending cap. Keep Razorpay fields blank.
Never paste credentials into chat or Git.

```sh
chmod 600 .env.cloud.staging
pnpm cloud:staging:check
```

`check` validates the env, rendered Compose file and loopback-only published
ports without printing secrets. It runs on the development machine; the VM
does not need Node or pnpm because the Docker build contains both.

## 4. Transfer exactly the committed code and start

From your development machine, after the VM and laptop are on the tailnet,
replace the SSH key path and VM hostname below. `git archive HEAD` sends the
committed tree only, excluding unrelated uncommitted work and local secrets.
The env is copied separately over encrypted SSH. The Tailscale access policy
must allow your account TCP 22 to this VM.

```sh
git archive HEAD | ssh -i /path/to/lightsail-key.pem ubuntu@pyro-staging-in.YOUR-TAILNET.ts.net 'mkdir -p ~/pyro && tar -x -C ~/pyro'
scp -i /path/to/lightsail-key.pem .env.cloud.staging ubuntu@pyro-staging-in.YOUR-TAILNET.ts.net:~/pyro/
```

On the VM:

```sh
cd ~/pyro
chmod 600 .env.cloud.staging
sudo docker compose --project-name pyro-cloud-staging --env-file .env.cloud.staging -f docker-compose.cloud.staging.yml config --quiet
sudo docker compose --project-name pyro-cloud-staging --env-file .env.cloud.staging -f docker-compose.cloud.staging.yml up -d --build --wait
sudo tailscale serve --bg --https=443 http://127.0.0.1:3001
tailscale serve status
curl -fsS http://127.0.0.1:3001/health
sudo docker compose --project-name pyro-cloud-staging --env-file .env.cloud.staging -f docker-compose.cloud.staging.yml ps
```

Do not use `docker-compose.cloud.yml` for private staging and never use
`tailscale funnel`. If a command fails, inspect `sudo docker compose
--project-name pyro-cloud-staging --env-file .env.cloud.staging -f
docker-compose.cloud.staging.yml logs --tail=100 cloud` on the VM; do not share
raw logs without checking them for sensitive data.

## 5. Prove access and protect the data

From an approved tailnet device, open
`https://pyro-staging-in.YOUR-TAILNET.ts.net`, run `curl -fsS
https://pyro-staging-in.YOUR-TAILNET.ts.net/health`, create an account, follow
the Resend verification link, create an organization and Pyro API key, and test
one local policy and one semantic policy. Set an SDK's `baseUrl`/`base_url` to
this same private HTTPS origin. Confirm the URL is unreachable from a device
outside the tailnet and that the Lightsail firewall has no public app or
database ingress. Check Resend delivery, provider usage, the budget alert, and
`tailscale serve status`.

Before inviting testers or storing useful data, run the [encrypted PostgreSQL
backup and restore drill](cloud.md#backups-and-recovery), copy backups off this
VM, and keep the age private identity off this VM. Snapshots alone disappear
when the source instance is deleted. Apply OS and Docker updates regularly and
retest after upgrades.

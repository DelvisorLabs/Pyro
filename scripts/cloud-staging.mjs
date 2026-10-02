import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const templateFile = fileURLToPath(new URL("../.env.cloud.staging.example", import.meta.url));
const defaultEnvFile = fileURLToPath(new URL("../.env.cloud.staging", import.meta.url));
const composeFile = "docker-compose.cloud.staging.yml";
const secrets = ["POSTGRES_PASSWORD", "PYRO_RUNTIME_PASSWORD", "CONTROL_PLANE_SECRET", "CLOUD_PLATFORM_TOKEN"];
const action = process.argv[2] ?? "check";
const envFile = process.argv[3] ?? defaultEnvFile;
const usage = "Usage: node scripts/cloud-staging.mjs init|check|up [path-to-env-file]";

if (!["init", "check", "up"].includes(action) || process.argv.length > 4) {
  console.error(usage);
  process.exit(1);
}

function fail(message) {
  console.error(`Staging preflight: ${message}`);
  process.exit(1);
}

if (action === "init") {
  if (existsSync(envFile)) fail(`${envFile} already exists; keeping its secrets unchanged.`);
  let template = readFileSync(templateFile, "utf8");
  for (const key of secrets) {
    const marker = new RegExp(`^${key}=$`, "m");
    if (!marker.test(template)) fail(`Template is missing ${key}.`);
    template = template.replace(marker, `${key}=${randomBytes(32).toString("hex")}`);
  }
  writeFileSync(envFile, template, { mode: 0o600, flag: "wx" });
  console.log(`Created ${envFile} with four unique secrets and mode 600. Fill the remaining blank values, then run pnpm cloud:staging:check.`);
  process.exit(0);
}

if (!existsSync(envFile)) fail(`Missing ${envFile}. Run pnpm cloud:staging:init first.`);
if (statSync(envFile).mode & 0o077) fail(`${envFile} is readable by others. Run chmod 600 on it.`);

const contents = readFileSync(envFile, "utf8");
const seen = new Set();
for (const line of contents.split(/\r?\n/)) {
  if (!line.trim() || line.trimStart().startsWith("#")) continue;
  const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
  if (!match) fail("The env file contains a malformed line; use KEY=value on each non-comment line.");
  if (seen.has(match[1])) fail(`${match[1]} is defined more than once.`);
  seen.add(match[1]);
}
const values = parseEnv(contents);
const required = (key) => {
  const value = values[key]?.trim();
  if (!value || /your[-_ ]|example\.(com|org|net)|replace[-_ ]/i.test(value)) fail(`Set ${key} to a real value in ${envFile}.`);
  return value;
};
const email = (value) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const hostname = (value) => value.length <= 253 && value.includes(".") && value.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));

for (const key of secrets) {
  if (!/^[0-9a-f]{64}$/.test(required(key))) fail(`${key} must be a unique 32-byte hex secret (64 characters).`);
}
if (new Set(secrets.map((key) => values[key])).size !== secrets.length) fail("The four generated secrets must be different.");
const tailnetDomain = required("TAILSCALE_DOMAIN").toLowerCase();
if (!hostname(tailnetDomain) || !tailnetDomain.endsWith(".ts.net")) fail("TAILSCALE_DOMAIN must be the VM's full *.ts.net MagicDNS hostname, without https:// or a path.");
const from = required("CLOUD_EMAIL_FROM");
const sender = from.includes("<") ? from.match(/<([^<>]+)>$/)?.[1] : from;
if (!sender || !email(sender)) fail("CLOUD_EMAIL_FROM must be an email address or Display Name <email@verified-domain>.");
required("RESEND_API_KEY");
required("TYPESAFE_API_KEY");
required("TYPESAFE_MODEL");
let providerUrl;
try { providerUrl = new URL(required("TYPESAFE_ENDPOINT")); } catch { fail("TYPESAFE_ENDPOINT must be a valid HTTPS URL."); }
if (providerUrl.protocol !== "https:") fail("TYPESAFE_ENDPOINT must use HTTPS.");
const price = Number(required("CLOUD_PROVIDER_PRICE_PER_MILLION"));
if (!Number.isFinite(price) || price <= 0) fail("CLOUD_PROVIDER_PRICE_PER_MILLION must be the verified, positive USD price ceiling per million tokens.");
for (const key of ["CLOUD_PROVIDER_BUDGET_MICROS", "CLOUD_MAX_ORGANIZATIONS", "CLOUD_TRIAL_CREDITS"]) {
  const number = Number(required(key));
  if (!Number.isSafeInteger(number) || number < 0 || (key !== "CLOUD_TRIAL_CREDITS" && number === 0)) fail(`${key} must be a non-negative integer${key === "CLOUD_TRIAL_CREDITS" ? "" : " greater than zero"}.`);
}
for (const key of ["CLOUD_EMAIL_MODE", "CLOUD_PROVIDER_MODE", "CLOUD_PUBLIC_URL", "DATABASE_URL", "STAGING_VM_IPV4", "CLOUD_DOMAIN", "CLOUD_API_DOMAIN", "ACME_EMAIL"]) {
  if (seen.has(key)) fail(`Remove ${key}; the cloud Compose file derives or fixes it for production-mode staging.`);
}
const paymentKeys = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
const filledPayments = paymentKeys.filter((key) => values[key]?.trim());
if (filledPayments.length) fail("Leave all Razorpay variables blank in this staging setup; checkout is disabled.");

// Compose normally lets shell variables override --env-file. Force this staging file to win.
const composeEnv = { ...process.env };
for (const key of [...seen, "COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "COMPOSE_PROFILES", "CLOUD_PACK_PRICE_PAISE", "CLOUD_PACK_CREDITS"]) delete composeEnv[key];
const compose = ["compose", "--project-name", "pyro-cloud-staging", "--env-file", envFile, "-f", composeFile];
function docker(args, inherit = false) {
  const result = spawnSync("docker", [...compose, ...args], { cwd: root, env: composeEnv, stdio: inherit ? "inherit" : "pipe", encoding: "utf8" });
  if (result.error) fail(`Docker Compose is unavailable: ${result.error.message}`);
  if (result.status !== 0) fail(`Docker Compose ${args[0]} failed. Check the Compose file and env values (exit ${result.status}).`);
  return result.stdout;
}

// The JSON contains interpolated secrets. Inspect it in memory and never log it.
let config;
try { config = JSON.parse(docker(["config", "--format", "json"])); }
catch { fail("Could not inspect the rendered Compose configuration."); }
for (const [serviceName, service] of Object.entries(config.services ?? {})) {
  if (service.network_mode === "host") fail(`${serviceName} uses host networking; private staging must remain on the Docker bridge.`);
  for (const port of service.ports ?? []) {
    if (port.host_ip !== "127.0.0.1") fail(`${serviceName} publishes a non-loopback port. Private staging cannot start.`);
  }
}
const webPorts = config.services?.web?.ports ?? [];
if (!webPorts.some((port) => port.host_ip === "127.0.0.1" && String(port.published) === "3001")) fail("Private web ingress must bind only to 127.0.0.1:3001.");
console.log("Private staging env and Compose configuration are valid; no public ports are published. Secrets were not printed.");

if (action === "up") {
  const status = spawnSync("tailscale", ["status", "--json"], { encoding: "utf8" });
  if (status.error || status.status !== 0) fail("Tailscale is not connected on this VM. Install it, run tailscale up, and enable MagicDNS plus HTTPS in the tailnet settings.");
  let actualDomain;
  try { actualDomain = JSON.parse(status.stdout).Self?.DNSName?.replace(/\.$/, "").toLowerCase(); }
  catch { fail("Could not read the VM's Tailscale DNS name."); }
  if (actualDomain !== tailnetDomain) fail(`TAILSCALE_DOMAIN must match this VM's Tailscale DNS name (${actualDomain ?? "unavailable"}).`);
  docker(["up", "-d", "--build", "--wait"], true);
  const serve = spawnSync("tailscale", ["serve", "--bg", "--https=443", "http://127.0.0.1:3001"], { encoding: "utf8" });
  if (serve.error || serve.status !== 0) fail("Containers are healthy, but Tailscale Serve did not start. Enable tailnet HTTPS and run tailscale serve --bg --https=443 http://127.0.0.1:3001 with Tailscale operator permission.");
  console.log(`Private staging is available to your tailnet at https://${tailnetDomain}. Use that same origin as the SDK baseUrl.`);
}

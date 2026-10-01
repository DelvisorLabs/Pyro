import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const envFile = fileURLToPath(new URL("../.env.cloud.local", import.meta.url));
const secrets = ["POSTGRES_PASSWORD", "PYRO_RUNTIME_PASSWORD", "CONTROL_PLANE_SECRET", "CLOUD_PLATFORM_TOKEN"];
const action = process.argv[2] ?? "up";
if (!["up", "stop", "mail"].includes(action)) {
  console.error("Usage: pnpm cloud:local [up|stop|mail [email]]");
  process.exit(1);
}

if (!existsSync(envFile)) {
  if (action !== "up") {
    console.error("Start the local cloud preview with pnpm cloud:local first.");
    process.exit(1);
  }
  writeFileSync(envFile, "# Generated for the isolated local cloud preview. Keep this file while its data volume exists.\n" +
    secrets.map((key) => `${key}=${randomBytes(32).toString("hex")}`).join("\n") + "\n", { mode: 0o600, flag: "wx" });
}

// Use this project's generated secrets even if the shell has another deployment configured.
const env = { ...process.env };
for (const key of [...secrets, "COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "COMPOSE_PROFILES"]) delete env[key];
const compose = ["compose", "--project-name", "pyro-cloud-local", "--env-file", envFile, "-f", "docker-compose.cloud.local.yml"];
function docker(args) {
  const result = spawnSync("docker", [...compose, ...args], { cwd: root, env, stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (action === "up") {
  docker(["up", "-d", "--build", "--wait"]);
  console.log("\nPyro Cloud preview: http://127.0.0.1:3001\nCreate an account, then run pnpm cloud:local:mail your@email.test to read its local verification link.\nMock inference and a local email outbox are enabled; no provider, email or payment account is needed.\nYour self-hosted app at http://localhost:3000 has its own database.\nStop this preview with pnpm cloud:local:stop; its data is preserved.");
} else if (action === "stop") {
  docker(["down"]);
} else {
  // Read the encrypted outbox through the packaged storage library. No public debug endpoint.
  docker(["exec", "-T", "--workdir", "/app/apps/cloud", "cloud", "node", "--input-type=module", "--eval", `
    import { openDatabase, decryptText } from '@pyro/storage';
    if (process.env.NODE_ENV !== 'development' || process.env.CLOUD_EMAIL_MODE !== 'outbox' || process.env.CLOUD_PROVIDER_MODE !== 'mock') {
      throw new Error('This command only reads the local mock/outbox preview.');
    }
    const db = await openDatabase(process.env.DATABASE_URL, 'platform');
    try {
      const rows = await db.document('email_outbox', () => []).read();
      const recipient = process.argv[1]?.trim().toLowerCase();
      const messages = rows.map(row => ({ ...JSON.parse(decryptText(row.message, process.env.CONTROL_PLANE_SECRET)), createdAt: row.createdAt }))
        .filter(message => !recipient || message.to === recipient).slice(-10);
      if (!messages.length) console.log('No local email yet. Create an account or request a new verification link in the dashboard.');
      for (const message of messages) console.log(message.createdAt + ' | ' + message.to + '\\n' + message.subject + '\\n' + message.text + '\\n');
    } finally { await db.close(); }
  `, "--", ...(process.argv[3] ? [process.argv[3]] : [])]);
}

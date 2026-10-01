import { buildCloud } from "./app.js";
import { loadConfig } from "./config.js";
const config = loadConfig();
const app = await buildCloud(config);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
await app.listen({ host: config.host, port: config.port });

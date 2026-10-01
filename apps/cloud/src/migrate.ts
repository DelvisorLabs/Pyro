import { openDatabase } from "@pyro/storage";
if (!process.env.DATABASE_URL || process.env.PYRO_SKIP_MIGRATIONS === "true") throw new Error("Set the migration DATABASE_URL and unset PYRO_SKIP_MIGRATIONS.");
const database = await openDatabase(process.env.DATABASE_URL);
await database.ping(); await database.close();
console.log("Cloud schema migrations complete.");

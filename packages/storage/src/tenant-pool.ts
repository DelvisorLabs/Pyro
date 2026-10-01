import type { Pool, PoolClient } from "pg";

/** Every operation uses a transaction-local tenant setting and a non-bypass role.
 * A connection is never returned to the pool with tenant state attached. */
export function organizationPool(pool: Pool, organizationId: string, close: () => Promise<void>): Pool {
  const begin = async (client: PoolClient) => {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE pyro_tenant");
    await client.query("SELECT set_config('pyro.organization_id', $1, true)", [organizationId]);
  };
  return {
    async query(text: string, values?: unknown[]) {
      const client = await pool.connect();
      try { await begin(client); const result = await client.query(text, values); await client.query("COMMIT"); return result; }
      catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async connect() {
      const client = await pool.connect();
      return {
        async query(text: string, values?: unknown[]) {
          if (text === "BEGIN") { await begin(client); return { rows: [], rowCount: 0 }; }
          return client.query(text, values);
        },
        release() { client.release(); },
      };
    },
    end: close,
  } as unknown as Pool;
}

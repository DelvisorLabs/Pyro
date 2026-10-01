import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { openDatabase } from "./index.js";

test("pre-cloud schema and renamed legacy constraints migrate into the default organization", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = process.env.TEST_DATABASE_URL!, admin = new Pool({ connectionString: url });
  const name = `pyro_migration_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const target = new URL(url); target.pathname = `/${name}`;
  const legacy = new Pool({ connectionString: target.href });
  try {
    await legacy.query(await readFile(new URL("../test/legacy-v2.sql", import.meta.url), "utf8"));
    await legacy.query("INSERT INTO pyro_documents(key, value) VALUES ('migration-proof', '[\"preserved\"]')");
    // Historical table renames kept their constraint names; migration must discover them.
    await legacy.query("ALTER TABLE pyro_documents RENAME CONSTRAINT pyro_documents_pkey TO old_documents_pkey; ALTER TABLE pyro_events RENAME CONSTRAINT pyro_events_pkey TO old_events_pkey");
    const defaultOrg = await openDatabase(target.href), other = await openDatabase(target.href, "another-org");
    try {
      assert.deepEqual(await defaultOrg.document("migration-proof", () => []).read(), ["preserved"]);
      assert.deepEqual(await other.document("migration-proof", () => []).read(), []);
      await other.document("migration-proof", () => []).write(["independent"]);
      assert.deepEqual(await defaultOrg.document("migration-proof", () => []).read(), ["preserved"]);
      assert.equal((await legacy.query("SELECT max(version) AS version FROM pyro_schema_migrations")).rows[0].version, 3);
    } finally { await defaultOrg.close(); await other.close(); }
  } finally { await legacy.end(); await admin.query(`DROP DATABASE ${name}`); await admin.end(); }
});

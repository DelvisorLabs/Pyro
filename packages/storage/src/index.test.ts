import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { decryptText, encryptText, openDatabase } from "./index.js";

test("stores and atomically updates database documents", async () => {
  const database = await openDatabase(`memory://storage-${randomUUID()}`);
  const document = database.document("counter", () => ({ value: 0 }));
  assert.deepEqual(await document.read(), { value: 0 });
  await document.update((current) => ({ value: current.value + 1 }));
  assert.deepEqual(await document.read(), { value: 1 });
});

test("encrypts and decrypts database secrets", () => {
  const secret = "test-control-plane-secret";
  const encrypted = encryptText("ts_live_example", secret);
  assert.notEqual(encrypted.ciphertext, "ts_live_example");
  assert.equal(decryptText(encrypted, secret), "ts_live_example");
});

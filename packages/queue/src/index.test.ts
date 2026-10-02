import assert from "node:assert/strict";
import test from "node:test";
import { ConcurrentQueue, QueueFullError } from "./index.js";

test("honors concurrency and reports queue time", async () => {
  const queue = new ConcurrentQueue(2, 10);
  let active = 0;
  let peak = 0;
  const jobs = Array.from({ length: 6 }, (_, index) =>
    queue.submit(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 8));
      active -= 1;
      return index;
    }),
  );
  const results = await Promise.all(jobs);
  assert.equal(peak, 2);
  assert.deepEqual(
    results.map((result) => result.value),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(queue.snapshot().completed, 6);
});

test("rejects work when the waiting queue is full", async () => {
  const queue = new ConcurrentQueue(1, 1);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = queue.submit(async () => gate);
  const second = queue.submit(async () => "waiting");
  assert.throws(() => queue.submit(async () => "rejected"), QueueFullError);
  release();
  await Promise.all([first, second]);
});

test("live limits preserve running work and reject excess waiting requests", async () => {
  let concurrency = 1, depth = 1;
  const queue = new ConcurrentQueue(() => concurrency, () => depth);
  let release!: () => void;
  const first = queue.submit(async () => { await new Promise<void>(resolve => { release = resolve; }); return 1; });
  const second = queue.submit(async () => 2);
  assert.throws(() => queue.submit(async () => 3), QueueFullError);
  concurrency = 2; depth = 2;
  const third = queue.submit(async () => 3);
  assert.equal((await second).value, 2); assert.equal((await third).value, 3);
  concurrency = 1; release(); assert.equal((await first).value, 1);
  assert.equal(queue.snapshot().concurrency, 1);
});

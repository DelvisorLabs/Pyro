import { randomUUID } from "node:crypto";

export class QueueFullError extends Error {
  constructor() {
    super("The classification queue is full.");
    this.name = "QueueFullError";
  }
}

export interface QueueSnapshot {
  active: number;
  waiting: number;
  concurrency: number;
  maxDepth: number;
  accepted: number;
  completed: number;
  failed: number;
  rejected: number;
}

interface PendingJob<T> {
  id: string;
  enqueuedAt: number;
  execute: (queueMs: number) => Promise<T>;
  resolve: (value: QueueResult<T>) => void;
  reject: (reason: unknown) => void;
}

export interface QueueResult<T> {
  id: string;
  value: T;
  queueMs: number;
}

export class ConcurrentQueue {
  private readonly waiting: PendingJob<unknown>[] = [];
  private active = 0;
  private accepted = 0;
  private completed = 0;
  private failed = 0;
  private rejected = 0;

  constructor(
    private readonly concurrency: number,
    private readonly maxDepth: number,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be positive");
    if (!Number.isInteger(maxDepth) || maxDepth < 1) throw new Error("maxDepth must be positive");
  }

  submit<T>(execute: (queueMs: number) => Promise<T>, id: string = randomUUID()): Promise<QueueResult<T>> {
    if (this.waiting.length >= this.maxDepth) {
      this.rejected += 1;
      throw new QueueFullError();
    }
    this.accepted += 1;
    const promise = new Promise<QueueResult<T>>((resolve, reject) => {
      this.waiting.push({
        id,
        enqueuedAt: performance.now(),
        execute,
        resolve: resolve as (value: QueueResult<unknown>) => void,
        reject,
      });
    });
    this.drain();
    return promise;
  }

  snapshot(): QueueSnapshot {
    return {
      active: this.active,
      waiting: this.waiting.length,
      concurrency: this.concurrency,
      maxDepth: this.maxDepth,
      accepted: this.accepted,
      completed: this.completed,
      failed: this.failed,
      rejected: this.rejected,
    };
  }

  private drain(): void {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift();
      if (!job) return;
      this.active += 1;
      const queueMs = performance.now() - job.enqueuedAt;
      void job
        .execute(queueMs)
        .then((value) => {
          this.completed += 1;
          job.resolve({ id: job.id, value, queueMs });
        })
        .catch((error: unknown) => {
          this.failed += 1;
          job.reject(error);
        })
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

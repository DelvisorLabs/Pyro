
## Durable jobs and retention

`POST /v1/jobs` persists an encrypted input and an immutable policy/application
snapshot before returning 202. Send a unique `Idempotency-Key` (1–128 printable
characters) for a logical submission. Reusing it with different input returns
409; matching retries return the original job for its remaining lifetime.
Workers lease jobs for 30 seconds and renew while running. Crashed workers are
replaced after lease expiry. Provider execution is **at least once**: a crash
after an upstream call can incur another call and charge. Pyro never executes
your tools. Use the decision ID for downstream deduplication.

Pending inputs expire after 15 minutes and are erased on completion/failure.
Expired pending work becomes an explicit failed result. Results and idempotency
records expire 10 minutes after completion. Encrypt database backups and retain
`CONTROL_PLANE_SECRET` separately; losing it makes queued inputs unreadable.

The beta queue uses a PostgreSQL document lock across all replicas, is capped at
200 outstanding jobs (or the lower `QUEUE_MAX_DEPTH`), and schedules applications
in turn. This bounded implementation is intended for pilot traffic. Measure
throughput on your hardware before expanding it. Queue age, counts and capacity
are exposed in `/v1/health`. Application and key quotas share database counters;
both limits apply, and job polling does not consume classification quota.

`EVENT_RETENTION_DAYS` defaults to 30 (minimum 1). The gateway prunes old events
and terminal webhook deliveries every minute. Durable job inputs use the much
shorter deadlines above, independent of `persistInputs`. Labels, caller metadata,
and opt-in previews are event data: never put credentials in them. Review and
evaluation retention are documented with those features. Audit and policy
history are retained until an administrator removes the deployment database.

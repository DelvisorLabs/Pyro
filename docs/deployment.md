
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

## Team access and SSO

Keep the bootstrap `admin` password for recovery; use individual accounts for
normal work. Administrators can provision users in **Team & audit**, grant
applications, disable accounts, and revoke sessions. Passwords use salted scrypt.
Sessions expire after 24 hours; grants and disabled state are checked on each
request and every live-notification poll. Changing access revokes existing
sessions. Raw input previews and caller metadata need a separate grant.

Admins manage global policies, provider secrets, integrations and team settings.
Operators manage keys, evaluations and reviews within their granted applications;
reviewers triage reviews; viewers inspect scoped activity and usage. Gateway API
keys are application-scoped service credentials, shown once and revocable. Rotate
by creating a replacement key, deploying it, then revoking the old key.

For OIDC, set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and
`OIDC_REDIRECT_URI=https://YOUR_HOST/control/api/auth/oidc/callback`, then restart
the control plane. Both issuer and callback require HTTPS. Register that exact
callback with your provider. Provision each user's **exact issuer/subject pair**
in Team & audit; email addresses and domain membership never grant access.
No just-in-time accounts or implicit administrator grants are created.

The [openid-client library](https://github.com/panva/openid-client) verifies the
code flow with PKCE, nonce, browser-bound single-use state and signed ID tokens.
Tests cover valid signed tokens, nonce mismatch, state replay and unprovisioned
subjects. A deployment still needs a smoke test against its actual identity
provider and reverse proxy before enabling SSO for a team.

Audit records contain actors, timestamps, operation paths, status and policy
revision identifiers, without request bodies or secrets. Status 0 records an
intent persisted before a privileged mutation; the following HTTP status records
its outcome. An intent without an outcome means an interrupted operation that
requires reconciliation. The API provides no edit/delete operation for audit
history. PostgreSQL administrators remain trusted and can alter the database;
use external backups or log shipping when tamper resistance is required.

## Review workflow

Review inbox lists decisions with action `review`, with application/trace context,
age, assignment, severity, comments and disposition. Writes require the displayed
revision; a stale or duplicate write returns 409. The original event is immutable.
Reviewers and operators are restricted to their granted applications. A viewer
cannot resolve a review. Comments and review state expire after the event
retention period from their last update. Do not enter secrets in comments.

Webhooks can opt into signed `review.resolved` callbacks. They use the existing
application, profile, action and risk filters. Resolution intent is stored with
the review and handed off to the durable delivery outbox with a stable ID;
receivers must deduplicate IDs. Payloads include disposition and actor ID but omit
comments and inputs. A resolution never runs a previously blocked or held action:
your application decides whether and how to resume, with its own authorization.

## Evaluation retention

Evaluation datasets explicitly retain full inputs encrypted for 1, 7 or 30 days,
independent of policy `persistInputs`. Reports store input hashes and decisions,
not full inputs, and expire with the dataset. Manual deletion cancels a run and
removes stored inputs; an in-flight provider request can still finish. A selected
provider credential is encrypted in the run until completion or expiry so a
resumed run uses the authorized account. Keep reports and dataset snapshots in
your own controlled storage when longer retention is required.

## Backup, restore and upgrades

Use the same PostgreSQL major version for this procedure. Before an upgrade,
pause incoming classification traffic and workers, save the deployment files,
and copy `.env` into your encrypted secret backup. Keep `CONTROL_PLANE_SECRET`
with that backup; the SQL dump alone cannot recover encrypted credentials or
queued inputs. Run from the configured compose directory:

```sh
docker compose stop gateway control-plane dashboard
# Restrict access to the resulting backup; it contains configuration and events.
umask 077
docker compose exec -T postgres pg_dump -U pyro -d pyro -Fc > pyro-backup.dump
```

Restore into a **separate empty database** and test it before replacing a running
installation. The target command below restores into `pyro_restore`, never over
the live `pyro` database:

```sh
docker compose exec -T postgres createdb -U pyro pyro_restore
docker compose exec -T postgres pg_restore -U pyro -d pyro_restore --exit-on-error < pyro-backup.dump
```

Start an isolated stack pointed at the restored database with the matching
secret and image versions. Verify sign-in, policy hashes, application keys,
retained events and a local classification. Keep queues and webhook destinations
paused or redirected during a restore drill to avoid replaying external work.
After validating the new release, resume the original stack. Do not run
`docker compose down --volumes` during an upgrade. Restoring older code requires
the corresponding pre-upgrade database, not only an image rollback.

## Pilot operating targets

Use local-only load tests first. Measure p50/p95 latency, queue age, error rate,
provider failures and webhook backlog on the actual deployment; no universal
latency or throughput SLA is claimed. Alert on persistent job failures, growing
queue age, a provider circuit staying open, or webhook failures. `/v1/health`
reports durable queue counts and oldest age; `/metrics` exposes gateway metrics;
Webhooks shows delivery history. Keep one gateway/control-plane replica for an
initial pilot, then test shared PostgreSQL quotas and worker recovery before
scaling. The bounded document queue and audit/history documents are deliberately
suited to pilot volumes, not an unmeasured high-volume service.

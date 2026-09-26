
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

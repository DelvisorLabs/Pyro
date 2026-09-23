# Five next features for Pyro

These proposals follow the current architecture: Fastify gateway/control plane, PostgreSQL documents and events, an in-process classification queue, a React dashboard, and the new profiles/outbound-delivery layer. They are recommendations, not functionality implemented in this change.

## 1. Versioned policies, staged rollout and rollback

**Why:** profiles currently update in place (`apps/control-plane/src/app.ts`). Events identify a profile but do not preserve the exact revision that made the decision. Editing a threshold can make a historical decision impossible to reproduce.

**Build:** immutable profile revisions and content hashes; draft/published states; semantic diffs for thresholds, detectors and local rules; application bindings to an explicit revision; shadow/canary rollout; one-click rollback; an audit record of who published each change. Include the application rule revision in the decision snapshot, since application rules combine with profile rules.

**First release:** create a new revision on every save, store the revision/hash on events, and allow an application to pin or roll back a revision. Add approval gates after multi-user access exists.

**Acceptance:** replay a stored test input with its original config even after later edits; rollback without rewriting history; concurrent edits cannot silently overwrite one another. Profile export includes a portable revision/hash but excludes deployment secrets.

**Priority:** highest. This makes every subsequent tuning feature safer and makes decision traces trustworthy.

## 2. Evaluation and regression lab

**Why:** the playground classifies individual requests and shadow mode compares actions, but there is no repeatable dataset workflow for measuring false positives, misses or policy regressions. Curated profiles are currently starting points without measured coverage claims.

**Build:** versioned labeled datasets; batch evaluation against multiple policy revisions; precision/recall and confusion matrices per attack class; disagreements with ground truth; p50/p95 latency, token cost and local-rule hit rate; threshold sweeps; CI gates before publishing profiles. Let operators add redacted Activity samples to a dataset with an explicit retention decision. Record provider/model version where available.

**First release:** import a JSONL dataset with expected allow/review/block outcomes, compare two revisions, and export the report. Reuse the gateway's evaluation path so the lab cannot drift from enforcement.

**Acceptance:** reproducible dataset/config hashes, no hidden provider calls for local-only runs, clear cost estimates before a batch, cancellation and resumption, and a CI failure when a configured regression budget is exceeded.

**Priority:** highest alongside versioning. It establishes whether Pyro is getting better rather than simply blocking more traffic.

## 3. A human review inbox with feedback

**Why:** `review` is a decision and dashboard notification today. It has no owner, resolution, service-level target or feedback loop. An alert can tell a team something happened without helping them resolve it.

**Build:** a triage queue with assignment, severity, comments, disposition (true positive, false positive, uncertain), saved filters and aging indicators. Link events by trace/application and group related alerts. Emit signed resolution callbacks so an application can implement a delayed-approval flow when appropriate. Keep the original decision immutable and store review as a separate record.

**First release:** persistent disposition and assignment in Activity, grouped notifications, and export of reviewed samples to the evaluation lab. Add authenticated review workflows once permission scoping and audit records are in place.

**Acceptance:** each resolution is attributed and auditable; duplicate clicks do not produce conflicting outcomes; reviewers only access authorized applications; resolving a record does not silently execute a previously blocked tool call.

**Priority:** next. Converts alerts into an operational workflow and produces useful training/evaluation feedback.

## 4. Team access: SSO, application-scoped roles and audit logs

**Why:** the control plane uses one administrator password and session authentication. A role field exists, but there is no complete role-enforcement model for managing profiles, keys, integrations or sensitive previews.

**Build:** OIDC SSO, individual accounts, admin/operator/reviewer/viewer roles, application-level grants, service accounts, session revocation and expiration, scoped key rotation, and append-only audit records. Gate viewing raw previews separately from policy editing. Audit integration destination changes and signing-key rotations without recording secrets.

**First release:** individual users plus explicit server-side permission checks and an audit log. Add OIDC next; introduce organizations/tenant isolation only when deployment requirements justify the additional data-model complexity.

**Acceptance:** unauthorized mutations fail in the API even when the UI is bypassed; revoked sessions stop working; one application's users cannot list another application's events or secrets; every privileged change has actor, timestamp and before/after revision identifiers.

**Priority:** required before wider team adoption or hosted multi-tenant operation.

## 5. Durable execution and operational controls

**Why:** classification jobs and rate-limit counters currently live in gateway memory (`jobs` and `rateLimits` in `apps/gateway/src/app.ts`). Restarting loses pending job state; multiple replicas have independent quotas. Event/delivery history currently has no automatic retention policy.

**Build:** durable classification job state with worker leases, idempotency keys and result TTL; distributed application quotas; queue backpressure and fair scheduling across applications; configurable data retention/deletion; outbox retention and delivery backlog metrics; end-to-end OpenTelemetry traces; documented SLOs, backup/restore and load-test targets.

**First release:** durable jobs plus distributed limits and retention controls. Reuse the outbox lease pattern but keep classification workers and notification workers on independent capacity budgets. Store raw job inputs encrypted with short lifetimes because durable evaluation requires retaining inputs while queued.

**Acceptance:** restart workers during a load test without losing accepted jobs; honor one quota across replicas; prevent one application starving others; expire stored inputs on schedule; expose queue age and delivery failure SLOs; demonstrate a tested restore procedure. Idempotency semantics must distinguish duplicate API submissions from at-least-once upstream execution after a crash.

**Priority:** before substantial traffic or horizontal scaling. This is the largest operational reliability gain after durable notification delivery.

# Cloud plans and limits

Cloud plans configure entitlements before subscription checkout is introduced. They do not create invoices, charge cards, or activate automatic renewals at a payment provider. The standalone CLI and self-hosted configuration remain unchanged.

## Operator workflow

Use the cloud service's operator interface over a trusted connection (the public proxy should continue to deny `/platform/*`). Never put the platform token in a browser, URL, or customer application. Export the existing `CLOUD_PLATFORM_TOKEN` in your operator shell and set `CLOUD_OPERATOR_URL` to your direct cloud-service URL or SSH-forwarded localhost address.

```sh
pnpm cloud:plans list
pnpm cloud:plans save examples/cloud-plans/starter.json
pnpm cloud:plans save examples/cloud-plans/growth.json
pnpm cloud:plans assign ORGANIZATION_ID starter
```

The example values are editable engineering examples, not prices or published commercial tiers. Edit the JSON and save it again to change a named plan for all organizations assigned to it. Changes apply live in the current cloud process; already running work finishes, and reduced concurrency prevents new work until capacity is available. Use organization suspension for an immediate stop to new admission. The beta runtime remains a single cloud process; synchronous queues and evaluation worker counts are per process. Transactional provider leases, credit accounting, and durable queue depth work through shared storage. Horizontal runtime coordination is not a supported deployment guarantee.

Endpoints, authenticated with the platform bearer token:

- `GET /platform/plans`: catalog and assignments.
- `PUT /platform/plans`: validated complete plan; missing limit fields use documented defaults.
- `PUT /platform/organizations/:id/plan` with `{ "planId": "starter" }`: assign a plan.
- `GET /api/billing/usage`: authenticated organization members can inspect their plan, monthly usage, source totals and available credits.
- `GET /api/billing`: owners/admins can inspect the prepaid ledger as before.

Customers cannot change plans or raise limits through organization membership. The existing `beta` plan is used for unassigned organizations and preserves the previous queue/rate defaults, with zero included monthly credits. New accounts receive a one-time 1,000,000-credit grant by default (`CLOUD_TRIAL_CREDITS` can override it). The 1,000,000 monthly spending cap is separate from the credit balance. Existing prepaid balances are preserved.

## Limits

| Field | Meaning | Default |
| --- | --- | --- |
| concurrency | Maximum concurrent semantic provider attempts shared across API, playground, evaluation and shadow checks | 2 |
| queueDepth | Waiting synchronous classification requests (excludes active work) | 20 |
| durableQueueDepth | Queued plus running classification jobs | 20 |
| playgroundConcurrency | Simultaneously executing preview requests | 2 |
| playgroundRequestsPerMinute | Preview request quota | 30 |
| evaluationConcurrency | Concurrent evaluation runs; cases within a run execute serially | 1 |
| evaluationQueueDepth | Queued plus running evaluation runs | 20 |
| requestsPerMinute | Organization gateway request quota, including polling | 120 |
| monthlyRequests | Admitted POST work submissions, including previews and evaluation runs; invalid submissions may count; polling and free estimates do not count | 100000 |
| monthlyCredits | Included credits renewed on the first of each UTC calendar month | 0 |
| monthlyCreditLimit | Hard cap on total credits consumed in a UTC calendar month, including prepaid usage | 1000000 |
| eventStorageBytes | Monthly per-organization event-write allowance | 500000000 |

An evaluation submission counts once toward monthlyRequests; its individual semantic checks consume credits. Local decisions use request/storage capacity but no semantic credits. Provider concurrency exhaustion returns 429 rather than starting an extra call. Durable work encountering a capacity error can fail and be resumed/retried; this is not an unlimited wait queue. Existing global provider spend and event-storage ceilings still apply. `CLOUD_PROVIDER_CONCURRENCY` (default 16) and `CLOUD_REQUESTS_PER_MINUTE` (default 1000) set platform ceilings.

## Credit semantics

The full UTF-8 provider request, including policy context and examples, costs one credit per started 2,000 bytes. Each reached semantic condition is metered; skipped conditions are free. Retries and recovery of the same logical check do not debit credits again. Each provider attempt still reserves the conservative provider-spend ceiling.

Included credits are spent first, followed by prepaid credits. Monthly allowances do not roll over. Purchased/manual credits do not expire at month end. Changing plans does not reset the month's consumed amount: upgrading can expose a larger allowance; downgrading below existing usage blocks further charges until renewal or another plan change. Monthly limits apply even when prepaid credits remain. Admission and debit happen in one document transaction, preventing concurrent overspend.

Usage separates application, playground, and evaluation checks without storing raw preview inputs. Source counters describe charged checks, not retry attempts. Older historical ledger entries without a source remain in billing; they are not guessed into new counters. Test estimates use the exact request serialization and assume all semantic checks are reached. Actual consumption can be lower. A test/run cap rejects the entire operation before inference if this upper bound exceeds the requested cap. Provider currency cost may still be unknown; cloud credits remain explicit.

## Validation

Cloud tests cover authorization, organization isolation, live limits, monthly renewal, switching plans without resetting usage, atomic balances, shared inference slots, retry charging, preview estimates/caps, saved drafts, and protected case retrieval. PostgreSQL-specific smoke coverage requires `CLOUD_TEST_DATABASE_URL`; in-memory tests do not establish production throughput or billing-provider integration.

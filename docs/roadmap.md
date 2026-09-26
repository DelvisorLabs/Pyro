# Feature status

The five roadmap areas have a working beta implementation in this release.
They remain subject to the pilot limits below; a dashboard control is not a
claim of independent security validation or unlimited scale.

| Area | Implemented | Further work |
| --- | --- | --- |
| Policy changes | Immutable revisions and hashes; draft/publish; stale-edit conflicts; app pins; canary selection; rollback by publishing old configuration; event revision and application-rule snapshot | Approval gates and richer visual field-by-field diffs |
| Evaluation lab | Encrypted versioned JSONL datasets; one/two-revision comparison; shared gateway engine; hashes; metrics and category confusion matrices; paid consent; cancel/resume; reports and local CI budgets | Representative held-out semantic benchmarks, threshold sweeps, larger datasets |
| Review inbox | Scoped triage, assignment, severity, comments, dispositions, aging, saved status filter, trace context, revision conflicts, signed callbacks and explicit JSONL sample export | Rich saved filters, automated alert grouping and case management |
| Team access | Individual password accounts, OIDC, admin/operator/reviewer/viewer roles, application grants, preview permission, session revocation, scoped service keys and audit intents/outcomes | Organizations/multi-tenant hosting and tamper-evident external audit storage |
| Durable execution | Encrypted pending inputs; PostgreSQL worker leases; idempotent submissions; shared quotas; bounded fair scheduling; TTLs; retention; queue status; backup/restore procedure | Row-level high-throughput queues, end-to-end OpenTelemetry spans, measured production SLOs |

Use the [deployment guide](deployment.md), [evaluation guide](evaluations/README.md)
and [release guide](releases.md) before a pilot. Unmeasured accuracy and throughput
must not be presented as demonstrated product guarantees.

# Feature status

The roadmap areas have a working beta implementation in this release.
They remain subject to the pilot limits below; a dashboard control is not a
claim of independent security validation or unlimited scale.

| Area | Implemented | Further work |
| --- | --- | --- |
| Policy Playground | Ordered text/word-list/RE2 checks, semantic conditions with context/examples, explicit Yes/No branches, uncertainty/error outcomes, draft preview, path traces, YAML export and regression-case capture | Freeform graphs, semantic evidence attribution and representative semantic benchmarks |
| Policy changes | Immutable revisions and hashes; draft/publish; stale-edit conflicts; app pins; canary selection; rollback by publishing old configuration; event revision and application-rule snapshot | Approval gates and richer visual field-by-field diffs |
| Evaluation lab | Encrypted versioned JSONL datasets; one/two-revision comparison; shared gateway engine; hashes; metrics and category confusion matrices; paid consent; cancel/resume; reports and local CI budgets | Representative held-out semantic benchmarks, threshold sweeps, larger datasets |
| Review inbox | Scoped triage, assignment, severity, comments, dispositions, aging, saved status filter, trace context, revision conflicts, signed callbacks and explicit JSONL sample export | Rich saved filters, automated alert grouping and case management |
| Team access | Individual password accounts, OIDC, admin/operator/reviewer/viewer roles, application grants, preview permission, session revocation, scoped service keys and audit intents/outcomes; optional cloud organizations, verification/invitations and RLS | Public cloud launch, cloud OIDC and tamper-evident external audit storage |
| Durable execution | Encrypted pending inputs; PostgreSQL worker leases; idempotent submissions; shared quotas; bounded fair scheduling; TTLs; retention; queue status; backup/restore procedure | Row-level high-throughput queues, end-to-end OpenTelemetry spans, measured production SLOs |

Use the [deployment guide](deployment.md), [evaluation guide](evaluations/README.md)
and [release guide](releases.md) before a pilot. Unmeasured accuracy and throughput
must not be presented as demonstrated product guarantees.

## October 2, 2026: optional cloud beta

Implemented locally: cloud accounts/recovery/invitations, organization roles and RLS, isolated runtimes, scoped keys/streams/evaluations, prepaid credits with attempt reservations, optional Razorpay capture, data export/deletion, cloud dashboard and single-VM deployment/backup configuration. See [cloud operations](cloud.md) for capacity limits, verification and remaining public-launch prerequisites. The subsequent Policy Playground implementation shares this runtime; independent-engine research remains separate.

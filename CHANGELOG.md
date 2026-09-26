# Changelog

## 0.3.0-beta.1 — prepared, not yet published

This beta adds policy revision history, drafts, pins and canary rollouts; an
application-scoped review inbox; versioned evaluation datasets and reports;
individual users, OIDC and audit history; and durable encrypted jobs with shared
quotas and retention. CLI 0.2.0 adds setup diagnostics and commands for the new
APIs. First-run examples use a local-only policy without a provider key.

The release is intended for supervised pilots. A local 20-case regression
fixture passes; semantic attack detection has not been independently evaluated.

### Upgrade notes

- Back up PostgreSQL **and** `CONTROL_PLANE_SECRET` before upgrading.
- Existing profiles receive revision 1 at startup. Editing an existing policy
  now requires its current `revision` in the payload; stale writes return 409.
- The bootstrap admin account remains available. New users receive only explicit
  application grants. Management APIs now enforce roles.
- Job inputs have a 15-minute deadline; results and idempotency records remain
  for 10 minutes after completion. Event retention defaults to 30 days.
- Reviews do not execute deferred actions. Semantic evaluations require explicit
  consent and may incur provider charges. Dataset retention is chosen at import.
- Database changes and stored policy metadata are forward migrations. To revert
  to an older server, restore the matching pre-upgrade database backup rather
  than mixing old code with new policy metadata.

See `docs/deployment.md` for backup, restore, retention and SSO setup. SDKs remain
source distributions. The release workflows prepare container images, a CLI
archive, checksums and a draft GitHub release; publication is a separate action.

### Standalone CLI

CLI 0.2.0 now classifies with bundled local rules immediately after installation. Docker and a server are optional. Explicit `--semantic` calls TypeSafe directly; configured gateways keep the server client workflow.

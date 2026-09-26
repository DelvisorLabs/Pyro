# Beta validation record

Validated locally on 26 September 2026 for the proposed server 0.3.0-beta.1 and
CLI 0.2.0 changes. These checks are engineering evidence for a supervised pilot,
not an independent security audit or a semantic detection benchmark.

- Full workspace type checks, tests and production builds passed, including
  PostgreSQL storage, concurrency, scoped access, OIDC signed-token/nonce/replay
  tests, review conflicts and signed resolution callbacks.
- The CLI archive installed outside the repository and ran successfully.
- Python and Rust SDK tests passed. The dependency audit reported no known high
  severity vulnerabilities at the time of the check.
- A fresh four-service Docker stack reached healthy state without startup
  restarts. Local-only synthetic inputs returned allow, block and review.
- The evaluation service ran all 20 local smoke cases with their expected actions
  against PostgreSQL. This verifies specified local rules only.
- Ten accepted asynchronous jobs survived a forced gateway SIGKILL and restart.
  Matching idempotency retries returned the original ID; changed input returned
  409. This used a local fake provider; no external model calls were made.
- A PostgreSQL dump restored into a separate empty database retained policy
  hashes and all events. Isolated services using that restored database accepted
  the administrator login and existing application key and classified locally.
- Browser checks covered CLI/Docker switching, the Docker symbol, narrow-screen
  documentation, evaluation reports, review results and policy-history controls.
  The website passed lint and its production build.

Still required per deployment: an actual identity-provider/proxy smoke test,
representative semantic evaluation with explicit provider-cost authorization,
load testing at intended traffic, and verification of published artifacts after
release. Release workflows are prepared; this record does not assert that an npm
version, container image, GitHub release or website deployment was published.

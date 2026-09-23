# Contributing

Issues and pull requests are welcome. For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development

1. Install Node.js 22 and Docker.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and generate every required credential.
4. Start PostgreSQL with `docker compose up -d postgres`.
5. Export `DATABASE_URL` and the required application secrets, then run `npm run dev`.

Before opening a pull request, run:

```bash
npm run check
PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -v
cargo test --manifest-path sdks/rust/Cargo.toml
docker compose config --quiet
```

Keep changes focused, include tests for behavior changes, and avoid committing `.env`, database exports, credentials, or captured user inputs.

Set `TEST_DATABASE_URL` to a disposable PostgreSQL database to exercise real event/outbox transactions and multi-worker delivery leases. The storage tests write test data.

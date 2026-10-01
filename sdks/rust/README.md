# Pyro Rust SDK

An async, typed client for the Pyro gateway, using reqwest and Tokio. It is not published to crates.io by this change.

```toml
[dependencies]
pyro-client = { path = "../Pyro/sdks/rust" }
serde_json = "1"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

```rust,no_run
use pyro_client::{Action, ClassifyOptions, PyroClient};
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let key = std::env::var("PYRO_API_KEY")?;
    let pyro = PyroClient::new("http://localhost:8080", &key)?;
    let decision = pyro.classify(
        json!({"message": "Summarize the quarterly report."}),
        &ClassifyOptions::default(),
    ).await?;
    if decision.action == Action::Block {
        return Err(decision.reason.into());
    }
    println!("{:?}: {}", decision.action, decision.reason);
    Ok(())
}
```

`ClassifyOptions` includes profile, metadata, labels and request ID. The gateway derives the application from the API key. Configure timeouts with `PyroClient::with_timeout` (default 10 seconds).

Pipeline responses expose `decision_mode` and `policy_trace`, including skipped checks and uncertainty. Enforce `action`; pipeline `risk` encodes the action and is not a probability of harm. See the [Policy Playground guide](../../docs/policy-playground.md) for creating and publishing a policy.

- `classify(input, &options)` returns a typed decision.
- `create_job(input, &options)` returns a job receipt.
- `get_job(id)` returns status or a decision.
- `wait_for_job(id, interval, timeout)` bounds the entire polling operation, including HTTP requests. Drop the future to cancel.
- `list_profiles()` lists profiles authorized for the key.
- `verify_webhook(raw_body, secret, signature, timestamp, tolerance)` checks HMAC-SHA256 and timestamp freshness. Keep a receiver-side deduplication store keyed by X-Pyro-Delivery-Id.

`Error::Api` preserves HTTP status, request ID, and numeric Retry-After. Error messages omit URLs from transport failures. Redirects are not followed and POSTs are not automatically retried, avoiding duplicate billable classifications. Gateway jobs persist in the deployment database, have a 15-minute execution deadline, and retain completed results for ten minutes. Dropping a polling future stops this client, not the server job.

Run `cargo test --manifest-path sdks/rust/Cargo.toml` from the Pyro root. The integration tests use a local TCP HTTP receiver; no external credentials are required.

## Cloud (unreleased source)

The cloud convenience endpoint is `https://api.pyro.delvisor.com`. TypeScript/Python cloud keys (`pyro_`) select it automatically; legacy/self-hosted keys retain localhost defaults. Rust uses `PyroClient::cloud`. Explicit base URLs always work for local tests, migrated legacy keys or custom hosting. Public DNS/service and package publication are separate launch steps; do not assume this source change is already available from a package registry.

```rust
let pyro = PyroClient::cloud(&std::env::var("PYRO_API_KEY")?)?;
```

Use keys on your backend. HTTP 402 stops semantic usage at a credit/platform limit; HTTP 429 indicates a request limit. Queued jobs can return a failed status with an exhaustion reason. Local-only checks do not consume cloud credits. Organization is derived from the authenticated key.

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

- `classify(input, &options)` returns a typed decision.
- `create_job(input, &options)` returns a job receipt.
- `get_job(id)` returns status or a decision.
- `wait_for_job(id, interval, timeout)` bounds the entire polling operation, including HTTP requests. Drop the future to cancel.
- `list_profiles()` lists profiles authorized for the key.
- `verify_webhook(raw_body, secret, signature, timestamp, tolerance)` checks HMAC-SHA256 and timestamp freshness. Keep a receiver-side deduplication store keyed by X-Pyro-Delivery-Id.

`Error::Api` preserves HTTP status, request ID, and numeric Retry-After. Error messages omit URLs from transport failures. Redirects are not followed and POSTs are not automatically retried, avoiding duplicate billable classifications. Gateway jobs currently expire after about ten minutes and are process-local.

Run `cargo test --manifest-path sdks/rust/Cargo.toml` from the Pyro root. The integration tests use a local TCP HTTP receiver; no external credentials are required.

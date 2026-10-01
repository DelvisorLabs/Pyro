# Pyro Python SDK

```bash
pip install -e ./sdks/python
```

```python
import os
from pyro import Pyro

pyro = Pyro(
    api_key=os.environ["PYRO_API_KEY"],
    base_url="http://localhost:8080",
)

decision = pyro.classify({
    "messages": [{"role": "user", "content": "Summarize this document."}]
}, labels={"session_url": "https://support.example/chats/123", "tenant": "acme"})

if decision["action"] != "allow":
    raise RuntimeError(decision["reason"])
```

The API key selects the application and its policy/rules; an application ID is never trusted from request data. The client also exposes `create_job`, `get_job`, `wait_for_job`, and `list_profiles`.

Pipeline responses include `decision["decisionMode"] == "pipeline"` and `decision["policyTrace"]`, the ordered execution path. Enforce `decision["action"]`; pipeline `risk` encodes the action and is not a probability of harm. See the [Policy Playground guide](../../docs/policy-playground.md) for creating and publishing a policy.

## Cloud (unreleased source)

The cloud convenience endpoint is `https://api.pyro.delvisor.com`. TypeScript/Python cloud keys (`pyro_`) select it automatically; legacy/self-hosted keys retain localhost defaults. Rust uses `PyroClient::cloud`. Explicit base URLs always work for local tests, migrated legacy keys or custom hosting. Public DNS/service and package publication are separate launch steps; do not assume this source change is already available from a package registry.

```python
import os
from pyro import Pyro
pyro = Pyro(os.environ["PYRO_API_KEY"])
result = pyro.classify("Hello")
job = pyro.create_job("Hello", idempotency_key="operation-123")
```

Use keys on your backend. HTTP 402 stops semantic usage at a credit/platform limit; HTTP 429 indicates a request limit. Queued jobs can return a failed status with an exhaustion reason. Local-only checks do not consume cloud credits. Organization is derived from the authenticated key.

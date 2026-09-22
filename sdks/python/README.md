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

if decision["action"] == "block":
    raise RuntimeError(decision["reason"])
```

The API key selects the application and its policy/rules; an application ID is never trusted from request data. The client also exposes `create_job`, `get_job`, `wait_for_job`, and `list_profiles`.

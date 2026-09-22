from __future__ import annotations

import json
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


class PyroError(RuntimeError):
    def __init__(self, message: str, status: int | None = None, request_id: str | None = None):
        super().__init__(message)
        self.status = status
        self.request_id = request_id


class Pyro:
    def __init__(self, api_key: str, base_url: str = "http://localhost:8080", timeout: float = 10.0):
        if not api_key:
            raise ValueError("api_key is required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def classify(
        self,
        input: Any,
        *,
        profile: str | None = None,
        metadata: dict[str, Any] | None = None,
        labels: dict[str, str] | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        return self._request("POST", "/v1/classify", self._envelope(input, profile, metadata, labels), request_id)

    def create_job(
        self,
        input: Any,
        *,
        profile: str | None = None,
        metadata: dict[str, Any] | None = None,
        labels: dict[str, str] | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        return self._request("POST", "/v1/jobs", self._envelope(input, profile, metadata, labels), request_id)

    def get_job(self, job_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/jobs/{quote(job_id, safe='')}")

    def wait_for_job(self, job_id: str, *, interval: float = 0.25, timeout: float = 60.0) -> dict[str, Any]:
        started = time.monotonic()
        while time.monotonic() - started < timeout:
            job = self.get_job(job_id)
            if job.get("status") == "complete" and isinstance(job.get("decision"), dict):
                return job["decision"]
            if job.get("status") == "failed":
                raise PyroError(str(job.get("error") or "Classification job failed."), 500)
            time.sleep(interval)
        raise PyroError("Timed out waiting for classification job.", 408)

    def list_profiles(self) -> list[dict[str, Any]]:
        return self._request("GET", "/v1/profiles")

    @staticmethod
    def _envelope(
        input: Any,
        profile: str | None,
        metadata: dict[str, Any] | None,
        labels: dict[str, str] | None,
    ) -> dict[str, Any]:
        envelope: dict[str, Any] = {"input": input}
        if profile is not None:
            envelope["profile"] = profile
        if metadata is not None:
            envelope["metadata"] = metadata
        if labels is not None:
            envelope["labels"] = labels
        return envelope

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        request_id: str | None = None,
    ) -> Any:
        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        if request_id:
            headers["X-Request-Id"] = request_id
        encoded = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
        request = Request(f"{self.base_url}{path}", data=encoded, headers=headers, method=method)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            request_id_header = error.headers.get("X-Request-Id")
            try:
                payload = json.loads(error.read().decode("utf-8"))
                message = str(payload.get("error") or f"Request failed ({error.code}).")
            except (json.JSONDecodeError, UnicodeDecodeError):
                message = f"Request failed ({error.code})."
            raise PyroError(message, error.code, request_id_header) from error
        except URLError as error:
            raise PyroError(f"Could not reach Pyro: {error.reason}") from error

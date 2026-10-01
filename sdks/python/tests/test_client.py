import json
import unittest
from unittest.mock import patch

from pyro import Pyro


class FakeResponse:
    headers = {"Content-Type": "application/json"}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return json.dumps({"id": "decision-1", "action": "allow"}).encode()


class ClientTest(unittest.TestCase):
    @patch("pyro.client.urlopen", return_value=FakeResponse())
    def test_classify_sends_an_authenticated_envelope(self, mocked_urlopen):
        client = Pyro("pf_test")
        result = client.classify("hello", profile="strict", labels={"session_url": "https://example.test/chats/123"})
        request = mocked_urlopen.call_args.args[0]
        self.assertEqual(result["id"], "decision-1")
        self.assertEqual(request.get_header("Authorization"), "Bearer pf_test")
        self.assertEqual(json.loads(request.data), {"input": "hello", "profile": "strict", "labels": {"session_url": "https://example.test/chats/123"}})

    @patch("pyro.client.urlopen", return_value=FakeResponse())
    def test_cloud_default_and_explicit_local_override(self, mocked_urlopen):
        Pyro("pyro_test").create_job("hello", idempotency_key="same-operation")
        request = mocked_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.pyro.delvisor.com/v1/jobs")
        self.assertEqual(request.get_header("Idempotency-key"), "same-operation")
        self.assertEqual(Pyro("pyro_test", base_url="http://localhost:8082").base_url, "http://localhost:8082")
        self.assertEqual(Pyro("pf_test").base_url, "http://localhost:8080")


if __name__ == "__main__":
    unittest.main()
